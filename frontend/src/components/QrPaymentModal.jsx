import { useEffect } from "react";

export default function QrPaymentModal({
  open,
  title,
  amount,
  subtitle,
  processing,
  success,
  onSimulate,  // fires when user clicks button — parent handles confirmation
  onClose,
}) {
  useEffect(() => {
    if (!open) return;
    document.body.classList.add("body-scroll-locked");
    return () => {
      document.body.classList.remove("body-scroll-locked");
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="walkin-modal fine-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="walkin-modal-header">
          <div className="walkin-modal-icon">💳</div>
          <div>
            <h3>{title}</h3>
            <p className="muted">{subtitle}</p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="walkin-modal-body">
          <div className="fine-amount-pill">Amount to Pay: ₹{amount}</div>

          <div className="qr-payment-card">
            <div className="qr-box">
              <div className="qr-grid" />
              <div className="qr-scan-line" />
            </div>
            <div className="qr-note">
              Scan this QR to simulate payment
            </div>
          </div>

          {success ? (
            <div className="fine-success-box">
              Payment successful. Action completed.
            </div>
          ) : (
            <button
              type="button"
              className="primary-btn full-btn"
              onClick={onSimulate}
              disabled={processing}
            >
              {processing ? "Processing Payment..." : "Simulate Payment Success"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}