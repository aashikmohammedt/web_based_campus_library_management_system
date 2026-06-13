import { useEffect, useRef, useState } from "react";

import BooksCatalogue from "../components/BooksCatalogue";
import NewArrivalsHighlight from "../components/NewArrivalsHighlight";
import ProfileSidebar from "../components/ProfileSidebar";
import TopBar from "../components/TopBar";
import StudentReservationsPage from "./StudentReservationsPage";  // ← NEW IMPORT

import "./StudentDashboardPage.css";

import { apiRequest } from "../api";

/* =========================================
   EDIT MODAL — inline, no extra file needed
========================================= */
function EditBookModal({ open, book, onClose, onSave, saving }) {
  const [form, setForm] = useState({
    title: "",
    author: "",
    edition: "",
    totalCopies: "",
  });

  // Pre-fill whenever the target book changes
  useEffect(() => {
    if (book) {
      setForm({
        title: book.title ?? "",
        author: book.author ?? "",
        edition: book.edition ?? "",
        totalCopies: book.totalCopies ?? "",
      });
    }
  }, [book]);

  if (!open || !book) return null;

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = () => {
    onSave({
      ...form,
      totalCopies: Number(form.totalCopies),
    });
  };

  return (
    /* ── Backdrop ── */
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className="modal-card edit-modal">

        {/* Header */}
        <div className="modal-card__header">
          <h2 id="edit-modal-title" className="modal-card__title">
            ✏️ Edit Book
          </h2>
          <button
            className="modal-card__close"
            onClick={onClose}
            disabled={saving}
            aria-label="Close edit modal"
          >
            ✕
          </button>
        </div>

        {/* Body — form fields */}
        <div className="modal-card__body">
          <div className="edit-modal__field">
            <label htmlFor="edit-title" className="edit-modal__label">
              Title <span aria-hidden="true">*</span>
            </label>
            <input
              id="edit-title"
              name="title"
              type="text"
              className="edit-modal__input"
              value={form.title}
              onChange={handleChange}
              placeholder="Book title"
              disabled={saving}
              required
            />
          </div>

          <div className="edit-modal__field">
            <label htmlFor="edit-author" className="edit-modal__label">
              Author <span aria-hidden="true">*</span>
            </label>
            <input
              id="edit-author"
              name="author"
              type="text"
              className="edit-modal__input"
              value={form.author}
              onChange={handleChange}
              placeholder="Author name"
              disabled={saving}
              required
            />
          </div>

          <div className="edit-modal__row">
            <div className="edit-modal__field">
              <label htmlFor="edit-edition" className="edit-modal__label">
                Edition
              </label>
              <input
                id="edit-edition"
                name="edition"
                type="text"
                className="edit-modal__input"
                value={form.edition}
                onChange={handleChange}
                placeholder="e.g. 3rd"
                disabled={saving}
              />
            </div>

            <div className="edit-modal__field">
              <label htmlFor="edit-totalCopies" className="edit-modal__label">
                Total Copies <span aria-hidden="true">*</span>
              </label>
              <input
                id="edit-totalCopies"
                name="totalCopies"
                type="number"
                min="0"
                className="edit-modal__input"
                value={form.totalCopies}
                onChange={handleChange}
                placeholder="0"
                disabled={saving}
                required
              />
            </div>
          </div>
        </div>

        {/* Footer — actions */}
        <div className="modal-card__footer">
          <button
            className="btn btn--ghost"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            className="btn btn--primary"
            onClick={handleSubmit}
            disabled={saving || !form.title || !form.author || form.totalCopies === ""}
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>

      </div>
    </div>
  );
}

