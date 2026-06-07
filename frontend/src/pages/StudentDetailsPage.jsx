import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiRequest, downloadExcel } from "../api";
import {
  Users,
  BookOpen,
  Clock3,
  CheckCircle2,
  DollarSign,
  Search,
  ChevronDown,
  PackageCheck,
  XCircle,
  CalendarX,
} from "lucide-react";
import "./StudentDetailsPage.css";

// Backend origin — mirrors the base URL used by apiRequest so image paths
// resolve correctly when the frontend and backend run on different ports.
const API_BASE =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL
    ? import.meta.env.VITE_API_URL
    : "http://localhost:4000"
  ).replace(/\/$/, "");

const STATUS_CLASS_MAP = {
  reserved: "sdp-badge--reserved",
  collected: "sdp-badge--collected",
  returned: "sdp-badge--returned",
  overdue: "sdp-badge--overdue",
  cancelled: "sdp-badge--cancelled",
  canceled: "sdp-badge--cancelled",
  expired: "sdp-badge--expired",
  "pre-book": "sdp-badge--pre-book",
  pending: "sdp-badge--pending",
  active: "sdp-badge--active",
  inactive: "sdp-badge--inactive",
};

function formatDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  const h12 = String(hours % 12 || 12).padStart(2, "0");
  return { date: `${dd}/${mm}/${yyyy}`, time: `${h12}:${minutes} ${ampm}` };
}

function DateCell({ value }) {
  const parsed = formatDate(value);
  if (!parsed) return <span className="sdp-detail-cell__na">—</span>;
  return (
    <div className="sdp-date-cell">
      <span className="sdp-date-cell__date">{parsed.date}</span>
      <span className="sdp-date-cell__time">{parsed.time}</span>
    </div>
  );
}

function formatCurrency(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num <= 0) return "₹0";
  return `₹${num}`;
}

function normalizeStatus(status) {
  return String(status || "")
    .trim()
    .toLowerCase();
}

function getStatusClass(status) {
  const normalized = normalizeStatus(status);
  return STATUS_CLASS_MAP[normalized] || "sdp-badge--inactive";
}

function getStudentKey(student, fallbackIndex) {
  return (
    student?.id ??
    student?._id ??
    student?.student_id ??
    student?.roll_no ??
    student?.roll_number ??
    student?.email ??
    fallbackIndex
  );
}

// FIX (1): Resolve profile image URL from all common API field names with safe fallback.
function getProfileImageUrl(student) {
  return (
    student?.profileImage ||
    student?.profile_image ||
    student?.profile_pic ||
    student?.photo ||
    student?.avatar ||
    student?.image_url ||
    student?.photo_url ||
    null
  );
}

// Converts any relative image path returned by the backend into a full URL.
function resolveImageUrl(raw) {
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  const clean = raw.replace(/^\/+/, "");
  if (clean.startsWith("uploads/")) return `${API_BASE}/${clean}`;
  return `${API_BASE}/uploads/${clean}`;
}

/* ─────────────────────────────────────────────────
   StatCard — redesigned to match ARP stat card
───────────────────────────────────────────────── */
function StatCard({ Icon, value, label, tone }) {
  return (
    <div className={`sdp-stat-card ${tone || ""} sdp-fade-in`}>
      <div className="sdp-stat-icon">
        {Icon && <Icon size={22} strokeWidth={1.75} />}
      </div>
      <div className="sdp-stat-count">{value}</div>
      <div className="sdp-stat-label">{label}</div>
    </div>
  );
}

// FIX (2): Display "Pre-Booked" for backend status "reserved".
function capitalizeStatus(raw) {
  if (!raw) return "Unknown";
  return String(raw)
    .trim()
    .replace(/^(.)/, (c) => c.toUpperCase());
}

function StatusBadge({ status }) {
  const normalized = normalizeStatus(status);
  let label;
  if (normalized === "reserved") {
    label = "Pre-Booked";
  } else {
    label = capitalizeStatus(status);
  }
  return (
    <span className={`sdp-badge ${getStatusClass(status)}`}>
      <span className="sdp-badge__dot" />
      {label}
    </span>
  );
}

// FIX (3): Use enriched fine fallback chain
function getReservationFine(reservation) {
  const raw =
    reservation?.totalFine ??
    reservation?.total_fine ??
    reservation?.fine ??
    reservation?.overdueFine ??
    reservation?.overdue_fine ??
    0;
  return Number(raw || 0);
}

// Must match the server constant used in ReservationList.jsx
const OVERDUE_FINE_PER_DAY = 20;

