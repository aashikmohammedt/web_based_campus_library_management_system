import { useMemo, useState, useEffect } from "react";
import {
  ClipboardList,
  BookMarked,
  BookOpen,
  Clock3,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  BookX,
  Timer,
  Store,
  Search,
} from "lucide-react";
import { formatDateTime } from "../utils/dateFormat";
import { apiRequest } from "../api";
import "./StudentReservationsPage.css";


// ─── Derived Status ───────────────────────────────────────────────────────────
// Trusts the normalized backend status entirely.
// The only virtual derivation is "overdue":
//   a collected reservation whose dueDate (at 5 PM) is in the past.
// Status "overdue" is NEVER stored — it is always computed here at render time.
function getDerivedStatus(reservation) {
  if (!reservation) return "cancelled";

  const status = reservation.status;

  // Transitional compatibility for old returned records.
  // Some old DB records still store lost/damaged books
  // as returned reservations with fines attached.
  if (
    status === "returned" &&
    (
      reservation?.lostFinePaid ||
      Number(reservation?.lostFine || 0) > 0
    )
  ) {
    return "lost";
  }

  if (
    status === "returned" &&
    (
      reservation?.damageFinePaid ||
      Number(reservation?.damageFine || 0) > 0
    )
  ) {
    return "damaged";
  }

  // Pass through normalized terminal statuses directly.
  if (
    status === "returned" ||
    status === "damaged" ||
    status === "lost" ||
    status === "cancelled" ||
    status === "expired" ||
    status === "reserved"
  ) {
    return status;
  }

  // Virtual overdue: collected + past due date (5 PM cutoff).
  if (status === "collected") {
    const due = reservation.dueDate ? new Date(reservation.dueDate) : null;
    if (due && !Number.isNaN(due.getTime())) {
      due.setHours(17, 0, 0, 0);
      if (due < new Date()) return "overdue";
    }
    return "collected";
  }

  return status || "reserved";
}

function getSection(status) {
  switch (status) {
    case "reserved":
      return "active";

    case "collected":
    case "overdue":   // overdue is a subset view of collected
      return "collected";

    case "expired":
      return "history";

    case "cancelled":
      return "cancelled";

    case "lost":
      return "lost";

    case "damaged":
      return "damaged";

    case "returned":
      return "returned";

    default:
      return "history";
  }
}

// ─── Display Helpers ──────────────────────────────────────────────────────────

function getStatusLabel(status) {
  switch (status) {
    case "reserved": return "Pre-Booked";
    case "collected": return "Collected";
    case "returned": return "Returned";
    case "cancelled": return "Pre-Booking Cancelled";
    case "expired": return "Pre-Booking Expired";
    case "overdue": return "Overdue";
    case "lost": return "Lost";
    case "damaged": return "Damaged (Returned)";
    default: return "Unknown";
  }
}

const getBookTitle = (r) => r?.book?.title || "Untitled Book";
const getBookAuthor = (r) => r?.book?.author || "Unknown Author";
const getDepartment = (r) => r?.book?.department || "General";
const getLocation = (r) => r?.book?.location || "Shelf";
const getCourseCode = (r) => r?.book?.courseCode || "Not Assigned";

const getOverdueDays = (r) => Math.max(0, Number(r?.overdueDays || 0));
const getOverdueFine = (r) => Math.max(0, Number(r?.overdueFine || 0));
const getDamageFine = (r) => Math.max(0, Number(r?.damageFine || 0));
const getLostFine = (r) => Math.max(0, Number(r?.lostFine || 0));

// Returns the timestamp when the book was physically checked out.
// Mirrors ReservationList.jsx — tries every field name the server may use so
// older records still show correctly. For lost / damaged non-walk-in records
// where collectedAt was never written, falls back to reservedAt / createdAt
// as the best available proxy (the book was definitely collected before being
// marked lost/damaged).
function getCollectedAt(reservation) {
  const explicit =
    reservation?.collectedAt ||
    reservation?.checkedOutAt ||
    reservation?.checkoutAt ||
    reservation?.pickedUpAt ||
    null;

  if (explicit) return explicit;

  const status = reservation?.status;
  // Legacy fallback for non-walk-in records where collectedAt was never written.
  // The book was definitely collected for any of these statuses, so reservedAt
  // is the best available proxy for the checkout timestamp.
  const wasCollected =
    status === "collected" ||
    status === "returned" ||
    status === "lost" ||
    status === "damaged" ||
    reservation?.isBookLost ||
    reservation?.isBookDamaged;

  if (wasCollected && !reservation?.isWalkIn) {
    return reservation?.reservedAt || reservation?.createdAt || null;
  }

  return null;
}

