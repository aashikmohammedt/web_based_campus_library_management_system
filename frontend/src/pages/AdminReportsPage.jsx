import { useState, useEffect, useCallback, useRef } from "react";
import { apiRequest, downloadExcel } from "../api";
import { getToken } from "../auth";
import "./AdminReportsPage.css";

// ─── Date helpers ─────────────────────────────────────────────────────────────

/** Returns today's date as "YYYY-MM-DD" in local time. */
function todayISO() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

/** Returns the current month as "YYYY-MM". */
function currentMonthISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Returns the current year as a string. */
function currentYearStr() {
    return String(new Date().getFullYear());
}

// ─── Quick-report button definitions ─────────────────────────────────────────
//
// PATHS HAVE NO "/api/" PREFIX.
// api.js → API_BASE already ends with "/api" (fallback: "http://localhost:4000/api").
// Passing "/api/admin/..." would produce "…/api/api/admin/…" → 404.
// App.jsx confirms the convention: apiRequest("/auth/me"), not "/api/auth/me".

const QUICK_REPORTS = [
    { id: "today", label: "Today", endpoint: "/admin/reports/today" },
    { id: "week", label: "This Week", endpoint: "/admin/reports/week" },
    { id: "month", label: "This Month", endpoint: "/admin/reports/month" },
    { id: "year", label: "This Year", endpoint: "/admin/reports/year" },
];

// ─── Stat card definitions ────────────────────────────────────────────────────

const STAT_CARDS = [
    { key: "totalTransactions", label: "Total Transactions", description: "Every reservation created in this period", accent: "primary" },
    { key: "totalPreBookings", label: "Pre-Bookings", description: "Student booked online (isWalkIn = false)", accent: "blue" },
    { key: "totalWalkInCheckouts", label: "Walk-in Checkouts", description: "Admin created at counter (isWalkIn = true)", accent: "blue" },
    { key: "totalCollected", label: "Collected", description: "Book physically out with student", accent: "green" },
    { key: "totalReturned", label: "Returned", description: "Book back on shelf", accent: "green" },
    { key: "totalCancelled", label: "Cancelled", description: "Manually cancelled by student or admin", accent: "orange" },
    { key: "totalExpired", label: "Expired", description: "24-h pickup window missed (auto)", accent: "orange" },
    { key: "totalOverdueActive", label: "Overdue (Active)", description: "Collected + dueDate passed — still outstanding", accent: "red" },
    { key: "totalDamaged", label: "Damaged", description: "isBookDamaged = true (any status)", accent: "red" },
    { key: "totalLost", label: "Lost", description: "isBookLost = true (any status)", accent: "red" },
];

// ─── Token validation helper ──────────────────────────────────────────────────
//
// Wraps the imported getToken() (from auth.js — same source as apiRequest uses)
// and additionally rejects the literal strings "undefined" / "null" that appear
// when an undefined value is accidentally written to localStorage.

function hasValidToken() {
    const t = getToken();
    return Boolean(t && t !== "undefined" && t !== "null" && t.trim() !== "");
}

// ─── Main Page Component ──────────────────────────────────────────────────────