// Mirrors ReservationList.jsx getOverdueDays exactly:
// - Applies the fixed 5 PM due-time cutoff
// - For paid records, back-calculates days from overduePaidAmount so the
//   figure never drifts after settlement
// - For closed records (lost/damaged), anchors the end date to the first
//   available closing timestamp instead of using live Date.now()
// - Falls back to live calculation when no closing timestamp exists
// - Cancelled and expired pre-bookings never generate overdue (mirrors server
//   calculateOverdueDays which returns 0 for all non-ACTIVE_STATUSES except
//   damaged and lost)
function getOverdueDays(reservation) {
  const due = reservation?.dueDate ? new Date(reservation.dueDate) : null;
  if (!due || Number.isNaN(due.getTime())) return 0;

  // Cancelled / expired reservations never accumulate overdue — the book was
  // never collected so there is nothing to be "overdue".
  const statusStr = normalizeStatus(
    reservation?.derivedStatus || reservation?.status
  );
  if (["cancelled", "canceled", "expired"].includes(statusStr)) return 0;

  // Fixed due time = 5:00 PM
  due.setHours(17, 0, 0, 0);

  // If overdue was already paid, back-calculate from the paid amount
  // so the displayed days never drift after settlement.
  if (reservation?.overduePaid && reservation?.overduePaidAmount > 0) {
    return Math.round(Number(reservation.overduePaidAmount) / OVERDUE_FINE_PER_DAY);
  }

  // For lost / damaged books that have no returnedAt, use the fine-payment
  // timestamp as the end anchor so days don't keep growing after the record
  // is closed.
  const closingTimestamp =
    reservation?.returnedAt ||
    reservation?.overduePaidAt ||
    reservation?.lostFinePaidAt ||
    reservation?.damageFinePaidAt ||
    reservation?.finePaidAt ||
    null;

  const endDate = closingTimestamp ? new Date(closingTimestamp) : new Date();

  if (endDate <= due) return 0;

  const msPerDay = 1000 * 60 * 60 * 24;
  const calculatedDays = Math.ceil((endDate.getTime() - due.getTime()) / msPerDay);

  // For active (not yet closed) books, prefer the server-serialized value
  // when it exists; otherwise fall back to the live calculation.
  if (!closingTimestamp) {
    const serializedDays = Number(reservation?.overdueDays || reservation?.overdue_days || 0);
    return serializedDays > 0 ? serializedDays : calculatedDays;
  }

  return calculatedDays;
}

// Mirrors ReservationList.jsx getOverdueFine exactly:
// Prefers the server-computed field; falls back to days x rate so the
// fine is never silently zero when the serialized field hasn't propagated.
function getOverdueFine(reservation) {
  const serializedFine = Number(
    reservation?.overdueFine || reservation?.overdue_fine || 0
  );
  if (serializedFine > 0) return serializedFine;

  const days = getOverdueDays(reservation);
  return days > 0 ? days * OVERDUE_FINE_PER_DAY : 0;
}

// Returns the timestamp when the book was physically checked out.
// Mirrors ReservationList.jsx — tries every field name the server may use.
// For lost / damaged non-walk-in records where collectedAt was never written,
// falls back to reservedAt / createdAt as the best available proxy.
function getCollectedAt(reservation) {
  const explicit =
    reservation?.collectedAt ||
    reservation?.checkedOutAt ||
    reservation?.checkoutAt ||
    reservation?.pickedUpAt ||
    reservation?.collected_date ||
    null;

  if (explicit) return explicit;

  const status = normalizeStatus(reservation?.derivedStatus || reservation?.status);
  const isLostOrDamaged =
    status === "lost" ||
    status === "damaged" ||
    reservation?.isBookLost ||
    reservation?.isBookDamaged;

  if (isLostOrDamaged && !reservation?.isWalkIn) {
    return reservation?.reservedAt || reservation?.reserved_date || reservation?.createdAt || null;
  }

  return null;
}

