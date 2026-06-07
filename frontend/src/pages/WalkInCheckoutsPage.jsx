import { useCallback, useEffect, useMemo, useState } from "react";
import WalkInCheckoutModal from "../components/WalkInCheckoutModal";
import "../pages/WalkInCheckoutsPage.css";

/* ── Helpers ─────────────────────────────────────────────── */
function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const d  = String(date.getDate()).padStart(2, "0");
  const m  = String(date.getMonth() + 1).padStart(2, "0");
  const y  = date.getFullYear();
  let   hr = date.getHours();
  const mn = String(date.getMinutes()).padStart(2, "0");
  const ampm = hr >= 12 ? "PM" : "AM";
  hr = hr % 12 || 12;
  return (
    <span className="wicp-datetime">
      <span className="wicp-datetime-date">{d}/{m}/{y}</span>
      <span className="wicp-datetime-time">{String(hr).padStart(2, "0")}:{mn} {ampm}</span>
    </span>
  );
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

function getDerivedWalkInStatus(reservation) {
  if (!reservation) return "returned";
  if (reservation.status === "returned") return "returned";
  if (reservation.status === "cancelled" || reservation.status === "expired")
    return "hidden";
  const due = reservation.dueDate ? new Date(reservation.dueDate) : null;
  // All due dates are enforced at 5:00 PM — matches server and ReservationList logic
  if (due && !Number.isNaN(due.getTime())) due.setHours(17, 0, 0, 0);
  if (
    reservation.status === "collected" &&
    due &&
    !Number.isNaN(due.getTime()) &&
    due < new Date()
  )
    return "overdue";
  if (reservation.status === "collected") return "active";
  return "hidden";
}

function getStudentName(reservation) {
  return reservation?.user?.name || "Unknown Student";
}

function getStudentId(reservation) {
  return reservation?.user?.studentId || "—";
}

function getBookTitle(reservation) {
  return reservation?.book?.title || "Untitled Book";
}

function getCheckedOutDate(reservation) {
  return (
    reservation?.collectedAt ||
    reservation?.createdAt ||
    reservation?.reservedAt ||
    null
  );
}

function getOverdueDays(reservation) {
  const due = reservation?.dueDate ? new Date(reservation.dueDate) : null;
  if (!due || Number.isNaN(due.getTime())) return 0;
  // All due dates are enforced at 5:00 PM — matches server and ReservationList logic
  due.setHours(17, 0, 0, 0);
  // For returned books use the actual return date, not today — otherwise
  // a book returned weeks ago would accumulate phantom overdue days.
  const endDate = reservation?.returnedAt
    ? new Date(reservation.returnedAt)
    : new Date();
  if (due >= endDate) return 0;
  return Math.max(1, Math.ceil((endDate - due) / 86400000));
}

/* ── Avatar helpers — mirrors StudentDetailsPage exactly ─── */

// Backend origin for resolving relative image paths
const API_BASE = (
  typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL
    ? import.meta.env.VITE_API_URL
    : "http://localhost:4000"
).replace(/\/$/, "");

// Reads whichever field the backend puts the profile image in
function getProfileImageUrl(user) {
  return (
    user?.profileImage ||
    user?.profile_image ||
    user?.profile_pic ||
    user?.photo ||
    user?.avatar ||
    user?.image_url ||
    user?.photo_url ||
    null
  );
}

// Turns a relative path like "uploads/abc.jpg" into a full URL
function resolveImageUrl(raw) {
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  const clean = raw.replace(/^\/+/, "");
  if (clean.startsWith("uploads/")) return `${API_BASE}/${clean}`;
  return `${API_BASE}/uploads/${clean}`;
}

// Returns up to 2 uppercase initials from a full name
function getInitials(name) {
  return String(name || "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || "")
    .join("") || "?";
}

// Avatar component: shows profile photo when available, falls back to initials
function StudentAvatar({ user, name }) {
  const [imgError, setImgError] = useState(false);
  const profileImageUrl = resolveImageUrl(getProfileImageUrl(user));
  const showImage = profileImageUrl && !imgError;

  return (
    <div className="wicp-avatar">
      {showImage ? (
        <img
          src={profileImageUrl}
          alt={name}
          className="wicp-avatar__img"
          onError={() => setImgError(true)}
        />
      ) : (
        getInitials(name)
      )}
    </div>
  );
}

/* ── SVG Icons ───────────────────────────────────────────── */
const IconBooks = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);

