import { BookOpen, User, ClipboardList, CheckCircle2 } from "lucide-react";
import { formatDateTime } from "../utils/dateFormat";

// ─── Helper functions ────────────────────────────────────────────────────────
export function formatDateInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function getDerivedStatus(reservation) {
  if (!reservation) return "cancelled";

  // Manual issue flags take highest priority — a lost or damaged book is
  // always displayed as such, regardless of underlying status.
  if (reservation.isBookDamaged) return "damaged";
  if (reservation.isBookLost) return "lost";

  // Terminal statuses — return immediately, no further checks needed.
  // "expired" must be checked before the overdue logic so that a pre-book
  // whose 24-h window has passed is never mislabelled as something else.
  if (reservation.status === "returned") return "returned";
  if (reservation.status === "cancelled") return "cancelled";
  if (reservation.status === "expired") return "expired";

  const due = reservation.dueDate ? new Date(reservation.dueDate) : null;
  if (due && !Number.isNaN(due.getTime())) due.setHours(17, 0, 0, 0); // fixed 5 PM

  if (
    due &&
    !Number.isNaN(due.getTime()) &&
    due < new Date() &&
    reservation.status === "collected"
  ) {
    return "overdue";
  }

  return reservation.status || "reserved";
}

export function getStatusLabel(status) {
  switch (status) {
    case "reserved":
      return "Pre-Booked";
    case "collected":
      return "Collected";
    case "overdue":
      return "Overdue";
    case "returned":
      return "Returned";
    case "damaged":
      return "Damaged (Returned)";
    case "lost":
      return "Lost";
    case "cancelled":
      return "Cancelled";
    case "expired":
      return "Pre-Booking Expired";
    default:
      return "Unknown";
  }
}

export function getBookTitle(reservation) {
  return reservation?.book?.title || "Untitled Book";
}

export function getBookAuthor(reservation) {
  return reservation?.book?.author || "Unknown Author";
}

export function getStudentName(reservation) {
  return reservation?.user?.name || "Unknown Student";
}

export function getStudentEmail(reservation) {
  return reservation?.user?.email || "No Email";
}

export function getStudentId(reservation) {
  return reservation?.user?.studentId || "—";
}

export function getDepartment(reservation) {
  return reservation?.book?.department || "General";
}

export function getLocation(reservation) {
  return reservation?.book?.location || "Shelf";
}

export function getCourseCode(reservation) {
  return reservation?.book?.courseCode || "Not Assigned";
}

