import { useEffect } from "react";
import { getBookTitle } from "./ReservationList";

export default function FineChoiceModal({
  open,
  reservation,
  onClose,
  onSelectDamage,
  onSelectLost,
}) {
  useEffect(() => {
    if (!open) return;
    document.body.classList.add("body-scroll-locked");
    return () => {
      document.body.classList.remove("body-scroll-locked");
    };
  }, [open]);

  // Always return null when closed — no hidden overlay left mounted
  if (!open || !reservation) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="walkin-modal fine-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="walkin-modal-header">
          <div className="walkin-modal-icon">⚠️</div>
          <div>
            <h3>Fine Options</h3>
            <p className="muted">
              Choose the fine type for <strong>{getBookTitle(reservation)}</strong>
            </p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="walkin-modal-body">
          <div className="fine-choice-grid">
            <button
              type="button"
              className="secondary-btn fine-choice-btn"
              onClick={onSelectDamage}
            >
              Book Damaged (₹100)
            </button>

            <button
              type="button"
              className="danger-btn fine-choice-btn"
              onClick={onSelectLost}
            >
              Book Lost (₹500)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}