/* =========================================
   STUDENT DASHBOARD PAGE
========================================= */
export default function StudentDashboardPage({ user, onUserUpdated, onLogoutClick, setToast }) {
  const [books, setBooks] = useState([]);
  const [loadingBooks, setLoadingBooks] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  // ── Student page navigation ──────────────────────────────────────────────
  const [activeStudentPage, setActiveStudentPage] = useState("dashboard");
  useEffect(() => {
    const handlePopState = () => {
      setActiveStudentPage("dashboard");
      setShowProfile(false);
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);
  useEffect(() => {
    const handlePopState = () => {
      setActiveStudentPage("dashboard");
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  // ── Reservations state ───────────────────────────────────────────────────
  const [reservations, setReservations] = useState([]);

  // ── Search state ─────────────────────────────────────────────────────────
  const [searchValue, setSearchValue] = useState("");
  const [filterType, setFilterType] = useState("all");

  // ── Section refs for quick-action scrolling ──────────────────────────────
  const newArrivalsRef = useRef(null);
  const catalogueRef = useRef(null);

  // ── Reservation state ────────────────────────────────────────────────────
  const [reserving, setReserving] = useState(false);

  // ── Edit state ───────────────────────────────────────────────────────────
  const [editTarget, setEditTarget] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [saving, setSaving] = useState(false);

  /* ── Load books ──────────────────────────────────────────────────────── */
  const loadBooks = async () => {
    setLoadingBooks(true);
    try {
      const data = await apiRequest("/books");
      setBooks(data.books || []);
    } catch (err) {
      setToast({ type: "error", message: err.message });
    } finally {
      setLoadingBooks(false);
    }
  };

  useEffect(() => {
    loadBooks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Load reservations ───────────────────────────────────────────────── */
  const loadReservations = async () => {
    try {
      const data = await apiRequest("/reservations");
      setReservations(data.reservations || []);
    } catch (err) {
      setToast({ type: "error", message: err.message });
    }
  };

  // Fetch reservations whenever the reservations page becomes active
  useEffect(() => {
    if (activeStudentPage === "reservations") {
      loadReservations();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStudentPage]);

  /* ── Filtered books (drives BooksCatalogue) ──────────────────────────── */
  const filteredBooks = (() => {
    const q = searchValue.trim().toLowerCase();
    if (!q) return books;

    return books.filter((b) => {
      switch (filterType) {
        case "department":
          return (b.department ?? "").toLowerCase().includes(q);
        case "author":
          return (b.author ?? "").toLowerCase().includes(q);
        case "new":
          return (
            (b.title ?? "").toLowerCase().includes(q) ||
            (b.author ?? "").toLowerCase().includes(q)
          );
        default:
          return (
            (b.title ?? "").toLowerCase().includes(q) ||
            (b.author ?? "").toLowerCase().includes(q) ||
            (b.department ?? "").toLowerCase().includes(q) ||
            (b.courseCode ?? "").toLowerCase().includes(q)
          );
      }
    });
  })();

  /* ── Search handlers ─────────────────────────────────────────────────── */
  const handleSearchChange = (value) => {
    setSearchValue(value);
    if (value && catalogueRef.current) {
      catalogueRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const handleSearchSubmit = () => {
    if (catalogueRef.current) {
      catalogueRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  /* ── Reserve / Borrow handler ────────────────────────────────────────── */
const handleReserve = async (book) => {
  console.log("STEP 1 - handleReserve started", book);

  if (!book || reserving) return;

  setReserving(true);

  try {
    console.log("STEP 2 - calling reservation API");

    const data = await apiRequest("/reservations", {
      method: "POST",
      body: JSON.stringify({ bookId: book._id }),
    });

    console.log("STEP 3 - reservation API success", data);

    setToast({
      type: "success",
      message: data.message || "Reservation placed successfully",
    });

    console.log("STEP 4 - before loadBooks");

    await loadBooks();

    console.log("STEP 5 - loadBooks finished");
  } catch (err) {
    console.error("STEP ERROR:", err);

    setToast({
      type: "error",
      message: err.message || "Failed to place reservation",
    });
  } finally {
    console.log("STEP 6 - finally reached");

    setReserving(false);
  }
};
  /* ── Edit handlers ───────────────────────────────────────────────────── */
  const handleEdit = (book) => {
    if (!book) return;
    setEditTarget(book);
    setShowEditModal(true);
  };

  const handleCloseEdit = () => {
    if (saving) return;
    setShowEditModal(false);
    setEditTarget(null);
  };

  const handleSaveEdit = async (updatedFields) => {
    if (!editTarget) return;
    setSaving(true);
    try {
      const data = await apiRequest(`/books/${editTarget._id}`, {
        method: "PUT",
        body: JSON.stringify(updatedFields),
      });

      const savedBook = data?.book ?? { ...editTarget, ...updatedFields };

      setBooks((prev) =>
        prev.map((b) => (b._id === editTarget._id ? savedBook : b))
      );

      setToast({ type: "success", message: "Book updated successfully" });
      setShowEditModal(false);
      setEditTarget(null);
    } catch (err) {
      setToast({ type: "error", message: err.message || "Failed to update book" });
    } finally {
      setSaving(false);
    }
  };

  /* ── Copy-count handlers ─────────────────────────────────────────────── */
  const handleIncrease = async (book) => {
    const updated = {
      ...book,
      totalCopies: book.totalCopies + 1,
      availableCopies: book.availableCopies + 1,
    };

    setBooks((prev) => prev.map((b) => (b._id === book._id ? updated : b)));

    try {
      await apiRequest(`/books/${book._id}`, {
        method: "PUT",
        body: JSON.stringify({
          totalCopies: updated.totalCopies,
          availableCopies: updated.availableCopies,
        }),
      });
    } catch (err) {
      setBooks((prev) => prev.map((b) => (b._id === book._id ? book : b)));
      setToast({ type: "error", message: err.message || "Failed to increase copies" });
    }
  };

  const handleDecrease = async (book) => {
    const updated = {
      ...book,
      totalCopies: Math.max(0, book.totalCopies - 1),
      availableCopies: Math.max(0, book.availableCopies - 1),
    };

    setBooks((prev) => prev.map((b) => (b._id === book._id ? updated : b)));

    try {
      await apiRequest(`/books/${book._id}`, {
        method: "PUT",
        body: JSON.stringify({
          totalCopies: updated.totalCopies,
          availableCopies: updated.availableCopies,
        }),
      });
    } catch (err) {
      setBooks((prev) => prev.map((b) => (b._id === book._id ? book : b)));
      setToast({ type: "error", message: err.message || "Failed to decrease copies" });
    }
  };

  /* ── Student quick actions ───────────────────────────────────────────── */
  const studentQuickActions = [
    {
      label: "New Arrivals",
      onClick: () =>
        newArrivalsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    },
    {
      label: "Pre-Book",
      onClick: () => {
        setFilterType("new");
        catalogueRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      },
    },
    {
      // ── FIXED: was setShowProfile(true), now navigates to reservations page ──
      label: "My Pre-Bookings and Checkouts",
      onClick: () => {
        window.history.pushState(
          { page: "reservations" },
          "",
          "#reservations"
        );
        setActiveStudentPage("reservations");
      },
    },
  ];

  /* ── Sub-page: Reservations ──────────────────────────────────────────── */
  if (activeStudentPage === "reservations") {
    return (
      <StudentReservationsPage
        reservations={reservations}
        refreshReservations={loadReservations}
        refreshBooks={loadBooks}
        setToast={setToast}
        onBack={() => setActiveStudentPage("dashboard")}
      />
    );
  }

  /* ── Render: Dashboard (default) ─────────────────────────────────────── */
  return (
    <div className="page-shell">

      {/* ── 1. Top navigation bar ──────────────────────────────── */}
      <TopBar
        title="Student Dashboard"
        subtitle="Browse and reserve books from the library catalogue."
        onProfileClick={() => {
          window.history.pushState(
            { page: "profile" },
            "",
            "#profile"
          );

          setShowProfile(true);
        }}
        user={user}
        onProfileUpdated={onUserUpdated}
        setToast={setToast}
        onLogoutClick={onLogoutClick}

        searchValue={searchValue}
        onSearchChange={handleSearchChange}
        onSearchSubmit={handleSearchSubmit}
        filterType={filterType}
        onFilterTypeChange={setFilterType}
        quickActions={studentQuickActions}
      />

      {/* ── 2. New Arrivals — infinite auto-scrolling slider ───── */}
      <div ref={newArrivalsRef}>
        <NewArrivalsHighlight
          books={books}
          onReserve={handleReserve}
        />
      </div>

      {/* ── 3. Books catalogue ──────────────────────────────────── */}
      <div ref={catalogueRef}>
        <BooksCatalogue
          title="Books Catalogue"
          books={filteredBooks}
          loading={loadingBooks}
          userRole="student"
          onReserve={handleReserve}
          onEditBook={handleEdit}
          onUpdateCopies={(bookId, action) => {
            const book = books.find((b) => b._id === bookId);
            if (!book) return;
            if (action === "increase") handleIncrease(book);
            if (action === "decrease") handleDecrease(book);
          }}
        />
      </div>

      {/* ── 4. Overlays (sidebar, edit modal) ───────────────────── */}
      <ProfileSidebar
        open={showProfile}
        onClose={() => setShowProfile(false)}
        user={user}
        onProfileUpdated={onUserUpdated}
        onLogoutClick={onLogoutClick}
        setToast={setToast}
      />

      <EditBookModal
        open={showEditModal}
        book={editTarget}
        saving={saving}
        onClose={handleCloseEdit}
        onSave={handleSaveEdit}
      />

    </div>
  );
}