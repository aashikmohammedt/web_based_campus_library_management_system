import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "../components/WalkInCheckoutModal.css";

/* ── Inline SVG Icons ─────────────────────────────────────── */
const IconWalk = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="13" cy="4" r="2" /><path d="M7 21l2.5-7.5L13 17l1.5-4L17 21" /><path d="M9 11l1-4 3.5 2 2.5-3" />
  </svg>
);
const IconUser = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
  </svg>
);
const IconBook = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);
const IconBookOpen = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
  </svg>
);
const IconSearch = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);
const IconCalendar = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);
const IconNote = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
  </svg>
);
const IconCheck = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

/* ─────────────────────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────────────────── */
function getTodayStr() {
  const d = new Date();
  return d.toISOString().split("T")[0];
}

function getDefaultDueDate() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().split("T")[0];
}

function getInitials(name = "") {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/* ─────────────────────────────────────────────────────────────
   Sub-components
───────────────────────────────────────────────────────────── */

/** Highlighted text: wraps matched substring in <mark> */
function Highlight({ text = "", query = "" }) {
  if (!query.trim()) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase().trim());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="wic-highlight">{text.slice(idx, idx + query.trim().length)}</mark>
      {text.slice(idx + query.trim().length)}
    </>
  );
}

/** A single search-result row */
function SearchResultRow({ icon, primary, secondary, query, onClick, disabled, unavailableReason }) {
  return (
    <button
      type="button"
      className={`wic-result-row${disabled ? " wic-result-row--unavailable" : ""}`}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={disabled ? unavailableReason : undefined}
    >
      <div className="wic-result-avatar">{icon}</div>
      <div className="wic-result-text">
        <span className="wic-result-primary">
          <Highlight text={primary} query={query} />
        </span>
        {secondary && (
          <span className="wic-result-secondary">
            <Highlight text={secondary} query={query} />
          </span>
        )}
        {disabled && unavailableReason && (
          <span className="wic-result-unavailable-badge">{unavailableReason}</span>
        )}
      </div>
      {disabled ? (
        <span className="wic-result-lock" aria-hidden="true">🔒</span>
      ) : (
        <span className="wic-result-chevron">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        </span>
      )}
    </button>
  );
}

/** Selected item pill/card — dismissible */
function SelectedCard({ icon, primary, secondary, onClear, tone = "blue" }) {
  return (
    <div className={`wic-selected-card wic-selected-${tone}`}>
      <div className="wic-selected-avatar">{icon}</div>
      <div className="wic-selected-text">
        <span className="wic-selected-primary">{primary}</span>
        {secondary && <span className="wic-selected-secondary">{secondary}</span>}
      </div>
      <button
        type="button"
        className="wic-selected-clear"
        onClick={onClear}
        aria-label="Clear selection"
      >
        ✕
      </button>
    </div>
  );
}