const IconCheckCircle = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

const IconAlertTriangle = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const IconCornerDownLeft = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 10 4 15 9 20" />
    <path d="M20 4v7a4 4 0 0 1-4 4H4" />
  </svg>
);

const IconSearch = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const IconTrash = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14H6L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4h6v2" />
  </svg>
);

const IconDamaged = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

const IconLost = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
    <line x1="11" y1="8" x2="11" y2="14" />
    <line x1="8" y1="11" x2="14" y2="11" />
  </svg>
);

const IconInbox = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
    <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </svg>
);

const IconWalkIn = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="5" r="1" />
    <path d="M9 20l1-5 2 2 1-4" />
    <path d="M6 10l2-3h4l2 3" />
    <path d="M6 10l-1 4h3" />
    <path d="M16 10l1 4h-3" />
  </svg>
);

const IconReturnBtn = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 10 4 15 9 20" />
    <path d="M20 4v7a4 4 0 0 1-4 4H4" />
  </svg>
);

/* ── Status badge config ─────────────────────────────────── */
const BADGE_MAP = {
  active:   { label: "Active",   cls: "wicp-badge-active"   },
  overdue:  { label: "Overdue",  cls: "wicp-badge-overdue"  },
  returned: { label: "Returned", cls: "wicp-badge-returned" },
  damaged:  { label: "Damaged",  cls: "wicp-badge-damaged"  },
  lost:     { label: "Lost",     cls: "wicp-badge-lost"     },
};

/* ── Filter chip config ──────────────────────────────────── */
const FILTER_CHIPS = [
  { value: "all",       label: "All"       },
  { value: "collected", label: "Collected" },
  { value: "overdue",   label: "Overdue"   },
  { value: "returned",  label: "Returned"  },
  { value: "damaged",   label: "Damaged"   },
  { value: "lost",      label: "Lost"      },
];

/* ── Stat card config ────────────────────────────────────── */
const STAT_CARDS = [
  { key: "all",      label: "All",      tone: "",              icon: <IconBooks />          },
  { key: "active",   label: "Active",   tone: "tone-green",    icon: <IconCheckCircle />    },
  { key: "overdue",  label: "Overdue",  tone: "tone-amber",    icon: <IconAlertTriangle />  },
  { key: "returned", label: "Returned", tone: "tone-purple",   icon: <IconCornerDownLeft /> },
  { key: "damaged",  label: "Damaged",  tone: "tone-orange",   icon: <IconDamaged />        },
  { key: "lost",     label: "Lost",     tone: "tone-red",      icon: <IconLost />           },
]

/* ── Pure renderers (no component state needed) ──────────── */
function formatCurrency(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num <= 0) return "₹0";
  return `₹${num}`;
}

