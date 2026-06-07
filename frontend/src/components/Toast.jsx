import { useEffect } from "react";

export default function Toast({ toast, onClose }) {
  useEffect(() => {
    if (!toast) return;

    const timer = setTimeout(() => {
      onClose();
    }, 3500);

    return () => clearTimeout(timer);
  }, [toast, onClose]);

  if (!toast) return null;

  return (
    <div className={`toast ${toast.type || "success"}`}>
      <span>{toast.message}</span>
      <button type="button" onClick={onClose}>
        ×
      </button>
    </div>
  );
}