/** Inline search field with icon, input, clear button */
function SearchField({ icon, placeholder, value, onChange, onClear, inputRef }) {
  return (
    <div className="wic-search-wrap">
      <span className="wic-search-icon" aria-hidden="true">{icon}</span>
      <input
        ref={inputRef}
        type="text"
        className="wic-search-input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
      />
      {value && (
        <button
          type="button"
          className="wic-search-clear"
          onMouseDown={(e) => e.preventDefault()} /* prevent input blur before click fires on mobile */
          onClick={onClear}
          aria-label="Clear search"
          tabIndex={-1}
        >
          ✕
        </button>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   WalkInCheckoutModal
   Props:
     isOpen      – boolean
     onClose     – () => void
     onSubmit    – ({ studentId, bookId, dueDate, notes }) => Promise<void>
     students    – [{ _id, name, studentId, grade?, class? }]
     books       – [{ _id, title, author?, isbn?, availableCopies? }]
     submitting  – boolean  (shows spinner on submit btn)
───────────────────────────────────────────────────────────── */
export default function WalkInCheckoutModal({
  isOpen,
  onClose,
  onConfirm,
  students,
  books,
  reservations = [],
  loading,
  // NOTE: per-student+book duplicate validation is intentionally server-side only.
  // Client-side checks here only cover availableCopies (no physical stock) because
  // that is visible in the book list. Checking "does THIS student already have THIS
  // book" requires a DB query and is enforced by POST /api/reservations/walkin,
  // which returns a 400 with conflictStatus on duplicate — the modal catch below
  // routes that error to the book field inline.
}) {
  /* ── Form state ────────────────────────────────────────── */
  const [studentQuery, setStudentQuery] = useState("");
  const [bookQuery, setBookQuery] = useState("");
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [selectedBook, setSelectedBook] = useState(null);
  const [dueDate, setDueDate] = useState(getDefaultDueDate());
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState({});

  const studentInputRef = useRef(null);
  const bookInputRef = useRef(null);
  const overlayRef = useRef(null);

  /* ── Filtered search results ───────────────────────────── */
  const studentResults = useMemo(() => {
    const q = studentQuery.trim().toLowerCase();
    if (!q) return [];
    return students
      .filter(
        (s) =>
          s.name?.toLowerCase().includes(q) ||
          s.studentId?.toLowerCase().includes(q) ||
          s.grade?.toLowerCase().includes(q)
      )
      .slice(0, 6);
  }, [students, studentQuery]);

  const bookResults = useMemo(() => {
    const query = String(bookQuery || "")
      .toLowerCase()
      .trim();

    const safeBooks = Array.isArray(books) ? books : [];

    console.log("Modal books:", safeBooks);

    return safeBooks
      .filter((b) => {
        const title = String(
          b?.title ||
          b?.bookTitle ||
          b?.name ||
          ""
        )
          .toLowerCase()
          .trim();

        const author = String(
          b?.author ||
          b?.bookAuthor ||
          ""
        )
          .toLowerCase()
          .trim();

        const isbn = String(
          b?.isbn ||
          b?.ISBN ||
          ""
        )
          .toLowerCase()
          .trim();

        const availableCopies =
          Number(
            b?.availableCopies ??
            b?.available ??
            b?.copiesAvailable ??
            b?.quantity ??
            1
          );

        if (!query) {
          return true;
        }

        return (
          title.includes(query) ||
          author.includes(query) ||
          isbn.includes(query)
        );
      })
      .slice(0, 12);
  }, [books, bookQuery]);

  /* ── Stock-only unavailability check for selected book ──────────────────
     Client-side we can only see availableCopies — that tells us whether ANY
     copy exists to hand out. We do NOT block based on other students' active
     reservations for the same book (multiple students may hold the same book
     as long as copies are available). Per-student+book duplicate conflicts are
     caught by the server and surfaced as a field error after submission.  */
  const selectedBookUnavailable = useMemo(() => {
    if (!selectedBook) return false;

    const copies =
      selectedBook.availableCopies ??
      selectedBook.available ??
      selectedBook.copiesAvailable ??
      selectedBook.quantity ??
      1;

    return copies <= 0;
  }, [selectedBook]);

  /* ── Status-specific message for selected unavailable book ── */
  const selectedBookUnavailableMsg = useMemo(() => {
    if (!selectedBook || !selectedBookUnavailable) return null;
    return "This book has no copies available — all copies are currently checked out.";
  }, [selectedBook, selectedBookUnavailable]);

  /* ── Reset on open ─────────────────────────────────────── */
  useEffect(() => {
    if (isOpen) {
      setStudentQuery("");
      setBookQuery("");
      setSelectedStudent(null);
      setSelectedBook(null);
      setDueDate(getDefaultDueDate());
      setNotes("");
      setErrors({});
      setTimeout(() => studentInputRef.current?.focus(), 80);
    }
  }, [isOpen]);

  /* ── Escape key ────────────────────────────────────────── */
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  /* ── Body scroll lock (iOS Safari fix: position:fixed prevents rubber-band scroll) */
  useEffect(() => {
    if (isOpen) {
      const scrollY = window.scrollY;
      document.body.style.overflow = "hidden";
      document.body.style.position = "fixed";
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = "100%";
    } else {
      const top = document.body.style.top;
      document.body.style.overflow = "";
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.width = "";
      if (top) window.scrollTo(0, -parseInt(top, 10));
    }
    return () => {
      document.body.style.overflow = "";
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.width = "";
    };
  }, [isOpen]);

  /* ── Validation ────────────────────────────────────────── */
  const validate = useCallback(() => {
    const errs = {};
    if (!selectedStudent) errs.student = "Please select a student.";
    if (!selectedBook) {
      errs.book = "Please select a book.";
    } else if (selectedBookUnavailable) {
      errs.book = "This book has no copies available.";
    }
    if (!dueDate) errs.dueDate = "Please pick a due date.";
    else if (dueDate < getTodayStr()) errs.dueDate = "Due date cannot be in the past.";
    return errs;
  }, [selectedStudent, selectedBook, selectedBookUnavailable, dueDate]);

  /* ── Submit ────────────────────────────────────────────── */
  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      const errs = validate();
      if (Object.keys(errs).length) { setErrors(errs); return; }
      setErrors({});
      try {
        await onConfirm({
          studentId: selectedStudent._id || selectedStudent.id,
          bookId: selectedBook._id || selectedBook.id,
          dueDate,
          notes: notes.trim(),
        });
      } catch (err) {
        // The server returned 400. Route the error to the correct inline field
        // so the admin sees it in context rather than losing it to a generic toast.
        //
        // Priority 1 — use `conflictStatus` when the server includes it:
        //   • conflictStatus "collected"  → student already has the book checked out
        //   • conflictStatus "reserved"   → student already pre-booked this book
        //
        // Priority 2 — fall back to message-string matching for older server versions
        // or other conflict types (no copies in stock, etc.).
        const msg = err?.message ?? "Checkout failed. Please try again.";
        const lc = msg.toLowerCase();

        const hasConflictStatus = !!err?.conflictStatus;
        const isStudentBookConflict =
          hasConflictStatus ||
          lc.includes("already checked out") ||
          lc.includes("already pre-booked");

        // Stock conflict = the book itself has no copies left (availableCopies <= 0).
        // This is a *book-level* constraint, not a per-student duplicate — a different
        // book must be selected, so the error belongs on the book field.
        const isStockConflict =
          lc.includes("no copies available") ||
          lc.includes("not available");

        if (isStockConflict) {
          // No physical copies left — route to the book field so the admin
          // knows to pick a different title.
          setErrors({ book: msg });
        } else if (isStudentBookConflict) {
          // This *student* already has an active record for this book (checked out
          // or pre-booked). Other students are unaffected and may still check it
          // out if copies exist. Route to submit so the book field stays usable
          // and the submit button is not permanently disabled.
          setErrors({ submit: msg });
        } else {
          setErrors({ submit: msg });
        }
      }
    },
    [validate, onConfirm, selectedStudent, selectedBook, dueDate, notes]
  );

  /* ── Overlay click ─────────────────────────────────────── */
  const handleOverlayClick = useCallback(
    (e) => { if (e.target === overlayRef.current) onClose(); },
    [onClose]
  );

  if (!isOpen) return null;

  /* ── Step completion state for visual progress ─────────── */
  const step1Done = !!selectedStudent;
  const step2Done = !!selectedBook;
  const step3Done = !!dueDate && dueDate >= getTodayStr();

  return (
    <div
      className="wic-overlay"
      ref={overlayRef}
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-label="New Walk-In Checkout"
    >
      <div className="wic-modal">

        {/* ══ HEADER ══════════════════════════════════════ */}
        <div className="wic-header">
          <div className="wic-header-icon"><IconWalk /></div>
          <div className="wic-header-text">
            <h2 className="wic-title">New Walk-In Checkout</h2>
            <p className="wic-subtitle">Issue a book to a student at the library desk</p>
          </div>
          <button
            type="button"
            className="wic-close-btn"
            onClick={onClose}
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {/* ══ PROGRESS STRIP ══════════════════════════════ */}
        <div className="wic-progress">
          {[
            { label: "Student", done: step1Done },
            { label: "Book", done: step2Done },
            { label: "Details", done: step3Done },
          ].map((step, i) => (
            <div key={step.label} className={`wic-progress-step ${step.done ? "done" : ""}`}>
              <div className="wic-progress-dot">{step.done ? "✓" : i + 1}</div>
              <span className="wic-progress-label">{step.label}</span>
              {i < 2 && <div className="wic-progress-line" />}
            </div>
          ))}
        </div>

        {/* ══ BODY + FOOTER (form wraps both so the submit button is inside) ═ */}
        <form id="wic-form" onSubmit={handleSubmit} noValidate>
          <div className="wic-body">

            {/* ── SECTION 1: Student ─────────────────────── */}
            <section className="wic-section">
              <div className="wic-section-head">
                <span className="wic-section-num">1</span>
                <div>
                  <h3 className="wic-section-title">Select Student</h3>
                  <p className="wic-section-hint">Search by name, student ID or grade</p>
                </div>
              </div>

              {selectedStudent ? (
                <SelectedCard
                  icon={getInitials(selectedStudent.name)}
                  primary={selectedStudent.name}
                  secondary={[selectedStudent.studentId, selectedStudent.grade].filter(Boolean).join(" · ")}
                  onClear={() => {
                    setSelectedStudent(null);
                    setStudentQuery("");
                    setTimeout(() => studentInputRef.current?.focus(), 60);
                  }}
                  tone="blue"
                />
              ) : (
                <div className="wic-search-section">
                  <SearchField
                    icon={<IconUser />}
                    placeholder="Search students…"
                    value={studentQuery}
                    onChange={setStudentQuery}
                    onClear={() => setStudentQuery("")}
                    inputRef={studentInputRef}
                  />
                  {studentQuery.trim() && (
                    <div className="wic-results-list">
                      {studentResults.length > 0 ? (
                        studentResults.map((s) => (
                          <SearchResultRow
                            key={s._id || s.id}
                            icon={getInitials(s.name)}
                            primary={s.name}
                            secondary={[s.studentId, s.grade].filter(Boolean).join(" · ")}
                            query={studentQuery}
                            onClick={() => {
                              setSelectedStudent(s);
                              setStudentQuery("");
                              setErrors((e) => ({ ...e, student: undefined }));
                            }}
                          />
                        ))
                      ) : (
                        <div className="wic-results-empty">
                          <span className="wic-results-empty-icon"><IconSearch /></span>
                          No students match &ldquo;{studentQuery}&rdquo;
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {errors.student && <p className="wic-field-error">{errors.student}</p>}
            </section>

            <div className="wic-divider" />

            {/* ── SECTION 2: Book ────────────────────────── */}
            <section className="wic-section">
              <div className="wic-section-head">
                <span className="wic-section-num">2</span>
                <div>
                  <h3 className="wic-section-title">Select Book</h3>
                  <p className="wic-section-hint">Search by title, author or ISBN</p>
                </div>
              </div>

              {selectedBook ? (
                <>
                  <SelectedCard
                    icon={<IconBookOpen />}
                    primary={selectedBook.title || selectedBook.bookTitle || "Untitled Book"}
                    secondary={[
                      selectedBook.author,
                      selectedBook.isbn,
                      selectedBook.availableCopies != null
                        ? `${selectedBook.availableCopies} cop${selectedBook.availableCopies === 1 ? "y" : "ies"} available`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    onClear={() => {
                      setSelectedBook(null);
                      setBookQuery("");
                      setTimeout(() => bookInputRef.current?.focus(), 60);
                    }}
                    tone={selectedBookUnavailable ? "red" : "green"}
                  />
                  {selectedBookUnavailable && (
                    <p className="wic-field-error wic-field-error--book-unavailable">
                      ⚠ {selectedBookUnavailableMsg}
                    </p>
                  )}
                </>
              ) : (
                <div className="wic-search-section">
                  <SearchField
                    icon={<IconBook />}
                    placeholder="Search books…"
                    value={bookQuery}
                    onChange={setBookQuery}
                    onClear={() => setBookQuery("")}
                    inputRef={bookInputRef}
                  />
                  {bookQuery.trim() && (
                    <div className="wic-results-list">
                      {bookResults.length > 0 ? (
                        bookResults.map((b) => {
                          const copies =
                            b.availableCopies ??
                            b.available ??
                            b.copiesAvailable ??
                            b.quantity ??
                            1;
                          const studentAlreadyHasBook =
                            selectedStudent &&
                            reservations.some((r) => {
                              const sameStudent =
                                String(r.user?._id || r.user) ===
                                String(selectedStudent._id);

                              const sameBook =
                                String(r.book?._id || r.book) ===
                                String(b._id);

                              return (
                                sameStudent &&
                                sameBook &&
                                ["reserved", "collected"].includes(r.status)
                              );
                            });
                          const isUnavailable =
                            copies <= 0 || studentAlreadyHasBook;
                          const unavailableReason =
                            copies <= 0
                              ? "No copies available"
                              : studentAlreadyHasBook
                                ? "Student already has this book"
                                : undefined;
                          return (
                            <SearchResultRow
                              key={b._id || b.id}
                              icon={<IconBookOpen />}
                              primary={
                                b.title ||
                                b.bookTitle ||
                                b.name ||
                                "Untitled Book"
                              }
                              secondary={[
                                b.author || b.bookAuthor,
                                b.isbn || b.ISBN,
                                copies != null ? `${copies} cop${copies === 1 ? "y" : "ies"} available` : null,
                              ].filter(Boolean).join(" · ")}
                              query={bookQuery}
                              disabled={isUnavailable}
                              unavailableReason={unavailableReason}
                              onClick={() => {
                                setSelectedBook(b);
                                setBookQuery("");
                                setErrors((e) => ({ ...e, book: undefined }));
                              }}
                            />
                          );
                        })
                      ) : (
                        <div className="wic-results-empty">
                          <span className="wic-results-empty-icon"><IconSearch /></span>
                          No books match &ldquo;{bookQuery}&rdquo;
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {errors.book && <p className="wic-field-error">{errors.book}</p>}
            </section>

            <div className="wic-divider" />

            {/* ── SECTION 3: Details ─────────────────────── */}
            <section className="wic-section">
              <div className="wic-section-head">
                <span className="wic-section-num">3</span>
                <div>
                  <h3 className="wic-section-title">Checkout Details</h3>
                  <p className="wic-section-hint">Set due date and optional notes</p>
                </div>
              </div>

              <div className="wic-details-grid">
                {/* Due Date */}
                <div className="wic-field">
                  <label className="wic-label" htmlFor="wic-duedate">
                    <span className="wic-label-icon"><IconCalendar /></span>
                    Due Date
                    <span className="wic-label-required">*</span>
                  </label>
                  <input
                    id="wic-duedate"
                    type="date"
                    className={`wic-input wic-input-date ${errors.dueDate ? "wic-input-error" : ""}`}
                    value={dueDate}
                    min={getTodayStr()}
                    onChange={(e) => {
                      setDueDate(e.target.value);
                      setErrors((er) => ({ ...er, dueDate: undefined }));
                    }}
                  />
                  {errors.dueDate && <p className="wic-field-error">{errors.dueDate}</p>}
                </div>


              </div>

              {/* Notes */}
              <div className="wic-field wic-field-notes">
                <label className="wic-label" htmlFor="wic-notes">
                  <span className="wic-label-icon"><IconNote /></span>
                  Notes
                  <span className="wic-label-optional">(optional)</span>
                </label>
                <textarea
                  id="wic-notes"
                  className="wic-textarea"
                  placeholder="Any special notes about this checkout…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  maxLength={300}
                />
                <span className="wic-char-count">{notes.length}/300</span>
              </div>
            </section>

          </div>{/* /wic-body */}

          {/* ══ FOOTER (inside form — submit button works natively) ══════════ */}
          <div className="wic-footer">
            {errors.submit && (
              <p className="wic-field-error wic-field-error--submit" role="alert">
                ⚠ {errors.submit}
              </p>
            )}
            <button
              type="button"
              className="wic-btn-cancel"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="wic-btn-submit"
              disabled={loading || selectedBookUnavailable || !!errors.book}
            >
              {loading ? (
                <>
                  <span className="wic-spinner" aria-hidden="true" />
                  Processing…
                </>
              ) : (
                <>
                  <IconCheck />
                  Confirm Checkout
                </>
              )}
            </button>
          </div>{/* /wic-footer */}

        </form>{/* /wic-form */}

      </div>{/* /wic-modal */}
    </div>
  );
}