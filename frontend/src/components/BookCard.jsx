import { Pencil, Plus, Minus, Clock, Trash2 } from "lucide-react";
import "./BooksCatalogue.css";

/**
 * BookCard
 *
 * Props:
 *  - book                 {object}   Required. Book data object.
 *  - onClick              {function} Opens the detail/borrow modal. Receives `book`.
 *  - onPreBook            {function} Handles Pre-Book action. Receives `book`.
 *  - onEdit               {function} Admin-only edit handler. Receives `book`.
 *  - onDelete             {function} Admin-only delete handler. Receives `book`.
 *  - onIncrease           {function} Admin-only increase copy count. Receives `book`.
 *  - onDecrease           {function} Admin-only decrease copy count. Receives `book`.
 *  - isAdmin              {boolean}  Switches between admin and student views.
 *  - userReservationStatus {string}  Optional. "reserved" | "collected" — blocks re-booking.
 *  - viewMode             {string}   "grid" (default) | "list" — controls card layout.
 */
const BookCard = ({
  book,
  onClick,
  onPreBook,
  onEdit,
  onDelete,
  onIncrease,
  onDecrease,
  isAdmin = false,
  userReservationStatus = null,
  viewMode = "grid",
}) => {
  if (!book) return null;

  const {
    title = "",
    author = "",
    edition = "",
    coverImage = "",
    availableCopies = 0,
    totalCopies = 0,
    department = "",
    courseCode = "",
    location = "",
  } = book;

  const available = availableCopies > 0;
  const isList = viewMode === "list";

  /* ── User-level block (already reserved or collected) ──── */
  const isBlockedReserved  = userReservationStatus === "reserved";
  const isBlockedCollected = userReservationStatus === "collected";
  const isBlocked          = isBlockedReserved || isBlockedCollected;

  /* ── Derived button label & disabled state ─────────────── */
  const getActionLabel = () => {
    if (isBlockedCollected) return "Already Checked Out";
    if (isBlockedReserved)  return "Already Pre-Booked";
    if (available)          return "Pre-Book";
    return "Join Waitlist";
  };

  /* ── Status helper ─────────────────────────────────────── */
  const getStatus = () => {
    if (availableCopies === totalCopies) return { text: "Available",   cls: "available"   };
    if (availableCopies > 0)            return { text: "Limited",     cls: "limited"     };
    return                                     { text: "Unavailable", cls: "unavailable" };
  };
  const status = getStatus();

  /* ── Handlers ──────────────────────────────────────────── */
  const handleCardClick = () => { if (typeof onClick  === "function") onClick(book);  };
  const handlePreBook   = (e) => { e.stopPropagation(); if (typeof onPreBook  === "function") onPreBook(book);  };
  const handleEdit      = (e) => { e.stopPropagation(); if (typeof onEdit     === "function") onEdit(book);     };
  const handleDelete    = (e) => { e.stopPropagation(); if (typeof onDelete   === "function") onDelete(book);   };
  const handleIncrease  = (e) => { e.stopPropagation(); if (typeof onIncrease === "function") onIncrease(book); };
  const handleDecrease  = (e) => { e.stopPropagation(); if (typeof onDecrease === "function") onDecrease(book); };

  return (
    <div className="book-card-wrapper">
      <div
        className={`book-card book-card-clickable${isList ? " book-card--list" : ""}`}
        onClick={handleCardClick}
      >

        {/* ── Cover — image fills entirely, or dark-gradient placeholder ── */}
        <div className={`book-cover-thumb${coverImage ? "" : " book-cover-thumb--placeholder"}`}>
          {coverImage ? (
            <img src={coverImage} alt={`Cover of ${title}`} className="book-cover-img" />
          ) : (
            <span className="book-cover-initial">{title.charAt(0).toUpperCase()}</span>
          )}
        </div>

        {/* ── Admin action buttons — INSIDE card, below cover (grid & list view) ── */}
        {isAdmin && (
          <div className="admin-card-actions-grid" onClick={(e) => e.stopPropagation()}>
            <button className="admin-action-btn edit-btn"     onClick={handleEdit}     title="Edit book"           aria-label="Edit book">
              <Pencil  size={14} strokeWidth={2}   />
            </button>
            <button className="admin-action-btn increase-btn" onClick={handleIncrease} title="Increase copy count" aria-label="Increase copy count">
              <Plus    size={15} strokeWidth={2.5} />
            </button>
            <button className="admin-action-btn decrease-btn" onClick={handleDecrease} title="Decrease copy count" aria-label="Decrease copy count">
              <Minus   size={15} strokeWidth={2.5} />
            </button>
            <button className="admin-action-btn delete-btn"   onClick={handleDelete}   title="Delete book"         aria-label="Delete book">
              <Trash2  size={14} strokeWidth={2}   />
            </button>
          </div>
        )}

        {/* ── Info section ─────────────────────────────────── */}
        <div className={`book-card-info${isList ? " book-card-info--list" : ""}`}>

        {isList ? (
          /* ── List view: two-group layout for balanced vertical spacing ── */
          <>
            {/* Top group: title, author, edition, metadata */}
            <div className="book-card-info-top">
              <h3 className="book-card-title">{title}</h3>
              <p className="book-card-author">{author}</p>
              {edition && <p className="book-card-edition">{edition}</p>}

              {/* Extra metadata — list mode only */}
              <div className="book-card-meta">
                {department && (
                  <span className="book-card-meta-item">
                    <span className="book-card-meta-label">Dept</span>
                    <span className="book-card-meta-value">{department}</span>
                  </span>
                )}
                {courseCode && (
                  <span className="book-card-meta-item">
                    <span className="book-card-meta-label">Course</span>
                    <span className="book-card-meta-value">{courseCode}</span>
                  </span>
                )}
                {location && (
                  <span className="book-card-meta-item">
                    <span className="book-card-meta-label">Shelf</span>
                    <span className="book-card-meta-value">{location}</span>
                  </span>
                )}
              </div>
            </div>

            {/* Bottom group: copies count, status, button */}
            <div className="book-card-info-bottom">
              <div className="featured-footer">
                <span className="copies-label">
                  {availableCopies}/{totalCopies} copies
                </span>
              </div>

              {/* Availability status — student only */}
              {!isAdmin && (
                <span className={`copies-status copies-status--${isBlocked ? "unavailable" : status.cls}`}>
                  {isBlockedCollected
                    ? "Checked Out by You"
                    : isBlockedReserved
                    ? "Pre-Booked by You"
                    : status.text}
                </span>
              )}

              {/* Pre-Book button — student only */}
              {!isAdmin && (
                <button
                  className={`borrow-btn ${
                    isBlocked
                      ? "borrow-btn--unavailable"
                      : available
                      ? "borrow-btn--available"
                      : "borrow-btn--prebook"
                  }`}
                  type="button"
                  onClick={isBlocked ? undefined : handlePreBook}
                  disabled={isBlocked}
                  aria-label={getActionLabel()}
                >
                  <Clock size={13} strokeWidth={2.5} className="borrow-btn__icon borrow-btn__icon--left" />
                  <span className="borrow-btn__label">{getActionLabel()}</span>
                </button>
              )}
            </div>
          </>
        ) : (
          /* ── Grid view: original flat layout ── */
          <>
            <h3 className="book-card-title">{title}</h3>
            <p className="book-card-author">{author}</p>
            {edition && <p className="book-card-edition">{edition}</p>}

            <div className="featured-footer">
              <span className="copies-label">
                {availableCopies}/{totalCopies} copies
              </span>
            </div>

            {/* Availability status — student only, plain muted text */}
            {!isAdmin && (
              <span className={`copies-status copies-status--${isBlocked ? "unavailable" : status.cls}`}>
                {isBlockedCollected
                  ? "Checked Out by You"
                  : isBlockedReserved
                  ? "Pre-Booked by You"
                  : status.text}
              </span>
            )}

            {/* Pre-Book button — student only */}
            {!isAdmin && (
              <button
                className={`borrow-btn ${
                  isBlocked
                    ? "borrow-btn--unavailable"
                    : available
                    ? "borrow-btn--available"
                    : "borrow-btn--prebook"
                }`}
                type="button"
                onClick={isBlocked ? undefined : handlePreBook}
                disabled={isBlocked}
                aria-label={getActionLabel()}
              >
                <Clock size={13} strokeWidth={2.5} className="borrow-btn__icon borrow-btn__icon--left" />
                <span className="borrow-btn__label">{getActionLabel()}</span>
              </button>
            )}
          </>
        )}
        </div>
      </div>

    </div>
  );
};

export default BookCard;