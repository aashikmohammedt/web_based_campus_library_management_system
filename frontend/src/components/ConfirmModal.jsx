import { useEffect } from "react";
import { BookMarked, X, BookOpen } from "lucide-react";

export default function ConfirmModal({
  open,
  title,
  message,
  subtext,
  confirmText,
  confirmVariant = "primary",
  loading = false,
  onCancel,
  onConfirm,
  /* ── Book-details mode ── */
  book = null,   // pass a book object to render the rich Book Details layout
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  /* ────────────────────────────────────────────────────────
     Rich "Book Details" layout (used by NewArrivalsHighlight)
  ──────────────────────────────────────────────────────── */
  if (book) {
    const available = (book.availableCopies ?? 0) > 0;
    const total     = book.totalCopies ?? book.availableCopies ?? 0;

    return (
      <div className="confirm-modal-wrap">
        <div
          className="overlay show"
          onClick={loading ? undefined : onCancel}
        />

        <div className="confirm-modal book-detail-modal">

          {/* ── Header ── */}
          <div className="bdm-header">
            <div className="bdm-header-left">
              <BookMarked size={20} className="bdm-header-icon" />
              <span className="bdm-header-title">Book Details</span>
            </div>
            <button
              className="bdm-close-btn"
              type="button"
              onClick={onCancel}
              disabled={loading}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>

          {/* ── Body ── */}
          <div className="bdm-body">

            {/* Left — cover + badge */}
            <div className="bdm-cover-col">
              <div className="bdm-cover">
                {book.coverImage ? (
                  <img src={book.coverImage} alt={`Cover of ${book.title}`} />
                ) : (
                  <div className="bdm-cover-placeholder">
                    <BookOpen size={36} />
                    <span>{book.title?.slice(0, 2).toUpperCase() ?? "BK"}</span>
                  </div>
                )}
              </div>
              <span className={`bdm-badge ${available ? "bdm-badge--available" : "bdm-badge--unavailable"}`}>
                {available ? "AVAILABLE" : "UNAVAILABLE"}
              </span>
            </div>

            {/* Right — info */}
            <div className="bdm-info-col">
              <h2 className="bdm-book-title">{book.title}</h2>
              <p  className="bdm-book-author">{book.author}</p>

              <table className="bdm-meta-table">
                <tbody>
                  {total > 0 && (
                    <tr>
                      <td className="bdm-meta-label">Copies</td>
                      <td className="bdm-meta-value">
                        {available
                          ? `${book.availableCopies} / ${total} available`
                          : `0 / ${total} available`}
                      </td>
                    </tr>
                  )}
                  {book.department && (
                    <tr>
                      <td className="bdm-meta-label">Department</td>
                      <td className="bdm-meta-value">{book.department}</td>
                    </tr>
                  )}
                  {book.course && (
                    <tr>
                      <td className="bdm-meta-label">Course</td>
                      <td className="bdm-meta-value">{book.course}</td>
                    </tr>
                  )}
                  {book.edition && (
                    <tr>
                      <td className="bdm-meta-label">Edition</td>
                      <td className="bdm-meta-value">{book.edition}</td>
                    </tr>
                  )}
                </tbody>
              </table>

              {/* Callout prompt */}
              <div className="bdm-callout">
                {available
                  ? "Would you like to pre-book this title for pickup?"
                  : "All copies are currently checked out. Join the waitlist?"}
              </div>
            </div>
          </div>

          {/* ── Divider ── */}
          <div className="bdm-divider" />

          {/* ── Actions ── */}
          <div className="bdm-actions">
            <button
              className="secondary-btn"
              type="button"
              onClick={onCancel}
              disabled={loading}
            >
              No, Cancel
            </button>
            <button
              className={confirmVariant === "danger" ? "danger-btn" : "primary-btn"}
              type="button"
              onClick={onConfirm}
              disabled={loading}
            >
              {loading ? "Please wait…" : (confirmText ?? (available ? "Yes, Pre-Book" : "Join Waitlist"))}
            </button>
          </div>

        </div>
      </div>
    );
  }

  /* ────────────────────────────────────────────────────────
     Default / generic layout (unchanged)
  ──────────────────────────────────────────────────────── */
  return (
    <div className="confirm-modal-wrap">
      <div className="overlay show" onClick={loading ? undefined : onCancel} />
      <div className="confirm-modal">
        <div className="confirm-modal-icon">!</div>
        <div className="confirm-modal-content">
          <h3>{title}</h3>
          <p className="confirm-modal-text">{message}</p>
          {subtext ? <p className="confirm-modal-subtext">{subtext}</p> : null}
        </div>

        <div className="confirm-modal-actions">
          <button className="secondary-btn" type="button" onClick={onCancel} disabled={loading}>
            Cancel
          </button>
          <button
            className={confirmVariant === "danger" ? "danger-btn" : "primary-btn"}
            type="button"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? "Please wait..." : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}