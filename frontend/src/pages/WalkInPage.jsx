import { useMemo, useState } from "react";
import WalkInCheckoutsPage from "./WalkInCheckoutsPage";
import { apiRequest } from "../api";

/* =========================================
   WALK-IN PAGE
   - WalkInCheckoutsPage manages its own modal internally
   - This component supplies the data + action handlers
   - All actions go through real backend + refresh shared state
========================================= */
export default function WalkInPage({
  user,
  onBack,
  onLogoutClick,
  setToast,
  reservations = [],
  books = [],           // full books list passed from AdminDashboardPage
  refreshReservations,
  refreshBooks,
  autoOpenForm = false, // when true, modal opens immediately on mount
}) {
  const [walkInLoading, setWalkInLoading] = useState(false);

  /* ── Walk-in records: active/returned only (not damaged/lost) ── */
  const walkInCheckouts = useMemo(
    () =>
      reservations
        .filter(
          (r) =>
            r.isWalkIn &&
            r.status !== "cancelled" &&
            r.status !== "expired" &&
            r.status !== "damaged" &&
            r.status !== "lost"
        )
        .sort(
          (a, b) =>
            new Date(b.collectedAt || b.createdAt || b.reservedAt || 0) -
            new Date(a.collectedAt || a.createdAt || a.reservedAt || 0)
        ),
    [reservations]
  );

  /* ── Damaged walk-in records ───────────────────────────── */
  const walkInDamaged = useMemo(
    () =>
      reservations
        .filter((r) => r.isWalkIn && (r.status === "damaged" || r.isBookDamaged === true))
        .sort(
          (a, b) =>
            new Date(b.returnedAt || b.collectedAt || b.createdAt || 0) -
            new Date(a.returnedAt || a.collectedAt || a.createdAt || 0)
        ),
    [reservations]
  );

  /* ── Lost walk-in records ──────────────────────────────── */
  const walkInLost = useMemo(
    () =>
      reservations
        .filter((r) => r.isWalkIn && (r.status === "lost" || r.isBookLost === true))
        .sort(
          (a, b) =>
            new Date(b.collectedAt || b.createdAt || 0) -
            new Date(a.collectedAt || a.createdAt || 0)
        ),
    [reservations]
  );

  /* ── Unique student list for modal search ───────────────── */
  const studentList = useMemo(() => {
    const map = new Map();
    reservations.forEach((r) => {
      const id = r?.user?._id || r?.user?.id || r?.user?.email;
      if (id && !map.has(id)) {
        map.set(id, {
          _id: id,
          name: r.user?.name || "Unknown",
          email: r.user?.email || "",
          studentId:
            r.user?.studentId ||
            r.user?.rollNo ||
            r.user?.rollNumber ||
            r.user?.registerNumber ||
            r.user?.regNo ||
            "",
        });
      }
    });
    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [reservations]);

  /* ── Books with live availability info ─────────────────── */
  // Count how many active reservations exist per book so we can subtract them
  // from totalCopies rather than blindly zeroing out any book with ≥1 active
  // reservation (which caused false "out of stock" for multi-copy titles).
  const activeReservationCountByBookId = useMemo(() => {
    const ACTIVE = new Set(["reserved", "collected"]);
    const counts = new Map(); // bookId (string) → number of active reservations
    reservations.forEach((r) => {
      if (ACTIVE.has(r.status)) {
        const bookId = r?.book?._id || r?.book?.id || r?.book;
        if (bookId) {
          const key = String(bookId);
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
    });
    return counts;
  }, [reservations]);

  // Annotate each book with a client-derived availableCopies value.
  // We take the most conservative (lowest) of:
  //   • the backend-reported availableCopies, and
  //   • totalCopies minus the number of active reservations we see locally.
  // This keeps the UI in sync with backend validation and prevents the false
  // "out of stock" state that occurred when any reservation existed for the
  // book, regardless of how many copies the library holds.
  const annotatedBooks = useMemo(
    () =>
      books.map((b) => {
        const id = String(b._id || b.id || "");
        const activeCount = id ? (activeReservationCountByBookId.get(id) ?? 0) : 0;

        if (activeCount === 0) return b; // nothing active — trust backend as-is

        const totalCopies =
          b.totalCopies ?? b.copies ?? b.quantity ?? b.availableCopies ?? 1;
        const derivedAvailable = Math.max(0, totalCopies - activeCount);

        // Backend may already reflect the correct number; never go higher than it.
        const backendAvailable = b.availableCopies ?? totalCopies;
        const safeAvailable = Math.min(backendAvailable, derivedAvailable);

        return { ...b, availableCopies: safeAvailable };
      }),
    [books, activeReservationCountByBookId]
  );
  const handleAddWalkIn = async ({ studentId, bookId, dueDate, notes }) => {
    setWalkInLoading(true);
    try {
      await apiRequest("/reservations/walkin", {
        method: "POST",
        body: JSON.stringify({ userId: studentId, bookId, dueDate, notes }),
      });
      setToast({ type: "success", message: "Book issued successfully" });
      await refreshReservations?.();
      await refreshBooks?.();
    } catch (err) {
      setToast({
        type: "error",
        message: err.message || "Walk-in checkout failed",
      });
      throw err; // re-throw so WalkInCheckoutsPage modal stays open on failure
    } finally {
      setWalkInLoading(false);
    }
  };

  /* ── Return walk-in book ─────────────────────────────────── */
  const handleReturnWalkIn = async (id) => {
    try {
      await apiRequest(`/reservations/${id}/status`, {
        method: "PUT",
        body: JSON.stringify({ action: "return" }),
      });
      setToast({ type: "success", message: "Book marked as returned" });
      await refreshReservations?.();
      await refreshBooks?.();
    } catch (err) {
      setToast({
        type: "error",
        message: err.message || "Failed to mark as returned",
      });
    }
  };

  /* ── Cancel / delete walk-in record ─────────────────────── */
  const handleDeleteWalkIn = async (id) => {
    try {
      await apiRequest(`/reservations/${id}/status`, {
        method: "PUT",
        body: JSON.stringify({ action: "cancel" }),
      });
      setToast({ type: "success", message: "Walk-in record cancelled" });
      await refreshReservations?.();
      await refreshBooks?.();
    } catch (err) {
      setToast({
        type: "error",
        message: err.message || "Failed to cancel record",
      });
    }
  };

  return (
    <WalkInCheckoutsPage
      user={user}
      checkouts={walkInCheckouts}
      damagedCheckouts={walkInDamaged}
      lostCheckouts={walkInLost}
      students={studentList}        // for the modal's student search
      books={annotatedBooks}        // books with live availableCopies annotation
      reservations={reservations}
      onReturn={handleReturnWalkIn}
      onDelete={handleDeleteWalkIn}
      onWalkInSubmit={handleAddWalkIn}
      onLogout={onLogoutClick}
      onBack={onBack}
      loading={walkInLoading}
      autoOpenModal={autoOpenForm}  // triggers modal open on mount
    />
  );
}