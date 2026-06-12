import { useEffect, useMemo, useRef, useState } from "react";
import "./AdminDashboardPage.css";
import AdminReservationsPage from "./AdminReservationsPage";
import WalkInPage from "./WalkInPage";
import AdminReportsPage from "./AdminReportsPage";
import StudentDetailsPage from "./StudentDetailsPage";

import ConfirmModal from "../components/ConfirmModal";
import ProfileSidebar from "../components/ProfileSidebar";
import BooksCatalogue from "../components/BooksCatalogue";
import AddBookForm from "../components/AddBookForm";
import TopBar from "../components/TopBar";

import { apiRequest, SERVER_ORIGIN } from "../api";
import { DEPARTMENTS } from "../constants";

/* =========================================
   ADMIN DASHBOARD PAGE
========================================= */
export default function AdminDashboardPage({ user, onUserUpdated, onLogoutClick, setToast }) {
  const [books, setBooks] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [loadingBooks, setLoadingBooks] = useState(false);

  const [showProfile, setShowProfile] = useState(false);
  const [showAdminReservationsPage, setShowAdminReservationsPage] = useState(false);
  const [showWalkInPage, setShowWalkInPage] = useState(false);
  // FIX: tracks whether "New Walk-In" was clicked so WalkInPage opens the form immediately
  const [walkInAutoOpen, setWalkInAutoOpen] = useState(false);
  const [showAdminReportsPage, setShowAdminReportsPage] = useState(false);
  const [showStudentDetailsPage, setShowStudentDetailsPage] = useState(false);
  useEffect(() => {
    const handlePopState = () => {
      setShowProfile(false);
      setShowStudentDetailsPage(false);
      setShowAdminReservationsPage(false);
      setShowWalkInPage(false);
      setShowAdminReportsPage(false);
      setWalkInAutoOpen(false);
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);
  const addBookRef = useRef(null);
  const catalogueRef = useRef(null);

  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [department, setDepartment] = useState(DEPARTMENTS[0] || "");
  const [courseCode, setCourseCode] = useState("");
  const [location, setLocation] = useState("Main Shelf");
  const [coverImage, setCoverImage] = useState("");
  const [publishedYear, setPublishedYear] = useState("");
  const [coverImageFile, setCoverImageFile] = useState(null);
  const [coverImagePreview, setCoverImagePreview] = useState("");
  const [totalCopies, setTotalCopies] = useState(1);
  const [isNewArrival, setIsNewArrival] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState("all");

  const [addingBook, setAddingBook] = useState(false);
  const [editingBookId, setEditingBookId] = useState("");

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletingBook, setDeletingBook] = useState(false);

  useEffect(() => {
    return () => {
      if (coverImagePreview) {
        URL.revokeObjectURL(coverImagePreview);
      }
    };
  }, [coverImagePreview]);

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

  const loadReservations = async () => {
    try {
      const data = await apiRequest("/reservations");
      setReservations(data.reservations || []);
    } catch (err) {
      setToast({ type: "error", message: err.message });
    }
  };

  useEffect(() => {
    loadBooks();
    loadReservations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAddBook = async (e) => {
    e.preventDefault();

    if (!department) {
      setToast({ type: "error", message: "Please select a department first" });
      return;
    }

    setAddingBook(true);

    try {
      const formData = new FormData();
      formData.append("title", title);
      formData.append("author", author);
      formData.append("department", department);
      formData.append("courseCode", courseCode);
      formData.append("location", location);
      formData.append("coverImage", coverImage || "");
      formData.append("publishedYear", publishedYear !== "" ? String(publishedYear) : "");
      formData.append("totalCopies", String(totalCopies));
      formData.append("isNewArrival", String(isNewArrival));

      if (coverImageFile) {
        formData.append("image", coverImageFile);
      }

      const data = await apiRequest("/books", {
        method: "POST",
        body: formData,
      });

      setBooks((prev) => {
        const exists = prev.some((b) => b._id === data.book._id);
        if (exists) {
          return prev.map((b) => (b._id === data.book._id ? data.book : b));
        }
        return [data.book, ...prev];
      });

      setTitle("");
      setAuthor("");
      setDepartment(DEPARTMENTS[0] || "");
      setCourseCode("");
      setLocation("Main Shelf");
      setCoverImage("");
      setPublishedYear("");
      setCoverImageFile(null);

      if (coverImagePreview) {
        URL.revokeObjectURL(coverImagePreview);
      }

      setCoverImagePreview("");
      setTotalCopies(1);
      setIsNewArrival(false);

      setToast({
        type: "success",
        message: data.message || "Book saved successfully",
      });
    } catch (err) {
      setToast({ type: "error", message: err.message || "Failed to add book" });
    } finally {
      setAddingBook(false);
    }
  };

  const handleUpdateCopies = async (bookId, action) => {
    try {
      const data = await apiRequest(`/books/${bookId}/copies`, {
        method: "PUT",
        body: JSON.stringify({ action }),
      });
      setToast({
        type: "success",
        message: data.message || "Book copies updated",
      });
      await loadBooks();
    } catch (err) {
      setToast({ type: "error", message: err.message });
    }
  };

  const handleEditBook = async (bookId, updatedBook, imageFile = null) => {
    setEditingBookId(bookId);

    try {
      const formData = new FormData();
      formData.append("title", updatedBook.title || "");
      formData.append("author", updatedBook.author || "");
      formData.append("department", updatedBook.department || "");
      formData.append("courseCode", updatedBook.courseCode || "");
      formData.append("location", updatedBook.location || "");
      formData.append("coverImage", updatedBook.coverImage || "");
      formData.append(
        "publishedYear",
        updatedBook.publishedYear !== undefined &&
          updatedBook.publishedYear !== null &&
          updatedBook.publishedYear !== ""
          ? String(updatedBook.publishedYear)
          : ""
      );
      formData.append("totalCopies", String(updatedBook.totalCopies || 1));
      formData.append("isNewArrival", String(!!updatedBook.isNewArrival));

      if (imageFile) {
        formData.append("image", imageFile);
      }

      const data = await apiRequest(`/books/${bookId}`, {
        method: "PUT",
        body: formData,
      });

      setBooks((prev) =>
        prev.map((book) => (book._id === bookId ? data.book : book))
      );
      setToast({
        type: "success",
        message: data.message || "Book updated successfully",
      });
      return true;
    } catch (err) {
      setToast({ type: "error", message: err.message || "Failed to update book" });
      return false;
    } finally {
      setEditingBookId("");
    }
  };

  const handleDeleteBook = (book) => {
    setDeleteTarget(book);
  };

  const confirmDeleteBook = async () => {
    if (!deleteTarget) return;

    try {
      setDeletingBook(true);

      const data = await apiRequest(`/books/${deleteTarget._id}`, {
        method: "DELETE",
      });

      setToast({
        type: "success",
        message: data.message || "Book deleted successfully",
      });
      setDeleteTarget(null);
      await loadBooks();
    } catch (err) {
      setToast({ type: "error", message: err.message });
    } finally {
      setDeletingBook(false);
    }
  };

  const cancelDeleteBook = () => {
    if (deletingBook) return;
    setDeleteTarget(null);
  };

  const filteredBooks = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();

    if (!q) {
      if (filterType === "new") {
        return books.filter((book) => book.isNewArrival);
      }

      return books;
    }

    return books.filter((book) => {
      const title = book.title?.toLowerCase() || "";
      const author = book.author?.toLowerCase() || "";
      const department = book.department?.toLowerCase() || "";
      const courseCode = book.courseCode?.toLowerCase() || "";

      if (filterType === "department") {
        return department.includes(q);
      }

      if (filterType === "author") {
        return author.includes(q);
      }

      if (filterType === "new") {
        return (
          book.isNewArrival &&
          (
            title.includes(q) ||
            author.includes(q)
          )
        );
      }

      return (
        title.includes(q) ||
        author.includes(q) ||
        department.includes(q) ||
        courseCode.includes(q)
      );
    });
  }, [books, searchTerm, filterType]);

  const previewImageSrc = coverImagePreview
    ? coverImagePreview
    : coverImage?.trim()
      ? coverImage.trim().startsWith("/uploads/")
        ? `${SERVER_ORIGIN}${coverImage.trim()}`
        : coverImage.trim()
      : "";

  // ── Student Details Page ──────────────────────────────────────────────────
  if (showStudentDetailsPage) {
    return (
      <>
        <StudentDetailsPage
          user={user}
          onBack={() => setShowStudentDetailsPage(false)}
          onLogoutClick={onLogoutClick}
          setToast={setToast}
        />

        <ProfileSidebar
          open={showProfile}
          onClose={() => setShowProfile(false)}
          user={user}
          onProfileUpdated={onUserUpdated}
          onLogoutClick={onLogoutClick}
          setToast={setToast}
        />

        <ConfirmModal
          open={!!deleteTarget}
          title="Delete Book"
          message={`Are you sure you want to permanently delete ${deleteTarget?.title || "this book"
            }?`}
          subtext="This action cannot be undone. If the book has active pre-bookings, deletion will be blocked."
          confirmText="Delete Book"
          confirmVariant="danger"
          loading={deletingBook}
          onCancel={cancelDeleteBook}
          onConfirm={confirmDeleteBook}
        />
      </>
    );
  }

  // ── Admin Reservations Page ───────────────────────────────────────────────
  if (showAdminReservationsPage) {
    return (
      <>
        <AdminReservationsPage
          reservations={reservations}
          onBack={() => setShowAdminReservationsPage(false)}
          refreshReservations={loadReservations}
          refreshBooks={loadBooks}
          setToast={setToast}
        />

        <ProfileSidebar
          open={showProfile}
          onClose={() => setShowProfile(false)}
          user={user}
          onProfileUpdated={onUserUpdated}
          onLogoutClick={onLogoutClick}
          setToast={setToast}
        />

        <ConfirmModal
          open={!!deleteTarget}
          title="Delete Book"
          message={`Are you sure you want to permanently delete ${deleteTarget?.title || "this book"
            }?`}
          subtext="This action cannot be undone. If the book has active pre-bookings, deletion will be blocked."
          confirmText="Delete Book"
          confirmVariant="danger"
          loading={deletingBook}
          onCancel={cancelDeleteBook}
          onConfirm={confirmDeleteBook}
        />
      </>
    );
  }

  // ── Walk-In Page ──────────────────────────────────────────────────────────
  if (showWalkInPage) {
    return (
      <>
        <WalkInPage
          user={user}
          reservations={reservations}
          books={books}
          refreshReservations={loadReservations}
          refreshBooks={loadBooks}
          onBack={() => {
            setShowWalkInPage(false);
            setWalkInAutoOpen(false);
          }}
          onLogoutClick={onLogoutClick}
          setToast={setToast}
          autoOpenForm={walkInAutoOpen}
        />

        <ProfileSidebar
          open={showProfile}
          onClose={() => setShowProfile(false)}
          user={user}
          onProfileUpdated={onUserUpdated}
          onLogoutClick={onLogoutClick}
          setToast={setToast}
        />

        <ConfirmModal
          open={!!deleteTarget}
          title="Delete Book"
          message={`Are you sure you want to permanently delete ${deleteTarget?.title || "this book"
            }?`}
          subtext="This action cannot be undone. If the book has active pre-bookings, deletion will be blocked."
          confirmText="Delete Book"
          confirmVariant="danger"
          loading={deletingBook}
          onCancel={cancelDeleteBook}
          onConfirm={confirmDeleteBook}
        />
      </>
    );
  }

  // ── Admin Reports Page ────────────────────────────────────────────────────
  if (showAdminReportsPage) {
    return (
      <>
        <AdminReportsPage
          user={user}
          onBack={() => setShowAdminReportsPage(false)}
          onLogoutClick={onLogoutClick}
          setToast={setToast}
        />

        <ProfileSidebar
          open={showProfile}
          onClose={() => setShowProfile(false)}
          user={user}
          onProfileUpdated={onUserUpdated}
          onLogoutClick={onLogoutClick}
          setToast={setToast}
        />

        <ConfirmModal
          open={!!deleteTarget}
          title="Delete Book"
          message={`Are you sure you want to permanently delete ${deleteTarget?.title || "this book"}?`}
          subtext="This action cannot be undone. If the book has active pre-bookings, deletion will be blocked."
          confirmText="Delete Book"
          confirmVariant="danger"
          loading={deletingBook}
          onCancel={cancelDeleteBook}
          onConfirm={confirmDeleteBook}
        />
      </>
    );
  }

  // ── Admin Dashboard (default) ─────────────────────────────────────────────
  return (
    <div className="page-shell">
      <TopBar
        title="Admin Dashboard"
        subtitle="Manage inventory, pre-bookings, due dates, and student activity."
        reservationButtonText="Pre-Booking Management"
        onReservationsClick={() => setShowAdminReservationsPage(true)}
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
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        filterType={filterType}
        onFilterTypeChange={setFilterType}
        quickActions={[
          {
            label: "Add Book",
            onClick: () =>
              addBookRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              }),
          },
          {
            label: "Pre-Bookings and Checkouts",
            onClick: () => {
              window.history.pushState(
                { page: "reservations" },
                "",
                "#reservations"
              );
              setShowAdminReservationsPage(true);
            },
          },
          {
            label: "Students",
            onClick: () => {
              window.history.pushState(
                { page: "students" },
                "",
                "#students"
              );
              setShowStudentDetailsPage(true);
            },
          },
          {
            label: "Reports",
            onClick: () => {
              window.history.pushState(
                { page: "reports" },
                "",
                "#reports"
              );
              setShowAdminReportsPage(true);
            },
          },
          {
            label: "Walk-In Checkouts",
            // Opens WalkInPage in list view (no form)
            onClick: () => {
              window.history.pushState(
                { page: "walkin" },
                "",
                "#walkin"
              );
              setShowWalkInPage(true);
            },
          },
          {
            label: "New Walk-In",
            // FIX: sets walkInAutoOpen=true so WalkInPage opens its form on mount
            onClick: () => {
              window.history.pushState(
                { page: "new-walkin" },
                "",
                "#new-walkin"
              );

              setWalkInAutoOpen(true);
              setShowWalkInPage(true);
            },
          },
        ]}
      />

      <AddBookForm
        addBookRef={addBookRef}
        handleAddBook={handleAddBook}
        department={department}
        setDepartment={setDepartment}
        title={title}
        setTitle={setTitle}
        author={author}
        setAuthor={setAuthor}
        courseCode={courseCode}
        setCourseCode={setCourseCode}
        location={location}
        setLocation={setLocation}
        publishedYear={publishedYear}
        setPublishedYear={setPublishedYear}
        coverImage={coverImage}
        setCoverImage={setCoverImage}
        coverImagePreview={coverImagePreview}
        setCoverImageFile={setCoverImageFile}
        setCoverImagePreview={setCoverImagePreview}
        totalCopies={totalCopies}
        setTotalCopies={setTotalCopies}
        isNewArrival={isNewArrival}
        setIsNewArrival={setIsNewArrival}
        previewImageSrc={previewImageSrc}
        addingBook={addingBook}
      />

      <div ref={catalogueRef}>
        <BooksCatalogue
          title="Books Catalogue"
          books={filteredBooks}
          loading={loadingBooks}
          userRole="admin"
          onUpdateCopies={handleUpdateCopies}
          onDeleteBook={handleDeleteBook}
          onEditBook={handleEditBook}
          editingBookId={editingBookId}
          variant="na"
        />
      </div>

      <ProfileSidebar
        open={showProfile}
        onClose={() => setShowProfile(false)}
        user={user}
        onProfileUpdated={onUserUpdated}
        onLogoutClick={onLogoutClick}
        setToast={setToast}
      />

      <ConfirmModal
        open={!!deleteTarget}
        title="Delete Book"
        message={`Are you sure you want to permanently delete ${deleteTarget?.title || "this book"
          }?`}
        subtext="This action cannot be undone. If the book has active pre-bookings, deletion will be blocked."
        confirmText="Delete Book"
        confirmVariant="danger"
        loading={deletingBook}
        onCancel={cancelDeleteBook}
        onConfirm={confirmDeleteBook}
      />
    </div>
  );
}