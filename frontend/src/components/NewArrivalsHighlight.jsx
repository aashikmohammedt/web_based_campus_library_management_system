import { useEffect, useRef, useState, useCallback } from "react";
import { BookOpen, ChevronLeft, ChevronRight } from "lucide-react";
import ConfirmModal from "./ConfirmModal";
import "../pages/StudentDashboardPage.css";

const NUM_DOTS  = 4;
const SLIDE_MS  = 350;
const EASING    = "cubic-bezier(0.25, 0.46, 0.45, 0.94)";

/*
  Infinite carousel — pure CSS-transform, NO clones.

  The trick: we render the real list THREE times side by side:
    [ copy A | copy B | copy C ]
  We always keep the user inside copy B (the middle).
  When they reach the edge of copy B we do an INSTANT (no-animation)
  jump to the same visual position inside copy B from copy A or C,
  then continue animating normally. Because all three copies are
  pixel-identical the jump is invisible.

  cardW  = width of one card + gap (measured from DOM)
  sw     = width of one full copy  = cardW * N
  We start at scrollX = sw (left edge of copy B).
  After each animated slide we check: if pos < sw or pos >= 2*sw,
  we silently shift by ±sw to re-center inside copy B.
*/
export default function NewArrivalsHighlight({ books = [], onReserve, activeReservations = [] }) {

  const arrivals = books.filter((b) => b.isNewArrival);
  const N = arrivals.length;
  /* Triple the list so copy A | copy B | copy C exist in the DOM */
  const display = N > 0 ? [...arrivals, ...arrivals, ...arrivals] : [];

  /* ── Refs ─────────────────────────────────────────────────── */
  const trackRef  = useRef(null);
  const posRef    = useRef(0);   /* current translateX magnitude (positive = shifted left) */
  const cardWRef  = useRef(0);
  const swRef     = useRef(0);   /* width of one copy */
  const lockedRef = useRef(false);

  /* ── State ───────────────────────────────────────────────── */
  const [activeDot,      setActiveDot]      = useState(0);
  const [pendingBook,    setPendingBook]     = useState(null);
  const [confirmOpen,    setConfirmOpen]     = useState(false);
  const [confirmLoading, setConfirmLoading]  = useState(false);
  const [serverBlocked,  setServerBlocked]   = useState({});

  /* ── Helpers ─────────────────────────────────────────────── */
  const applyPos = (pos, animate) => {
    const el = trackRef.current;
    if (!el) return;
    el.style.transition = animate ? `transform ${SLIDE_MS}ms ${EASING}` : "none";
    el.style.transform  = `translateX(${-pos}px)`;
  };

  /* Re-center inside copy B if we've drifted into copy A or C */
  const recenter = (pos) => {
    const sw = swRef.current;
    if (!sw) return pos;
    if (pos < sw)      return pos + sw;
    if (pos >= 2 * sw) return pos - sw;
    return pos;
  };

  /* Update dot from absolute pos */
  const syncDot = (pos) => {
    const cardW = cardWRef.current;
    if (!cardW) return;
    const sw = swRef.current;
    /* Offset within copy B */
    const offset = pos - sw;
    const cardIdx = Math.round(offset / cardW);
    const dot = ((cardIdx % NUM_DOTS) + NUM_DOTS) % NUM_DOTS;
    setActiveDot(dot);
  };

  /* ── Measure & park at start of copy B ──────────────────── */
  const measure = useCallback(() => {
    const el = trackRef.current;
    if (!el || !el.children[0]) return;
    const gap  = parseFloat(getComputedStyle(el).gap) || 16;
    const cardW = el.children[0].offsetWidth + gap;
    cardWRef.current = cardW;
    swRef.current    = cardW * N;

    /* Park at copy B start — instant, no animation */
    const sw = swRef.current;
    posRef.current = sw;
    applyPos(sw, false);
  }, [N]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  /* ── Slide one card in direction (+1 right, -1 left) ──────── */
  const slide = useCallback((dir) => {
    if (lockedRef.current || cardWRef.current === 0) return;
    lockedRef.current = true;

    const cardW = cardWRef.current;
    const sw    = swRef.current;

    /* Target position before re-centering */
    let target = posRef.current + dir * cardW;

    /* If target would go outside copy B, silently jump first */
    const needsJump = target < sw || target >= 2 * sw;
    if (needsJump) {
      /* Jump to equivalent position inside copy B instantly */
      const jumpedFrom = target < sw ? target + sw : target - sw;
      posRef.current = jumpedFrom;
      applyPos(jumpedFrom, false);

      /* Force a reflow so the browser registers the instant jump
         before we kick off the smooth animation */
      trackRef.current?.getBoundingClientRect();

      /* Now animate from the jumped position to the real target inside copy B */
      target = jumpedFrom + dir * cardW;

      /* target should now be inside copy B — double-check */
      if (target < sw)      target += sw;
      if (target >= 2 * sw) target -= sw;
    }

    /* Animate to target */
    applyPos(target, true);
    posRef.current = target;
    syncDot(target);

    /* Unlock after animation */
    const onEnd = () => {
      trackRef.current?.removeEventListener("transitionend", onEnd);
      lockedRef.current = false;
    };
    trackRef.current?.addEventListener("transitionend", onEnd);

    /* Safety unlock fallback */
    setTimeout(() => {
      if (lockedRef.current) {
        trackRef.current?.removeEventListener("transitionend", onEnd);
        lockedRef.current = false;
      }
    }, SLIDE_MS + 300);

  }, [N]); // eslint-disable-line react-hooks/exhaustive-deps

  const goRight = useCallback(() => slide(1),  [slide]);
  const goLeft  = useCallback(() => slide(-1), [slide]);

  /* ── Reservation helpers ─────────────────────────────────── */
  const getReservationStatus = (bookId) => {
    if (!bookId) return null;
    if (serverBlocked[bookId]) return serverBlocked[bookId];
    const found = activeReservations.find((r) => {
      const rBookId = r.book?._id ?? r.book;
      return String(rBookId) === String(bookId);
    });
    return found?.status ?? null;
  };

  const handlePreBook = (e, book) => {
    e.stopPropagation();
    const status = getReservationStatus(book._id);
    if (status === "reserved" || status === "collected") return;
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
      await onReserve(pendingBook);
    } catch (err) {
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

  const handleCancel = () => {
    setConfirmOpen(false);
    setPendingBook(null);
  };

  if (N === 0) return null;

  /* ── Render ──────────────────────────────────────────────── */
  return (
    <section className="na-section">

      <div className="na-header">
        <h2 className="na-title">New Arrivals</h2>
        <span className="na-badge">✦ New</span>
      </div>

      <div
        className="na-slider-wrapper"
        style={{
          background: "none",
          border: "none",
          boxShadow: "none",
          display: "flex",
          alignItems: "center",
          overflow: "visible",
        }}
      >
        <button className="na-arrow" onClick={goLeft} aria-label="Scroll left">
          <ChevronLeft size={18} strokeWidth={2.5} />
        </button>

        {/* Clipping viewport between the arrows */}
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          {/* Track — 3× wide, moved by transform */}
          <div
            ref={trackRef}
            style={{
              display: "flex",
              flexWrap: "nowrap",
              gap: "16px",
              willChange: "transform",
              /* transform set imperatively after mount */
            }}
          >
            {display.map((book, idx) => {
              const available          = (book.availableCopies ?? 0) > 0;
              const status             = getReservationStatus(book._id);
              const isBlockedCollected = status === "collected";
              const isBlockedReserved  = status === "reserved";
              const isBlocked          = isBlockedCollected || isBlockedReserved;
              const btnLabel = isBlockedCollected ? "Already Checked Out"
                             : isBlockedReserved  ? "Already Pre-Booked"
                             : available          ? "Pre-Book"
                             :                      "Pre-Book";
              return (
                <div
                  className="na-card na-card--clickable"
                  key={`${book._id}-${idx}`}
                  style={{ flexShrink: 0, background: "none", boxShadow: "none" }}
                >
                  <div className="na-cover">
                    {book.coverImage ? (
                      <img src={book.coverImage} alt={`Cover of ${book.title}`} />
                    ) : (
                      <div className="na-cover-placeholder">
                        <BookOpen size={34} />
                        <span>{book.title?.slice(0, 2).toUpperCase() ?? "BK"}</span>
                      </div>
                    )}
                  </div>
                  <div className="na-info">
                    <p className="na-book-title">{book.title}</p>
                    <p className="na-book-author">{book.author}</p>
                    {book.edition && <p className="na-book-edition">{book.edition}</p>}
                    <button
                      className="na-catalogue-prebook-btn"
                      type="button"
                      disabled={isBlocked}
                      onClick={isBlocked ? undefined : (e) => handlePreBook(e, book)}
                      style={isBlocked ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
                    >
                      {btnLabel}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <button className="na-arrow" onClick={goRight} aria-label="Scroll right">
          <ChevronRight size={18} strokeWidth={2.5} />
        </button>
      </div>

      <div className="na-dots" role="tablist" aria-label="New arrivals navigation">
        {Array.from({ length: NUM_DOTS }).map((_, idx) => (
          <button
            key={idx}
            role="tab"
            aria-selected={idx === activeDot}
            aria-label={`Section ${idx + 1}`}
            className={`na-dot${idx === activeDot ? " na-dot--active" : ""}`}
          />
        ))}
      </div>

      <ConfirmModal
        open={confirmOpen}
        book={pendingBook}
        loading={confirmLoading}
        onCancel={handleCancel}
        onConfirm={handleConfirm}
      />

    </section>
  );
}