// Returns the timestamp when the book was physically checked out.
// Tries every field name the server may use so older records still show correctly.
// For lost / damaged records that pre-date the collectedAt field (legacy DB rows
// where collectedAt was never written), falls back to reservedAt / createdAt as a
// best-available proxy — the book was definitely collected before being marked lost.
export function getCollectedAt(reservation) {
  // Primary: any of the known checkout timestamp field names
  const explicit =
    reservation?.collectedAt ||
    reservation?.checkedOutAt ||
    reservation?.checkoutAt ||
    reservation?.pickedUpAt ||
    null;

  if (explicit) return explicit;

  // Legacy fallback for non-walk-in records where collectedAt was never written.
  // Old DB rows pre-date the collectedAt field so it is null, but the book was
  // clearly collected at some point for any of these statuses.
  // reservedAt (the pre-book timestamp) is the best available proxy.
  const status = reservation?.status;
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

const OVERDUE_FINE_PER_DAY = 20; // must match server constant

export function getOverdueDays(reservation) {
  const due = reservation?.dueDate ? new Date(reservation.dueDate) : null;
  if (!due || Number.isNaN(due.getTime())) return 0;

  // Fixed due time = 5:00 PM
  due.setHours(17, 0, 0, 0);

  // If overdue was already paid, back-calculate from the paid amount
  // so the displayed days never drift after settlement.
  if (reservation?.overduePaid && reservation?.overduePaidAmount > 0) {
    return Math.round(Number(reservation.overduePaidAmount) / OVERDUE_FINE_PER_DAY);
  }

  // For lost / damaged books that have no returnedAt, use the fine-payment
  // timestamp (overduePaidAt, lostFinePaidAt, damageFinePaidAt, finePaidAt)
  // as the "end" anchor so days don't keep growing after the record is closed.
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

  // For active (not yet closed) books, the server value can be preferred
  // when it exists; otherwise fall back to live calculation.
  if (!closingTimestamp) {
    const serializedDays = Number(reservation?.overdueDays || 0);
    return serializedDays > 0 ? serializedDays : calculatedDays;
  }

  return calculatedDays;
}

export function getOverdueFine(reservation) {
  // Prefer the server-computed field when available and nonzero
  const serializedFine = Number(reservation?.overdueFine || 0);
  if (serializedFine > 0) return serializedFine;

  // Fallback: compute live from overdueDays so the button is never
  // silently disabled when the serialized field hasn't propagated yet
  const days = getOverdueDays(reservation);
  return days > 0 ? days * OVERDUE_FINE_PER_DAY : 0;
}

export function getDamageFine(reservation) {
  const fine = Number(reservation?.damageFine || 0);
  return fine > 0 ? fine : 0;
}

export function getLostFine(reservation) {
  const fine = Number(reservation?.lostFine || 0);
  return fine > 0 ? fine : 0;
}

export function getTotalFine(reservation) {
  const fine = Number(reservation?.totalFine || 0);
  return fine > 0 ? fine : 0;
}

/**
 * Returns true when a damaged/lost record still has an unpaid overdue fine.
 * Used by AdminReservationsPage to decide which filter section to surface it in.
 */
export function isDamagedOrLostWithPendingOverdue(reservation) {
  const status = getDerivedStatus(reservation);
  if (status !== "damaged" && status !== "lost") return false;
  const overdueFine = getOverdueFine(reservation);
  return overdueFine > 0 && !reservation?.overduePaid;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ReservationList({
  reservations,
  loadingActionId,
  editingDueDateId,
  dueDateValue,
  setEditingDueDateId,
  setDueDateValue,
  runAdminAction,
  onConfirmCollect,
  onConfirmReturn,
  handleSaveDueDate,
  handleRemind,
  onOpenFine,
  onOpenOverduePayment,
  onOpenDamagePayment,
  onOpenLostPayment,
}) {
  return (
    <div className="reservation-list">
      {reservations.map((reservation) => {
        const status = getDerivedStatus(reservation);
        const canEditDueDate = !["returned", "cancelled", "expired", "lost", "damaged"].includes(status);
        const isBusy = loadingActionId === reservation._id;

        // Mark as Collected: only for active pre-books (reserved), not expired/cancelled/collected
        const canMarkCollected = status === "reserved";

        const isEditingDueDate = editingDueDateId === reservation._id;

        // Cancelled pre-bookings never accrue overdue — the book was never collected
        const overdueDays = status === "cancelled" ? 0 : getOverdueDays(reservation);
        const overdueFine = status === "cancelled" ? 0 : getOverdueFine(reservation);
        const damageFine = getDamageFine(reservation);
        const lostFine = getLostFine(reservation);
        const totalFine = getTotalFine(reservation);
        const overduePaid = !!reservation?.overduePaid;

        return (
          <div
            key={reservation._id}
            className={`reservation-card ${status === "overdue"
              ? "is-overdue"
              : status === "returned"
                ? "is-returned"
                : status === "cancelled"
                  ? "is-cancelled"
                  : status === "expired"
                    ? "is-expired"
                    : status === "lost"
                      ? "is-lost"
                      : status === "damaged"
                        ? "is-damaged"
                        : ""
              }`}
          >
            {/* ── Slim card header: book title identifier + status badge ── */}
            <div className="res-card-header">
              <div className="res-card-header-left">
                <span className="res-card-header-icon">
                  <BookOpen size={15} strokeWidth={2} />
                </span>
                <span className="res-card-header-title">{getBookTitle(reservation)}</span>
                {reservation.isWalkIn && (
                  <span className="res-walkin-tag">Walk-In</span>
                )}
              </div>
              <span className={`status-badge ${status}`}>
                {getStatusLabel(status)}
              </span>
            </div>

            {/* ── 3-column dashboard section grid ── */}
            <div className="res-sections-grid">

              {/* ── Section 1: Student Details ── */}
              <div className="res-section res-section--student">
                <div className="res-section-title">
                  <span className="res-section-icon">
                    <User size={13} strokeWidth={2} />
                  </span>
                  Student Details
                </div>
                <div className="res-fields">
                  <div className="res-field">
                    <span className="res-field-label">Name</span>
                    <span className="res-field-value res-field-value--strong">
                      {getStudentName(reservation)}
                    </span>
                  </div>
                  <div className="res-field">
                    <span className="res-field-label">Student ID</span>
                    <span className="res-field-value res-field-value--mono">
                      {getStudentId(reservation)}
                    </span>
                  </div>
                  <div className="res-field">
                    <span className="res-field-label">Email</span>
                    <span className="res-field-value res-field-value--break">
                      {getStudentEmail(reservation)}
                    </span>
                  </div>
                  <div className="res-field">
                    <span className="res-field-label">Department</span>
                    <span className="res-field-value">
                      {getDepartment(reservation)}
                    </span>
                  </div>
                </div>
              </div>

              {/* ── Section 2: Book Details ── */}
              <div className="res-section res-section--book">
                <div className="res-section-title">
                  <span className="res-section-icon">
                    <BookOpen size={13} strokeWidth={2} />
                  </span>
                  Book Details
                </div>
                <div className="res-fields">
                  <div className="res-field">
                    <span className="res-field-label">Title</span>
                    <span className="res-field-value res-field-value--strong">
                      {getBookTitle(reservation)}
                    </span>
                  </div>
                  <div className="res-field">
                    <span className="res-field-label">Author</span>
                    <span className="res-field-value">
                      {getBookAuthor(reservation)}
                    </span>
                  </div>
                  <div className="res-field">
                    <span className="res-field-label">Course Code</span>
                    <span className="res-field-value res-field-value--mono">
                      {getCourseCode(reservation)}
                    </span>
                  </div>
                  <div className="res-field">
                    <span className="res-field-label">Location</span>
                    <span className="res-field-value">
                      {getLocation(reservation)}
                    </span>
                  </div>

                  {/* Condition — only for lost / damaged books */}
                  {(status === "lost" || status === "damaged") && (
                    <div className="res-field" style={{ width: "fit-content", alignSelf: "flex-start" }}>
                      <span className="res-field-label">Condition</span>
                      <span className={`res-flag ${status === "lost" ? "res-flag--lost" : "res-flag--damaged"}`}>
                        {status === "lost" ? "Lost" : "Damaged"}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Section 3: Reservation Details ── */}
              <div className="res-section res-section--reservation">
                <div className="res-section-title">
                  <span className="res-section-icon">
                    <ClipboardList size={13} strokeWidth={2} />
                  </span>
                  {(status === "collected" || status === "overdue" || status === "returned" ||
                    ((status === "damaged" || status === "lost") && !isDamagedOrLostWithPendingOverdue(reservation)))
                    ? "Check-Out Details"
                    : "Pre-Booking Details"}
                </div>
                <div className="res-fields">

                  {/* Reserved / Checked Out Date */}
                  <div className="res-field">
                    <span className="res-field-label">
                      {reservation.isWalkIn ? "Checked Out" : "Pre-Booked"}
                    </span>
                    <span className="res-field-value">
                      {formatDateTime(
                        reservation.isWalkIn
                          ? getCollectedAt(reservation) || reservation.createdAt
                          : reservation.reservedAt || reservation.createdAt
                      )}
                    </span>
                  </div>

                  {/* Checked Out On — shown for all statuses except cancelled and expired.
                      Walk-ins are excluded because collectedAt already appears as the
                      first field ("Checked Out") above.
                      Uses getCollectedAt() to cover all server field name variants. */}
                  {status !== "cancelled" &&
                    status !== "expired" &&
                    !reservation.isWalkIn &&
                    getCollectedAt(reservation) && (
                      <div className="res-field">
                        <span className="res-field-label">Checked Out On</span>
                        <span className="res-field-value res-field-value--timestamp">
                          {formatDateTime(getCollectedAt(reservation))}
                        </span>
                      </div>
                  )}

                  {/* Reservation Expiry / Due Date */}
                  {status === "reserved" ? (
                    <div className="res-field res-due-field">
                      <span className="res-field-label">Due Timing</span>

                      <div className="res-due-display">
                        <span className="res-field-value">
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
                      <span className="res-field-label">Due Date</span>

                      {!isEditingDueDate ? (
                        <div className="res-due-display">
                          <span className={`res-field-value ${status === "overdue" ? "overdue-text" : ""}`}>
                            {(() => {
                              const d = new Date(reservation.dueDate);
                              d.setHours(17, 0, 0, 0);
                              return formatDateTime(d);
                            })()}
                          </span>

                          {canEditDueDate && (
                            <button
                              type="button"
                              className="edit-due-btn"
                              onClick={() => {
                                setEditingDueDateId(reservation._id);
                                setDueDateValue(formatDateInputValue(reservation.dueDate));
                              }}
                              disabled={isBusy}
                            >
                              Edit
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="res-due-edit-row">
                          <input
                            type="date"
                            className="compact-input"
                            value={dueDateValue}
                            onChange={(e) => setDueDateValue(e.target.value)}
                            disabled={isBusy}
                          />

                          <button
                            type="button"
                            className="primary-btn small-btn"
                            onClick={() => handleSaveDueDate(reservation._id)}
                            disabled={isBusy}
                          >
                            {isBusy ? "Saving…" : "Save"}
                          </button>

                          <button
                            type="button"
                            className="secondary-btn small-btn"
                            onClick={() => {
                              setEditingDueDateId("");
                              setDueDateValue("");
                            }}
                            disabled={isBusy}
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  ) : null}

                  {/* Book Returned On — hidden for damaged/lost with pending overdue.
                      Return details only surface once the overdue fine is settled. */}
                  {reservation?.returnedAt &&
                    status !== "cancelled" &&
                    !isDamagedOrLostWithPendingOverdue(reservation) && (
                    <>
                      <div className="res-field">
                        <div className="res-field-label">Book Returned On</div>
                        <div className="res-field-value res-field-value--timestamp">
                          {formatDateTime(reservation.returnedAt)}
                        </div>
                      </div>
                    </>
                  )}



                  {/* Overdue Days — expired books are never collected so no overdue applies */}
                  {overdueDays > 0 && status !== "expired" && (
                    <div className="res-field">
                      <span className="res-field-label">Overdue Days</span>
                      <span className="res-field-value overdue-text">{overdueDays} days</span>
                    </div>
                  )}

                  {/* Overdue Fine — use paid amount when already paid */}
                  {(overdueFine > 0 || (overduePaid && reservation?.overduePaidAmount > 0)) && status !== "expired" && (
                    <div className="res-field">
                      <span className="res-field-label">Overdue Fine</span>
                      <span className="res-field-value">
                        ₹{overduePaid ? reservation.overduePaidAmount : overdueFine}
                        {overduePaid && (
                          <span className="fine-paid-inline"> — Paid</span>
                        )}
                      </span>
                    </div>
                  )}

                  {/* Overdue Payment Timestamp */}
                  {overduePaid && reservation?.overduePaidAt && status !== "expired" && (
                    <div className="res-field">
                      <span className="res-field-label">Overdue Fine Paid On</span>
                      <span className="res-field-value res-field-value--timestamp">
                        {formatDateTime(reservation.overduePaidAt)}
                      </span>
                    </div>
                  )}

                  {/* Damage Fine */}
                  {damageFine > 0 && (
                    <div className="res-field">
                      <span className="res-field-label">Damage Fine</span>
                      <span className="res-field-value">
                        ₹{damageFine}
                        {(reservation?.damageFinePaid || status === "damaged")
                          ? <span className="fine-paid-inline"> — Paid</span>
                          : null}
                      </span>
                    </div>
                  )}

                  {/* Damage Fine Payment Timestamp */}
                  {damageFine > 0 && (reservation?.damageFinePaid || status === "damaged") && reservation?.damageFinePaidAt && (
                    <div className="res-field">
                      <span className="res-field-label">Damage Fine Paid On</span>
                      <span className="res-field-value res-field-value--timestamp">
                        {formatDateTime(reservation.damageFinePaidAt)}
                      </span>
                    </div>
                  )}

                  {/* Lost Fine */}
                  {lostFine > 0 && (
                    <div className="res-field">
                      <span className="res-field-label">Lost Fine</span>
                      <span className="res-field-value">
                        ₹{lostFine}
                        {(reservation?.lostFinePaid || status === "lost")
                          ? <span className="fine-paid-inline"> — Paid</span>
                          : null}
                      </span>
                    </div>
                  )}

                  {/* Lost Fine Payment Timestamp */}
                  {reservation?.lostFinePaid && reservation?.lostFinePaidAt && (
                    <div className="res-field">
                      <span className="res-field-label">Lost Book Fine Paid On</span>
                      <span className="res-field-value res-field-value--timestamp">
                        {formatDateTime(reservation.lostFinePaidAt)}
                      </span>
                    </div>
                  )}

                  {/* Fallback fine payment timestamp — legacy records only.
                      Shown when finePaid is set but no granular per-type
                      timestamp exists (i.e. records settled before
                      damageFinePaidAt / lostFinePaidAt were introduced).
                      Granular timestamps above are always preferred. */}
                  {reservation?.finePaid &&
                    !reservation?.damageFinePaidAt &&
                    !reservation?.lostFinePaidAt &&
                    reservation?.finePaidAt && (
                      <div className="res-field">
                        <span className="res-field-label">Fine Payment Date & Time</span>
                        <span className="res-field-value res-field-value--timestamp">
                          {formatDateTime(reservation.finePaidAt)}
                        </span>
                      </div>
                    )}

                  {/* Total Fine */}
                  {totalFine > 0 && (
                    <div className="res-field">
                      <span className="res-field-label">Total Fine</span>
                      <span className="res-field-value res-field-value--strong">₹{totalFine}</span>
                    </div>
                  )}


                </div>
              </div>

            </div>{/* end res-sections-grid */}

            {/* ── Damaged / Lost: pay overdue first if still pending ── */}
            {/* The damage/lost fine button is intentionally absent:            */}
            {/* status "damaged"/"lost" is set atomically with payment via      */}
            {/* /pay-fine, so the fine is always settled at this point.         */}
            {(status === "damaged" || status === "lost") && (() => {
              const hasUnpaidOverdue = overdueFine > 0 && !overduePaid;
              // Fine is always settled when status is "damaged"/"lost" —
              // server marks status + records payment atomically in /pay-fine.
              const hasUnpaidFine = false;
              if (!hasUnpaidOverdue && !hasUnpaidFine) return null;
              return (
                <div className="reservation-actions">
                  {hasUnpaidOverdue && (
                    <button
                      type="button"
                      className="primary-btn"
                      disabled={isBusy}
                      onClick={() => onOpenOverduePayment(reservation)}
                    >
                      {isBusy ? "Please wait…" : `Pay Overdue — ₹${overdueFine}`}
                    </button>
                  )}

                </div>
              );
            })()}

            {/* ── Reserved / Collected / Overdue: standard action row ── */}
            {status !== "expired" &&
              status !== "returned" &&
              status !== "cancelled" &&
              status !== "damaged" &&
              status !== "lost" && (
                <div className="reservation-actions">
                  {canMarkCollected && (
                    <button
                      type="button"
                      className="primary-btn"
                      disabled={isBusy}
                      onClick={() => onConfirmCollect(reservation)}
                    >
                      {isBusy ? "Please wait…" : "Mark as Collected"}
                    </button>
                  )}

                  {/* Mark Returned — blocked while an unpaid overdue fine exists */}
                  {(status === "collected" || status === "overdue") && (() => {
                    const overdueUnpaid =
                      status === "overdue" && overdueFine > 0 && !overduePaid;
                    return (
                      <button
                        type="button"
                        className="secondary-btn"
                        disabled={overdueUnpaid || isBusy}
                        title={overdueUnpaid ? "Pay the overdue fine before returning" : undefined}
                        onClick={() => onConfirmReturn(reservation)}
                      >
                        {isBusy
                          ? "Please wait…"
                          : overdueUnpaid
                            ? "Pay Overdue First"
                            : "Mark Returned"}
                      </button>
                    );
                  })()}

                  {/* Fine — opens FineChoiceModal (damage or lost) */}
                  {(status === "collected" || status === "overdue") && (
                    <button
                      type="button"
                      className="secondary-btn"
                      disabled={isBusy}
                      onClick={() => onOpenFine(reservation)}
                    >
                      Fine
                    </button>
                  )}

                  {/* Reminder for reserved, collected, and overdue */}
                  {(status === "reserved" || status === "collected" || status === "overdue") && (
                    <button
                      type="button"
                      className="secondary-btn"
                      disabled={isBusy}
                      onClick={() => handleRemind(reservation._id)}
                    >
                      {isBusy ? "Please wait…" : "Send Reminder"}
                    </button>
                  )}

                  {/* Pay Overdue — only for overdue cards, never for plain collected */}
                  {status === "overdue" && (
                    <button
                      type="button"
                      className="primary-btn"
                      disabled={!(overdueFine > 0 && !overduePaid) || isBusy}
                      onClick={() => onOpenOverduePayment(reservation)}
                    >
                      {overduePaid
                        ? "Overdue Paid"
                        : overdueFine > 0
                          ? `Pay Overdue — ₹${overdueFine}`
                          : "Pay Overdue"}
                    </button>
                  )}
                </div>
              )}
          </div>
        );
      })}
    </div>
  );
}