// Split-display helpers for collectedAt
const formatDateOnly = (dt) =>
  dt ? new Date(dt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const formatTimeOnly = (dt) =>
  dt ? new Date(dt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—";
// Backend is the single source of truth — derive totalFine from the three
// fine fields the API provides so this always stays in sync.
const getTotalFine = (r) => {
  const overdueFine = Number(r?.overdueFine || 0);
  const damageFine = Number(r?.damageFine || 0);
  const lostFine = Number(r?.lostFine || 0);
  return (
    Number(overdueFine || 0) +
    Number(damageFine || 0) +
    Number(lostFine || 0)
  );
};


// ─── Pending Overdue Helper ───────────────────────────────────────────────────
// Returns true when a damaged or lost record still has an unpaid overdue fine.
// These records belong in the Overdue section only until the overdue is settled.
function isDamagedOrLostWithPendingOverdue(r) {
  const status = getDerivedStatus(r);
  if (status !== "damaged" && status !== "lost") return false;
  return Number(r?.overdueFine || 0) > 0 && !r?.overduePaid;
}

// ─── Section Definitions ──────────────────────────────────────────────────────


const SECTIONS = [
  {
    key: "active",
    tone: "srp-section--active",
    Icon: BookMarked,
    title: "Active Pre-Bookings",
    description: "Confirmed reservations awaiting collection from the library.",
    emptyNote: "No active reservations right now.",
  },
  {
    key: "collected",
    tone: "srp-section--collected",
    Icon: BookOpen,
    title: "Collected Books",
    description: "Books currently in your possession.",
    emptyNote: "No collected books.",
  },
  {
    key: "overdue",
    tone: "srp-section--history",
    Icon: Clock3,
    title: "Overdue Books",
    description: "Books that crossed the return date — still shown in Collected.",
    emptyNote: "No overdue books.",
  },
  {
    key: "walkin",
    tone: "srp-section--walkin",
    Icon: BookOpen,
    title: "Walk-In Checkouts",
    description: "Books checked out directly at the library counter without a prior pre-booking.",
    emptyNote: "No walk-in checkouts.",
  },
  {
    key: "history",
    tone: "srp-section--history",
    Icon: Clock3,
    title: "Expired Reservations",
    description: "Reservations not collected within the allowed time.",
    emptyNote: "No expired reservations.",
  },
  {
    key: "damaged",
    tone: "srp-section--closed",
    Icon: ClipboardList,
    title: "Damaged Books",
    description: "Books marked damaged and pending return completion.",
    emptyNote: "No damaged books.",
  },

  {
    key: "lost",
    tone: "srp-section--closed",
    Icon: ClipboardList,
    title: "Lost Books",
    description: "Lost books with paid fine records.",
    emptyNote: "No lost books.",
  },
  {
    key: "cancelled",
    tone: "srp-section--history",
    Icon: ClipboardList,
    title: "Cancelled Reservations",
    description: "Reservations cancelled before collection.",
    emptyNote: "No cancelled reservations.",
  },
  {
    key: "returned",
    tone: "srp-section--closed",
    Icon: CheckCircle2,
    title: "Returned Books",
    description: "Successfully returned books.",
    emptyNote: "No returned books.",
  },
];

/* ── Stat card config — one card per filter chip ─────────────────────────── */
const STAT_CARDS = [
  { value: "all",       Icon: ClipboardList, label: "All Records",  tone: ""            },
  { value: "active",    Icon: BookMarked,    label: "Pre-Bookings", tone: "tone-blue"   },
  { value: "walkin",    Icon: Store,         label: "Walk-In",      tone: "tone-teal"   },
  { value: "collected", Icon: BookOpen,      label: "Collected",    tone: "tone-green"  },
  { value: "overdue",   Icon: Clock3,        label: "Overdue",      tone: "tone-amber"  },
  { value: "history",   Icon: Timer,         label: "Expired",      tone: "tone-gray"   },
  { value: "damaged",   Icon: BookX,         label: "Damaged",      tone: "tone-orange" },
  { value: "lost",      Icon: AlertTriangle, label: "Lost",         tone: "tone-red"    },
  { value: "cancelled", Icon: XCircle,       label: "Cancelled",    tone: "tone-slate"  },
  { value: "returned",  Icon: CheckCircle2,  label: "Returned",     tone: "tone-purple" },
];

/* ── Filter chip config ───────────────────────────────────────────────────── */
const FILTER_CHIPS = [
  { value: "all", label: "All" },
  { value: "active", label: "Pre-Bookings" },
  { value: "walkin", label: "Walk-In Checkouts" },
  { value: "collected", label: "Collected" },
  { value: "overdue", label: "Overdue" },
  { value: "history", label: "Expired" },
  { value: "damaged", label: "Damaged" },
  { value: "lost", label: "Lost" },
  { value: "cancelled", label: "Cancelled" },
  { value: "returned", label: "Returned" },
];

/* ── Chip active class per section ────────────────────────────────────────── */
function chipActiveClass(value) {
  const map = {
    all: "active-prebooked",
    active: "active-prebooked",
    walkin: "active-walkin",
    collected: "active-collected",
    overdue: "active-expired",
    history: "active-expired",
    damaged: "active-cancelled",
    lost: "active-cancelled",
    cancelled: "active-cancelled",
    returned: "active-collected",
  };

  return map[value] || "active-prebooked";
}

// ─── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({ value, Icon, label, tone, count, isActive, onClick }) {
  return (
    <button
      type="button"
      className={`arp-stat-card ${tone || ""} ${isActive ? "active" : ""}`.trim()}
      onClick={() => onClick(value)}
      aria-pressed={isActive}
    >
      <div className="arp-stat-icon">
        {Icon && <Icon size={20} strokeWidth={1.75} />}
      </div>
      <div className="arp-stat-count">{count}</div>
      <div className="arp-stat-label">{label}</div>
    </button>
  );
}

// ─── ReservationCard ──────────────────────────────────────────────────────────

function ReservationCard({ reservation, loadingActionId, onCancel }) {
  const status = getDerivedStatus(reservation);
  const canCancel = status === "reserved";

  // ── Live countdown for pre-bookings ─────────────────────────────────────
  const [timeLeft, setTimeLeft] = useState(() => {
    if (status !== "reserved") return null;
    const deadline = new Date(
      new Date(reservation.createdAt || reservation.reservedAt).getTime() +
      24 * 60 * 60 * 1000
    );
    const diff = deadline - Date.now();
    if (diff <= 0) return { label: "Expired", urgent: true };
    const totalMins = Math.floor(diff / 60000);
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    return { label: h > 0 ? `${h}h ${m}m remaining` : `${m}m remaining`, urgent: totalMins < 60 };
  });

  useEffect(() => {
    if (status !== "reserved") return;
    const deadline = new Date(
      new Date(reservation.createdAt || reservation.reservedAt).getTime() +
      24 * 60 * 60 * 1000
    );
    function tick() {
      const diff = deadline - Date.now();
      if (diff <= 0) { setTimeLeft({ label: "Expired", urgent: true }); return; }
      const totalMins = Math.floor(diff / 60000);
      const h = Math.floor(totalMins / 60);
      const m = totalMins % 60;
      setTimeLeft({ label: h > 0 ? `${h}h ${m}m remaining` : `${m}m remaining`, urgent: totalMins < 60 });
    }
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, [status, reservation.createdAt, reservation.reservedAt]);

  const overdueDays = getOverdueDays(reservation);
  const overdueFine = getOverdueFine(reservation);
  const damageFine = getDamageFine(reservation);
  const lostFine = getLostFine(reservation);
  const totalFine = getTotalFine(reservation);
  const overduePaid = !!reservation?.overduePaid;
  const damageFinePaid = !!reservation?.damageFinePaid;

  // Transitional compatibility for old DB records.
  // Some records contain only lostFinePaidAt without lostFinePaid.
  const lostFinePaid =
    !!reservation?.lostFinePaid ||
    !!reservation?.lostFinePaidAt;

  const cardClass = [
    "reservation-card",
    status === "overdue" ? "is-overdue" : "",
    status === "returned" ? "is-returned" : "",
    status === "cancelled" ? "is-cancelled" : "",
    status === "expired" ? "is-expired" : "",
    status === "lost" ? "is-lost" : "",
    status === "damaged" ? "is-damaged" : "",
  ].filter(Boolean).join(" ");

  /* Label for the disabled action button */
  const actionLabel =
    status === "lost" ? "Book Marked Lost"
      : status === "damaged" ? "Book Marked Damaged"
        : status === "collected" ? "Book Collected"
          : status === "overdue" ? (overduePaid ? "Overdue Paid — Return Pending" : "Overdue — Payment Pending")
            : status === "returned" ? "Returned Successfully"
              : status === "cancelled" ? "Reservation Cancelled"
                : status === "expired" ? "Reservation Expired"
                  : "No Actions Available";

  return (
    <div className={cardClass}>

      {/* ── Card header: book title + walk-in tag + status badge ── */}
      <div className="res-card-header">
        <div className="res-card-header-left">
          <span className="res-card-header-icon">📖</span>
          <span className="res-card-header-title">{getBookTitle(reservation)}</span>
          {reservation.isWalkIn && (
            <span className="res-walkin-tag">Walk-In</span>
          )}
        </div>
        <span className={`status-badge ${status}`}>
          {getStatusLabel(status)}
        </span>
      </div>

      {/* ── 3-column detail grid ── */}
      <div className="res-sections-grid">

        {/* Book Details */}
        <div className="res-section res-section--book">
          <div className="res-section-title">
            <span className="res-section-icon">📚</span>
            Book Details
          </div>
          <div className="res-fields">
            <div className="res-field">
              <div className="res-field-label">Author</div>
              <div className="res-field-value res-field-value--strong">
                {getBookAuthor(reservation)}
              </div>
            </div>
            <div className="res-field">
              <div className="res-field-label">Department</div>
              <div className="res-field-value">{getDepartment(reservation)}</div>
            </div>
            <div className="res-field">
              <div className="res-field-label">Course Code</div>
              <div className="res-field-value res-field-value--mono">
                {getCourseCode(reservation)}
              </div>
            </div>
            <div className="res-field">
              <div className="res-field-label">Location</div>
              <div className="res-field-value">{getLocation(reservation)}</div>
            </div>
          </div>
        </div>

        {/* Dates */}
        <div className="res-section res-section--student">
          <div className="res-section-title">
            <span className="res-section-icon">📅</span>
            Dates
          </div>
          <div className="res-fields">
            {reservation.isWalkIn ? (
              <div className="res-field">
                <div className="res-field-label">Checked Out</div>
                <div className="res-field-value">
                  {formatDateTime(getCollectedAt(reservation) || reservation.createdAt)}
                </div>
              </div>
            ) : (
              <div className="res-field">
                <div className="res-field-label">Pre-Booked</div>
                <div className="res-field-value">
                  {formatDateTime(reservation.createdAt || reservation.reservedAt)}
                </div>
              </div>
            )}

            {/* Checked Out On — collected, overdue, lost, damaged, and returned.
                Walk-ins are excluded: for walk-ins the checkout date is already
                shown as the primary "Checked Out" field above.
                Uses getCollectedAt() to cover all server field name variants and
                provides a legacy fallback for records where collectedAt was
                never written. */}
            {status !== "cancelled" &&
              status !== "expired" &&
              !reservation.isWalkIn &&
              getCollectedAt(reservation) && (
              <div className="res-field">
                <div className="res-field-label">Checked Out On</div>
                <div className="res-field-value res-field-value--timestamp">
                  {formatDateTime(getCollectedAt(reservation))}
                </div>
              </div>
            )}

            {status === "reserved" ? (
              <div className="res-field res-due-field">
                <div className="res-field-label">Collect Within</div>
                <div className="res-due-display">
                  <span className="res-field-value res-field-value--strong">
                    {formatDateTime(
                      new Date(
                        new Date(
                          reservation.createdAt || reservation.reservedAt
                        ).getTime() + 24 * 60 * 60 * 1000
                      )
                    )}
                  </span>
                </div>
              </div>
            ) : status !== "expired" && status !== "cancelled" ? (
              <div className="res-field res-due-field">
                <div className="res-field-label">Due Date</div>
                <div className="res-due-display">
                  <span
                    className={
                      status === "overdue"
                        ? "res-field-value overdue-text"
                        : "res-field-value res-field-value--strong"
                    }
                  >
                    {(() => {
                      const d = new Date(reservation.dueDate);
                      d.setHours(17, 0, 0, 0);
                      return formatDateTime(d);
                    })()}
                  </span>
                </div>
              </div>
            ) : null}

            {overdueDays > 0 && (
              <div className="res-field">
                <div className="res-field-label">Overdue Days</div>
                <div className="res-field-value overdue-text">
                  {overdueDays} day{overdueDays !== 1 ? "s" : ""}
                </div>
              </div>
            )}

            {/* Book Returned Date & Time — hidden for lost books since the book
                was never actually returned; returnedAt may be set as a processing
                timestamp but should not be displayed as a return event.
                Also hidden for damaged/lost when overdue is still pending —
                return details only surface once the overdue fine is settled. */}
            {reservation?.returnedAt &&
              status !== "lost" &&
              status !== "cancelled" &&
              status !== "expired" &&
              !(
                (status === "damaged" || status === "lost") &&
                Number(reservation?.overdueFine || 0) > 0 &&
                !reservation?.overduePaid
              ) && (
              <div className="res-field">
                <div className="res-field-label">Book Returned</div>
                <div className="res-field-value res-field-value--timestamp">
                  {formatDateTime(reservation.returnedAt)}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Status & Fines */}
        <div className="res-section res-section--reservation">
          <div className="res-section-title">
            <span className="res-section-icon">💰</span>
            {status === "reserved"
              ? "Pre-Booking Details"
              : "Status & Fines"}
          </div>
          <div className="res-fields">

            {/* Overdue fine */}
            {(overdueFine > 0 ||
              (overduePaid && reservation?.overduePaidAmount > 0)) && (
                <div className="res-field">
                  <div className="res-field-label">Overdue Fine</div>
                  <div className="res-field-value">
                    ₹{overduePaid
                      ? reservation.overduePaidAmount
                      : overdueFine}
                    {overduePaid && (
                      <span className="fine-paid-inline"> — Paid</span>
                    )}
                  </div>
                </div>
              )}

            {/* Overdue Payment Timestamp */}
            {overduePaid && reservation?.overduePaidAt && (
              <div className="res-field">
                <div className="res-field-label">Overdue Paid On</div>
                <div className="res-field-value res-field-value--timestamp">
                  {formatDateTime(reservation.overduePaidAt)}
                </div>
              </div>
            )}

            {/* Damage fine */}
            {damageFine > 0 && (
              <div className="res-field">
                <div className="res-field-label">Damage Fine</div>
                <div className="res-field-value">
                  ₹{damageFine}
                  {(reservation?.damageFinePaid ||
                    reservation?.finePaid ||
                    status === "damaged") && (
                    <span className="fine-paid-inline"> — Paid</span>
                  )}
                </div>
              </div>
            )}

            {/* Damage Fine Payment Timestamp — covers both granular damageFinePaidAt
                and legacy finePaidAt records where damageFine > 0. */}
            {damageFine > 0 &&
              (reservation?.damageFinePaid ||
                reservation?.finePaid ||
                status === "damaged") &&
              (reservation?.damageFinePaidAt || reservation?.finePaidAt) && (
                <div className="res-field">
                  <div className="res-field-label">Damage Fine Paid On</div>
                  <div className="res-field-value res-field-value--timestamp">
                    {formatDateTime(reservation.damageFinePaidAt || reservation.finePaidAt)}
                  </div>
                </div>
              )}

            {/* Lost fine.
                Payment indicator priority (highest to lowest):
                  1. lostFinePaid / lostFinePaidAt  — granular flag (new records)
                  2. finePaid / finePaidAt           — legacy single-fine flag
                  3. lostFinePaidAmount > 0          — paid-amount field set
                  4. status === "lost"               — definitive fallback: the
                     backend only sets status="lost" AFTER the fine is fully
                     settled, so the status itself is proof of payment for any
                     record where the granular flags were never written. */}
            {lostFine > 0 && (() => {
              const lostFinePaidAny =
                lostFinePaid ||
                !!reservation?.lostFinePaidAt ||
                !!reservation?.finePaid ||
                Number(reservation?.lostFinePaidAmount || 0) > 0 ||
                status === "lost";

              const lostFinePaidOn =
                reservation?.lostFinePaidAt ||
                reservation?.finePaidAt ||
                reservation?.returnedAt ||
                null;

              return (
                <>
                  <div className="res-field">
                    <div className="res-field-label">Lost Fine</div>
                    <div className="res-field-value">
                      ₹{reservation?.lostFinePaidAmount || lostFine}
                      {lostFinePaidAny && (
                        <span className="fine-paid-inline"> — Paid</span>
                      )}
                    </div>
                  </div>
                  {lostFinePaidAny && lostFinePaidOn && (
                    <div className="res-field">
                      <div className="res-field-label">Lost Fine Paid On</div>
                      <div className="res-field-value res-field-value--timestamp">
                        {formatDateTime(lostFinePaidOn)}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}

            {/* Fallback fine payment timestamp — legacy records only.
                Shown when finePaid is set but no granular per-type
                timestamp exists AND neither lost nor damage fine is being
                handled above (i.e. records settled before the granular
                fields were introduced). Specific handlers above take priority. */}
            {reservation?.finePaid &&
              !reservation?.damageFinePaidAt &&
              !reservation?.lostFinePaidAt &&
              lostFine === 0 &&
              damageFine === 0 &&
              reservation?.finePaidAt && (
                <div className="res-field">
                  <div className="res-field-label">Fine Paid On</div>
                  <div className="res-field-value res-field-value--timestamp">
                    {formatDateTime(reservation.finePaidAt)}
                  </div>
                </div>
              )}

            {/* Total fine */}
            {totalFine > 0 && (
              <div className="res-field">
                <div className="res-field-label">Total Fine</div>
                <div className="res-field-value res-field-value--strong">
                  ₹{totalFine}
                </div>
              </div>
            )}



            {/* Condition flags — derived from normalized backend status only */}
            {status === "damaged" && (
              <div className="res-field">
                <div className="res-field-label">Condition</div>
                <div className="res-field-value">
                  <span className="res-flag res-flag--damaged">Damaged</span>
                </div>
              </div>
            )}
            {status === "lost" && (
              <div className="res-field">
                <div className="res-field-label">Condition</div>
                <div className="res-field-value">
                  <span className="res-flag res-flag--lost">Lost</span>
                </div>
              </div>
            )}

            {/* Pending collection countdown — Pre-Bookings only */}
            {status === "reserved" && timeLeft && (
              <div className="res-field">
                <div className="res-field-label">Time to Collect</div>
                <div className="res-field-value">
                  <span className={`res-countdown${timeLeft.urgent ? " res-countdown--urgent" : ""}`}>
                    ⏳ {timeLeft.label}
                  </span>
                </div>
              </div>
            )}

            {/* Nothing to show at all */}
            {overdueFine === 0 &&
              damageFine === 0 &&
              lostFine === 0 &&
              totalFine === 0 &&
              !damageFinePaid &&
              !lostFinePaid &&
              status !== "damaged" &&
              status !== "lost" &&
              status !== "reserved" && (
                <div className="res-field">
                  <div className="res-field-label">Fines</div>
                  <div className="res-field-value" style={{ color: "#9ca3af" }}>
                    None
                  </div>
                </div>
              )}
          </div>
        </div>

      </div>{/* /res-sections-grid */}

      {/* ── Action footer — only shown when cancellation is available ── */}
      {canCancel && (
        <div className="reservation-actions">
          <button
            type="button"
            className="danger-btn"
            disabled={loadingActionId === reservation._id}
            onClick={() => onCancel(reservation._id)}
          >
            {loadingActionId === reservation._id
              ? "Please wait…"
              : "Cancel Reservation"}
          </button>
        </div>
      )}

    </div>
  );
}

// ─── SectionBlock ─────────────────────────────────────────────────────────────

function SectionBlock({ section, cards, loadingActionId, onCancel }) {
  const { tone, Icon, title, description, emptyNote } = section;

  return (
    <div className={`srp-section ${tone}`}>

      {/* Section heading */}
      <div className="srp-section-head">
        <div>
          <div className="srp-section-title-row">
            <span className="srp-section-icon">
              <Icon size={15} strokeWidth={2} />
            </span>
            <h3 className="srp-section-title">{title}</h3>
            <span className="srp-section-count">{cards.length}</span>
          </div>
          <p className="srp-section-desc">{description}</p>
        </div>
      </div>

      {/* Cards or empty state */}
      {cards.length > 0 ? (
        <div className="reservation-list">
          {cards.map((reservation) => (
            <ReservationCard
              key={reservation._id}
              reservation={reservation}
              loadingActionId={loadingActionId}
              onCancel={onCancel}
            />
          ))}
        </div>
      ) : (
        <div className="arp-empty">
          <div className="arp-empty-icon">
            <Icon size={36} strokeWidth={1.25} style={{ opacity: 0.45 }} />
          </div>
          <h3 className="arp-empty-title">{emptyNote}</h3>
        </div>
      )}

    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * Returns a Set of book IDs that the student currently has actively reserved
 * or collected (including walk-in checkouts). Used by the book catalogue to
 * disable the "Reserve" button and show the right error message.
 *
 * Rules:
 *  • Only "reserved" and "collected" statuses are active.
 *  • Returned / cancelled / expired reservations allow the book to be re-reserved.
 *  • Lost records where damageFinePaid or lostFinePaid is true are EXCLUDED — the fee was settled, so
 *    the student is free to reserve or check out the same book again.
 */
export function getActiveBookIds(reservations = []) {
  const ACTIVE = new Set(["reserved", "collected"]);
  const ids = new Set();

  reservations.forEach((r) => {
    if (ACTIVE.has(r?.status)) {
      const bookId =
        r?.book?._id ||
        r?.book?.id ||
        r?.book;

      if (bookId) {
        ids.add(String(bookId));
      }
    }
  });

  return ids;
}

export default function StudentReservationsPage({
  reservations = [],
  books = [],           // full book list (optional) — reserved for future use
  onBack,
  refreshReservations,
  refreshBooks,
  setToast,
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [sectionFilter, setSectionFilter] = useState("all");
  const [loadingActionId, setLoadingActionId] = useState("");

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const s = {
      all: reservations.length,
      active: 0,
      collected: 0,
      overdue: 0,
      history: 0,
      damaged: 0,
      lost: 0,
      cancelled: 0,
      returned: 0,
      walkin: 0,
    };
    reservations.forEach((r) => {
      if (r.isWalkIn) s.walkin += 1;
      const derivedStatus = getDerivedStatus(r);
      // active stat = reserved + collected (including virtual overdue)
      if (derivedStatus === "reserved" || derivedStatus === "collected" || derivedStatus === "overdue") {
        if (derivedStatus === "reserved") s.active += 1;
        if (derivedStatus === "collected") { s.collected += 1; }
        if (derivedStatus === "overdue") { s.collected += 1; s.overdue += 1; }
      } else if (derivedStatus === "damaged") {
        const overdueUnpaid = Number(r?.overdueFine || 0) > 0 && !r?.overduePaid;
        if (overdueUnpaid) {
          // Pending overdue — counts only toward overdue, not damaged
          s.overdue += 1;
        } else {
          s.damaged += 1;
          // Mirrors grouped logic: damaged + finePaid also appears in returned section
          if (r?.finePaid) s.returned += 1;
        }
      } else if (derivedStatus === "lost") {
        const overdueUnpaid = Number(r?.overdueFine || 0) > 0 && !r?.overduePaid;
        if (overdueUnpaid) {
          // Pending overdue — counts only toward overdue, not lost
          s.overdue += 1;
        } else {
          s.lost += 1;
        }
      } else {
        const sec = getSection(derivedStatus);
        if (s[sec] !== undefined) s[sec] += 1;
      }
    });
    return s;
  }, [reservations]);

  function statCount(value) {
    return stats[value] ?? 0;
  }

  // ── Filter change ─────────────────────────────────────────────────────────
  const handleFilterChange = (value) => {
    setSectionFilter(value);
  };

  // ── Filtered + sorted list ────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...reservations];

    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      list = list.filter((r) =>
        getBookTitle(r).toLowerCase().includes(q) ||
        getBookAuthor(r).toLowerCase().includes(q) ||
        getDepartment(r).toLowerCase().includes(q) ||
        getStatusLabel(getDerivedStatus(r)).toLowerCase().includes(q) ||
        (r.isWalkIn && "walk-in walk in walkin".includes(q))
      );
    }

    return list.sort((a, b) => {
      const aDate = new Date(a.createdAt || a.reservedAt || 0).getTime();
      const bDate = new Date(b.createdAt || b.reservedAt || 0).getTime();
      return bDate - aDate;
    });
  }, [reservations, searchTerm]);

  // ── Group into sections ───────────────────────────────────────────────────
  const grouped = useMemo(() => {
    const map = {
      active: [],
      collected: [],   // includes overdue items (collected + virtual overdue)
      overdue: [],     // subset view — overdue items only
      walkin: [],      // cross-cutting: all walk-in records regardless of status
      history: [],
      damaged: [],
      lost: [],
      cancelled: [],
      returned: [],    // status === "returned" + damaged (books that came back)
    };
    filtered.forEach((r) => {
      // Walk-in records are also pushed to their normal status sections below
      // so they appear in "All" mode without duplication; the dedicated walkin
      // section is only shown when the Walk-In Checkouts chip is active.
      if (r.isWalkIn) map.walkin.push(r);

      const derivedStatus = getDerivedStatus(r);
      if (derivedStatus === "overdue") {
        // overdue is a subset view of collected — push to both
        map.collected.push(r);
        map.overdue.push(r);
      } else if (derivedStatus === "damaged") {
        const overdueUnpaid =
          Number(r?.overdueFine || 0) > 0 && !r?.overduePaid;
        if (overdueUnpaid) {
          // Overdue still pending — show ONLY in overdue section.
          // Do NOT push to damaged or returned until overdue is settled.
          map.overdue.push(r);
        } else {
          // Overdue settled (or no overdue) — show in damaged.
          // Also show in returned if all fines are fully paid.
          map.damaged.push(r);
          if (r?.finePaid) {
            map.returned.push(r);
          }
        }
      } else if (derivedStatus === "lost") {
        const overdueUnpaid =
          Number(r?.overdueFine || 0) > 0 && !r?.overduePaid;
        if (overdueUnpaid) {
          // Overdue still pending — show ONLY in overdue section.
          map.overdue.push(r);
        } else {
          // Overdue settled (or no overdue) — show in lost.
          map.lost.push(r);
        }
      } else {
        const sec = getSection(derivedStatus);
        map[sec].push(r);
      }
    });
    return map;
  }, [filtered]);

  // ── Visible sections ──────────────────────────────────────────────────────
  // In "all" mode the walkin section is intentionally hidden: walk-in records
  // already appear inside their respective status sections (collected, active,
  // etc.) so surfacing the walkin section too would double-show the same cards.
  // The dedicated view is only active when the Walk-In Checkouts chip is selected.
  const visibleSections = sectionFilter === "all"
    ? SECTIONS.filter((s) => s.key !== "walkin")
    : SECTIONS.filter((s) => s.key === sectionFilter);

  const hasAnyVisible = visibleSections.some(
    (s) => grouped[s.key]?.length > 0
  );

  const resultsCount = filtered.length;

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleCancelReservation = async (reservationId) => {
    setLoadingActionId(reservationId);
    try {
      const data = await apiRequest(`/reservations/${reservationId}/status`, {
        method: "PUT",
        body: JSON.stringify({ action: "cancel" }),
      });
      setToast?.({ type: "success", message: data?.message || "Reservation cancelled successfully" });
      await refreshReservations?.();
      await refreshBooks?.();
    } catch (err) {
      setToast?.({ type: "error", message: err.message || "Failed to cancel reservation" });
    } finally {
      setLoadingActionId("");
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="page-shell">
      <div className="srp-page">

        {/* ── Page Header ── */}
        <div className="arp-header">
          <div className="arp-header-left">
            <button
              type="button"
              className="secondary-btn compact-header-btn arp-back-btn"
              onClick={onBack}
            >
              ← Back
            </button>
            <h2 className="arp-title">My Pre-Bookings and Checkouts</h2>
            <p className="arp-subtitle">
              Track all your reserved, collected, overdue, damaged, lost, and returned books in one place.            </p>
          </div>

          <div className="arp-header-actions">
            <span className="arp-results-badge">
              {resultsCount} result{resultsCount !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {/* ── Stats Cards Grid — click to filter ── */}
        <div className="srp-stats-grid">
          {STAT_CARDS.map(({ value, Icon, label, tone }) => (
            <StatCard
              key={value}
              value={value}
              Icon={Icon}
              label={label}
              tone={tone}
              count={statCount(value)}
              isActive={sectionFilter === value}
              onClick={handleFilterChange}
            />
          ))}
        </div>

        {/* ── Toolbar ── */}
        <div className="arp-toolbar">

          {/* Search input */}
          <div className="arp-toolbar-search">
            <span className="arp-search-icon">
              <Search size={15} strokeWidth={2} />
            </span>
            <input
              type="text"
              className="arp-search-input"
              placeholder="Search by title, author, department, or status…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button
                type="button"
                className="arp-search-clear"
                onClick={() => setSearchTerm("")}
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>

          {/* Filter chips */}
          <div className="arp-filter-row">
            {FILTER_CHIPS.map(({ value, label }) => {
              const count = statCount(value);
              const isActive = sectionFilter === value;
              const cls = isActive
                ? `active ${chipActiveClass(value)}`
                : "";
              return (
                <button
                  key={value}
                  type="button"
                  className={`arp-chip ${cls}`}
                  onClick={() => handleFilterChange(value)}
                >
                  {label}
                  {count > 0 && (
                    <span className="arp-chip-count">{count}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Search results note */}
          {searchTerm.trim() && (
            <div style={{ padding: "6px 14px 10px" }}>
              <span className="search-results-note">
                {filtered.length} result{filtered.length !== 1 ? "s" : ""}{" "}
                for &ldquo;{searchTerm.trim()}&rdquo;
              </span>
            </div>
          )}
        </div>

        {/* ── Section Content ── */}
        {!hasAnyVisible && filtered.length === 0 ? (
          /* Global empty — no results at all */
          <div className="arp-empty">
            <div className="arp-empty-icon">
              <Search size={40} strokeWidth={1.25} />
            </div>
            <h3 className="arp-empty-title">
              {searchTerm.trim()
                ? "No reservations match your search."
                : "No reservation history found."}
            </h3>
            <p className="arp-empty-sub">
              {searchTerm.trim()
                ? "Try a different search term."
                : "Your reservations will appear here once you reserve a book."}
            </p>
          </div>

        ) : !hasAnyVisible ? (
          /* Filtered empty — section selected but no cards in that section */
          <div className="arp-empty">
            <div className="arp-empty-icon">
              <ClipboardList size={40} strokeWidth={1.25} />
            </div>
            <h3 className="arp-empty-title">
              {SECTIONS.find((s) => s.key === sectionFilter)?.emptyNote ||
                "No records found."}
            </h3>
            <p className="arp-empty-sub">
              Try selecting a different filter above.
            </p>
          </div>

        ) : (
          /* Sections with cards */
          <div className="srp-sections">
            {visibleSections.map((section) => {
              const cards = grouped[section.key] || [];
              /* In "all" mode skip empty sections silently */
              if (sectionFilter === "all" && cards.length === 0) return null;
              return (
                <SectionBlock
                  key={section.key}
                  section={section}
                  cards={cards}
                  loadingActionId={loadingActionId}
                  onCancel={handleCancelReservation}
                />
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
}