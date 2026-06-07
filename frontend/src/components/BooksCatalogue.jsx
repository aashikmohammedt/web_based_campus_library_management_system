import { useState, useEffect, useRef } from "react";
import { X, Upload, BookOpen, LayoutGrid, List } from "lucide-react";
import BookCard from "./BookCard";
import ConfirmModal from "./ConfirmModal";
import "./BooksCatalogue.css";

/**
 * BooksCatalogue
 *
 * Props:
 *  - title          {string}   Optional heading above the grid.
 *  - books          {array}    List of book objects.
 *  - loading        {boolean}  Shows loading state when true.
 *  - userRole       {string}   "admin" | "student" — controls which BookCard view renders.
 *  - onReserve      {function} Student: called with `book` AFTER modal confirmation.
 *  - onEditBook     {function} Admin: called with `(bookId, updatedBook, imageFile)`.
 *  - onDeleteBook   {function} Admin: called with `book`.
 *  - onUpdateCopies {function} Admin: called with `(bookId, action)` for backend sync.
 *  - activeReservations {array} Student: list of active reservation objects to detect
 *                               per-book status (shape: [{ book: bookId|{_id}, status }]).
 */
const BooksCatalogue = ({
  title,
  books = [],
  loading = false,
  userRole = "student",
  onReserve,
  onEditBook,
  onDeleteBook,
  onUpdateCopies,
  activeReservations = [],
}) => {
  const SORT_OPTIONS = [
    { value: "title-asc",    label: "Title: A → Z"       },
    { value: "title-desc",   label: "Title: Z → A"       },
    { value: "author-asc",   label: "Author: A → Z"      },
    { value: "author-desc",  label: "Author: Z → A"      },
    { value: "copies-desc",  label: "Most Copies"         },
    { value: "copies-asc",   label: "Fewest Copies"       },
    { value: "avail-desc",   label: "Most Available"      },
    { value: "avail-asc",    label: "Least Available"     },
    { value: "edition-desc", label: "Edition: Newest"     },
    { value: "edition-asc",  label: "Edition: Oldest"     },
  ];

  const [sortKey, setSortKey] = useState("title-asc");
  const [viewMode, setViewMode] = useState("grid");

  /* ── Local books state — mirrors prop, updated immutably ── */
  const [localBooks, setLocalBooks] = useState(books);
  useEffect(() => { setLocalBooks(books); }, [books]);

  /* ── Role helpers ─────────────────────────────────────── */
  const isAdmin = userRole === "admin";

  /* ── Server-confirmed blocks (populated on 400 API responses) ──────────
     Maps bookId → "reserved" | "collected". This lets a 400 response from
     POST /api/reservations immediately disable the button without a full
     re-fetch, and survives across pagination / sort changes. ───────────── */
  const [serverBlocked, setServerBlocked] = useState({});

  /* ── Per-book reservation status lookup (student only) ── */
  const getReservationStatus = (bookId) => {
    if (isAdmin || !bookId) return null;
    // Server-confirmed block from a prior 400 takes precedence
    if (serverBlocked[bookId]) return serverBlocked[bookId];
    const found = activeReservations.find((r) => {
      const rBookId = r.book?._id ?? r.book;
      return String(rBookId) === String(bookId);
    });
    return found?.status ?? null;
  };

  /* ── Sort logic ───────────────────────────────────────── */
  const sortedBooks = [...localBooks].sort((a, b) => {
    switch (sortKey) {
      case "title-asc":    return (a.title  || "").localeCompare(b.title  || "");
      case "title-desc":   return (b.title  || "").localeCompare(a.title  || "");
      case "author-asc":   return (a.author || "").localeCompare(b.author || "");
      case "author-desc":  return (b.author || "").localeCompare(a.author || "");
      case "copies-desc":  return (b.totalCopies     ?? 0) - (a.totalCopies     ?? 0);
      case "copies-asc":   return (a.totalCopies     ?? 0) - (b.totalCopies     ?? 0);
      case "avail-desc":   return (b.availableCopies ?? 0) - (a.availableCopies ?? 0);
      case "avail-asc":    return (a.availableCopies ?? 0) - (b.availableCopies ?? 0);
      case "edition-desc": return (b.edition || "").localeCompare(a.edition || "");
      case "edition-asc":  return (a.edition || "").localeCompare(b.edition || "");
      default:             return 0;
    }
  });

  /* ── Pagination ───────────────────────────────────────── */
  const getItemsPerPage = () => {
    if (window.innerWidth <= 1024 && window.innerWidth > 480) return 21;
    return 20;
  };

  const [itemsPerPage, setItemsPerPage] = useState(getItemsPerPage());
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    const handleResize = () => {
      setItemsPerPage(getItemsPerPage());
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Reset to page 1 whenever sort changes
  useEffect(() => { setCurrentPage(1); }, [sortKey]);

  const totalPages = Math.ceil(sortedBooks.length / itemsPerPage);
  const paginatedBooks = sortedBooks.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  /* ══════════════════════════════════════════════════════════
     STUDENT: Pre-Book — opens Book Details confirmation modal
  ══════════════════════════════════════════════════════════ */
  const [pendingBook,    setPendingBook]    = useState(null);
  const [confirmOpen,    setConfirmOpen]    = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const handlePreBook = (book) => {
    // Block if the student already has an active reservation for this book
    const reservationStatus = getReservationStatus(book._id);
    if (reservationStatus === "reserved" || reservationStatus === "collected") return;
    setPendingBook(book);
    setConfirmOpen(true);
  };

  const handleConfirm = async () => {
    if (typeof onReserve !== "function") {
      setConfirmOpen(false);
      setPendingBook(null);
      return;
    }
    setConfirmLoading(true);
    try {
      // onReserve must return a Promise; it should throw on API error so we
      // can catch the 400 response here and update the button state immediately
      // without requiring a full re-fetch.
      await onReserve(pendingBook);
    } catch (err) {
      // 400 from POST /api/reservations — the server told us the book is taken.
      // Use the structured `conflictStatus` field when available; fall back to
      // reading the human-readable message so older server versions still work.
      const conflictStatus =
        err?.conflictStatus ??
        (String(err?.message ?? "").toLowerCase().includes("checked out")
          ? "collected"
          : "reserved");
      setServerBlocked((prev) => ({ ...prev, [pendingBook._id]: conflictStatus }));
    } finally {
      setConfirmLoading(false);
      setConfirmOpen(false);
      setPendingBook(null);
    }
  };

  const handleConfirmCancel = () => {
    setConfirmOpen(false);
    setPendingBook(null);
  };

  /* ══════════════════════════════════════════════════════════
     ADMIN: Edit Book Modal
  ══════════════════════════════════════════════════════════ */
  const [editingBook,   setEditingBook]   = useState(null);
  const [editForm,      setEditForm]      = useState({});
  const [editImageFile, setEditImageFile] = useState(null);
  const [imagePreview,  setImagePreview]  = useState("");
  const fileInputRef = useRef(null);

  const handleEdit = (book) => {
    setEditingBook(book);
    setEditForm({
      title:       book.title       || "",
      author:      book.author      || "",
      edition:     book.edition     || "",
      coverImage:  book.coverImage  || "",
      totalCopies: book.totalCopies ?? 1,
    });
    setEditImageFile(null);
    setImagePreview(book.coverImage || "");
  };

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setEditForm((prev) => ({ ...prev, [name]: value }));
    if (name === "coverImage") setImagePreview(value);
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setEditImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setEditForm((prev) => ({ ...prev, coverImage: "" }));
  };

  const handleEditSave = () => {
    if (!editForm.title?.trim()) return;
    if (typeof onEditBook === "function") {
      onEditBook(editingBook._id, editForm, editImageFile || null);
    }
    closeEditModal();
  };

  const closeEditModal = () => {
    setEditingBook(null);
    setEditForm({});
    setEditImageFile(null);
    setImagePreview("");
  };

  /* ── Admin handlers ───────────────────────────────────── */
  const handleDelete   = (book) => { if (typeof onDeleteBook   === "function") onDeleteBook(book); };
  const handleIncrease = (book) => { if (typeof onUpdateCopies === "function") onUpdateCopies(book._id, "increase"); };
  const handleDecrease = (book) => { if (typeof onUpdateCopies === "function") onUpdateCopies(book._id, "decrease"); };

  const adminProps = isAdmin
    ? { onEdit: handleEdit, onDelete: handleDelete, onIncrease: handleIncrease, onDecrease: handleDecrease }
    : {};

  const previewLetter = editForm.title?.charAt(0).toUpperCase() || "?";

  return (
    <div className="catalogue-container">
      {title && <h2 className="catalogue-title">{title}</h2>}

      <div className="catalogue-toolbar">
        <label className="catalogue-sort-label" htmlFor="catalogue-sort">
          Sort by
        </label>
        <select
          id="catalogue-sort"
          className="catalogue-sort-select"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value)}
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        <div className="catalogue-view-toggle">
          <button
            type="button"
            className={`catalogue-view-btn${viewMode === "grid" ? " catalogue-view-btn--active" : ""}`}
            onClick={() => setViewMode("grid")}
            aria-label="Grid view"
            aria-pressed={viewMode === "grid"}
          >
            <LayoutGrid size={16} strokeWidth={2} />
          </button>
          <button
            type="button"
            className={`catalogue-view-btn${viewMode === "list" ? " catalogue-view-btn--active" : ""}`}
            onClick={() => setViewMode("list")}
            aria-label="List view"
            aria-pressed={viewMode === "list"}
          >
            <List size={16} strokeWidth={2} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="empty-state">Loading...</div>
      ) : sortedBooks.length === 0 ? (
        <div className="empty-state">No books found</div>
      ) : (
        <>
          <div className={`catalogue-grid ${viewMode === "list" ? "catalogue-list-view" : ""}`}>
            {paginatedBooks.map((book) => (
              <BookCard
                key={book._id}
                book={book}
                isAdmin={isAdmin}
                onPreBook={!isAdmin ? handlePreBook : undefined}
                onClick={!isAdmin ? handlePreBook : undefined}
                userReservationStatus={getReservationStatus(book._id)}
                viewMode={viewMode}
                {...adminProps}
              />
            ))}
          </div>

          {/* ── Pagination ──────────────────────────────── */}
          {totalPages > 1 && (
            <div className="catalogue-pagination">
              <button
                className="catalogue-pagination-btn"
                onClick={() => setCurrentPage((p) => p - 1)}
                disabled={currentPage === 1}
              >
                ← Prev
              </button>

              {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                <button
                  key={page}
                  className={`catalogue-pagination-btn${currentPage === page ? " catalogue-pagination-btn--active" : ""}`}
                  onClick={() => setCurrentPage(page)}
                >
                  {page}
                </button>
              ))}

              <button
                className="catalogue-pagination-btn"
                onClick={() => setCurrentPage((p) => p + 1)}
                disabled={currentPage === totalPages}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════════════════
          ADMIN: Edit Book Modal
      ══════════════════════════════════════════════════════ */}
      {editingBook && (
        <div className="edit-modal-overlay" onClick={closeEditModal}>
          <div
            className="edit-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            {/* ── Header ──────────────────────────────────── */}
            <div className="edit-modal-header">
              <div className="edit-modal-header-left">
                <BookOpen size={18} strokeWidth={2} className="edit-modal-header-icon" />
                <h3 className="edit-modal-title">Edit Book</h3>
              </div>
              <button
                className="edit-modal-close"
                onClick={closeEditModal}
                aria-label="Close"
              >
                <X size={16} strokeWidth={2.5} />
              </button>
            </div>

            {/* ── Body ────────────────────────────────────── */}
            <div className="edit-modal-body">

              {/* Cover preview + upload */}
              <div className="edit-cover-section">
                <div className="edit-cover-preview">
                  {imagePreview ? (
                    <img
                      src={imagePreview}
                      alt="Cover preview"
                      className="edit-cover-img"
                      onError={() => setImagePreview("")}
                    />
                  ) : (
                    <span className="edit-cover-initial">{previewLetter}</span>
                  )}
                </div>
                <button
                  type="button"
                  className="edit-upload-btn"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={13} strokeWidth={2.5} />
                  Upload Image
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={handleFileChange}
                />
                <p className="edit-upload-hint">or paste a URL below</p>
              </div>

              {/* Form fields */}
              <div className="edit-form-fields">

                <div className="edit-field-group">
                  <label className="edit-label" htmlFor="edit-title">
                    Title <span className="edit-required">*</span>
                  </label>
                  <input
                    id="edit-title"
                    name="title"
                    type="text"
                    className="edit-input"
                    placeholder="Book title"
                    value={editForm.title}
                    onChange={handleFormChange}
                  />
                </div>

                <div className="edit-field-group">
                  <label className="edit-label" htmlFor="edit-author">Author</label>
                  <input
                    id="edit-author"
                    name="author"
                    type="text"
                    className="edit-input"
                    placeholder="Author name"
                    value={editForm.author}
                    onChange={handleFormChange}
                  />
                </div>

                <div className="edit-field-row">
                  <div className="edit-field-group">
                    <label className="edit-label" htmlFor="edit-edition">Edition</label>
                    <input
                      id="edit-edition"
                      name="edition"
                      type="text"
                      className="edit-input"
                      placeholder="e.g. 7th Edition"
                      value={editForm.edition}
                      onChange={handleFormChange}
                    />
                  </div>
                  <div className="edit-field-group edit-field-group--small">
                    <label className="edit-label" htmlFor="edit-totalCopies">Total Copies</label>
                    <input
                      id="edit-totalCopies"
                      name="totalCopies"
                      type="number"
                      min="0"
                      className="edit-input"
                      placeholder="0"
                      value={editForm.totalCopies}
                      onChange={handleFormChange}
                    />
                  </div>
                </div>

                <div className="edit-field-group">
                  <label className="edit-label" htmlFor="edit-coverImage">Cover Image URL</label>
                  <input
                    id="edit-coverImage"
                    name="coverImage"
                    type="text"
                    className="edit-input"
                    placeholder="https://..."
                    value={editForm.coverImage}
                    onChange={handleFormChange}
                  />
                </div>

              </div>
            </div>

            {/* ── Footer ──────────────────────────────────── */}
            <div className="edit-modal-footer">
              <button type="button" className="edit-btn-cancel" onClick={closeEditModal}>
                Cancel
              </button>
              <button
                type="button"
                className="edit-btn-save"
                onClick={handleEditSave}
                disabled={!editForm.title?.trim()}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          STUDENT: Book Details confirmation modal
      ══════════════════════════════════════════════════════ */}
      {!isAdmin && (
        <ConfirmModal
          open={confirmOpen}
          book={pendingBook}
          loading={confirmLoading}
          onCancel={handleConfirmCancel}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  );
};

export default BooksCatalogue;