export default function AdminReportsPage({ onBack }) {

    // ── State ────────────────────────────────────────────────────────────────

    const [activeQuickId, setActiveQuickId] = useState(null);
    const [last10Days, setLast10Days] = useState([]);
    const [last10Loading, setLast10Loading] = useState(true);
    const [last10Error, setLast10Error] = useState(null);
    const [activeDayLabel, setActiveDayLabel] = useState(null);

    const [rangeMode, setRangeMode] = useState("date");   // "date"|"month"|"year"
    const [dateFrom, setDateFrom] = useState(todayISO());
    const [dateTo, setDateTo] = useState(todayISO());
    const [monthFrom, setMonthFrom] = useState(currentMonthISO());
    const [monthTo, setMonthTo] = useState(currentMonthISO());
    const [yearFrom, setYearFrom] = useState(currentYearStr());
    const [yearTo, setYearTo] = useState(currentYearStr());

    const [report, setReport] = useState(null);
    const [reportLoading, setReportLoading] = useState(false);
    const [reportError, setReportError] = useState(null);
    const [exporting, setExporting] = useState(false);

    const [catalogueReport, setCatalogueReport] = useState(null);
    const [catalogueLoading, setCatalogueLoading] = useState(false);
    const [catalogueError, setCatalogueError] = useState("");
    const [catalogueExporting, setCatalogueExporting] = useState(false);
    const [cataloguePage, setCataloguePage] = useState(1);

    const [toast, setToast] = useState(null);
    const toastTimerRef = useRef(null);

    // ── Toast helper ─────────────────────────────────────────────────────────

    function showToast(message, type = "error", duration = 4000) {
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        setToast({ message, type });
        toastTimerRef.current = setTimeout(() => setToast(null), duration);
    }

    useEffect(() => () => clearTimeout(toastTimerRef.current), []);

    // ── Fetch helper ──────────────────────────────────────────────────────────

    /**
     * Hits any reservation-report endpoint and stores the result.
     *
     * KEY FIXES vs the old version:
     *
     * 1. Token guard now calls getToken() from ../auth — the EXACT same function
     *    that apiRequest() uses internally.  The old file had its own local
     *    getToken() that read from localStorage independently; even when both
     *    returned a truthy value they could disagree on which key to use, causing
     *    the guard to pass while apiRequest sent no Authorization header (401).
     *
     * 2. Paths have no "/api/" prefix — see QUICK_REPORTS comment above.
     */
    const fetchReport = useCallback(async (path, quickId = null, dayLabel = null) => {
        setReportLoading(true);
        setReportError(null);
        setReport(null);
        setActiveQuickId(quickId);
        setActiveDayLabel(dayLabel);

        if (!hasValidToken()) {
            setReportError("Admin session expired. Please log in again.");
            setReportLoading(false);
            return;
        }

        try {
            const data = await apiRequest(path);
            setReport(data?.report ?? null);
        } catch (err) {
            setReportError(err.message || "Failed to load report");
        } finally {
            setReportLoading(false);
        }
    }, []);

    // ── Load last-10-days strip on mount ──────────────────────────────────────

    useEffect(() => {
        async function loadLast10() {
            setLast10Loading(true);
            setLast10Error(null);

            if (!hasValidToken()) {
                setLast10Error("Admin session expired. Please log in again.");
                setLast10Loading(false);
                return;
            }

            try {
                // FIX: was "/api/admin/reports/last-10-days" → double-prefix 404
                const data = await apiRequest("/admin/reports/last-10-days");
                setLast10Days(Array.isArray(data?.days) ? data.days : []);
            } catch (err) {
                setLast10Error(err.message || "Failed to load last 10 days");
            } finally {
                setLast10Loading(false);
            }
        }

        loadLast10();
    }, []);

    // ── Auto-load "Today" on first mount ──────────────────────────────────────

    useEffect(() => {
        // FIX: was "/api/admin/reports/today" → double-prefix 404
        fetchReport("/admin/reports/today", "today", null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Quick report handlers ─────────────────────────────────────────────────

    function handleQuickReport(btn) {
        fetchReport(btn.endpoint, btn.id, null);
    }

    // ── Last-10-days day click ────────────────────────────────────────────────

    function handleDayClick(day) {
        // FIX: was "/api/admin/reports/day/..." → double-prefix 404
        fetchReport(`/admin/reports/day/${day.date}`, null, day.label);
    }

    // ── Manual range handler ──────────────────────────────────────────────────

    function handleGenerateReport() {
        const currentYear = Number(currentYearStr());
        let fromDate, toDate;

        if (rangeMode === "date") {
            if (!dateFrom || !dateTo) {
                showToast("Please select both a From and To date.");
                return;
            }
            if (dateFrom > dateTo) {
                showToast("\"From\" date must be on or before the \"To\" date.");
                return;
            }
            fromDate = dateFrom;
            toDate = dateTo;

        } else if (rangeMode === "month") {
            if (!monthFrom || !monthTo) {
                showToast("Please select both a From and To month.");
                return;
            }
            if (monthFrom > monthTo) {
                showToast("\"From\" month must be on or before the \"To\" month.");
                return;
            }
            fromDate = `${monthFrom}-01`;
            const [toYear, toMon] = monthTo.split("-").map(Number);
            toDate = `${monthTo}-${String(new Date(toYear, toMon, 0).getDate()).padStart(2, "0")}`;

        } else if (rangeMode === "year") {
            if (!yearFrom.trim() || !yearTo.trim()) {
                showToast("Please enter both a From and To year.");
                return;
            }

            const from = Number(yearFrom);
            const to = Number(yearTo);

            if (!Number.isInteger(from) || !Number.isInteger(to) ||
                String(yearFrom).includes(".") || String(yearTo).includes(".")) {
                showToast("Years must be whole numbers (e.g. 2023).");
                return;
            }
            if (String(from).length !== 4 || String(to).length !== 4) {
                showToast("Years must be 4-digit numbers (e.g. 2023).");
                return;
            }
            if (from < 2000 || to < 2000) {
                showToast("Years must be 2000 or later.");
                return;
            }
            if (from > currentYear || to > currentYear) {
                showToast(`Years cannot exceed the current year (${currentYear}).`);
                return;
            }
            if (from > to) {
                showToast("\"From\" year must be less than or equal to the \"To\" year.");
                return;
            }

            fromDate = `${from}-01-01`;
            toDate = `${to}-12-31`;
        }

        if (fromDate && toDate) {
            // FIX: was "/api/admin/reports/range?..." → double-prefix 404
            const params = new URLSearchParams({ mode: rangeMode, from: fromDate, to: toDate });
            fetchReport(`/admin/reports/range?${params}`, null, null);
        }
    }

    // ── Reservation report export ─────────────────────────────────────────────

    /**
     * FIX: replaced the old local downloadBlob() helper with downloadExcel()
     * from api.js.
     *
     * Why downloadBlob() was broken:
     *   - It built the base URL from import.meta.env.VITE_API_BASE_URL directly,
     *     which may or may not include "/api", making the final URL unpredictable.
     *   - It read the token from its own local getToken() — a different code path
     *     than apiRequest() uses — so auth could silently diverge.
     *
     * downloadExcel() from api.js:
     *   - Uses the shared API_BASE constant (already normalised).
     *   - Uses the same getToken() from auth.js that apiRequest() uses.
     *   - Handles Content-Disposition filename extraction automatically.
     *
     * All paths: no "/api/" prefix.
     */
    async function handleExport() {
        if (!report) return;
        setExporting(true);
        try {
            let endpoint, filename;

            if (activeQuickId) {
                // FIX: was "/api/admin/reports/${activeQuickId}/export"
                endpoint = `/admin/reports/${activeQuickId}/export`;
                filename = `report-${activeQuickId}.xlsx`;

            } else if (activeDayLabel) {
                const day = last10Days.find((d) => d.label === activeDayLabel);
                const isoDate = day?.date;
                if (!isoDate) {
                    showToast("Could not resolve day date for export.", "error");
                    return;
                }
                // FIX: was "/api/admin/reports/day/${isoDate}/export"
                endpoint = `/admin/reports/day/${isoDate}/export`;
                filename = `report-${isoDate}.xlsx`;

            } else {
                let fromDate, toDate;

                if (rangeMode === "date") {
                    fromDate = dateFrom;
                    toDate = dateTo;
                    filename = `report-${dateFrom}-to-${dateTo}.xlsx`;

                } else if (rangeMode === "month") {
                    fromDate = `${monthFrom}-01`;
                    const [toYear, toMon] = monthTo.split("-").map(Number);
                    toDate = `${monthTo}-${String(new Date(toYear, toMon, 0).getDate()).padStart(2, "0")}`;
                    filename = `report-${monthFrom}-to-${monthTo}.xlsx`;

                } else {
                    fromDate = `${yearFrom}-01-01`;
                    toDate = `${yearTo}-12-31`;
                    filename = `report-${yearFrom}-to-${yearTo}.xlsx`;
                }

                // FIX: was "/api/admin/reports/range/export?..."
                const params = new URLSearchParams({ mode: rangeMode, from: fromDate, to: toDate });
                endpoint = `/admin/reports/range/export?${params}`;
            }

            await downloadExcel(endpoint, filename);
        } catch (err) {
            showToast(err.message || "Export failed", "error");
        } finally {
            setExporting(false);
        }
    }

    // ── Catalogue handlers ────────────────────────────────────────────────────

    /**
     * FIX: replaced raw fetch() with apiRequest() from api.js.
     *
     * The old code used getApiBase() (which returned VITE_API_BASE_URL directly)
     * combined with a "/api/..." path, producing a double-prefix URL, and used
     * its own local auth logic instead of the shared auth.js token.
     *
     * Path: no "/api/" prefix.
     */
    async function handleGenerateCatalogueReport() {
        setCatalogueLoading(true);
        setCatalogueError("");
        setCatalogueReport(null);
        setCataloguePage(1);

        if (!hasValidToken()) {
            setCatalogueError("Admin session expired. Please log in again.");
            setCatalogueLoading(false);
            return;
        }

        try {
            // FIX: was raw fetch(`${base}/api/admin/reports/book-catalogue`, ...)
            const data = await apiRequest("/admin/reports/book-catalogue");
            setCatalogueReport(data?.report ?? null);
        } catch (err) {
            setCatalogueError(err.message || "Failed to load catalogue report");
        } finally {
            setCatalogueLoading(false);
        }
    }

    /**
     * FIX: replaced raw fetch() + manual blob handling with downloadExcel().
     * Same reasoning as handleExport() above.
     * Path: no "/api/" prefix.
     */
    async function handleExportCatalogue() {
        if (!catalogueReport) return;
        setCatalogueExporting(true);

        if (!hasValidToken()) {
            showToast("Admin session expired. Please log in again.", "error");
            setCatalogueExporting(false);
            return;
        }

        try {
            // FIX: was raw fetch(`${base}/api/admin/reports/book-catalogue/export`, ...)
            await downloadExcel("/admin/reports/book-catalogue/export", "Book_Catalogue_Report.xlsx");
        } catch (err) {
            showToast(err.message || "Catalogue export failed", "error");
        } finally {
            setCatalogueExporting(false);
        }
    }

    // ── Status badge helper ───────────────────────────────────────────────────

    function getCatalogueStatusClass(status) {
        switch (status) {
            case "Fully Available": return "available";
            case "Partially Available": return "partial";
            case "Reserved": return "reserved";
            case "Fully Issued": return "issued";
            case "Fully Overdue": return "overdue";
            case "Lost": return "lost";
            case "Damaged": return "damaged";
            default: return "available";
        }
    }

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div className="admin-reports-page">

            {/* ── VALIDATION TOAST ────────────────────────────────────────────── */}
            {toast && (
                <div
                    className={`reports-toast reports-toast--${toast.type}`}
                    role="alert"
                    aria-live="assertive"
                >
                    <span className="reports-toast-message">{toast.message}</span>
                    <button
                        className="reports-toast-close"
                        onClick={() => setToast(null)}
                        aria-label="Dismiss"
                    >
                        ✕
                    </button>
                </div>
            )}

            {/* ── HEADER ──────────────────────────────────────────────────────── */}
            <div className="reports-header">
                <button
                    className="reports-back-btn"
                    onClick={onBack}
                    aria-label="Go back"
                >
                    ← Back
                </button>
                <div className="reports-header-text">
                    <h1 className="reports-title">Reports &amp; Analytics</h1>
                    <p className="reports-subtitle">
                        View daily, weekly, monthly, yearly and custom library usage reports.
                    </p>
                </div>
            </div>

            {/* ── QUICK REPORT BUTTONS ─────────────────────────────────────────── */}
            <section className="reports-section">
                <h2 className="reports-section-title">Quick Reports</h2>
                <div className="quick-report-buttons">
                    {QUICK_REPORTS.map((btn) => (
                        <button
                            key={btn.id}
                            className={`quick-report-btn ${activeQuickId === btn.id ? "quick-report-btn--active" : ""}`}
                            onClick={() => handleQuickReport(btn)}
                            disabled={reportLoading}
                            aria-pressed={activeQuickId === btn.id}
                        >
                            {btn.label}
                        </button>
                    ))}
                </div>
            </section>

            {/* ── LAST 10 DAYS STRIP ───────────────────────────────────────────── */}
            <section className="reports-section">
                <h2 className="reports-section-title">Last 10 Days</h2>

                {last10Loading && (
                    <p className="reports-loading-text">Loading last 10 days…</p>
                )}
                {last10Error && !last10Loading && (
                    <div className="last10-error-row">
                        <p className="reports-error-text">{last10Error}</p>
                        <button
                            className="last10-retry-btn"
                            onClick={() => {
                                setLast10Loading(true);
                                setLast10Error(null);
                                setLast10Days([]);
                                (async () => {
                                    try {
                                        const data = await apiRequest("/admin/reports/last-10-days");
                                        setLast10Days(Array.isArray(data?.days) ? data.days : []);
                                    } catch (err) {
                                        setLast10Error(err.message || "Failed to load last 10 days");
                                    } finally {
                                        setLast10Loading(false);
                                    }
                                })();
                            }}
                        >
                            ↺ Retry
                        </button>
                    </div>
                )}
                {!last10Loading && !last10Error && last10Days.length === 0 && (
                    <p className="reports-empty-text">No transaction data available for the last 10 days.</p>
                )}
                {!last10Loading && !last10Error && last10Days.length > 0 && (
                    <div className="last10-strip">
                        {last10Days.map((day) => (
                            <button
                                key={day.label}
                                className={`last10-day-btn ${activeDayLabel === day.label ? "last10-day-btn--active" : ""}`}
                                onClick={() => handleDayClick(day)}
                                disabled={reportLoading}
                                aria-pressed={activeDayLabel === day.label}
                            >
                                <span className="last10-day-label">{day.label}</span>
                                <span className="last10-day-count">
                                    {day?.totalTransactions ?? 0} transaction{(day?.totalTransactions ?? 0) !== 1 ? "s" : ""}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </section>

            {/* ── MANUAL RANGE FILTER ──────────────────────────────────────────── */}
            <section className="reports-section">
                <h2 className="reports-section-title">Custom Range</h2>

                <div className="range-mode-tabs" role="tablist" aria-label="Range mode">
                    {["date", "month", "year"].map((mode) => (
                        <button
                            key={mode}
                            role="tab"
                            aria-selected={rangeMode === mode}
                            className={`range-mode-tab ${rangeMode === mode ? "range-mode-tab--active" : ""}`}
                            onClick={() => setRangeMode(mode)}
                        >
                            {mode === "date" && "Date Range"}
                            {mode === "month" && "Month Range"}
                            {mode === "year" && "Year Range"}
                        </button>
                    ))}
                </div>

                <div className="range-inputs">
                    {rangeMode === "date" && (
                        <>
                            <label className="range-label">
                                From
                                <input
                                    type="date"
                                    className="range-input"
                                    value={dateFrom}
                                    max={dateTo || todayISO()}
                                    onChange={(e) => setDateFrom(e.target.value)}
                                />
                            </label>
                            <label className="range-label">
                                To
                                <input
                                    type="date"
                                    className="range-input"
                                    value={dateTo}
                                    min={dateFrom}
                                    max={todayISO()}
                                    onChange={(e) => setDateTo(e.target.value)}
                                />
                            </label>
                        </>
                    )}

                    {rangeMode === "month" && (
                        <>
                            <label className="range-label">
                                From
                                <input
                                    type="month"
                                    className="range-input"
                                    value={monthFrom}
                                    max={monthTo || currentMonthISO()}
                                    onChange={(e) => setMonthFrom(e.target.value)}
                                />
                            </label>
                            <label className="range-label">
                                To
                                <input
                                    type="month"
                                    className="range-input"
                                    value={monthTo}
                                    min={monthFrom}
                                    max={currentMonthISO()}
                                    onChange={(e) => setMonthTo(e.target.value)}
                                />
                            </label>
                        </>
                    )}

                    {rangeMode === "year" && (
                        <>
                            <label className="range-label">
                                From
                                <input
                                    type="number"
                                    className="range-input"
                                    value={yearFrom}
                                    min="2000"
                                    max={currentYearStr()}
                                    onChange={(e) => setYearFrom(e.target.value)}
                                />
                            </label>
                            <label className="range-label">
                                To
                                <input
                                    type="number"
                                    className="range-input"
                                    value={yearTo}
                                    min="2000"
                                    max={currentYearStr()}
                                    onChange={(e) => setYearTo(e.target.value)}
                                />
                            </label>
                        </>
                    )}
                </div>

                <button
                    className="generate-report-btn"
                    onClick={handleGenerateReport}
                    disabled={reportLoading}
                >
                    {reportLoading ? "Generating…" : "Generate Report"}
                </button>
            </section>

            {/* ── BOOK CATALOGUE REPORT ────────────────────────────────────────── */}
            <section className="reports-section">
                <h2 className="reports-section-title">
                    Book Catalogue Status
                    {catalogueReport && (
                        <button
                            className="export-excel-btn"
                            onClick={handleExportCatalogue}
                            disabled={catalogueExporting}
                            style={{ marginLeft: "auto", fontSize: "0.85rem", padding: "0.3rem 0.9rem" }}
                        >
                            {catalogueExporting ? "Exporting…" : "⬇ Export Excel"}
                        </button>
                    )}
                </h2>

                <button
                    className="generate-report-btn"
                    onClick={handleGenerateCatalogueReport}
                    disabled={catalogueLoading}
                >
                    {catalogueLoading ? "Loading…" : "Generate Catalogue Report"}
                </button>

                {catalogueLoading && (
                    <p className="reports-loading-text">Loading catalogue…</p>
                )}
                {catalogueError && !catalogueLoading && (
                    <p className="reports-error-text">{catalogueError}</p>
                )}

                {!catalogueLoading && !catalogueError && catalogueReport && (
                    <>
                        <p className="reports-subtitle" style={{ marginTop: "0.5rem" }}>
                            {catalogueReport.totalTitles ?? 0} title{(catalogueReport.totalTitles ?? 0) !== 1 ? "s" : ""} ·{" "}
                            {catalogueReport.totalCopies ?? 0} total cop{(catalogueReport.totalCopies ?? 0) !== 1 ? "ies" : "y"} ·{" "}
                            {catalogueReport.totalAvailable ?? 0} available
                        </p>

                        {catalogueReport.books?.length > 0 ? (
                            <>
                                <div className="reports-table-wrapper">
                                    <table className="reports-table">
                                        <thead>
                                            <tr>
                                                <th>#</th>
                                                <th>Title</th>
                                                <th>Author</th>
                                                <th>Department</th>
                                                <th>Course Code</th>
                                                <th>Location</th>
                                                <th>Total</th>
                                                <th>Available</th>
                                                <th>Reserved</th>
                                                <th>Collected</th>
                                                <th>Overdue</th>
                                                <th>Lost</th>
                                                <th>Damaged</th>
                                                <th>Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {catalogueReport.books
                                                .slice((cataloguePage - 1) * 10, cataloguePage * 10)
                                                .map((book, idx) => (
                                                    <tr key={book?.bookId ?? idx}>
                                                        <td>{(cataloguePage - 1) * 10 + idx + 1}</td>
                                                        <td>{book?.title}</td>
                                                        <td>{book?.author}</td>
                                                        <td>{book?.department}</td>
                                                        <td>{book?.courseCode}</td>
                                                        <td>{book?.location}</td>
                                                        <td>{book?.totalCopies ?? 0}</td>
                                                        <td>{book?.availableCopies ?? 0}</td>
                                                        <td>{book?.reservedCount ?? 0}</td>
                                                        <td>{book?.collectedCount ?? 0}</td>
                                                        <td>{book?.overdueCount ?? 0}</td>
                                                        <td>{book?.lostCount ?? 0}</td>
                                                        <td>{book?.damagedCount ?? 0}</td>
                                                        <td>
                                                            <span className={`catalogue-status-badge catalogue-status-badge--${getCatalogueStatusClass(book?.catalogueStatus)}`}>
                                                                {book?.catalogueStatus ?? "—"}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                        </tbody>
                                    </table>
                                </div>

                                {catalogueReport.books.length > 10 && (
                                    <div className="catalogue-pagination">
                                        <button
                                            className="catalogue-pagination-btn"
                                            onClick={() => setCataloguePage((p) => p - 1)}
                                            disabled={cataloguePage === 1}
                                        >
                                            ← Prev
                                        </button>
                                        {Array.from(
                                            { length: Math.ceil(catalogueReport.books.length / 10) },
                                            (_, i) => i + 1
                                        ).map((page) => (
                                            <button
                                                key={page}
                                                className={`catalogue-pagination-btn ${cataloguePage === page ? "catalogue-pagination-btn--active" : ""}`}
                                                onClick={() => setCataloguePage(page)}
                                            >
                                                {page}
                                            </button>
                                        ))}
                                        <button
                                            className="catalogue-pagination-btn"
                                            onClick={() => setCataloguePage((p) => p + 1)}
                                            disabled={cataloguePage === Math.ceil(catalogueReport.books.length / 10)}
                                        >
                                            Next →
                                        </button>
                                    </div>
                                )}
                            </>
                        ) : (
                            <p className="reports-empty-text" style={{ marginTop: "1rem" }}>
                                No books found in catalogue.
                            </p>
                        )}
                    </>
                )}
            </section>

            {/* ── RESERVATION REPORT RESULTS ───────────────────────────────────────
                Fully isolated from catalogue state.                               */}
            <section className="reports-section">
                <h2 className="reports-section-title">
                    Results
                    {report?.label && (
                        <span className="reports-result-label"> — {report.label}</span>
                    )}
                    {report && (
                        <button
                            className="export-excel-btn"
                            onClick={handleExport}
                            disabled={exporting}
                            style={{ marginLeft: "auto", fontSize: "0.85rem", padding: "0.3rem 0.9rem" }}
                        >
                            {exporting ? "Exporting…" : "⬇ Export Excel"}
                        </button>
                    )}
                </h2>

                {reportLoading && (
                    <p className="reports-loading-text">Generating report…</p>
                )}
                {reportError && !reportLoading && (
                    <p className="reports-error-text">{reportError}</p>
                )}
                {!reportLoading && !reportError && !report && (
                    <p className="reports-empty-text">
                        Select a quick report or use the custom range filter above.
                    </p>
                )}

                {!reportLoading && !reportError && report && (
                    <>
                        {(report?.fromDate || report?.toDate) && (() => {
                            const from = new Date(report.fromDate);
                            const to = new Date(report.toDate);

                            const formattedDate = from.toLocaleDateString("en-GB");

                            const formattedFromTime = from.toLocaleTimeString("en-IN", {
                                hour: "2-digit",
                                minute: "2-digit",
                                hour12: true,
                            });

                            const formattedToTime = to.toLocaleTimeString("en-IN", {
                                hour: "2-digit",
                                minute: "2-digit",
                                hour12: true,
                            });

                            return (
                                <p className="reports-subtitle" style={{ marginTop: 0 }}>
                                    {formattedDate} • {formattedFromTime} – {formattedToTime}
                                </p>
                            );
                        })()}

                        <div className="stat-cards-grid">
                            {STAT_CARDS.map((card) => (
                                <div key={card.key} className={`stat-card stat-card--${card.accent}`}>
                                    <span className="stat-card-value">{report?.[card.key] ?? 0}</span>
                                    <span className="stat-card-label">{card.label}</span>
                                    <span className="stat-card-description">{card.description}</span>
                                </div>
                            ))}
                        </div>

                        <div className="top-books-section">
                            <h3 className="top-books-title">Top 5 Books</h3>
                            {report?.topBooks && report.topBooks.length > 0 ? (
                                <ol className="top-books-list">
                                    {report.topBooks.map((book, index) => (
                                        <li key={book?.bookId ?? index} className="top-books-item">
                                            <span className="top-books-rank">#{index + 1}</span>
                                            <div className="top-books-info">
                                                <span className="top-books-book-title">{book?.title}</span>
                                                <span className="top-books-author">{book?.author}</span>
                                            </div>
                                            <span className="top-books-count">
                                                {book?.count ?? 0} reservation{(book?.count ?? 0) !== 1 ? "s" : ""}
                                            </span>
                                        </li>
                                    ))}
                                </ol>
                            ) : (
                                <p className="reports-empty-text">No book data for this period.</p>
                            )}
                        </div>
                    </>
                )}
            </section>

        </div>
    );
}