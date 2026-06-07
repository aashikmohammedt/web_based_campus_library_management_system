import { useMemo, useState, useRef, useCallback } from "react";
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
  Search,
  User,
  Store,
} from "lucide-react";
import "./AdminReservationsPage.css";
import { apiRequest } from "../api";
import WalkInCheckoutModal from "../components/WalkInCheckoutModal";
import FineChoiceModal from "../components/FineChoiceModal";
import QrPaymentModal from "../components/QrPaymentModal";
import ConfirmModal from "../components/ConfirmModal";
import ReservationList, {
  getDerivedStatus,
  getStatusLabel,
  getBookTitle,
  getStudentName,
  getStudentEmail,
  getStudentId,
  getDepartment,
  getOverdueFine,
  isDamagedOrLostWithPendingOverdue,
} from "../components/ReservationList";

/* ── Helpers ─────────────────────────────────────────────── */
function getReservationSortDate(r) {
  return new Date(r.updatedAt || r.createdAt || r.reservedAt || 0).getTime();
}

/* ── Stat card config — one card per filter chip (excl. "student") ── */
const STAT_CARDS = [
  { value: "all",       Icon: ClipboardList, label: "All Records",      tone: ""            },
  { value: "walkin",    Icon: Store,         label: "Walk-In",          tone: "tone-teal"   },
  { value: "prebooked", Icon: BookMarked,    label: "Active Pre-Books", tone: "tone-blue"   },
  { value: "collected", Icon: BookOpen,      label: "Collected",        tone: "tone-green"  },
  { value: "overdue",   Icon: Clock3,        label: "Overdue",          tone: "tone-amber"  },
  { value: "returned",  Icon: CheckCircle2,  label: "Returned",         tone: "tone-purple" },
  { value: "expired",   Icon: Timer,         label: "Expired",          tone: "tone-gray"   },
  { value: "cancelled", Icon: XCircle,       label: "Cancelled",        tone: "tone-slate"  },
  { value: "lost",      Icon: AlertTriangle, label: "Lost",             tone: "tone-red"    },
  { value: "damaged",   Icon: BookX,         label: "Damaged",          tone: "tone-orange" },
];

/* ── Filter chip config ──────────────────────────────────── */
const FILTER_CHIPS = [
  { value: "all", label: "All" },
  { value: "student", label: "By Student", hasIcon: true },
  { value: "walkin", label: "Walk-In Checkouts" },
  { value: "prebooked", label: "Active Pre-Bookings" },
  { value: "collected", label: "Collected" },
  { value: "overdue", label: "Overdue" },
  { value: "expired", label: "Expired" },
  { value: "returned", label: "Returned" },
  { value: "cancelled", label: "Cancelled" },
  { value: "lost", label: "Lost" },
  { value: "damaged", label: "Damaged" },
];

/* ── Stat Card component ─────────────────────────────────── */
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