/* ─────────────────────────────────────────────────
   StudentCard — redesigned to match ARP reservation
   card visual language; all logic unchanged
───────────────────────────────────────────────── */
function StudentCard({ student, studentKey, isExpanded, onToggle }) {
  // FIX (1): Track image load failure.
  const [imgError, setImgError] = useState(false);

  const reservations = Array.isArray(student?.reservations)
    ? student.reservations
    : [];
  const [currentPage, setCurrentPage] = useState(1);

  const BOOKS_PER_PAGE = 10;

  const totalPages = Math.ceil(
    reservations.length / BOOKS_PER_PAGE
  );

  const paginatedReservations = reservations.slice(
    (currentPage - 1) * BOOKS_PER_PAGE,
    currentPage * BOOKS_PER_PAGE
  );

  const name = student?.name || "Unknown Student";
  const rollNo = student?.roll_no || student?.roll_number || "—";
  const email = student?.email || "—";

  const totalReservations = Number(
    student?.total_reservations ?? reservations.length ?? 0
  );
  const activeCount = Number(student?.active_count || 0);
  const overdueCount = Number(student?.overdue_count || 0);
  const totalFine = Number(student?.total_fine || 0);

  // Derived counts — prefer backend-provided fields, fall back to counting from reservations array
  const collectedCount = Number(
    student?.collected_count ??
    reservations.filter((r) => normalizeStatus(r?.status) === "collected").length
  );
  const expiredCount = Number(
    student?.expired_count ??
    reservations.filter((r) => normalizeStatus(r?.status) === "expired").length
  );
  const cancelledCount = Number(
    student?.cancelled_count ??
    reservations.filter((r) =>
      ["cancelled", "canceled"].includes(normalizeStatus(r?.status))
    ).length
  );

  const initials = String(name)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");

  const profileImageUrl = resolveImageUrl(getProfileImageUrl(student));
  const showImage = profileImageUrl && !imgError;

  // Determine the card accent tone based on student status
  const cardTone = overdueCount > 0
    ? "sdp-card--overdue"
    : totalFine > 0
      ? "sdp-card--has-fine"
      : activeCount > 0
        ? "sdp-card--active"
        : "";

  return (
    <div className={`sdp-card ${isExpanded ? "sdp-card--expanded" : ""} ${cardTone}`}>

      {/* ── Card summary row (always visible) ── */}
      <div
        className="sdp-card__summary"
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        {/* Avatar */}
        <div className="sdp-avatar">
          {showImage ? (
            <img
              src={profileImageUrl}
              alt={name}
              className="sdp-avatar__img"
              onError={() => setImgError(true)}
            />
          ) : (
            initials || "ST"
          )}
        </div>

        {/* Name + meta */}
        <div className="sdp-card__info">
          <div className="sdp-card__name">{name}</div>
          <div className="sdp-card__meta">{rollNo}</div>
          <div className="sdp-card__meta">{email}</div>
        </div>

        {/* Badges */}
        <div className="sdp-card__badges">
          <span className="sdp-count-badge" title="Total Reservations">
            {totalReservations}
          </span>

          {activeCount > 0 && (
            <span className="sdp-badge sdp-badge--active">
              <span className="sdp-badge__dot" />
              {activeCount} Active
            </span>
          )}

          {overdueCount > 0 && (
            <span className="sdp-badge sdp-badge--overdue">
              <span className="sdp-badge__dot" />
              {overdueCount} Overdue
            </span>
          )}

          {collectedCount > 0 && (
            <span className="sdp-badge sdp-badge--collected">
              <span className="sdp-badge__dot" />
              {collectedCount} Collected
            </span>
          )}

          {expiredCount > 0 && (
            <span className="sdp-badge sdp-badge--expired">
              <span className="sdp-badge__dot" />
              {expiredCount} Expired
            </span>
          )}

          {cancelledCount > 0 && (
            <span className="sdp-badge sdp-badge--cancelled">
              <span className="sdp-badge__dot" />
              {cancelledCount} Cancelled
            </span>
          )}

          {totalFine > 0 && (
            <span className="sdp-badge sdp-badge--pending">
              <span className="sdp-badge__dot" />
              Fine {formatCurrency(totalFine)}
            </span>
          )}
        </div>

        {/* Expand / collapse toggle */}
        <button
          type="button"
          className={`sdp-expand-btn ${isExpanded ? "sdp-expand-btn--open" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          aria-label={isExpanded ? "Collapse student details" : "Expand student details"}
        >
          <ChevronDown size={14} strokeWidth={2.5} />
        </button>
      </div>

      {/* ── Expanded detail panel ── */}
      {isExpanded ? (
        <div className="sdp-card__detail sdp-slide-down">

          {/* Info fields grid */}
          <div className="sdp-info-grid">
            <div className="sdp-info-item">
              <span className="sdp-info-item__label">Student Name</span>
              <span className="sdp-info-item__value">{name}</span>
            </div>

            <div className="sdp-info-item">
              <span className="sdp-info-item__label">Roll Number</span>
              <span className="sdp-info-item__value">{rollNo}</span>
            </div>

            <div className="sdp-info-item">
              <span className="sdp-info-item__label">Email</span>
              <span className="sdp-info-item__value">{email}</span>
            </div>

            <div className="sdp-info-item">
              <span className="sdp-info-item__label">Total Reservations</span>
              <span className="sdp-info-item__value">{totalReservations}</span>
            </div>

            <div className="sdp-info-item">
              <span className="sdp-info-item__label">Active Reservations</span>
              <span className="sdp-info-item__value">{activeCount}</span>
            </div>

            <div className="sdp-info-item">
              <span className="sdp-info-item__label">Overdue Count</span>
              <span className="sdp-info-item__value">{overdueCount}</span>
            </div>

            <div className="sdp-info-item">
              <span className="sdp-info-item__label">Total Fine</span>
              <span className="sdp-info-item__value">{formatCurrency(totalFine)}</span>
            </div>

            <div className="sdp-info-item">
              <span className="sdp-info-item__label">Collected</span>
              <span className="sdp-info-item__value sdp-info-item__value--collected">
                {collectedCount}
              </span>
            </div>

            <div className="sdp-info-item">
              <span className="sdp-info-item__label">Expired</span>
              <span className="sdp-info-item__value sdp-info-item__value--expired">
                {expiredCount}
              </span>
            </div>

            <div className="sdp-info-item">
              <span className="sdp-info-item__label">Cancelled</span>
              <span className="sdp-info-item__value sdp-info-item__value--cancelled">
                {cancelledCount}
              </span>
            </div>
          </div>

          {/* Reservation history table */}
          <div className="sdp-reservations">
            <div className="sdp-reservations__header">
              <div className="sdp-reservations__title">Reservation History</div>
            </div>

            {reservations.length === 0 ? (
              <div className="sdp-table-empty">
                <Search size={28} strokeWidth={1.5} />
                <span>No reservation records yet.</span>
              </div>
            ) : (
              <>
                <div className="sdp-table-wrap">
                  <table className="sdp-table">
                    <thead>
                      <tr>
                        <th>Book</th>
                        <th>Department</th>
                        <th>Type</th>
                        <th>Pre-Book Date</th>
                        <th>Checkout</th>
                        <th>Due Date</th>
                        <th>Returned Date</th>
                        <th>Damaged</th>
                        <th>Lost</th>
                        <th>Expired</th>
                        <th>Cancelled</th>
                        <th>Overdue</th>
                        <th>Fine</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedReservations.map((reservation, index) => {
                        const globalIndex =
                          (currentPage - 1) * BOOKS_PER_PAGE + index;
                        const reservationKey =
                          reservation?.id ??
                          reservation?._id ??
                          `${studentKey}-${globalIndex}`;

                        // Use the same getOverdueDays logic as ReservationList.jsx
                        // (5 PM cutoff, paid back-calc, closing timestamp anchor)
                        const overdueDays = getOverdueDays(reservation);

                        // FIX (3): Use enriched fine fallback chain
                        const fine = getReservationFine(reservation);

                        return (
                          <tr key={reservationKey}>
                            <td>
                              <div className="sdp-table__item-name">
                                {reservation?.book_title ||
                                  reservation?.title ||
                                  "Unknown Book"}
                              </div>
                              <div className="sdp-table__item-sub">
                                {reservation?.author || "—"}
                              </div>
                            </td>

                            {/* FIX (4): Full department fallback chain */}
                            <td>
                              {reservation?.book_department ||
                                reservation?.department ||
                                reservation?.book?.department ||
                                reservation?.book?.category ||
                                reservation?.book?.type ||
                                "—"}
                            </td>

                            {/* Type column */}
                            <td>
                              {reservation?.isWalkIn
                                ? "Walk-In Checkout"
                                : getCollectedAt(reservation)
                                  ? "Pre-Booked & Checked-Out"
                                  : "Pre-Booked"}
                            </td>

                            {/* FIX (5): Date columns support snake_case and camelCase */}
                            <td>
                              <DateCell value={reservation?.reserved_date || reservation?.reservedAt} />
                            </td>

                            {/* ── Checkout: collected date ── */}
                            <td>
                              <DateCell value={getCollectedAt(reservation)} />
                            </td>

                            {/* ── Due Date: hidden for expired and cancelled ── */}
                            <td>
                              {["expired", "cancelled", "canceled"].includes(
                                normalizeStatus(reservation?.derivedStatus || reservation?.status)
                              )
                                ? <span className="sdp-detail-cell__na">—</span>
                                : <DateCell value={reservation?.dueDate} />
                              }
                            </td>

                            {/* ── Returned date: hide for lost books ── */}
                            <td>
                              {(() => {
                                const status = normalizeStatus(
                                  reservation?.derivedStatus || reservation?.status
                                );

                                const isLost =
                                  status === "lost" ||
                                  reservation?.isBookLost;

                                if (isLost) {
                                  return <span className="sdp-detail-cell__na">—</span>;
                                }

                                const returnDate =
                                  reservation?.returned_date ||
                                  reservation?.returnedAt;

                                const showReturn =
                                  status === "returned" ||
                                  status === "damaged" ||
                                  reservation?.isBookDamaged;

                                return showReturn && returnDate
                                  ? <DateCell value={returnDate} />
                                  : <span className="sdp-detail-cell__na">—</span>;
                              })()}
                            </td>

                            {/* ── Damaged: badge + damage fine + paid timestamp ── */}
                            <td>
                              {(() => {
                                const isDamaged =
                                  reservation?.derivedStatus === "damaged" ||
                                  reservation?.status === "damaged" ||
                                  reservation?.isBookDamaged;
                                if (!isDamaged) return <span className="sdp-detail-cell__na">—</span>;
                                const damageFine = Number(reservation?.damageFine || 0);
                                const damagePaid =
                                  !!reservation?.damageFinePaid ||
                                  !!reservation?.finePaid;
                                const damagePaidAt =
                                  reservation?.damageFinePaidAt ||
                                  reservation?.finePaidAt ||
                                  null;
                                return (
                                  <div className="sdp-date-status-cell">
                                    <span className="sdp-badge sdp-badge--damaged-yes">Yes</span>
                                    {damageFine > 0 && (
                                      <span className={`sdp-fine-amount ${damagePaid ? "sdp-fine-amount--paid" : "sdp-fine-amount--pending"}`}>
                                        {formatCurrency(damageFine)} – {damagePaid ? "Paid" : "Pending"}
                                      </span>
                                    )}
                                    {damagePaid && damagePaidAt && (
                                      <DateCell value={damagePaidAt} />
                                    )}
                                  </div>
                                );
                              })()}
                            </td>

                            {/* ── Lost: badge + lost fine with Paid/Pending ── */}
                            <td>
                              {(() => {
                                const rawStatus = normalizeStatus(reservation?.status);
                                // Legacy records stored lost books as status="returned"
                                // with lostFine > 0 (predates the dedicated "lost" status).
                                // Mirror the same detection used in StudentReservationsPage's
                                // getDerivedStatus so both views are consistent.
                                const isLegacyReturnedWithLostFine =
                                  rawStatus === "returned" &&
                                  Number(reservation?.lostFine || 0) > 0;

                                const isLost =
                                  reservation?.derivedStatus === "lost" ||
                                  reservation?.status === "lost" ||
                                  reservation?.isBookLost ||
                                  isLegacyReturnedWithLostFine;

                                if (!isLost) return <span className="sdp-detail-cell__na">—</span>;

                                const lostFine = Number(reservation?.lostFine || 0);

                                // Payment detection — check all granular fields plus the
                                // server-guaranteed invariant that status="lost" is only
                                // reached after the fine is settled.  For legacy records
                                // (status="returned" + lostFine > 0) the book has already
                                // been returned, which is the historical proof of settlement.
                                const lostPaid =
                                  !!reservation?.lostFinePaid ||
                                  !!reservation?.lostFinePaidAt ||
                                  !!reservation?.finePaid ||
                                  Number(reservation?.lostFinePaidAmount || 0) > 0 ||
                                  // Modern records: status="lost" is only written after payment
                                  normalizeStatus(
                                    reservation?.derivedStatus || reservation?.status
                                  ) === "lost" ||
                                  // Legacy records: "returned" + lostFine means settled
                                  isLegacyReturnedWithLostFine;
                                return (
                                  <div className="sdp-date-status-cell">
                                    <span className="sdp-badge sdp-badge--lost-yes">Yes</span>
                                    {lostFine > 0 && (
                                      <span className={`sdp-fine-amount ${lostPaid ? "sdp-fine-amount--paid" : "sdp-fine-amount--pending"}`}>
                                        {formatCurrency(reservation?.lostFinePaidAmount || lostFine)} – {lostPaid ? "Paid" : "Pending"}
                                      </span>
                                    )}
                                  </div>
                                );
                              })()}
                            </td>

                            {/* ── Expired: badge + expiry date only if date exists ── */}
                            <td>
                              {normalizeStatus(reservation?.derivedStatus || reservation?.status) === "expired"
                                ? (() => {
                                  const expiredDate =
                                    reservation?.expiredAt ||
                                    reservation?.expired_date ||
                                    reservation?.expiry_date ||
                                    reservation?.expiration_date;
                                  return (
                                    <div className="sdp-date-status-cell">
                                      <span className="sdp-badge sdp-badge--expired">
                                        <span className="sdp-badge__dot" />
                                        Yes
                                      </span>
                                    </div>
                                  );
                                })()
                                : <span className="sdp-detail-cell__na">—</span>
                              }
                            </td>

                            {/* ── Cancelled: badge + cancellation date only if date exists ── */}
                            <td>
                              {["cancelled", "canceled"].includes(
                                normalizeStatus(reservation?.derivedStatus || reservation?.status)
                              )
                                ? (() => {
                                  return (
                                    <div className="sdp-date-status-cell">
                                      <span className="sdp-badge sdp-badge--cancelled">
                                        <span className="sdp-badge__dot" />
                                        Yes
                                      </span>
                                    </div>
                                  );
                                })()
                                : <span className="sdp-detail-cell__na">—</span>
                              }
                            </td>

                            {/* ── Overdue: days + fine using the same logic as ReservationList.jsx ── */}
                            <td>
                              {(() => {
                                const actualOverdueDays = getOverdueDays(reservation);
                                const overdueFineAmt = getOverdueFine(reservation);

                                const overduePaid =
                                  !!reservation?.overduePaid ||
                                  !!reservation?.overdueFinePaid ||
                                  !!reservation?.overduePaidAt ||
                                  Number(reservation?.overduePaidAmount || 0) > 0;

                                const resStatus = normalizeStatus(
                                  reservation?.derivedStatus || reservation?.status
                                );
                                const isExpired = resStatus === "expired";
                                // Cancelled pre-bookings were never collected, so
                                // no overdue ever applies — always show —
                                const isCancelled =
                                  resStatus === "cancelled" || resStatus === "canceled";

                                if (
                                  isExpired ||
                                  isCancelled ||
                                  (actualOverdueDays <= 0 && overdueFineAmt <= 0)
                                ) {
                                  return <span className="sdp-detail-cell__na">—</span>;
                                }

                                return (
                                  <div className="sdp-date-status-cell">
                                    <span className="sdp-overdue-text">
                                      {actualOverdueDays} Day{actualOverdueDays !== 1 ? "s" : ""}
                                    </span>
                                    <span
                                      className={`sdp-fine-amount ${overduePaid
                                        ? "sdp-fine-amount--paid"
                                        : "sdp-fine-amount--pending"
                                        }`}
                                    >
                                      {formatCurrency(overdueFineAmt)} – {overduePaid ? "Paid" : "Pending"}
                                    </span>
                                  </div>
                                );
                              })()}
                            </td>

                            {/* ── Fine: show proper final fine state ── */}
                            <td>
                              {fine > 0 ? (() => {
                                const overdueFineAmt = getOverdueFine(reservation);

                                const overduePaid =
                                  !!reservation?.overduePaid ||
                                  !!reservation?.overdueFinePaid ||
                                  !!reservation?.overduePaidAt ||
                                  Number(reservation?.overduePaidAmount || 0) > 0;

                                const hasOverduePending =
                                  overdueFineAmt > 0 && !overduePaid;

                                if (hasOverduePending) {
                                  return (
                                    <span className="sdp-fine-amount sdp-fine-amount--pending">
                                      {formatCurrency(fine)}
                                    </span>
                                  );
                                }

                                return (
                                  <span className="sdp-fine-amount sdp-fine-amount--paid">
                                    {formatCurrency(fine)} – Paid
                                  </span>
                                );
                              })() : (
                                <span className="sdp-detail-cell__na">—</span>
                              )}
                            </td>

                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {totalPages > 1 && (
                  <div className="catalogue-pagination">
                    <button
                      className="catalogue-pagination-btn"
                      disabled={currentPage === 1}
                      onClick={() =>
                        setCurrentPage((prev) => prev - 1)
                      }
                    >
                      Prev
                    </button>

                    {Array.from(
                      { length: totalPages },
                      (_, index) => (
                        <button
                          key={index + 1}
                          className={`catalogue-pagination-btn ${currentPage === index + 1
                            ? "catalogue-pagination-btn--active"
                            : ""
                            }`}
                          onClick={() =>
                            setCurrentPage(index + 1)
                          }
                        >
                          {index + 1}
                        </button>
                      )
                    )}

                    <button
                      className="catalogue-pagination-btn"
                      disabled={currentPage === totalPages}
                      onClick={() =>
                        setCurrentPage((prev) => prev + 1)
                      }
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   StudentDetailsPage — main export
   All state, API calls, and data logic are 100% unchanged.
   Only the rendered structure has been updated for UI parity
   with AdminReservationsPage.
═══════════════════════════════════════════════════════════ */
export default function StudentDetailsPage({
  user,
  onBack,
  onLogoutClick,
  setToast,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [expandedStudentKeys, setExpandedStudentKeys] = useState(new Set());
  const [exporting, setExporting] = useState("");

  const debounceRef = useRef(null);

  const fetchStudentDetails = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await apiRequest("/admin/student-details");
      setData(response);
    } catch (err) {
      const message = err?.message || "Failed to load student details.";
      setError(message);
      setToast?.({ type: "error", message });
    } finally {
      setLoading(false);
    }
  }, [setToast]);

  useEffect(() => {
    fetchStudentDetails();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetchStudentDetails]);

  const students = useMemo(() => {
    return Array.isArray(data?.students) ? data.students : [];
  }, [data]);

  const filteredStudents = useMemo(() => {
    const query = search.trim().toLowerCase();
    return students.filter((student) => {
      const name = String(student?.name || "").toLowerCase();
      const rollNo = String(
        student?.roll_no || student?.roll_number || ""
      ).toLowerCase();
      const email = String(student?.email || "").toLowerCase();
      const totalReservations = Number(
        student?.total_reservations ??
        (Array.isArray(student?.reservations) ? student.reservations.length : 0)
      );
      const activeCount = Number(student?.active_count || 0);
      const overdueCount = Number(student?.overdue_count || 0);

      const matchesSearch =
        !query ||
        name.includes(query) ||
        rollNo.includes(query) ||
        email.includes(query);

      let matchesFilter = true;
      if (filter === "active") {
        matchesFilter = activeCount > 0;
      } else if (filter === "overdue") {
        matchesFilter = overdueCount > 0;
      } else if (filter === "returned") {
        matchesFilter =
          totalReservations > 0 && activeCount === 0 && overdueCount === 0;
      }

      return matchesSearch && matchesFilter;
    });
  }, [students, search, filter]);

  const summary = useMemo(() => {
    const fallbackTotalStudents = students.length;
    const fallbackTotalReservations = students.reduce((sum, student) => {
      const count = Number(
        student?.total_reservations ??
        (Array.isArray(student?.reservations) ? student.reservations.length : 0)
      );
      return sum + count;
    }, 0);
    const fallbackActive = students.reduce((s, st) => s + Number(st?.active_count || 0), 0);
    const fallbackOverdue = students.reduce((s, st) => s + Number(st?.overdue_count || 0), 0);
    const fallbackFine = students.reduce((s, st) => s + Number(st?.total_fine || 0), 0);

    const fallbackCollected = students.reduce((s, st) => {
      const rsvs = Array.isArray(st?.reservations) ? st.reservations : [];
      return s + Number(
        st?.collected_count ??
        rsvs.filter((r) => normalizeStatus(r?.status) === "collected").length
      );
    }, 0);
    const fallbackExpired = students.reduce((s, st) => {
      const rsvs = Array.isArray(st?.reservations) ? st.reservations : [];
      return s + Number(
        st?.expired_count ??
        rsvs.filter((r) => normalizeStatus(r?.status) === "expired").length
      );
    }, 0);
    const fallbackCancelled = students.reduce((s, st) => {
      const rsvs = Array.isArray(st?.reservations) ? st.reservations : [];
      return s + Number(
        st?.cancelled_count ??
        rsvs.filter((r) =>
          ["cancelled", "canceled"].includes(normalizeStatus(r?.status))
        ).length
      );
    }, 0);

    return {
      totalStudents: Number(data?.summary?.total_students ?? fallbackTotalStudents),
      totalReservations: Number(data?.summary?.total_reservations ?? fallbackTotalReservations),
      activeCount: Number(data?.summary?.active_count ?? fallbackActive),
      overdueCount: Number(data?.summary?.overdue_count ?? fallbackOverdue),
      totalFine: Number(data?.summary?.total_fine ?? fallbackFine),
      collectedCount: Number(data?.summary?.collected_count ?? fallbackCollected),
      expiredCount: Number(data?.summary?.expired_count ?? fallbackExpired),
      cancelledCount: Number(data?.summary?.cancelled_count ?? fallbackCancelled),
    };
  }, [data, students]);

  const toggleStudent = (studentKey) => {
    setExpandedStudentKeys((prev) => {
      const next = new Set(prev);
      if (next.has(studentKey)) {
        next.delete(studentKey);
      } else {
        next.add(studentKey);
      }
      return next;
    });
  };

  const handleExpandAll = () => {
    const allKeys = filteredStudents.map((student, index) =>
      getStudentKey(student, index)
    );
    setExpandedStudentKeys(new Set(allKeys));
  };

  const handleCollapseAll = () => {
    setExpandedStudentKeys(new Set());
  };

  const handleSearchChange = (event) => {
    const value = event.target.value;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearch(value);
    }, 180);
  };

  const handleExport = async (type) => {
    const endpoint =
      type === "all"
        ? "/admin/student-details/export-all"
        : "/admin/student-details/export-overdue";
    const filename =
      type === "all"
        ? "all-student-reservations.xlsx"
        : "overdue-student-reservations.xlsx";
    setExporting(type);
    try {
      await downloadExcel(endpoint, filename);
      setToast?.({
        type: "success",
        message:
          type === "all"
            ? "All student reservations exported successfully."
            : "Overdue details exported successfully.",
      });
    } catch (err) {
      setToast?.({
        type: "error",
        message: err?.message || "Failed to export Excel file.",
      });
    } finally {
      setExporting("");
    }
  };

  /* ── Loading state ── */
  if (loading) {
    return (
      <div className="sdp-page">
        <div className="sdp-state-screen">
          <div className="sdp-spinner" />
          <p className="sdp-state-text">Loading student details…</p>
        </div>
      </div>
    );
  }

  /* ── Error state ── */
  if (error) {
    return (
      <div className="sdp-page">
        <div className="sdp-state-screen">
          <div className="sdp-state-icon">
            <Search size={40} strokeWidth={1.25} />
          </div>
          <h3 className="sdp-state-title">Unable to Load Student Details</h3>
          <p className="sdp-state-text">{error}</p>
          <button
            type="button"
            className="sdp-btn sdp-btn--primary"
            onClick={fetchStudentDetails}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  /* ═══════════ RENDER ═══════════ */
  return (
    <div className="sdp-page">

      {/* ── Dashboard Header ── */}
      <div className="sdp-header">
        <div className="sdp-header-left">
          <button
            type="button"
            className="sdp-back-btn"
            onClick={onBack}
            aria-label="Go back"
          >
            ← Back
          </button>
          <h2 className="sdp-title">Student Details</h2>
          <p className="sdp-subtitle">
            View all students, their reservation history, overdue activity, and export reports.
          </p>
        </div>

        <div className="sdp-header-actions">
          <button
            type="button"
            className="sdp-btn sdp-btn--primary"
            onClick={() => handleExport("all")}
            disabled={exporting === "all"}
          >
            {exporting === "all" ? "Exporting…" : "↓ Export All"}
          </button>

          <button
            type="button"
            className="sdp-btn sdp-btn--danger"
            onClick={() => handleExport("overdue")}
            disabled={exporting === "overdue"}
          >
            {exporting === "overdue" ? "Exporting…" : "↓ Export Overdue"}
          </button>

          <span className="sdp-results-badge">
            {filteredStudents.length} student{filteredStudents.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* ── Analytics Stats Row ── */}
      <div className="sdp-stats-grid">
        <StatCard
          Icon={Users}
          value={summary.totalStudents}
          label="Total Students"
          tone="tone-blue"
        />
        <StatCard
          Icon={BookOpen}
          value={summary.totalReservations}
          label="Reservations"
          tone="tone-green"
        />
        <StatCard
          Icon={CheckCircle2}
          value={summary.activeCount}
          label="Active"
          tone="tone-green"
        />
        <StatCard
          Icon={Clock3}
          value={summary.overdueCount}
          label="Overdue"
          tone="tone-amber"
        />
        <StatCard
          Icon={PackageCheck}
          value={summary.collectedCount}
          label="Collected"
          tone="tone-teal"
        />
        <StatCard
          Icon={CalendarX}
          value={summary.expiredCount}
          label="Expired"
          tone="tone-orange"
        />
        <StatCard
          Icon={XCircle}
          value={summary.cancelledCount}
          label="Cancelled"
          tone="tone-slate"
        />
        <StatCard
          Icon={DollarSign}
          value={formatCurrency(summary.totalFine)}
          label="Total Fines"
          tone="tone-red"
        />
      </div>

      {/* ── Search + Filter Toolbar ── */}
      <div className="sdp-toolbar">

        {/* Search row */}
        <div className="sdp-toolbar-search">
          <span className="sdp-search-icon">
            <Search size={15} strokeWidth={2} />
          </span>
          <input
            type="text"
            className="sdp-search-input"
            placeholder="Search by name, roll number, or email…"
            onChange={handleSearchChange}
          />
        </div>

        {/* Controls row: filter select + expand/collapse + count */}
        <div className="sdp-toolbar-controls">
          <select
            className="sdp-filter-select"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All Students</option>
            <option value="active">Has Active</option>
            <option value="overdue">Has Overdue</option>
            <option value="returned">Returned Only</option>
          </select>

          <div className="sdp-toolbar-right">
            <button
              type="button"
              className="sdp-btn sdp-btn--outline sdp-btn--sm"
              onClick={handleExpandAll}
            >
              Expand All
            </button>

            <button
              type="button"
              className="sdp-btn sdp-btn--outline sdp-btn--sm"
              onClick={handleCollapseAll}
            >
              Collapse All
            </button>

            <span className="sdp-result-count">
              Showing {filteredStudents.length} of {students.length}
            </span>
          </div>
        </div>
      </div>

      {/* ── Student list / empty state ── */}
      {filteredStudents.length === 0 ? (
        <div className="sdp-empty">
          <div className="sdp-empty-icon">
            <Search size={40} strokeWidth={1.25} />
          </div>
          <div className="sdp-empty-title">No Students Found</div>
          <div className="sdp-empty-sub">
            Try changing the search text or filter option.
          </div>
        </div>
      ) : (
        <div className="sdp-list">
          {filteredStudents.map((student, index) => {
            const studentKey = getStudentKey(student, index);
            return (
              <StudentCard
                key={studentKey}
                student={student}
                studentKey={studentKey}
                isExpanded={expandedStudentKeys.has(studentKey)}
                onToggle={() => toggleStudent(studentKey)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}