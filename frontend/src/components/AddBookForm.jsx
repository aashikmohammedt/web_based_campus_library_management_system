import { useRef } from "react";
import "./AddBookForm.css";
import { DEPARTMENTS } from "../constants";

/* ── Inline SVG icons (no extra dep needed) ── */
const BookPlusIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
    <line x1="12" y1="8" x2="12" y2="14"/>
    <line x1="9" y1="11" x2="15" y2="11"/>
  </svg>
);

const UploadIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="16 16 12 12 8 16"/>
    <line x1="12" y1="12" x2="12" y2="21"/>
    <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
  </svg>
);

const ImageIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
    <circle cx="8.5" cy="8.5" r="1.5"/>
    <polyline points="21 15 16 10 5 21"/>
  </svg>
);

const SparkleIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/>
  </svg>
);

export default function AddBookForm({
  addBookRef,
  handleAddBook,
  department, setDepartment,
  title,      setTitle,
  author,     setAuthor,
  courseCode, setCourseCode,
  location,   setLocation,
  publishedYear, setPublishedYear,
  coverImage, setCoverImage,
  coverImagePreview,
  setCoverImageFile,
  setCoverImagePreview,
  totalCopies, setTotalCopies,
  isNewArrival, setIsNewArrival,
  previewImageSrc,
  addingBook,
}) {
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0] || null;
    if (coverImagePreview) URL.revokeObjectURL(coverImagePreview);
    if (file) {
      setCoverImageFile(file);
      setCoverImagePreview(URL.createObjectURL(file));
    } else {
      setCoverImageFile(null);
      setCoverImagePreview("");
    }
  };

  return (
    <section className="admin-form-card" ref={addBookRef}>

      {/* ── Header ── */}
      <div className="add-form-header">
        <div className="add-form-header-left">
          <span className="add-form-header-icon">
            <BookPlusIcon />
          </span>
          <div>
            <h2 className="add-form-title">Add Book / Merge Copies</h2>
            <p className="add-form-subtitle">Fill the book details and save it to the library.</p>
          </div>
        </div>
      </div>

      <div className="add-form-divider" />

      {/* ── Body ── */}
      <form onSubmit={handleAddBook}>
        <div className="add-form-body">

          {/* ── Left: cover preview + image inputs ── */}
          <div className="add-cover-section">
            <div className="add-cover-preview">
              {previewImageSrc ? (
                <img src={previewImageSrc} alt="Book cover preview" className="add-cover-img" />
              ) : (
                <div className="add-cover-placeholder">
                  <ImageIcon />
                  <span>Cover<br />Preview</span>
                </div>
              )}
            </div>

            {/* Upload file button */}
            <div className="add-cover-controls">
              <button
                type="button"
                className="add-upload-btn"
                disabled={addingBook}
                onClick={() => fileInputRef.current?.click()}
              >
                <UploadIcon />
                Upload Image
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="add-file-input-hidden"
                disabled={addingBook}
                onChange={handleFileChange}
              />

              {/* Cover URL */}
              <div className="add-field-group" style={{ width: "100%" }}>
                <label className="add-label" htmlFor="add-cover-url">Image URL</label>
                <input
                  id="add-cover-url"
                  className="add-cover-url-input"
                  value={coverImage}
                  onChange={(e) => setCoverImage(e.target.value)}
                  disabled={addingBook}
                  placeholder="https://…/cover.jpg"
                />
              </div>

              <p className="add-upload-hint">Upload or paste a URL.<br />Upload takes priority.</p>
            </div>
          </div>

          {/* ── Right: form fields ── */}
          <div className="add-form-fields">

            {/* Row 1: Department + Published Year */}
            <div className="add-field-row">
              <div className="add-field-group" style={{ flex: 1 }}>
                <label className="add-label" htmlFor="add-department">Department</label>
                <select
                  id="add-department"
                  className="add-input"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  disabled={addingBook}
                >
                  {DEPARTMENTS.map((dept) => (
                    <option key={dept} value={dept}>{dept}</option>
                  ))}
                </select>
              </div>

              <div className="add-field-group add-field-group--small">
                <label className="add-label" htmlFor="add-year">Year</label>
                <input
                  id="add-year"
                  type="number"
                  className="add-input"
                  min="1900"
                  max={new Date().getFullYear() + 1}
                  value={publishedYear}
                  onChange={(e) => setPublishedYear(e.target.value)}
                  disabled={addingBook}
                  placeholder="2024"
                />
              </div>
            </div>

            {/* Row 2: Title */}
            <div className="add-field-group">
              <label className="add-label" htmlFor="add-title">
                Title <span className="add-required">*</span>
              </label>
              <input
                id="add-title"
                className="add-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                disabled={addingBook}
                placeholder="e.g. Introduction to Algorithms"
              />
            </div>

            {/* Row 3: Author */}
            <div className="add-field-group">
              <label className="add-label" htmlFor="add-author">
                Author <span className="add-required">*</span>
              </label>
              <input
                id="add-author"
                className="add-input"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                required
                disabled={addingBook}
                placeholder="e.g. Thomas H. Cormen"
              />
            </div>

            {/* Row 4: Course Code + Location */}
            <div className="add-field-row add-field-row--inline">
              <div className="add-field-group" style={{ flex: 1 }}>
                <label className="add-label" htmlFor="add-course">Course Code</label>
                <input
                  id="add-course"
                  className="add-input"
                  value={courseCode}
                  onChange={(e) => setCourseCode(e.target.value)}
                  disabled={addingBook}
                  placeholder="e.g. CS301"
                />
              </div>

              <div className="add-field-group" style={{ flex: 1 }}>
                <label className="add-label" htmlFor="add-location">Location</label>
                <input
                  id="add-location"
                  className="add-input"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  disabled={addingBook}
                  placeholder="e.g. Shelf A-3"
                />
              </div>
            </div>

            {/* Row 5: Total Copies + New Arrival */}
            <div className="add-field-row add-field-row--copies" style={{ alignItems: "flex-end" }}>
              <div className="add-field-group add-field-group--small">
                <label className="add-label" htmlFor="add-copies">
                  Total Copies <span className="add-required">*</span>
                </label>
                <input
                  id="add-copies"
                  type="number"
                  min="1"
                  className="add-input"
                  value={totalCopies}
                  onChange={(e) => setTotalCopies(Number(e.target.value) || 1)}
                  required
                  disabled={addingBook}
                />
              </div>

              <div className="add-field-group" style={{ flex: 1, justifyContent: "flex-end", paddingBottom: "0.55rem" }}>
                <label className="add-checkbox-row">
                  <input
                    type="checkbox"
                    checked={isNewArrival}
                    onChange={(e) => setIsNewArrival(e.target.checked)}
                    disabled={addingBook}
                  />
                  <span className="add-checkbox-label">Mark as New Arrival</span>
                  {isNewArrival && (
                    <span className="add-new-arrival-badge">
                      <SparkleIcon /> New
                    </span>
                  )}
                </label>
              </div>
            </div>

          </div>{/* /add-form-fields */}
        </div>{/* /add-form-body */}

        {/* ── Footer ── */}
        <div className="add-form-footer">
          <button
            className="add-btn-primary"
            type="submit"
            disabled={addingBook}
          >
            {addingBook ? "Adding…" : "Add / Update Book"}
          </button>
        </div>

      </form>
    </section>
  );
}