/* ═══════════════════════════════════════════════════════════
   AdminReservationsPage
═══════════════════════════════════════════════════════════ */
export default function AdminReservationsPage({
  reservations = [],
  books = [],          // full book list — needed for walk-in duplicate protection
  onBack,
  refreshReservations,
  refreshBooks,
  setToast,
}) {
  /* ── State ─────────────────────────────────────────────── */
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const searchInputRef = useRef(null);
  const [studentSearchTerm, setStudentSearchTerm] = useState("");
  const studentSearchRef = useRef(null);
  const [editingDueDateId, setEditingDueDateId] = useState("");
  const [dueDateValue, setDueDateValue] = useState("");
  const [loadingActionId, setLoadingActionId] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [walkInModalOpen, setWalkInModalOpen] = useState(false);
  const [walkInLoading, setWalkInLoading] = useState(false);

  const [fineModalReservation, setFineModalReservation] = useState(null);
  const [paymentModal, setPaymentModal] = useState({
    open: false, type: "", reservation: null,
    amount: 0, title: "", subtitle: "",
  });
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [showPayConfirm, setShowPayConfirm] = useState(false);

  const [actionConfirm, setActionConfirm] = useState({
    open: false,
    type: "",
    reservation: null,
  });

  const isStudentMode = statusFilter === "student";

  /* ── Derived: student list ─────────────────────────────── */
  const studentList = useMemo(() => {
    const map = new Map();
    reservations.forEach((r) => {
      const id = r?.user?._id || r?.user?.id || getStudentEmail(r);
      if (id && !map.has(id)) {
        map.set(id, {
          id,
          name: getStudentName(r),
          email: getStudentEmail(r),
          studentId:
            r?.user?.studentId ||
            r?.user?.rollNo ||
            r?.user?.rollNumber ||
            r?.user?.registerNumber ||
            r?.user?.regNo || "",
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [reservations]);

  /* ── Filtered student list (by search term) ────────────── */
  const filteredStudentList = useMemo(() => {
    if (!studentSearchTerm.trim()) return studentList;
    const q = studentSearchTerm.trim().toLowerCase();
    return studentList.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q) ||
        (s.studentId && s.studentId.toLowerCase().includes(q))
    );
  }, [studentList, studentSearchTerm]);

  /* ── Date filter helper ────────────────────────────────── */
  function applyDateFilter(list) {
    if (!dateFrom && !dateTo) return list;
    return list.filter((r) => {
      const d = new Date(r.createdAt || r.reservedAt || 0);
      if (dateFrom && d < new Date(dateFrom)) return false;
      if (dateTo && d > new Date(dateTo + "T23:59:59")) return false;
      return true;
    });
  }

  /* ── Filtered reservations ─────────────────────────────── */
  const filteredReservations = useMemo(() => {
    let list = [...reservations];

    if (isStudentMode) {
      if (!selectedStudentId) return [];
      list = list.filter((r) => {
        const id = r?.user?._id || r?.user?.id || getStudentEmail(r);
        return id === selectedStudentId;
      });
      list = applyDateFilter(list);
      list = list.filter((r) => getDerivedStatus(r) !== "expired");
      return list.sort((a, b) => getReservationSortDate(b) - getReservationSortDate(a));
    }

    if (statusFilter === "all") {
      // all records — no filter
    } else if (statusFilter === "walkin") {
      // Walk-in checkouts only — cross-cuts all statuses
      list = list.filter((r) => r.isWalkIn === true);
    } else if (statusFilter === "prebooked") {
      list = list.filter((r) => getDerivedStatus(r) === "reserved");
    } else if (statusFilter === "collected") {
      list = list.filter((r) => {
        const s = getDerivedStatus(r);
        return s === "collected" || s === "overdue";
      });
    } else if (statusFilter === "overdue") {
      // Include standard overdue books AND damaged/lost records that still
      // have an unpaid overdue fine — they belong in this section until the
      // overdue is settled, then they move to their respective section.
      list = list.filter(
        (r) => getDerivedStatus(r) === "overdue" || isDamagedOrLostWithPendingOverdue(r)
      );
    } else if (statusFilter === "lost") {
      // Only show lost records whose overdue is already settled (or had no overdue).
      // Records with pending overdue appear in the Overdue section instead.
      list = list.filter(
        (r) => getDerivedStatus(r) === "lost" && !isDamagedOrLostWithPendingOverdue(r)
      );
    } else if (statusFilter === "damaged") {
      // Same rule for damaged: only show when overdue is settled (or absent).
      list = list.filter(
        (r) => getDerivedStatus(r) === "damaged" && !isDamagedOrLostWithPendingOverdue(r)
      );
    } else if (statusFilter === "returned") {
      list = list.filter((r) => {
        const s = getDerivedStatus(r);
        if (s === "returned") return true;
        // Fully-settled damaged records (all fines paid, overdue settled) also surface here
        if (s === "damaged" && r.finePaid === true && !isDamagedOrLostWithPendingOverdue(r)) return true;
        return false;
      });
    } else {
      list = list.filter((r) => getDerivedStatus(r) === statusFilter);
    }

    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      list = list.filter((r) => {
        return (
          getBookTitle(r).toLowerCase().includes(q) ||
          (r?.book?.author?.toLowerCase() ?? "").includes(q) ||
          getStudentName(r).toLowerCase().includes(q) ||
          getStudentEmail(r).toLowerCase().includes(q) ||
          getStudentId(r).toLowerCase().includes(q) ||
          getDepartment(r).toLowerCase().includes(q) ||
          getStatusLabel(getDerivedStatus(r)).toLowerCase().includes(q) ||
          (r.isWalkIn && "walk-in walk in walkin".includes(q))
        );
      });
    }

    list = applyDateFilter(list);

    return list.sort((a, b) => {
      const aDate = new Date(a.createdAt || a.reservedAt || 0).getTime();
      const bDate = new Date(b.createdAt || b.reservedAt || 0).getTime();
      return bDate - aDate;
    });
  }, [reservations, statusFilter, searchTerm, selectedStudentId, dateFrom, dateTo]);

  /* ── Stats ─────────────────────────────────────────────── */
  const stats = useMemo(() => {
    const s = {
      all: 0, prebooked: 0, collected: 0,
      overdue: 0, returned: 0, cancelled: 0,
      expired: 0, lost: 0, damaged: 0, history: 0,
      walkin: 0,
    };
    reservations.forEach((r) => {
      if (r.isWalkIn) s.walkin += 1;
      const status = getDerivedStatus(r);
      s.all += 1;
      if (status === "reserved") { s.prebooked += 1; return; }
      if (status === "collected") { s.collected += 1; return; }
      if (status === "overdue") { s.collected += 1; s.overdue += 1; return; }
      if (status === "expired") { s.expired += 1; return; }
      if (status === "cancelled") { s.cancelled += 1; s.history += 1; return; }
      if (status === "lost") {
        // Only count toward lost if overdue is already settled (or no overdue).
        // Records with pending overdue are counted in overdue section only.
        if (isDamagedOrLostWithPendingOverdue(r)) {
          s.overdue += 1;
        } else {
          s.lost += 1; s.history += 1;
        }
        return;
      }
      if (status === "damaged") {
        // Only count toward damaged if overdue is already settled (or no overdue).
        if (isDamagedOrLostWithPendingOverdue(r)) {
          s.overdue += 1;
        } else {
          s.damaged += 1; s.history += 1;
          if (r.finePaid === true) s.returned += 1;
        }
        return;
      }
      if (status === "returned") { s.returned += 1; s.history += 1; return; }
    });
    return s;
  }, [reservations]);

  /* count helper for stat card */
  function statCount(value) {
    if (value === "all") return stats.all;
    if (value === "prebooked") return stats.prebooked;
    if (value === "collected") return stats.collected;
    if (value === "overdue") return stats.overdue;
    if (value === "returned") return stats.returned;
    if (value === "cancelled") return stats.cancelled;
    if (value === "lost") return stats.lost;
    if (value === "damaged") return stats.damaged;
    if (value === "expired") return stats.expired;
    return 0;
  }

  /* chip count helper */
  function chipCount(value) {
    if (value === "all") return stats.all;
    if (value === "walkin") return stats.walkin;
    if (value === "prebooked") return stats.prebooked;
    if (value === "collected") return stats.collected;
    if (value === "overdue") return stats.overdue;
    if (value === "expired") return stats.expired;
    if (value === "returned") return stats.returned;
    if (value === "cancelled") return stats.cancelled;
    if (value === "lost") return stats.lost;
    if (value === "damaged") return stats.damaged;
    return null;
  }

  /* ── Search handler — stable reference prevents input focus loss ── */
  const handleSearchChange = useCallback((e) => {
    setSearchTerm(e.target.value);
  }, []);

  const handleSearchClear = useCallback(() => {
    setSearchTerm("");
    if (searchInputRef.current) searchInputRef.current.value = "";
  }, []);

  /* ── Filter change ─────────────────────────────────────── */
  const handleFilterChange = (filter) => {
    setStatusFilter(filter);
    setSelectedStudentId(null);
    setStudentSearchTerm("");
    if (studentSearchRef.current) studentSearchRef.current.value = "";
    setDateFrom("");
    setDateTo("");
    setSearchTerm("");
    if (searchInputRef.current) searchInputRef.current.value = "";
  };

  /* ── Admin actions ─────────────────────────────────────── */
  const runAdminAction = async (reservationId, action) => {
    setLoadingActionId(reservationId);
    try {
      const data = await apiRequest(`/reservations/${reservationId}/status`, {
        method: "PUT",
        body: JSON.stringify({ action }),
      });
      setToast?.({ type: "success", message: data?.message || "Pre-booking updated successfully" });
      setEditingDueDateId("");
      setDueDateValue("");
      await refreshReservations?.();
      await refreshBooks?.();
    } catch (err) {
      setToast?.({ type: "error", message: err.message || "Failed to update pre-booking" });
    } finally {
      setLoadingActionId("");
    }
  };

  const handleSaveDueDate = async (reservationId) => {
    if (!dueDateValue) {
      setToast?.({ type: "error", message: "Please select a due date" });
      return;
    }
    setLoadingActionId(reservationId);
    try {
      const data = await apiRequest(`/reservations/${reservationId}/due-date`, {
        method: "PUT",
        body: JSON.stringify({ dueDate: dueDateValue }),
      });
      setToast?.({ type: "success", message: data?.message || "Due date updated successfully" });
      setEditingDueDateId("");
      setDueDateValue("");
      await refreshReservations?.();
    } catch (err) {
      setToast?.({ type: "error", message: err.message || "Failed to update due date" });
    } finally {
      setLoadingActionId("");
    }
  };

  const handleRemind = async (reservationId) => {
    setLoadingActionId(reservationId);
    try {
      const data = await apiRequest(`/reservations/${reservationId}/remind`, { method: "POST" });
      setToast?.({ type: "success", message: data?.message || "Reminder sent successfully" });
    } catch (err) {
      setToast?.({ type: "error", message: err.message || "Failed to send reminder" });
    } finally {
      setLoadingActionId("");
    }
  };
  const openCollectedConfirm = (reservation) => {
    setActionConfirm({
      open: true,
      type: "collect",
      reservation,
    });
  };

  const openReturnConfirm = (reservation) => {
    setActionConfirm({
      open: true,
      type: "return",
      reservation,
    });
  };

  const openRemindConfirm = (reservationId) => {
    // Resolve the full reservation object so the modal can show the book title
    const reservation = reservations.find(
      (r) => (r._id || r.id) === reservationId
    ) || { _id: reservationId };
    setActionConfirm({
      open: true,
      type: "remind",
      reservation,
    });
  };

  const closeActionConfirm = () => {
    setActionConfirm({
      open: false,
      type: "",
      reservation: null,
    });
  };

  const handleActionConfirm = async () => {
    if (!actionConfirm.reservation) return;

    const reservationId =
      actionConfirm.reservation._id || actionConfirm.reservation.id;

    try {
      if (actionConfirm.type === "collect") {
        await runAdminAction(reservationId, "collect");
      }

      if (actionConfirm.type === "return") {
        await runAdminAction(reservationId, "return");
      }

      if (actionConfirm.type === "remind") {
        await handleRemind(reservationId);
      }
    } finally {
      closeActionConfirm();
    }
  };
  /* ── Payment / fine openers ────────────────────────────── */

  /**
   * openDamagePayment — opens the QR payment modal only.
   * No marking happens here. The book is marked as damaged inside
   * handlePaymentConfirm AFTER the payment is simulated and confirmed,
   * so the section move only occurs once payment is actually recorded.
   */
  const openDamagePayment = (reservation) => {
    setFineModalReservation(null);
    setPaymentSuccess(false);
    // Use server-side fine if already marked, otherwise fall back to the
    // configured constant (server will set it when marking on confirm).
    const fineAmount = Number(reservation?.damageFine || 100);
    setPaymentModal({
      open: true, type: "damage", reservation,
      amount: fineAmount,
      title: "Pay Damage Fine",
      subtitle: `Book Damaged fine for "${getBookTitle(reservation)}"`,
    });
  };

  /**
   * openLostPayment — opens the QR payment modal only.
   * No marking happens here. The book is marked as lost inside
   * handlePaymentConfirm AFTER the payment is simulated and confirmed.
   */
  const openLostPayment = (reservation) => {
    setFineModalReservation(null);
    setPaymentSuccess(false);
    const fineAmount = Number(reservation?.lostFine || 500);
    setPaymentModal({
      open: true, type: "lost", reservation,
      amount: fineAmount,
      title: "Pay Lost Book Fine",
      subtitle: `Book Lost fine for "${getBookTitle(reservation)}"`,
    });
  };

  const openOverduePayment = (reservation) => {
    console.log("[DEBUG] openOverduePayment called", reservation);
    console.log("[DEBUG] overduePaid:", reservation?.overduePaid);
    console.log("[DEBUG] dueDate:", reservation?.dueDate);

    // Guard: do not re-open the modal if the fine is already paid
    if (reservation?.overduePaid) {
      console.log("[DEBUG] BLOCKED — overduePaid is true");
      return;
    }

    // Prefer server-serialized fine (now correctly populated for damaged/lost too)
    let overdueFine = getOverdueFine(reservation);
    console.log("[DEBUG] getOverdueFine result:", overdueFine);

    if (overdueFine <= 0) {
      const due = reservation?.dueDate ? new Date(reservation.dueDate) : null;
      if (due && !Number.isNaN(due.getTime())) due.setHours(17, 0, 0, 0); // fixed 5 PM

      // For damaged/lost records use returnedAt (the moment they were marked) as
      // the end boundary — overdue doesn't keep growing after the book came back.
      const status = reservation?.status;
      const isDamagedOrLost = status === "damaged" || status === "lost";
      const endDate = isDamagedOrLost && reservation?.returnedAt
        ? new Date(reservation.returnedAt)
        : new Date();

      console.log("[DEBUG] fallback due date object:", due, "endDate:", endDate);
      if (due && !Number.isNaN(due.getTime()) && endDate > due) {
        const msPerDay = 1000 * 60 * 60 * 24;
        const days = Math.ceil((endDate.getTime() - due.getTime()) / msPerDay);
        overdueFine = days * 20;
        console.log("[DEBUG] fallback computed days:", days, "fine:", overdueFine);
      }
    }

    if (overdueFine <= 0) {
      console.log("[DEBUG] BLOCKED — overdueFine is still 0, not opening modal");
      return;
    }

    console.log("[DEBUG] Opening overdue payment modal with fine:", overdueFine);
    setPaymentSuccess(false);
    setPaymentModal({
      open: true, type: "overdue", reservation,
      amount: overdueFine,
      title: `Pay Overdue Fine — ₹${overdueFine}`,
      subtitle: `Overdue payment for "${getBookTitle(reservation)}"`,
    });
  };

  const closePaymentModal = () => {
    document.body.classList.remove("body-scroll-locked");

    setPaymentProcessing(false);

    setPaymentModal({
      open: false,
      type: "",
      reservation: null,
      amount: 0,
      title: "",
      subtitle: "",
    });

    setPaymentSuccess(false);
  };

  const handlePaymentConfirm = async () => {
    if (!paymentModal.reservation) return;
    const reservationId = paymentModal.reservation._id || paymentModal.reservation.id;
    if (!reservationId) {
      setToast?.({ type: "error", message: "Invalid reservation — cannot process payment" });
      return;
    }
    setPaymentProcessing(true);
    try {
      if (paymentModal.type === "damage" || paymentModal.type === "lost") {
        // Single call — the server atomically marks the book AND records payment.
        // No separate mark step here; the book is only marked once payment is confirmed.
        await apiRequest(`/reservations/${reservationId}/pay-fine`, {
          method: "POST",
          body: JSON.stringify({ type: paymentModal.type }),
        });
      } else if (paymentModal.type === "overdue") {
        await apiRequest(`/reservations/${reservationId}/pay-overdue`, { method: "POST" });
      }

      setPaymentSuccess(true);
      setToast?.({
        type: "success",
        message: paymentModal.type === "overdue"
          ? "Overdue fine paid successfully"
          : paymentModal.type === "damage"
            ? "Damage fine paid — book marked as Damaged"
            : "Lost fine paid — book marked as Lost",
      });
      await refreshReservations?.();
      await refreshBooks?.();
      setTimeout(() => {
        closePaymentModal();
      }, 900);
    } catch (err) {
      document.body.classList.remove("body-scroll-locked");
      setToast?.({ type: "error", message: err.message || "Payment failed" });
    } finally {
      setPaymentProcessing(false);
    }
  };

  const handleWalkIn = async ({ studentId, bookId, dueDate, notes }) => {
    setWalkInLoading(true);
    try {
      await apiRequest("/reservations/walkin", {
        method: "POST",
        body: JSON.stringify({ userId: studentId, bookId, dueDate, notes }),
      });
      setToast?.({
        type: "success",
        message: "Walk-in checkout recorded — visible in both Admin and Student panels.",
      });
      setWalkInModalOpen(false);
      await refreshReservations?.();
      await refreshBooks?.();
    } catch (err) {
      // Re-throw so WalkInCheckoutModal can route the error to the correct
      // inline field — duplicate conflicts land on the book field (errors.book),
      // other failures land on the submit area (errors.submit).
      // The modal owns error display for this flow; no toast is shown here.
      throw err;
    } finally {
      setWalkInLoading(false);
    }
  };

  /* ── Derived UI values ─────────────────────────────────── */
  const showDateFilter = !isStudentMode || (isStudentMode && selectedStudentId);
  const resultsCount = isStudentMode
    ? (selectedStudentId ? filteredReservations.length : 0)
    : filteredReservations.length;
  const selectedStudent = selectedStudentId
    ? studentList.find((s) => s.id === selectedStudentId)
    : null;

  /* ── Shared ReservationList props ──────────────────────── */
  const listProps = {
    loadingActionId,
    editingDueDateId,
    dueDateValue,
    setEditingDueDateId,
    setDueDateValue,
    runAdminAction,
    handleSaveDueDate,
    handleRemind: openRemindConfirm,
    onOpenFine: setFineModalReservation,
    onOpenOverduePayment: openOverduePayment,
    // Records only appear in the "damaged" section after the damage fine is paid,
    // so the Pay Damage Fine button must never be shown there.
    onOpenDamagePayment: statusFilter === "damaged" ? undefined : openDamagePayment,
    // Records only appear in the "lost" section after the lost fine is paid,
    // so the Pay Lost Fine button must never be shown there.
    onOpenLostPayment: statusFilter === "lost" ? undefined : openLostPayment,
    onConfirmCollect: openCollectedConfirm,
    onConfirmReturn: openReturnConfirm,
  };

  /* ═══════════════════════════════════════════════════════
     RENDER
  ═══════════════════════════════════════════════════════ */
  return (
    <div className="page-shell">
      <div className="arp-page">

        {/* ── Dashboard Header ── */}
        <div className="arp-header">
          <div className="arp-header-left">
            <button
              type="button"
              className="secondary-btn compact-header-btn arp-back-btn"
              onClick={onBack}
            >
              ← Back
            </button>
            <h2 className="arp-title">Pre-Bookings and Checkouts</h2>
            <p className="arp-subtitle">
              View and manage active pre-bookings, collected books, overdue items,
              expired pre-books, and history — including returned, cancelled, lost, and damaged records.
            </p>
          </div>

          <div className="arp-header-actions">
            <button
              type="button"
              className="primary-btn compact-header-btn"
              onClick={() => setWalkInModalOpen(true)}
            >
              + Walk-In Checkout
            </button>

            <span className="arp-results-badge">
              {resultsCount} result{resultsCount !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {/* ── Stats Cards Grid — click to filter ── */}
        <div className="arp-stats-grid">
          {STAT_CARDS.map(({ value, Icon, label, tone }) => (
            <StatCard
              key={value}
              value={value}
              Icon={Icon}
              label={label}
              tone={tone}
              count={chipCount(value) ?? 0}
              isActive={statusFilter === value}
              onClick={handleFilterChange}
            />
          ))}
        </div>

        {/* ── Search + Filter Toolbar ── */}
        <div className="arp-toolbar">

          {/* Search input — hidden in student mode */}
          {!isStudentMode && (
            <div className="arp-toolbar-search">
              <span className="arp-search-icon">
                <Search size={15} strokeWidth={2} />
              </span>
              <input
                ref={searchInputRef}
                type="text"
                className="arp-search-input"
                placeholder="Search by book, author, student, student ID, email, department, or status…"
                defaultValue={searchTerm}
                onChange={handleSearchChange}
              />
              {searchTerm && (
                <button
                  type="button"
                  className="arp-search-clear"
                  onClick={handleSearchClear}
                  aria-label="Clear search"
                >
                  ×
                </button>
              )}
            </div>
          )}

          {/* Filter chips */}
          <div className="arp-filter-row">
            {FILTER_CHIPS.map(({ value, label, hasIcon }) => {
              const count = chipCount(value);
              const isActive = statusFilter === value;
              const activeClass = isActive
                ? `active active-${value === "prebooked" ? "prebooked" : value}`
                : "";

              return (
                <button
                  key={value}
                  type="button"
                  className={`arp-chip ${activeClass}`}
                  onClick={() => handleFilterChange(value)}
                >
                  {hasIcon && (
                    <User
                      size={12}
                      strokeWidth={2}
                      style={{ verticalAlign: "middle", marginRight: 4, opacity: 0.75 }}
                    />
                  )}
                  {label}
                  {count !== null && count > 0 && (
                    <span className="arp-chip-count">{count}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Date filter */}
          {showDateFilter && (
            <div className="arp-date-filter">
              <span className="arp-date-label">Filter by date:</span>

              <label className="arp-date-field">
                <span>From</span>
                <input
                  type="date"
                  className="arp-date-input"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </label>

              <label className="arp-date-field">
                <span>To</span>
                <input
                  type="date"
                  className="arp-date-input"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </label>

              {(dateFrom || dateTo) && (
                <button
                  type="button"
                  className="secondary-btn small-btn"
                  onClick={() => { setDateFrom(""); setDateTo(""); }}
                >
                  Clear
                </button>
              )}
            </div>
          )}
        </div>

        {/* ════════════════════════════════════
            STUDENT MODE — search + full-width
        ════════════════════════════════════ */}
        {isStudentMode && (
          <>
            {/* ── No student selected: show search + list ── */}
            {!selectedStudentId && (
              <div className="arp-student-select-view">

                {/* Student search bar */}
                <div className="arp-toolbar arp-student-search-bar">
                  <div className="arp-toolbar-search">
                    <span className="arp-search-icon">
                      <Search size={15} strokeWidth={2} />
                    </span>
                    <input
                      ref={studentSearchRef}
                      type="text"
                      className="arp-search-input"
                      placeholder="Search students by name, email, or student ID…"
                      value={studentSearchTerm}
                      onChange={(e) => setStudentSearchTerm(e.target.value)}
                    />
                    {studentSearchTerm && (
                      <button
                        type="button"
                        className="arp-search-clear"
                        onClick={() => setStudentSearchTerm("")}
                        aria-label="Clear student search"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>

                {/* Student list panel — full width */}
                <div className="arp-student-grid-panel">
                  <div className="arp-student-panel-head">
                    <span>Students</span>
                    <span className="arp-student-count">{filteredStudentList.length}</span>
                  </div>

                  {filteredStudentList.length === 0 ? (
                    <div className="arp-student-empty">
                      {studentSearchTerm
                        ? `No students match "${studentSearchTerm}"`
                        : "No students found"}
                    </div>
                  ) : (
                    <ul className="arp-student-list arp-student-list--full">
                      {filteredStudentList.map((student) => (
                        <li key={student.id}>
                          <button
                            type="button"
                            className="arp-student-item"
                            onClick={() => {
                              setSelectedStudentId(student.id);
                              setDateFrom("");
                              setDateTo("");
                              setEditingDueDateId("");
                              setDueDateValue("");
                            }}
                          >
                            <span className="arp-student-name">{student.name}</span>
                            <span className="arp-student-email">{student.email}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {/* ── Student selected: full-width detail view ── */}
            {selectedStudentId && (
              <div className="arp-student-detail-view">
                <button
                  type="button"
                  className="arp-change-student-btn"
                  onClick={() => {
                    setSelectedStudentId(null);
                    setDateFrom("");
                    setDateTo("");
                    setEditingDueDateId("");
                    setDueDateValue("");
                  }}
                >
                  ← Change Student
                </button>

                {filteredReservations.length ? (
                  <>
                    <div className="arp-student-selected-header">
                      <div className="arp-student-selected-name">
                        {selectedStudent?.name ?? "Student"}
                      </div>
                      <div className="arp-student-selected-meta">
                        {selectedStudent?.email} ·{" "}
                        {filteredReservations.length} reservation
                        {filteredReservations.length !== 1 ? "s" : ""}
                      </div>
                    </div>

                    <ReservationList
                      reservations={filteredReservations}
                      {...listProps}
                    />
                  </>
                ) : (
                  <div className="arp-empty">
                    <div className="arp-empty-icon">
                      <ClipboardList size={40} strokeWidth={1.25} />
                    </div>
                    <div className="arp-empty-title">No reservations found</div>
                    <div className="arp-empty-sub">
                      {dateFrom || dateTo
                        ? "No reservations match the selected date range."
                        : "This student has no reservations."}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ════════════════════════════════════
            REGULAR MODE — flat list
        ════════════════════════════════════ */}
        {!isStudentMode && (
          filteredReservations.length ? (
            <ReservationList
              reservations={filteredReservations}
              {...listProps}
            />
          ) : (
            <div className="arp-empty">
              <div className="arp-empty-icon">
                <Search size={40} strokeWidth={1.25} />
              </div>
              <div className="arp-empty-title">No reservations found</div>
              <div className="arp-empty-sub">
                {searchTerm
                  ? `No results for "${searchTerm}". Try a different search term.`
                  : "Try changing the active filter or date range."}
              </div>
            </div>
          )
        )}

      </div>

      {/* ── Modals (logic unchanged) ── */}
      <WalkInCheckoutModal
        isOpen={walkInModalOpen}
        onClose={() => !walkInLoading && setWalkInModalOpen(false)}
        students={studentList}
        books={books}
        onSubmit={handleWalkIn}
        submitting={walkInLoading}
      />

      <FineChoiceModal
        open={!!fineModalReservation}
        reservation={fineModalReservation}
        onClose={() => {
          document.body.classList.remove("body-scroll-locked");
          setFineModalReservation(null);
        }}
        onSelectDamage={() => openDamagePayment(fineModalReservation)}
        onSelectLost={() => openLostPayment(fineModalReservation)}
      />

      <QrPaymentModal
        open={paymentModal.open}
        title={paymentModal.title}
        amount={paymentModal.amount}
        subtitle={paymentModal.subtitle}
        processing={paymentProcessing}
        success={paymentSuccess}
        onSimulate={() => setShowPayConfirm(true)}
        onClose={closePaymentModal}
      />

      <ConfirmModal
        open={showPayConfirm}
        title="Confirm Payment"
        message={`Are you sure you want to simulate payment of ₹${paymentModal.amount}?`}
        confirmText="Yes, Pay"
        onCancel={() => setShowPayConfirm(false)}
        onConfirm={() => {
          setShowPayConfirm(false);
          handlePaymentConfirm();
        }}
      />
      <ConfirmModal
        open={actionConfirm.open}
        title={
          actionConfirm.type === "collect"
            ? "Confirm Collection"
            : actionConfirm.type === "return"
            ? "Confirm Return"
            : "Confirm Reminder"
        }
        message={
          actionConfirm.type === "collect"
            ? `Mark "${getBookTitle(actionConfirm.reservation)}" as collected by ${getStudentName(actionConfirm.reservation)}?`
            : actionConfirm.type === "return"
            ? `Mark "${getBookTitle(actionConfirm.reservation)}" as returned by ${getStudentName(actionConfirm.reservation)}?`
            : `Send a reminder to ${getStudentName(actionConfirm.reservation)} for "${getBookTitle(actionConfirm.reservation)}"?`
        }
        confirmText={
          actionConfirm.type === "collect"
            ? "Mark Collected"
            : actionConfirm.type === "return"
            ? "Mark Returned"
            : "Send Reminder"
        }
        onCancel={closeActionConfirm}
        onConfirm={handleActionConfirm}
      />
    </div>
  );
}