/* ── Damaged Walk-In Section ─────────────────────────────── */
function DamagedSection({ records }) {
  if (records.length === 0) return (
    <div className="wicp-section">
      <div className="wicp-section-header wicp-section-header--damaged">
        <span className="wicp-section-icon wicp-section-icon--damaged"><IconDamaged /></span>
        <h3 className="wicp-section-title">Damaged Books</h3>
        <span className="wicp-section-count wicp-section-count--damaged">0</span>
      </div>
      <div className="wicp-empty wicp-section-empty">
        <div className="wicp-empty-icon"><IconInbox /></div>
        <h3 className="wicp-empty-title">No damaged walk-in books</h3>
        <p className="wicp-empty-sub">Walk-in books marked as damaged will appear here</p>
      </div>
    </div>
  );

  return (
    <div className="wicp-section">
      <div className="wicp-section-header wicp-section-header--damaged">
        <span className="wicp-section-icon wicp-section-icon--damaged"><IconDamaged /></span>
        <h3 className="wicp-section-title">Damaged Books</h3>
        <span className="wicp-section-count wicp-section-count--damaged">{records.length}</span>
      </div>
      <div className="wicp-table-card">
        <div className="wicp-table-wrap">
          <table className="wicp-table">
            <thead>
              <tr>
                <th className="wicp-col-num">#</th>
                <th>Student</th>
                <th>Book</th>
                <th>Checked Out</th>
                <th>Marked Damaged</th>
                <th>Damage Fine</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r, i) => {
                const fine   = Number(r.damageFine || 0);
                const paid   = r.damageFinePaid;
                const fineLabel = fine > 0 ? `₹${fine}` : "₹0";
                // Payment is atomic with marking damaged — also check timestamp and status flag
                const effectivePaid =
                  paid === true ||
                  !!r.damageFinePaidAt ||
                  r.status === "damaged" ||
                  r.isBookDamaged === true;
                const statusLabel = effectivePaid ? "Paid" : (paid === false ? "Pending" : null);
                return (
                  <tr key={r._id || r.id || i} className="wicp-row-damaged">
                    <td className="wicp-cell-num wicp-col-num">{i + 1}</td>
                    <td>
                      <div className="wicp-student-cell">
                        <StudentAvatar user={r?.user} name={getStudentName(r)} />
                        <div>
                          <div className="wicp-student-name">{getStudentName(r)}</div>
                          <span className="wicp-student-id">{getStudentId(r)}</span>
                        </div>
                      </div>
                    </td>
                    <td><span className="wicp-book-title">{getBookTitle(r)}</span></td>
                    <td className="wicp-cell-date">{formatDateTime(r.collectedAt || r.createdAt)}</td>
                    <td className="wicp-cell-date">{r.returnedAt ? formatDateTime(r.returnedAt) : "—"}</td>
                    <td>
                      <span className="wicp-overdue-inline">
                        <span className="wicp-fine-amount">{fineLabel}</span>
                        {statusLabel && (
                          <>
                            <span className="wicp-overdue-sep">—</span>
                            <span className={`wicp-overdue-status ${statusLabel === "Paid" ? "wicp-overdue-status--paid" : "wicp-overdue-status--pending"}`}>
                              {statusLabel}
                            </span>
                          </>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="wicp-table-footer">
          <span className="wicp-result-count">{records.length} damaged record{records.length !== 1 ? "s" : ""}</span>
        </div>
      </div>
    </div>
  );
}

/* ── Lost Walk-In Section ────────────────────────────────── */
function LostSection({ records }) {
  if (records.length === 0) return (
    <div className="wicp-section">
      <div className="wicp-section-header wicp-section-header--lost">
        <span className="wicp-section-icon wicp-section-icon--lost"><IconLost /></span>
        <h3 className="wicp-section-title">Lost Books</h3>
        <span className="wicp-section-count wicp-section-count--lost">0</span>
      </div>
      <div className="wicp-empty wicp-section-empty">
        <div className="wicp-empty-icon"><IconInbox /></div>
        <h3 className="wicp-empty-title">No lost walk-in books</h3>
        <p className="wicp-empty-sub">Walk-in books marked as lost will appear here</p>
      </div>
    </div>
  );

  return (
    <div className="wicp-section">
      <div className="wicp-section-header wicp-section-header--lost">
        <span className="wicp-section-icon wicp-section-icon--lost"><IconLost /></span>
        <h3 className="wicp-section-title">Lost Books</h3>
        <span className="wicp-section-count wicp-section-count--lost">{records.length}</span>
      </div>
      <div className="wicp-table-card">
        <div className="wicp-table-wrap">
          <table className="wicp-table">
            <thead>
              <tr>
                <th className="wicp-col-num">#</th>
                <th>Student</th>
                <th>Book</th>
                <th>Checked Out</th>
                <th>Due Date</th>
                <th>Lost Fine</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r, i) => {
                const fine   = Number(r.lostFine || 0);
                const paid   = r.lostFinePaid;
                const fineLabel = fine > 0 ? `₹${fine}` : "₹0";
                // Payment is atomic with marking lost — also check timestamp and status flag
                const effectivePaid =
                  paid === true ||
                  !!r.lostFinePaidAt ||
                  r.status === "lost" ||
                  r.isBookLost === true;
                const statusLabel = effectivePaid ? "Paid" : (paid === false ? "Pending" : null);
                return (
                  <tr key={r._id || r.id || i} className="wicp-row-lost">
                    <td className="wicp-cell-num wicp-col-num">{i + 1}</td>
                    <td>
                      <div className="wicp-student-cell">
                        <StudentAvatar user={r?.user} name={getStudentName(r)} />
                        <div>
                          <div className="wicp-student-name">{getStudentName(r)}</div>
                          <span className="wicp-student-id">{getStudentId(r)}</span>
                        </div>
                      </div>
                    </td>
                    <td><span className="wicp-book-title">{getBookTitle(r)}</span></td>
                    <td className="wicp-cell-date">{formatDateTime(r.collectedAt || r.createdAt)}</td>
                    <td className="wicp-cell-date">{r.dueDate ? (() => { const d = new Date(r.dueDate); d.setHours(17,0,0,0); return formatDateTime(d); })() : "—"}</td>
                    <td>
                      <span className="wicp-overdue-inline">
                        <span className="wicp-fine-amount">{fineLabel}</span>
                        {statusLabel && (
                          <>
                            <span className="wicp-overdue-sep">—</span>
                            <span className={`wicp-overdue-status ${statusLabel === "Paid" ? "wicp-overdue-status--paid" : "wicp-overdue-status--pending"}`}>
                              {statusLabel}
                            </span>
                          </>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="wicp-table-footer">
          <span className="wicp-result-count">{records.length} lost record{records.length !== 1 ? "s" : ""}</span>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   WalkInCheckoutsPage
═══════════════════════════════════════════════════════════ */
export default function WalkInCheckoutsPage({
  user,
  checkouts,
  damagedCheckouts = [],
  lostCheckouts = [],
  students,
  books,
  reservations = [],
  onReturn,
  onDelete,
  onWalkInSubmit,
  onLogout,
  onBack,
  loading = false,
  autoOpenModal = false,
}) {
  const [search,  setSearch]  = useState("");
  const [filter,  setFilter]  = useState("all");
  const [sortBy,  setSortBy]  = useState("newest");
  const [isModalOpen,   setIsModalOpen]   = useState(false);
  const [isSubmitting,  setIsSubmitting]  = useState(false);

  useEffect(() => {
    if (autoOpenModal) setIsModalOpen(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Stable search handlers (prevent input focus loss) ─── */
  const handleSearchChange = useCallback((e) => setSearch(e.target.value), []);
  const handleSearchClear  = useCallback(() => setSearch(""), []);

  /* ── Enriched list — includes damaged & lost rows ───────── */
  const enriched = useMemo(() => {
    const lostIds = new Set(lostCheckouts.map((r) => r._id || r.id).filter(Boolean));
    const main = checkouts
      .map((reservation) => {
        const displayStatus = getDerivedWalkInStatus(reservation);
        return { ...reservation, displayStatus, isOverdue: displayStatus === "overdue" };
      })
      .filter((r) => r.displayStatus !== "hidden")
      .filter((r) => { const id = r._id || r.id; return !id || !lostIds.has(id); });

    const damaged = damagedCheckouts.map((r) => ({
      ...r,
      displayStatus: "damaged",
      isOverdue: false,
    }));

    const lost = lostCheckouts.map((r) => ({
      ...r,
      displayStatus: "lost",
      isOverdue: false,
    }));

    const combined = [...main, ...damaged, ...lost];
    const seen = new Set();
    return combined.filter((r) => {
      const id = r._id || r.id;
      if (!id) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [checkouts, damagedCheckouts, lostCheckouts]);

  /* ── Filtered + sorted list ─────────────────────────────── */
  const filtered = useMemo(() => {
    let list = [...enriched];

    if (filter !== "all") {
      if (filter === "collected") {
        // "Collected" chip shows all checked-out books — both active and overdue
        list = list.filter((r) => r.displayStatus === "active" || r.displayStatus === "overdue");
      } else if (filter === "returned") {
        // Damaged books are displayed in the Returned section as well
        list = list.filter((r) => r.displayStatus === "returned" || r.displayStatus === "damaged");
      } else {
        list = list.filter((r) => r.displayStatus === filter);
      }
    }

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((r) => {
        return (
          getStudentName(r).toLowerCase().includes(q) ||
          getStudentId(r).toLowerCase().includes(q) ||
          getBookTitle(r).toLowerCase().includes(q)
        );
      });
    }

    list.sort((a, b) => {
      if (sortBy === "newest")
        return new Date(getCheckedOutDate(b) || 0) - new Date(getCheckedOutDate(a) || 0);
      if (sortBy === "oldest")
        return new Date(getCheckedOutDate(a) || 0) - new Date(getCheckedOutDate(b) || 0);
      if (sortBy === "dueDate")
        return new Date(a?.dueDate || 0) - new Date(b?.dueDate || 0);
      if (sortBy === "student")
        return getStudentName(a).localeCompare(getStudentName(b));
      return 0;
    });

    return list;
  }, [enriched, filter, search, sortBy]);

  /* ── Counts ─────────────────────────────────────────────── */
  const counts = useMemo(() => ({
    total:     enriched.length,
    all:       enriched.length,
    active:    enriched.filter((r) => r.displayStatus === "active").length,
    collected: enriched.filter((r) => r.displayStatus === "active" || r.displayStatus === "overdue").length,
    overdue:   enriched.filter((r) => r.displayStatus === "overdue").length,
    returned:  enriched.filter((r) => r.displayStatus === "returned" || r.displayStatus === "damaged").length,
    damaged:   enriched.filter((r) => r.displayStatus === "damaged").length,
    lost:      enriched.filter((r) => r.displayStatus === "lost").length,
  }), [enriched]);

  /* ── Active chip class helper ───────────────────────────── */
  const chipCls = useCallback((chipValue) => {
    if (filter !== chipValue) return "wicp-chip";
    if (chipValue === "all") return "wicp-chip active";
    return `wicp-chip active-${chipValue}`;
  }, [filter]);

  /* ── Modal submit handler ───────────────────────────────── */
  // onWalkInSubmit must throw on failure so that WalkInCheckoutModal's internal
  // catch can route errors to the correct inline field. No catch block here —
  // swallowing errors would prevent the modal from showing field-level messages.
  const handleModalSubmit = useCallback(async (payload) => {
    setIsSubmitting(true);
    try {
      await onWalkInSubmit?.(payload);
      setIsModalOpen(false); // only close on success
    } finally {
      setIsSubmitting(false); // always clear spinner
      // Errors propagate to WalkInCheckoutModal.handleSubmit — do NOT catch here.
    }
  }, [onWalkInSubmit]);

  return (
    <div className="wicp-page">
      {/* ── Header ──────────────────────────────────────── */}
      <div className="wicp-header">
        <div className="wicp-header-left">
          <button className="secondary-btn small-btn wicp-back-btn" onClick={onBack}>
            ← Back
          </button>
          <h2 className="wicp-title">
            <span className="wicp-title-icon"><IconWalkIn /></span>
            Walk-In Book Management
          </h2>
          <p className="wicp-subtitle">
            Track books issued to students who visit the library in person
          </p>
        </div>

        <div className="wicp-header-actions">
          <button className="primary-btn" onClick={() => setIsModalOpen(true)}>
            + New Walk-In Checkout
          </button>
        </div>
      </div>

      {/* ── Stats grid ──────────────────────────────────── */}
      <div className="wicp-stats-grid">
        {STAT_CARDS.map((s) => (
          <div key={s.key} className={`wicp-stat-card ${s.tone}`}>
            <div className="wicp-stat-icon">{s.icon}</div>
            <div className="wicp-stat-count">{counts[s.key]}</div>
            <div className="wicp-stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Toolbar ─────────────────────────────────────── */}
      <div className="wicp-toolbar">
        {/* Search */}
        <div className="wicp-toolbar-search">
          <span className="wicp-search-icon"><IconSearch /></span>
          <input
            className="wicp-search-input"
            placeholder="Search by student name, ID or book title…"
            value={search}
            onChange={handleSearchChange}
          />
          {search && (
            <button className="wicp-search-clear" onClick={handleSearchClear}>
              ✕
            </button>
          )}
        </div>

        {/* Filter chips */}
        <div className="wicp-filter-row">
          {FILTER_CHIPS.map((chip) => (
            <button
              key={chip.value}
              className={chipCls(chip.value)}
              onClick={() => setFilter(chip.value)}
            >
              {chip.label}
              {chip.value !== "all" && (
                <span className="wicp-chip-count">{counts[chip.value] ?? 0}</span>
              )}
            </button>
          ))}
        </div>

        {/* Sort */}
        <div className="wicp-sort-row">
          <span className="wicp-sort-label">Sort by:</span>
          <select
            className="wicp-sort-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="dueDate">Due Date ↑</option>
            <option value="student">Student A–Z</option>
          </select>
        </div>
      </div>

      {/* ── Content area ────────────────────────────────── */}
      {loading ? (
        <div className="wicp-loading">Loading walk-in records…</div>
      ) : filtered.length === 0 ? (
        <div className="wicp-empty">
          <div className="wicp-empty-icon"><IconInbox /></div>
          <h3 className="wicp-empty-title">No records found</h3>
          <p className="wicp-empty-sub">
            {search || filter !== "all"
              ? "Try adjusting your search or filter"
              : "Record your first walk-in checkout using the button above"}
          </p>
        </div>
      ) : (
        <div className="wicp-table-card">
          <div className="wicp-table-wrap">
            <table className="wicp-table">
              <thead>
                <tr>
                  <th className="wicp-col-num">#</th>
                  <th>Student</th>
                  <th className="wicp-col-book">Book</th>
                  <th className="wicp-col-checkedout">Checked Out</th>
                  <th>Due Date</th>
                  <th className="wicp-col-returned">Returned</th>
                  <th className="wicp-col-indicator">Damaged</th>
                  <th className="wicp-col-indicator">Lost</th>
                  <th className="wicp-col-overdue">Overdue</th>
                  <th className="wicp-col-totalfine">Total Fine</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {filtered.map((reservation, i) => {
                  const reservationId  = reservation._id || reservation.id;
                  const checkedOutDate = getCheckedOutDate(reservation);
                  const isDamaged      =
                    reservation.displayStatus === "damaged" ||
                    reservation.status        === "damaged" ||
                    reservation.isBookDamaged === true;
                  const isLost         =
                    reservation.displayStatus === "lost" ||
                    reservation.status        === "lost" ||
                    reservation.isBookLost    === true;
                  const isOverdue      = reservation.displayStatus === "overdue";
                  const isReturned     = reservation.status === "returned";

                  /* ── Returned date ──────────────────────────
                     Lost books cannot be returned — suppress the
                     date so the Returned column always shows "—". */
                  const returnedAtValue = isLost ? null : (
                    reservation.returnedAt ||
                    reservation.returnedDate ||
                    reservation.returnDate ||
                    (isReturned ? (reservation.updatedAt || null) : null)
                  );

                  /* ── Fine amounts ───────────────────────────── */
                  const damageFine  = Number(reservation.damageFine  || 0);
                  const lostFine    = Number(reservation.lostFine    || 0);
                  const overdueFine = Number(
                    reservation.overdueFine ?? reservation.lateFine ?? 0
                  );
                  const totalFine   = damageFine + lostFine + overdueFine;

                  /* ── Paid flags ─────────────────────────────── */
                  const damageFinePaid  = reservation.damageFinePaid  ?? null;
                  const lostFinePaid    = reservation.lostFinePaid    ?? null;
                  const overduePaid     = reservation.overduePaid     ?? reservation.latePaid ?? null;

                  /* ── Row class ──────────────────────────────── */
                  const rowCls = isDamaged
                    ? "wicp-row-damaged"
                    : isLost
                    ? "wicp-row-lost"
                    : isOverdue
                    ? "wicp-row-overdue"
                    : "";

                  /* ── Overdue cell ───────────────────────────── */
                  const actualOverdueDays = getOverdueDays(reservation);
                  const isDueInPast = (() => {
                    const due = reservation.dueDate ? new Date(reservation.dueDate) : null;
                    if (!due || Number.isNaN(due.getTime())) return false;
                    due.setHours(17, 0, 0, 0); // enforce 5 PM rule
                    return due < new Date();
                  })();
                  const hasOverdue = isOverdue || (isDueInPast && actualOverdueDays > 0);

                  let overdueCell;
                  if (!hasOverdue) {
                    overdueCell = <span className="wicp-cell-dash">—</span>;
                  } else {
                    const daysLabel   = `${actualOverdueDays} ${actualOverdueDays === 1 ? "Day" : "Days"}`;
                    const fineLabel   = overdueFine > 0 ? ` - ₹${overdueFine}` : "";
                    const statusLabel = overduePaid === true ? "Paid" : overduePaid === false ? "Pending" : null;
                    const overdueSinceDate = reservation.dueDate ? (() => { const d = new Date(reservation.dueDate); d.setHours(17, 0, 0, 0); return d; })() : null;
                    overdueCell = (
                      <div className="wicp-col-cell-stack">
                        <span className="wicp-overdue-inline">
                          <span className="wicp-overdue-detail">{daysLabel}{fineLabel}</span>
                          {statusLabel && (
                            <>
                              <span className="wicp-overdue-sep">—</span>
                              <span className={`wicp-overdue-status ${overduePaid ? "wicp-overdue-status--paid" : "wicp-overdue-status--pending"}`}>
                                {statusLabel}
                              </span>
                            </>
                          )}
                        </span>
                        {formatDateTime(overdueSinceDate)}
                      </div>
                    );
                  }

                  /* ── Damaged cell — ₹100 — Paid/Pending ─────── */
                  let damagedCell;
                  if (!isDamaged) {
                    damagedCell = <span className="wicp-cell-dash">—</span>;
                  } else {
                    const fineLabel = damageFine > 0 ? `₹${damageFine}` : "₹0";
                    // Mirror ReservationList.jsx: payment is atomic with marking damaged,
                    // so treat as paid if explicitly paid, has a payment timestamp, OR
                    // status/flag indicates damaged (same logic as admin cards page).
                    const effectiveDamagePaid =
                      damageFinePaid === true ||
                      !!reservation.damageFinePaidAt ||
                      reservation.status === "damaged" ||
                      reservation.isBookDamaged === true;
                    const statusLabel = effectiveDamagePaid
                      ? "Paid"
                      : damageFinePaid === false ? "Pending" : null;
                    damagedCell = (
                      <div className="wicp-col-cell-stack">
                        <span className="wicp-overdue-inline">
                          <span className="wicp-overdue-detail">{fineLabel}</span>
                          {statusLabel && (
                            <>
                              <span className="wicp-overdue-sep">—</span>
                              <span className={`wicp-overdue-status ${statusLabel === "Paid" ? "wicp-overdue-status--paid" : "wicp-overdue-status--pending"}`}>
                                {statusLabel}
                              </span>
                            </>
                          )}
                        </span>
                        {formatDateTime(reservation.returnedAt || reservation.damagedAt)}
                      </div>
                    );
                  }

                  /* ── Lost cell — ₹500 — Paid/Pending ────────── */
                  let lostCell;
                  if (!isLost) {
                    lostCell = <span className="wicp-cell-dash">—</span>;
                  } else {
                    const fineLabel = lostFine > 0 ? `₹${lostFine}` : "₹0";
                    // Mirror ReservationList.jsx: payment is atomic with marking lost,
                    // so treat as paid if explicitly paid, has a payment timestamp, OR
                    // status/flag indicates lost (same logic as admin cards page).
                    const effectiveLostPaid =
                      lostFinePaid === true ||
                      !!reservation.lostFinePaidAt ||
                      reservation.status === "lost" ||
                      reservation.isBookLost === true;
                    const statusLabel = effectiveLostPaid
                      ? "Paid"
                      : lostFinePaid === false ? "Pending" : null;
                    lostCell = (
                      <div className="wicp-col-cell-stack">
                        <span className="wicp-overdue-inline">
                          <span className="wicp-overdue-detail">{fineLabel}</span>
                          {statusLabel && (
                            <>
                              <span className="wicp-overdue-sep">—</span>
                              <span className={`wicp-overdue-status ${statusLabel === "Paid" ? "wicp-overdue-status--paid" : "wicp-overdue-status--pending"}`}>
                                {statusLabel}
                              </span>
                            </>
                          )}
                        </span>
                        {formatDateTime(reservation.lostAt || reservation.returnedAt)}
                      </div>
                    );
                  }

                  return (
                    <tr key={reservationId || i} className={rowCls}>
                      {/* # */}
                      <td className="wicp-cell-num wicp-col-num">{i + 1}</td>

                      {/* Student */}
                      <td>
                        <div className="wicp-student-cell">
                          <StudentAvatar
                            user={reservation?.user}
                            name={getStudentName(reservation)}
                          />
                          <div>
                            <div className="wicp-student-name">
                              {getStudentName(reservation)}
                            </div>
                            <span className="wicp-student-id">
                              {getStudentId(reservation)}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Book */}
                      <td className="wicp-col-book">
                        <span className="wicp-book-title">
                          {getBookTitle(reservation)}
                        </span>
                      </td>

                      {/* Checked Out */}
                      <td className="wicp-cell-date wicp-col-checkedout">
                        {formatDateTime(checkedOutDate)}
                      </td>

                      {/* Due Date — always displayed at 5:00 PM to match server rule */}
                      <td className={`wicp-cell-date ${isOverdue ? "wicp-date-overdue" : ""}`}>
                        {reservation.dueDate ? (() => {
                          const d = new Date(reservation.dueDate);
                          d.setHours(17, 0, 0, 0);
                          return formatDateTime(d);
                        })() : <span className="wicp-cell-dash">—</span>}
                      </td>

                      {/* Returned */}
                      <td className="wicp-cell-date wicp-col-returned">
                        {returnedAtValue
                          ? formatDateTime(returnedAtValue)
                          : <span className="wicp-cell-dash">—</span>
                        }
                      </td>

                      {/* Damaged */}
                      <td className="wicp-col-indicator">{damagedCell}</td>

                      {/* Lost */}
                      <td className="wicp-col-indicator">{lostCell}</td>

                      {/* Overdue */}
                      <td className="wicp-col-overdue">{overdueCell}</td>

                      {/* Total Fine */}
                      <td className="wicp-col-totalfine">
                        {totalFine > 0 ? (() => {
                          /* Show "— Paid" only when every applicable fine on this row
                             is effectively paid. Mirrors the per-cell logic above:
                             payment is atomic with marking damaged/lost, so check
                             the explicit flag, the payment timestamp, and the status
                             flag — whichever is available.                          */
                          const damagePaidOk =
                            !isDamaged || (
                              damageFinePaid === true ||
                              !!reservation.damageFinePaidAt ||
                              reservation.status === "damaged" ||
                              reservation.isBookDamaged === true
                            );
                          const lostPaidOk =
                            !isLost || (
                              lostFinePaid === true ||
                              !!reservation.lostFinePaidAt ||
                              reservation.status === "lost" ||
                              reservation.isBookLost === true
                            );
                          const overduePaidOk =
                            !(hasOverdue && overdueFine > 0) || overduePaid === true;
                          const allPaid = damagePaidOk && lostPaidOk && overduePaidOk;
                          return (
                            <span className="wicp-overdue-inline">
                              <span className="wicp-fine-amount">₹{totalFine}</span>
                              {allPaid && (
                                <>
                                  <span className="wicp-overdue-sep">—</span>
                                  <span className="wicp-overdue-status wicp-overdue-status--paid">Paid</span>
                                </>
                              )}
                            </span>
                          );
                        })()
                          : <span className="wicp-cell-dash">—</span>
                        }
                      </td>

                      {/* Actions */}
                      <td>
                        <div className="wicp-actions">
                          {reservation.status !== "returned" && !isDamaged && !isLost && (
                            <button
                              className="primary-btn compact-btn"
                              onClick={() => onReturn(reservationId)}
                              title="Mark as returned"
                            >
                              <IconReturnBtn /> Return
                            </button>
                          )}
                          <button
                            className="danger-btn compact-btn"
                            onClick={() => onDelete(reservationId)}
                            title="Delete record"
                          >
                            <IconTrash />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Table footer */}
          <div className="wicp-table-footer">
            <span className="wicp-result-count">
              Showing {filtered.length} of {enriched.length} records
            </span>
          </div>
        </div>
      )}

      {/* ── Walk-In Checkout Modal ──────────────────────── */}
      <WalkInCheckoutModal
  isOpen={isModalOpen}
  onClose={() => setIsModalOpen(false)}
  onConfirm={handleModalSubmit}
  students={students}
  books={books}
  reservations={reservations}
  loading={isSubmitting}
/>
    </div>
  );
}