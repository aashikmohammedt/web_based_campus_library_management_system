require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const ExcelJS = require("exceljs");


const app = express();
const {
  sendManualPrebookReminderEmail,
  sendPrebookConfirmationEmail,
  sendPrebook12HourReminderEmail,
  sendPrebook20HourReminderEmail,
  sendPrebookExpiredEmail,
  sendDue10DayReminderEmail,
  sendDue5DayReminderEmail,
  sendDue2DayReminderEmail,
  sendDue1DayReminderEmail,
  sendDueTodayReminderEmail,
  sendOverdueReminderEmail,
  sendManualCollectedReminderEmail,
} = require("./mailer");

/* =========================================
   FILE UPLOADS (BOOK IMAGES + PROFILE IMAGES)
========================================= */
const uploadsDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname
      .replace(/\s+/g, "_")
      .replace(/[^\w.\-]/g, "");
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  },
});

const importUpload = multer({
  dest: "uploads/",
  fileFilter: (req, file, cb) => {
    const isJson =
      file.mimetype === "application/json" ||
      file.originalname.toLowerCase().endsWith(".json");
    if (isJson) {
      cb(null, true);
    } else {
      cb(new Error("Only JSON files are allowed"));
    }
  },
});

/* =========================================
   CONFIG
========================================= */
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const MONGO_URI =
  process.env.MONGO_URI || "mongodb://127.0.0.1:27017/campus_library";
// Base URL used to convert stored relative image paths into absolute URLs
// the frontend can load across ports. Set BASE_URL in .env for production.
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

const OVERDUE_FINE_PER_DAY = 20;
const BOOK_DAMAGE_FINE = 100;
const BOOK_LOST_FINE = 500;

// Pre-book expiry: a "reserved" book not collected within 24 hours is auto-expired
const PRE_BOOK_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

/*
 * ─── RESERVATION STATUS MACHINE ─────────────────────────────────────────────
 *
 *   [Student pre-books]
 *          │
 *          ▼
 *      "reserved" ──(admin: collect)──► "collected" ──(admin/student: return)──► "returned"
 *          │                                 │
 *          │ (24 h window missed — auto)      │ (admin marks damage)
 *          ▼                                 ▼
 *      "expired"                         "damaged"  ← status is single source of truth
 *          │                                 │
 *          │ (student or admin cancels)       │ (admin marks lost)
 *          ▼                                 ▼
 *      "cancelled"                        "lost"     ← lostFinePaid
 *
 *  Status       Stored?  Who sets it       Meaning
 *  ─────────── ──────── ────────────────── ──────────────────────────────────────
 *  reserved     ✓        system             Pre-booked; awaiting physical pickup
 *  collected    ✓        admin              Student has the physical book
 *  returned     ✓        admin / student    Book back on shelf (clean return)
 *  damaged      ✓        admin              Book returned in damaged state; fine settled
 *  lost         ✓        admin              Book confirmed lost; fine settled
 *  cancelled    ✓        admin / student    Deliberate manual cancellation
 *  expired      ✓        system (auto)      24-h pickup window was missed
 *  overdue      ✗ virtual  computed          collected + dueDate < now  (display only)
 *
 *  Rules enforced throughout this file:
 *   • NEVER use "cancelled" for auto-expiry — use "expired"
 *   • NEVER use "expired"   for manual cancellation — use "cancelled"
 *   • NEVER use "returned"  for lost books — use "lost"
 *   • NEVER use "returned"  for damaged books — use "damaged"
 *   • ACTIVE_STATUSES   = the only states where the book is still "out"
 *   • TERMINAL_STATUSES = the book is no longer in active circulation
 * ────────────────────────────────────────────────────────────────────────────
 */

// Single source of truth — used everywhere instead of inline arrays
const ACTIVE_STATUSES = Object.freeze(["reserved", "collected"]);
const TERMINAL_STATUSES = Object.freeze([
  "returned",
  "damaged",
  "lost",
  "cancelled",
  "expired",
]);

/**
 * activeDuplicateFilter()
 *
 * Returns a Mongoose filter fragment that matches ONLY records that should
 * block a duplicate checkout/pre-book for the SAME (student + book) pair.
 *
 * ── Rule ──────────────────────────────────────────────────────────────────
 *  Block  : SAME student + SAME book + ACTIVE record exists
 *  Allow  : DIFFERENT student + SAME book  (multiple students may hold same book
 *            concurrently, subject to availableCopies — checked separately)
 *  Allow  : SAME student + SAME book + only TERMINAL/resolved records exist
 *
 * ── Active states that block re-booking ───────────────────────────────────
 *  "reserved"   — student pre-booked, awaiting physical pickup
 *  "collected"  — student has the physical book; covers ALL of:
 *                   • on-time collected (normal checkout)
 *                   • overdue           (virtual display state — DB still "collected")
 *                   • active walk-in checkouts (isWalkIn=true, status="collected")
 *
 * ── Terminal/resolved states that DO NOT block re-booking ─────────────────
 *  "returned"         — book physically returned to shelf (clean return)
 *  "damaged"          — dedicated terminal damaged-book status; fine settled
 *  "lost"             — dedicated terminal lost-book status; fine settled
 *  "cancelled"        — deliberately cancelled (student or admin)
 *  "expired"          — 24-h pickup window missed (auto-system)
 *
 * Usage (always pass BOTH user and book alongside this filter):
 *   await Reservation.findOne({ user: userId, book: bookId, ...activeDuplicateFilter() })
 */
function activeDuplicateFilter() {
  return {
    // Only "reserved" and "collected" are active. Every terminal state
    // (returned, damaged, lost, cancelled, expired) is intentionally excluded so previous
    // closed records never block a fresh pre-book or checkout.
    status: { $in: ["reserved", "collected"] },
  };
}

/* ── isLostRecord(r) / isDamagedRecord(r) ───────────────────────────────────
 *
 * The ONLY place where legacy isBookLost / isBookDamaged flags are read in
 * business logic. All call sites must use these helpers — never access the
 * flags directly outside of schema definitions and serializer passthrough.
 *
 * Modern records: status is the single source of truth.
 * Legacy records: isBookLost / isBookDamaged are read-only compatibility fallbacks
 *                 for old DB records written before status was authoritative.
 *
 * @param {Object} r  A plain Reservation object or Mongoose document.
 * @returns {boolean}
 */
function isLostRecord(r) {
  return (
    r?.status === "lost" ||
    r?.isBookLost === true
  );
}

function isDamagedRecord(r) {
  return (
    r?.status === "damaged" ||
    r?.isBookDamaged === true
  );
}

/* ── Inventory helpers ──────────────────────────────────────────────────────
 *
 * Centralized, bounds-checked wrappers for every availableCopies mutation.
 * ALL reservation flows MUST use these helpers — never touch availableCopies
 * directly inside route handlers.
 *
 * Rules enforced:
 *   • availableCopies is ALWAYS clamped to [0, totalCopies]
 *   • Every mutation is atomic (findByIdAndUpdate) so concurrent requests
 *     cannot push the count out of bounds
 *   • Lost books NEVER call incrementAvailableCopiesSafely —
 *     the copy is permanently gone; there is nothing to restore
 *
 * @param {string|ObjectId} bookId  The Book document _id
 * @returns {Promise<Object|null>}  The updated Book doc, or null on not-found
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Atomically increments availableCopies by 1, clamped to totalCopies.
 *
 * Use for:  return, cancel (reserved or collected), expired pre-book, damage
 * Never use for: lost (copy is gone — do NOT restore stock)
 *
 * Two-step atomic pattern prevents concurrent double-increments from pushing
 * availableCopies above totalCopies (e.g. admin double-clicks Return).
 */
async function incrementAvailableCopiesSafely(bookId) {
  if (!bookId) return null;

  // Step 1: increment by 1 atomically
  const afterIncrement = await Book.findByIdAndUpdate(
    bookId,
    { $inc: { availableCopies: 1 } },
    { new: true }
  );

  if (!afterIncrement) return null;

  // Step 2: clamp to totalCopies if the increment overshot the ceiling
  if (afterIncrement.availableCopies > afterIncrement.totalCopies) {
    return Book.findByIdAndUpdate(
      bookId,
      { $set: { availableCopies: afterIncrement.totalCopies } },
      { new: true }
    );
  }

  return afterIncrement;
}

/**
 * Atomically decrements availableCopies by 1, clamped to 0.
 *
 * Use for:  pre-book creation, walk-in checkout
 * The floor clamp prevents negative stock from a concurrent race.
 */
async function decrementAvailableCopiesSafely(bookId) {
  if (!bookId) return null;

  // Step 1: decrement by 1 atomically
  const afterDecrement = await Book.findByIdAndUpdate(
    bookId,
    { $inc: { availableCopies: -1 } },
    { new: true }
  );

  if (!afterDecrement) return null;

  // Step 2: clamp to 0 if the decrement undershot the floor
  if (afterDecrement.availableCopies < 0) {
    return Book.findByIdAndUpdate(
      bookId,
      { $set: { availableCopies: 0 } },
      { new: true }
    );
  }

  return afterDecrement;
}

const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

/* =========================================
   MIDDLEWARE
========================================= */
app.use(express.json());
app.use("/uploads", express.static(uploadsDir));



/* =========================================
   SCHEMAS
========================================= */
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["student", "admin"], default: "student" },
    profileImage: { type: String, default: "", trim: true },
    studentId: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

const bookSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    author: { type: String, required: true, trim: true },
    department: { type: String, default: "General", trim: true },
    courseCode: { type: String, default: "", trim: true },
    location: { type: String, default: "Shelf", trim: true },
    coverImage: { type: String, default: "", trim: true },
    publishedYear: { type: Number, default: null },
    totalCopies: { type: Number, default: 1, min: 1 },
    availableCopies: { type: Number, default: 1, min: 0 },
    isNewArrival: { type: Boolean, default: false },
  },
  { timestamps: true }
);
const reservationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    book: { type: mongoose.Schema.Types.ObjectId, ref: "Book", required: true },
    status: {
      type: String,
      enum: ["reserved", "collected", "returned", "damaged", "lost", "cancelled", "expired"],
      default: "reserved",
    },
    reservedAt: { type: Date, default: null },
    dueDate: {
      type: Date,
      default: () => {
        const now = new Date();
        now.setMonth(now.getMonth() + 1);
        now.setHours(17, 0, 0, 0); // fixed 5:00 PM return time
        return now;
      },
    },
    returnedAt: { type: Date, default: null },

    // Fine-related fields
    isBookDamaged: { type: Boolean, default: false },
    damageFine: { type: Number, default: 0, min: 0 },

    isBookLost: { type: Boolean, default: false },
    lostFine: { type: Number, default: 0, min: 0 },

    overduePaid: { type: Boolean, default: false },
    overduePaidAmount: { type: Number, default: 0, min: 0 },
    overduePaidAt: { type: Date, default: null },

    // Fine-payment protection: tracks whether ANY fine (overdue, damage, lost)
    // has been settled. Once true, no further fine payment is accepted.
    finePaid: { type: Boolean, default: false },
    finePaidAt: { type: Date, default: null },

    // Granular payment flags and timestamps — one per fine type so each fine
    // can be validated and settled independently.
    damageFinePaid: { type: Boolean, default: false }, // true once damage fine is settled
    damageFinePaidAt: { type: Date, default: null },   // timestamp of damage fine payment
    lostFinePaid: { type: Boolean, default: false },   // true once lost-book fine is settled
    lostFinePaidAt: { type: Date, default: null },     // timestamp of lost-book fine payment

    // Set by the auto-expiry system when a pre-book is not collected within 24 h
    expiredAt: { type: Date, default: null },
    collectedAt: { type: Date, default: null },
    isWalkIn: { type: Boolean, default: false },

    // ── Email reminder tracking (automated scheduler) ──────────────────────
    // Pre-book lifecycle emails
    prebookConfirmationSent: { type: Boolean, default: false },
    prebook12HourReminderSent: { type: Boolean, default: false },
    prebook20HourReminderSent: { type: Boolean, default: false },
    prebookExpiredMailSent: { type: Boolean, default: false },

    // Due-date / overdue reminder emails
    due10DayReminderSent: { type: Boolean, default: false },
    due5DayReminderSent: { type: Boolean, default: false },
    due2DayReminderSent: { type: Boolean, default: false },
    due1DayReminderSent: { type: Boolean, default: false },
    dueTodayReminderSent: { type: Boolean, default: false },
    lastOverdueReminderSentAt: { type: Date, default: null },
    // ───────────────────────────────────────────────────────────────────────
  },
  { timestamps: true }
);

/* ── Reservation pre-save hook ─────────────────────────────────────────────
 *
 * Legacy compatibility validation only.
 *
 * Normalization writes (isBookLost, isBookDamaged) have been removed.
 * Modern runtime flow now uses `status` as the single source of truth.
 *
 * Legacy flags remain temporarily in the schema ONLY for backward
 * compatibility with older DB records during migration.
 *
 * VALIDATION (reject with error):
 *   • status === "returned" + isBookLost === true
 *       → lost books must never be stored as "returned".
 *
 *   • status === "returned" + isBookDamaged === true
 *       → damaged books must use status="damaged".
 *
 *   • status === "lost" + lostFine === 0
 *       → lost records must always carry a valid fine.
 *
 *   • status === "collected" + damageFinePaid === true
 *       → damage fine cannot be paid while still collected.
 *
 * ─────────────────────────────────────────────────────────────────────────*/
reservationSchema.pre("save", function (next) {
  // Guard 1 (legacy compatibility): lost books must never be stored as "returned".
  if (this.status === "returned" && this.isBookLost === true) {
    return next(
      new Error(
        "Invalid reservation state: a lost book cannot have status 'returned'. " +
        "Use status='lost'."
      )
    );
  }

  // Guard 2 (legacy compatibility): damaged books must use status="damaged".
  if (this.status === "returned" && this.isBookDamaged === true) {
    return next(
      new Error(
        "Invalid reservation state: a damaged book cannot have status 'returned'. " +
        "Use status='damaged'."
      )
    );
  }

  // Guard 3: "lost" status must always carry a non-zero lostFine.
  if (this.status === "lost" && (this.lostFine == null || this.lostFine <= 0)) {
    return next(
      new Error(
        "Invalid reservation state: status 'lost' requires lostFine > 0. " +
        "Set lostFine to BOOK_LOST_FINE before saving."
      )
    );
  }

  next();
});

const User = mongoose.model("User", userSchema);
const Book = mongoose.model("Book", bookSchema);
const Reservation = mongoose.model("Reservation", reservationSchema);

/* =========================================
   HELPERS
========================================= */
function createToken(user) {
  return jwt.sign(
    {
      userId: user._id,
      role: user.role,
      isAdmin: user.role === "admin",   // explicit flag — matches frontend checks
      name: user.name,
      email: user.email,
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;

  if (!token) {
    return res.status(401).json({ message: "Missing authorization token" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}
function isReservationFullySettled(reservation) {
  // Use calculateOverdueDays (which handles active, damaged, and lost statuses)
  // so that an unpaid overdue fine on a damaged/lost book is never skipped.
  const overdueSettled =
    reservation.overduePaid === true ||
    calculateOverdueDays(reservation) <= 0;

  const damageSettled =
    Number(reservation.damageFine || 0) <= 0 ||
    reservation.damageFinePaid === true;

  const lostSettled =
    Number(reservation.lostFine || 0) <= 0 ||
    reservation.lostFinePaid === true;

  return overdueSettled && damageSettled && lostSettled;
}

function getFinalSettlementStatus(reservation) {
  if (reservation.damageFinePaid) {
    return "damaged";
  }

  if (reservation.lostFinePaid) {
    return "lost";
  }

  return reservation.status;
}
function calculateOverdueDays(reservation) {
  if (!reservation) return 0;

  const dueDate = reservation.dueDate ? new Date(reservation.dueDate) : null;
  if (!dueDate || Number.isNaN(dueDate.getTime())) return 0;

  // Active reservations: compare against now.
  if (ACTIVE_STATUSES.includes(reservation.status)) {
    const now = new Date();
    if (dueDate >= now) return 0;
    const msPerDay = 1000 * 60 * 60 * 24;
    return Math.ceil((now.getTime() - dueDate.getTime()) / msPerDay);
  }

  // Damaged: use returnedAt (moment the book was handed back and marked).
  if (reservation.status === "damaged") {
    const markedAt = reservation.returnedAt ? new Date(reservation.returnedAt) : null;
    if (!markedAt || markedAt <= dueDate) return 0;
    const msPerDay = 1000 * 60 * 60 * 24;
    return Math.ceil((markedAt.getTime() - dueDate.getTime()) / msPerDay);
  }

  // Lost: book was never returned so returnedAt is not set.
  // Use finePaidAt if available (fine already settled), otherwise now.
  if (reservation.status === "lost") {
    const boundary = reservation.finePaidAt
      ? new Date(reservation.finePaidAt)
      : new Date();
    if (boundary <= dueDate) return 0;
    const msPerDay = 1000 * 60 * 60 * 24;
    return Math.ceil((boundary.getTime() - dueDate.getTime()) / msPerDay);
  }

  // All other terminal statuses (returned, cancelled, expired) have no overdue.
  return 0;
}

function getDerivedReservationStatus(reservation) {
  if (!reservation) return "unknown";

  // Terminal statuses are already final — return as-is.
  // "returned"  = clean return
  // "damaged"   = dedicated terminal damaged-book status
  // "lost"      = dedicated terminal lost-book status
  // "cancelled" = deliberate cancellation
  // "expired"   = 24-h pickup window missed (auto)
  if (TERMINAL_STATUSES.includes(reservation.status)) {
    return reservation.status;
  }

  // Virtual "overdue" — only for active reservations past their due date.
  const dueDate = reservation.dueDate ? new Date(reservation.dueDate) : null;
  const now = new Date();

  if (dueDate && dueDate < now && ACTIVE_STATUSES.includes(reservation.status)) {
    return "overdue";
  }

  return reservation.status;
}

function getReservationFinancials(reservation) {
  const overdueDays = calculateOverdueDays(reservation);
  // When overdue has been paid, surface the settled amount so it still
  // contributes to the historical totalFine (backend is single source of truth).
  const overdueFine = reservation?.overduePaid
    ? Number(reservation?.overduePaidAmount || 0)
    : overdueDays * OVERDUE_FINE_PER_DAY;
  // Use the values written to the DB when the damage / lost action was taken;
  // fall back to the current constants only if the field is missing (legacy docs).
  const damageFine = Number(reservation?.damageFine || 0);
  const lostFine = Number(reservation?.lostFine || 0);
  const totalFine =
    Number(overdueFine || 0) +
    Number(damageFine || 0) +
    Number(lostFine || 0);

  return {
    overdueDays,
    overdueFine,
    damageFine,
    lostFine,
    totalFine,
  };
}

/* ── 24-hour pre-book expiry helpers ──────────────────────────────────────
   A reservation in "reserved" state is a pre-book. If the student does not
   collect the book within PRE_BOOK_EXPIRY_MS the pre-book is treated as
   expired automatically — no cron job required. The check runs whenever
   reservation data is fetched or acted upon.
   ─────────────────────────────────────────────────────────────────────── */

/**
 * Returns true when a "reserved" pre-book has passed the 24-hour window
 * without being collected.
 */
function isPreBookExpired(reservation) {
  if (!reservation || reservation.status !== "reserved") return false;

  const reservedAt = reservation.reservedAt
    ? new Date(reservation.reservedAt)
    : null;

  if (!reservedAt || Number.isNaN(reservedAt.getTime())) return false;

  return Date.now() - reservedAt.getTime() > PRE_BOOK_EXPIRY_MS;
}

/**
 * Marks a reservation as "expired", records the expiry time in expiredAt,
 * and restores the book's available copy count.
 * Uses an atomic DB transition to avoid double-expiry / double stock increment.
 */
async function autoExpireReservation(reservation) {
  const expiredAt = new Date();

  // Atomic transition: only succeeds when status is still "reserved" in the DB.
  // If two concurrent requests both call this (e.g. two tabs opening the
  // reservations list at the same moment), only the first findOneAndUpdate wins;
  // the second matches 0 docs and skips the book increment entirely.
  // This prevents availableCopies from being incremented more than once per
  // expired pre-book, which would push the count above totalCopies.
  const matched = await Reservation.findOneAndUpdate(
    { _id: reservation._id, status: "reserved" }, // guard: still reserved in DB
    { $set: { status: "expired", expiredAt } },
    { new: false } // returns pre-update doc on match, null on no-match
  );

  if (!matched) {
    // Another concurrent request already expired this reservation — reflect
    // that in the in-memory object and bail without touching availableCopies.
    reservation.status = "expired";
    return;
  }

  // Reflect the committed change in the in-memory Mongoose document
  reservation.status = "expired";
  reservation.expiredAt = expiredAt;

  // Restore exactly one copy to the available pool, clamped to totalCopies
  const bookId = reservation.book?._id || reservation.book;
  if (bookId) {
    await incrementAvailableCopiesSafely(bookId);
  }

  console.log(
    `[AUTO-EXPIRE] Reservation ${reservation._id} expired — ` +
    `pre-book not collected within 24 hours (reservedAt: ${reservation.reservedAt})`
  );
}

/**
 * Scans the entire reservations collection for "reserved" pre-books that have
 * exceeded the 24-hour collection window and expires them in bulk.
 *
 * Uses `createdAt || reservedAt` fallback to determine reservation age:
 *   - `createdAt` is the authoritative Mongoose timestamp (always present).
 *   - `reservedAt` is kept as a fallback for records created before timestamps
 *     were added, or if `createdAt` is somehow missing.
 *
 * Safe to call concurrently — `autoExpireReservation` uses a findOneAndUpdate
 * guard so no reservation is double-expired and no book gets +2 copies.
 *
 * Called at the start of every route that reads or mutates reservation state
 * so the DB is always in a truthful shape before business logic runs.
 */
async function expireStalePreBookings() {
  const cutoff = new Date(Date.now() - PRE_BOOK_EXPIRY_MS);

  // Match reserved rows whose age exceeds the cutoff on either timestamp field.
  const stale = await Reservation.find({
    status: "reserved",
    $or: [
      { createdAt: { $exists: true, $lt: cutoff } },
      {
        createdAt: { $exists: false },
        reservedAt: { $lt: cutoff },
      },
    ],
  }).populate("book");

  for (const reservation of stale) {
    await autoExpireReservation(reservation);
  }
}

function serializeReservation(reservation) {
  const obj =
    typeof reservation.toObject === "function"
      ? reservation.toObject()
      : { ...reservation };

  const financials = getReservationFinancials(obj);

  return {
    ...obj,
    derivedStatus: getDerivedReservationStatus(obj),
    ...financials,

    // ── Date field rules enforced for ALL students / all routes ───────────────

    // Walk-in checkouts never go through a pre-book step — reservedAt is always
    // null for them. Enforce this explicitly so no client ever receives a
    // non-null reservedAt for a walk-in record, regardless of DB state.
    reservedAt: obj.isWalkIn ? null : (obj.reservedAt || null),

    // Lost books are never physically returned — strip returnedAt even if old
    // DB data has it (covers legacy records where status="returned" + isBookLost).
    // Expired reservations were never collected so they can have no return date.
    // Both rules apply to every student across every route.
    returnedAt: (obj.status === "lost" || obj.status === "expired" || obj.isBookLost)
      ? null
      : (obj.returnedAt || null),

    // ── Fine / payment flag passthrough ──────────────────────────────────────
    // Stable API payload for both modern and legacy DB records.
    // Status is the single source of truth; these flags are read-only pass-through.
    isBookDamaged: obj.isBookDamaged || false,
    isBookLost: obj.isBookLost || false,
    overduePaid: !!obj.overduePaid,
    overduePaidAmount: Number(obj.overduePaidAmount || 0),
    overduePaidAt: obj.overduePaidAt || null,
    finePaid: !!obj.finePaid,
    finePaidAt: obj.finePaidAt || null,
    damageFinePaid: !!obj.damageFinePaid,
    damageFinePaidAt: obj.damageFinePaidAt || null,
    lostFinePaid: !!obj.lostFinePaid,
    lostFinePaidAt: obj.lostFinePaidAt || null,
  };
}

/**
 * Converts a stored image path to a full, browser-loadable URL.
 *
 * Handles all three formats that may exist in the DB:
 *   ""                          → ""               (no image)
 *   "/uploads/123-photo.jpg"    → "http://localhost:4000/uploads/123-photo.jpg"
 *   "http://..."                → unchanged         (already absolute)
 */
/* ── Email reminder helpers (scheduler) ────────────────────────────────────
   These are called by the automated reminder scheduler (separate module).
   They are NOT route handlers and do not touch routes, reports, or startup.
   ─────────────────────────────────────────────────────────────────────── */

/**
 * Returns true if the reservation should be silently skipped by all reminder
 * processors — i.e. it is in a terminal state where no more emails are needed.
 *
 * "lost" and "damaged" are in TERMINAL_STATUSES and are matched here directly.
 */
function isReservationInactiveForReminders(reservation) {
  return TERMINAL_STATUSES.includes(reservation.status);
}

/**
 * Maps a fully-populated reservation document into the flat payload shape
 * that every mailer.js function expects.
 *
 * Call AFTER ensuring reservation.user and reservation.book are populated
 * objects (not raw ObjectId strings).
 *
 * @param  {object} reservation  Populated Mongoose reservation document
 * @returns {{ studentName, studentEmail, bookTitle, author,
 *             reservedAt, createdAt, dueDate, status }}
 */
function buildMailerPayload(reservation) {
  const user =
    reservation.user && typeof reservation.user === "object"
      ? reservation.user
      : {};

  const book =
    reservation.book && typeof reservation.book === "object"
      ? reservation.book
      : {};

  return {
    studentName: user.name ?? "",
    studentEmail: user.email ?? "",
    bookTitle: book.title ?? "",
    author: book.author ?? "",
    reservedAt: reservation.reservedAt ?? null,
    createdAt: reservation.createdAt ?? null,
    dueDate: reservation.dueDate ?? null,
    status: reservation.status ?? "",
    expiryTime: reservation.reservedAt
      ? new Date(new Date(reservation.reservedAt).getTime() + PRE_BOOK_EXPIRY_MS)
      : reservation.createdAt
        ? new Date(new Date(reservation.createdAt).getTime() + PRE_BOOK_EXPIRY_MS)
        : null,
  };
}

/**
 * Processes pre-book email reminders for a single reservation.
 * Handles two statuses:
 *
 *   "reserved"  →  confirmation · 12-hour · 20-hour reminders (sent once each)
 *   "expired"   →  expired notification (sent once, only when
 *                  prebookExpiredMailSent === false)
 *
 * Does NOT duplicate or recreate expiry logic — expiry is owned exclusively
 * by expireStalePreBookings() / autoExpireReservation().
 */
async function processPrebookReminder(reservation) {
  const isReserved = reservation.status === "reserved";
  const isExpired = reservation.status === "expired";

  if (!isReserved && !isExpired) return;

  // ── Populate user if needed ────────────────────────────────────────────────
  if (!reservation.user || typeof reservation.user !== "object") {
    reservation.user = await User.findById(reservation.user).lean();
  }
  if (!reservation.user?.email) return; // no address — skip silently

  // ── Populate book if needed ────────────────────────────────────────────────
  if (!reservation.book || typeof reservation.book !== "object") {
    reservation.book = await Book.findById(reservation.book).lean();
  }

  const payload = buildMailerPayload(reservation);
  const updates = {};

  // ── Expired path ───────────────────────────────────────────────────────────
  if (isExpired) {
    updates.status = "expired";

    if (!reservation.expiredAt) {
      updates.expiredAt = new Date();
    }

    if (!reservation.prebookExpiredMailSent) {
      try {
        await sendPrebookExpiredEmail(payload);
        updates.prebookExpiredMailSent = true;
      } catch (err) {
        console.error(`[REMINDER] prebookExpired failed for ${reservation._id}:`, err);
      }
    }

    if (Object.keys(updates).length > 0) {
      await Reservation.findByIdAndUpdate(reservation._id, { $set: updates });
    }

    return;
  }

  // ── Reserved path ──────────────────────────────────────────────────────────
  const reservedAt = reservation.reservedAt
    ? new Date(reservation.reservedAt)
    : reservation.createdAt
      ? new Date(reservation.createdAt)
      : null;

  if (!reservedAt || Number.isNaN(reservedAt.getTime())) return;

  const elapsedMs = Date.now() - reservedAt.getTime();

  // ── Confirmation (sent once, as soon as we first see this reservation) ─────
  if (!reservation.prebookConfirmationSent) {
    try {
      await sendPrebookConfirmationEmail(payload);
      updates.prebookConfirmationSent = true;
    } catch (err) {
      console.error(`[REMINDER] prebookConfirmation failed for ${reservation._id}:`, err);
    }
  }

  // ── 12-hour reminder ───────────────────────────────────────────────────────
  if (!reservation.prebook12HourReminderSent && elapsedMs >= 12 * 60 * 60 * 1000) {
    try {
      await sendPrebook12HourReminderEmail(payload);
      updates.prebook12HourReminderSent = true;
    } catch (err) {
      console.error(`[REMINDER] prebook12Hour failed for ${reservation._id}:`, err);
    }
  }

  // ── 20-hour reminder ───────────────────────────────────────────────────────
  if (!reservation.prebook20HourReminderSent && elapsedMs >= 20 * 60 * 60 * 1000) {
    try {
      await sendPrebook20HourReminderEmail(payload);
      updates.prebook20HourReminderSent = true;
    } catch (err) {
      console.error(`[REMINDER] prebook20Hour failed for ${reservation._id}:`, err);
    }
  }

  // Persist only the flags that changed
  if (Object.keys(updates).length > 0) {
    await Reservation.findByIdAndUpdate(reservation._id, { $set: updates });
  }
}

/**
 * Processes due-date / overdue (status === "collected") email reminders for a
 * single reservation.
 *
 * Upcoming-due — strict, non-overlapping day windows (only ONE fires per cycle):
 *   10-day  :  daysLeft <= 10  &&  daysLeft > 5
 *    5-day  :  daysLeft <=  5  &&  daysLeft > 2
 *    2-day  :  daysLeft <=  2  &&  daysLeft > 1
 *    1-day  :  daysLeft <=  1  &&  daysLeft > 0
 *
 * Due today  :  dueDate falls on today's calendar date (sent once)
 *
 * Overdue    :  dueDate has fully passed (different calendar day),
 *               re-sent every 48 hours via lastOverdueReminderSentAt.
 */
async function processDueReminder(reservation) {
  if (reservation.status !== "collected") return;

  // ── Populate user if needed ────────────────────────────────────────────────
  if (!reservation.user || typeof reservation.user !== "object") {
    reservation.user = await User.findById(reservation.user).lean();
  }
  if (!reservation.user?.email) return;

  // ── Populate book if needed ────────────────────────────────────────────────
  if (!reservation.book || typeof reservation.book !== "object") {
    reservation.book = await Book.findById(reservation.book).lean();
  }

  const dueDate = reservation.dueDate ? new Date(reservation.dueDate) : null;

  if (dueDate && !Number.isNaN(dueDate.getTime())) {
    dueDate.setHours(17, 0, 0, 0);
  }

  if (!dueDate || Number.isNaN(dueDate.getTime())) return;

  const payload = buildMailerPayload(reservation);
  const now = new Date();

  // Float days until due — positive = future, negative = overdue
  const msUntilDue = dueDate.getTime() - now.getTime();
  const daysLeft = msUntilDue / (1000 * 60 * 60 * 24);

  // True only when now and dueDate share the exact same calendar date
  const isToday =
    now.getFullYear() === dueDate.getFullYear() &&
    now.getMonth() === dueDate.getMonth() &&
    now.getDate() === dueDate.getDate();

  const updates = {};

  if (daysLeft > 0) {
    // ── Upcoming-due: strict windows prevent multiple fires in one cycle ──────

    if (!reservation.due10DayReminderSent && daysLeft <= 10 && daysLeft > 5) {
      try {
        await sendDue10DayReminderEmail(payload);
        updates.due10DayReminderSent = true;
      } catch (err) {
        console.error(`[REMINDER] due10Day failed for ${reservation._id}:`, err);
      }
    }

    if (!reservation.due5DayReminderSent && daysLeft <= 5 && daysLeft > 2) {
      try {
        await sendDue5DayReminderEmail(payload);
        updates.due5DayReminderSent = true;
      } catch (err) {
        console.error(`[REMINDER] due5Day failed for ${reservation._id}:`, err);
      }
    }

    if (!reservation.due2DayReminderSent && daysLeft <= 2 && daysLeft > 1) {
      try {
        await sendDue2DayReminderEmail(payload);
        updates.due2DayReminderSent = true;
      } catch (err) {
        console.error(`[REMINDER] due2Day failed for ${reservation._id}:`, err);
      }
    }

    if (!reservation.due1DayReminderSent && daysLeft <= 1 && daysLeft > 0) {
      try {
        await sendDue1DayReminderEmail(payload);
        updates.due1DayReminderSent = true;
      } catch (err) {
        console.error(`[REMINDER] due1Day failed for ${reservation._id}:`, err);
      }
    }

  } else if (isToday) {
    // ── Due today — fires once on the calendar day the book is due ────────────
    if (!reservation.dueTodayReminderSent) {
      try {
        await sendDueTodayReminderEmail(payload);
        updates.dueTodayReminderSent = true;
      } catch (err) {
        console.error(`[REMINDER] dueToday failed for ${reservation._id}:`, err);
      }
    }

  } else {
    // ── Overdue — dueDate has fully passed (not same calendar day) ────────────
    // Re-sent every 48 hours; does NOT fire on the due day itself.
    const last = reservation.lastOverdueReminderSentAt
      ? new Date(reservation.lastOverdueReminderSentAt)
      : null;
    const overdueIntervalMs = 48 * 60 * 60 * 1000;
    const shouldSendOverdue = !last || now.getTime() - last.getTime() >= overdueIntervalMs;

    if (shouldSendOverdue) {
      try {
        await sendOverdueReminderEmail(payload);
        updates.lastOverdueReminderSentAt = now;
      } catch (err) {
        console.error(`[REMINDER] overdue failed for ${reservation._id}:`, err);
      }
    }
  }

  if (Object.keys(updates).length > 0) {
    await Reservation.findByIdAndUpdate(reservation._id, { $set: updates });
  }
}

function resolveImageUrl(imagePath) {
  if (!imagePath) return "";
  // Already an absolute URL — return as-is (e.g. external avatar URLs)
  if (/^https?:\/\//i.test(imagePath)) return imagePath;
  // Ensure exactly one leading slash before joining with BASE_URL
  const normalized = imagePath.startsWith("/") ? imagePath : `/${imagePath}`;
  return `${BASE_URL}${normalized}`;
}

function formatUser(user) {
  const rawProfileImage = String(user?.profileImage || "").trim();

  const normalizedProfileImage = (() => {
    if (!rawProfileImage) return "";

    if (
      rawProfileImage.startsWith("http://") ||
      rawProfileImage.startsWith("https://")
    ) {
      return rawProfileImage;
    }

    if (rawProfileImage.startsWith("/uploads/")) {
      return rawProfileImage;
    }

    if (rawProfileImage.startsWith("uploads/")) {
      return `/${rawProfileImage}`;
    }

    return `/uploads/${rawProfileImage}`;
  })();

  return {
    id: String(user._id),
    name: user.name || "",
    email: user.email || "",
    role: user.role || "student",
    studentId: user.studentId || "",
    department: user.department || "",
    phone: user.phone || "",
    year: user.year || "",
    profileImage: normalizedProfileImage,
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
  };
}

/* =========================================
   REPORT HELPER FUNCTIONS
========================================= */

// ── Date boundary helpers ──────────────────────────────────────────────────

/** Returns midnight (00:00:00.000) of the given date */
function getStartOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Returns the last millisecond (23:59:59.999) of the given date */
function getEndOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Returns Monday 00:00:00.000 of the ISO week containing `date`.
 * Week starts on Monday (ISO 8601).
 */
function getStartOfWeek(date) {
  const d = new Date(date);
  // getDay(): 0 = Sunday … 6 = Saturday. We want Monday = 0 offset.
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // push Sunday back 6, others forward to Monday
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Returns Sunday 23:59:59.999 of the ISO week containing `date`.
 * (6 days after the Monday returned by getStartOfWeek)
 */
function getEndOfWeek(date) {
  const d = getStartOfWeek(date);
  d.setDate(d.getDate() + 6);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Returns the 1st of the month at 00:00:00.000 */
function getStartOfMonth(date) {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Returns the last day of the month at 23:59:59.999.
 * Trick: day 0 of next month === last day of this month.
 */
function getEndOfMonth(date) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + 1, 0);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Returns Jan 1 of the year at 00:00:00.000 */
function getStartOfYear(date) {
  const d = new Date(date);
  d.setMonth(0, 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Returns Dec 31 of the year at 23:59:59.999 */
function getEndOfYear(date) {
  const d = new Date(date);
  d.setMonth(11, 31);
  d.setHours(23, 59, 59, 999);
  return d;
}

// ── Main report builder ────────────────────────────────────────────────────

/**
 * Builds a summary report from a pre-fetched, populated array of Reservations.
 *
 * Caller is responsible for:
 *   1. Fetching reservations filtered by createdAt ∈ [fromDate, toDate] from DB.
 *   2. Populating `book` (at minimum: title, author) and `user`.
 *
 * @param {Object[]} reservations  Populated Reservation documents
 * @param {string}   label         Human-readable label ("This Week", "March 2025", …)
 * @param {Date}     fromDate      Period start — stored in the returned object for the frontend
 * @param {Date}     toDate        Period end   — stored in the returned object for the frontend
 * @returns {Object}               Complete report summary
 *
 * Metric definitions (aligned with the reservation status machine in this file):
 *
 *  totalTransactions    – every reservation created in the period (all statuses)
 *  totalPreBookings     – reservations where isWalkIn === false
 *                         (student pre-booked online; may be reserved/collected/returned/…)
 *  totalWalkInCheckouts – reservations where isWalkIn === true
 *                         (admin created the checkout at the counter directly)
 *  totalCollected       – DB status === "collected"
 *                         (book is physically out with the student, on-time OR overdue)
 *  totalReturned        – status === "returned" (clean return; lost/damaged have their own terminal statuses)
 *  totalCancelled       – DB status === "cancelled"  (deliberate manual cancellation)
 *  totalExpired         – DB status === "expired"    (24-h pickup window missed — auto)
 *  totalOverdueActive   – subset of totalCollected: collected + dueDate < now
 *                         (virtual "overdue" state — book is late but not yet returned)
 *  totalDamaged         – status === "damaged" (dedicated terminal status)
 *  totalLost            – status === "lost"    (dedicated terminal status)
 *  topBooks             – top 5 books by reservation count in the period
 */
function buildReservationReport(reservations, label, fromDate, toDate) {
  const now = new Date();

  let totalTransactions = 0;
  let totalPreBookings = 0;
  let totalWalkInCheckouts = 0;
  let totalCollected = 0;
  let totalReturned = 0;
  let totalCancelled = 0;
  let totalExpired = 0;
  let totalOverdueActive = 0;
  let totalDamaged = 0;
  let totalLost = 0;

  // bookCounts: { [bookId]: { bookId, title, author, count } }
  const bookCounts = {};

  for (const r of reservations) {
    totalTransactions++;

    // ── Pre-book vs walk-in ──────────────────────────────────────────────
    if (r.isWalkIn) {
      totalWalkInCheckouts++;
    } else {
      totalPreBookings++;
    }

    // ── Status buckets ───────────────────────────────────────────────────
    switch (r.status) {
      case "collected":
        totalCollected++;
        // Virtual overdue: DB status is still "collected" but dueDate has passed
        if (r.dueDate && new Date(r.dueDate) < now) {
          totalOverdueActive++;
        }
        break;
      case "returned":
        // status="returned" is a clean return by definition — "damaged" and "lost"
        // have their own dedicated terminal statuses.
        totalReturned++;
        break;
      case "damaged":
        // "damaged" is a dedicated terminal status — counted in totalDamaged below.
        break;
      case "lost":
        // "lost" is a dedicated terminal status — counted in totalLost below.
        break;
      case "cancelled":
        totalCancelled++;
        break;
      case "expired":
        totalExpired++;
        break;
      // "reserved" — counts only in totalTransactions + pre/walkin split above
      default:
        break;
    }

    // ── Damage / loss counters ───────────────────────────────────────────
    // status is the single source of truth; helpers are pure status checks.
    if (isDamagedRecord(r)) totalDamaged++;
    if (isLostRecord(r)) totalLost++;

    // ── Top-books aggregation ────────────────────────────────────────────
    // r.book is populated → object; un-populated → ObjectId string.
    // We guard both cases so this never throws.
    const bookId = r.book?._id?.toString() ?? r.book?.toString() ?? "unknown";
    const bookTitle = r.book?.title ?? "Unknown Title";
    const bookAuthor = r.book?.author ?? "Unknown Author";

    if (!bookCounts[bookId]) {
      bookCounts[bookId] = { bookId, title: bookTitle, author: bookAuthor, count: 0 };
    }
    bookCounts[bookId].count++;
  }

  // Top 5 books, highest reservation count first
  const topBooks = Object.values(bookCounts)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    label,
    fromDate,
    toDate,
    totalTransactions,
    totalPreBookings,
    totalWalkInCheckouts,
    totalCollected,
    totalReturned,
    totalCancelled,
    totalExpired,
    totalOverdueActive,
    totalDamaged,
    totalLost,
    topBooks,
  };
}

function normalizeImportedBook(raw = {}) {
  const title = String(raw.title || "").trim();
  const author = String(raw.author || "").trim();
  const department = normalizeDepartmentName(raw.department || "General");
  const courseCode = String(raw.courseCode || "").trim();
  const location = String(raw.location || "Shelf").trim() || "Shelf";
  const coverImage = String(raw.coverImage || "").trim();
  const publishedYear =
    raw.publishedYear !== undefined &&
      raw.publishedYear !== null &&
      raw.publishedYear !== ""
      ? Number(raw.publishedYear)
      : null;
  const totalCopies = Math.max(1, Number(raw.totalCopies) || 1);
  const requestedAvailable =
    raw.availableCopies !== undefined && raw.availableCopies !== null
      ? Number(raw.availableCopies)
      : totalCopies;
  const availableCopies = Math.max(
    0,
    Math.min(
      totalCopies,
      Number.isFinite(requestedAvailable) ? requestedAvailable : totalCopies
    )
  );
  const isNewArrival = !!raw.isNewArrival;
  return {
    title,
    author,
    department,
    courseCode,
    location,
    coverImage,
    publishedYear: Number.isFinite(publishedYear) ? publishedYear : null,
    totalCopies,
    availableCopies,
    isNewArrival,
  };
}

function normalizeDepartmentName(dept) {
  if (!dept || typeof dept !== "string") return "General";
  const trimmed = dept.trim();
  if (!trimmed) return "General";
  // Title-case each word
  return trimmed
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/* =========================================
   ROOT / HEALTH
========================================= */
app.get("/", (req, res) => {
  res.send("BookAhead Backend Running");
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Backend is running",
    time: new Date(),
  });
});

/* =========================================
   AUTH ROUTES
========================================= */
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password, studentId } = req.body;

    if (!name?.trim() || !email?.trim() || !password?.trim()) {
      return res
        .status(400)
        .json({ message: "Name, email, and password are required" });
    }

    if (!studentId?.trim()) {
      return res.status(400).json({ message: "Student ID is required" });
    }

    if (password.trim().length < 6) {
      return res
        .status(400)
        .json({ message: "Password must be at least 6 characters" });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({ message: "User already exists" });
    }

    const existingStudentId = await User.findOne({
      studentId: studentId.trim(),
    });
    if (existingStudentId) {
      return res.status(409).json({ message: "Student ID already registered" });
    }

    const passwordHash = await bcrypt.hash(password.trim(), 10);

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      passwordHash,
      role: "student",
      studentId: studentId.trim(),
    });

    const token = createToken(user);

    return res.status(201).json({
      token,
      user: formatUser(user),
    });
  } catch (err) {
    console.error("Register error:", err);
    return res.status(500).json({ message: "Failed to register" });
  }
});

app.post("/api/auth/signup", async (req, res) => {
  try {
    const { name, email, password, studentId } = req.body;

    if (!name?.trim() || !email?.trim() || !password?.trim()) {
      return res
        .status(400)
        .json({ message: "Name, email, and password are required" });
    }

    if (!studentId?.trim()) {
      return res.status(400).json({ message: "Student ID is required" });
    }

    if (password.trim().length < 6) {
      return res
        .status(400)
        .json({ message: "Password must be at least 6 characters" });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({ message: "User already exists" });
    }

    const existingStudentId = await User.findOne({
      studentId: studentId.trim(),
    });
    if (existingStudentId) {
      return res.status(409).json({ message: "Student ID already registered" });
    }

    const passwordHash = await bcrypt.hash(password.trim(), 10);

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      passwordHash,
      role: "student",
      studentId: studentId.trim(),
    });

    const token = createToken(user);

    return res.status(201).json({
      token,
      user: formatUser(user),
    });
  } catch (err) {
    console.error("Signup error:", err);
    return res.status(500).json({ message: "Failed to sign up" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Missing credentials" });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    const token = createToken(user);

    return res.json({
      token,
      user: formatUser(user),
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ message: "Failed to login" });
  }
});

app.get("/api/auth/me", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json({ user: formatUser(user) });
  } catch (err) {
    console.error("Auth me error:", err);
    return res.status(500).json({ message: "Failed to fetch profile" });
  }
});

app.put(
  "/api/auth/profile",
  authMiddleware,
  upload.single("profileImage"),
  async (req, res) => {
    try {
      const {
        name,
        email,
        currentPassword,
        newPassword,
        removeProfileImage,
        studentId,
      } = req.body;

      const user = await User.findById(req.user.userId);
      if (!user) {
        if (req.file) {
          deleteUploadedFile(`/uploads/${req.file.filename}`);
        }
        return res.status(404).json({ message: "User not found" });
      }

      if (name && name.trim()) {
        user.name = name.trim();
      }

      if (email && email.trim()) {
        const normalizedEmail = email.trim().toLowerCase();

        if (normalizedEmail !== user.email) {
          const existing = await User.findOne({
            email: normalizedEmail,
            _id: { $ne: user._id },
          });

          if (existing) {
            if (req.file) {
              deleteUploadedFile(`/uploads/${req.file.filename}`);
            }
            return res.status(400).json({ message: "Email already in use" });
          }

          user.email = normalizedEmail;
        }
      }

      if (user.role === "student" && studentId !== undefined) {
        const trimmedStudentId = String(studentId).trim();

        if (!trimmedStudentId) {
          if (req.file) {
            deleteUploadedFile(`/uploads/${req.file.filename}`);
          }
          return res.status(400).json({ message: "Student ID is required" });
        }

        if (trimmedStudentId !== user.studentId) {
          const existingStudent = await User.findOne({
            studentId: trimmedStudentId,
            _id: { $ne: user._id },
          });

          if (existingStudent) {
            if (req.file) {
              deleteUploadedFile(`/uploads/${req.file.filename}`);
            }
            return res.status(400).json({ message: "Student ID already in use" });
          }

          user.studentId = trimmedStudentId;
        }
      }

      if (newPassword && newPassword.trim()) {
        if (!currentPassword) {
          if (req.file) {
            deleteUploadedFile(`/uploads/${req.file.filename}`);
          }
          return res
            .status(400)
            .json({ message: "Current password is required" });
        }

        const ok = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!ok) {
          if (req.file) {
            deleteUploadedFile(`/uploads/${req.file.filename}`);
          }
          return res
            .status(400)
            .json({ message: "Current password is incorrect" });
        }

        if (newPassword.trim().length < 6) {
          if (req.file) {
            deleteUploadedFile(`/uploads/${req.file.filename}`);
          }
          return res
            .status(400)
            .json({ message: "New password must be at least 6 characters" });
        }

        user.passwordHash = await bcrypt.hash(newPassword.trim(), 10);
      }

      if (String(removeProfileImage) === "true") {
        if (user.profileImage) {
          deleteUploadedFile(user.profileImage);
        }
        user.profileImage = "";
      }

      if (req.file) {
        if (user.profileImage) {
          deleteUploadedFile(user.profileImage);
        }

        user.profileImage = `/uploads/${req.file.filename}`;
      }

      await user.save();

      const token = createToken(user);

      return res.json({
        message: "Profile updated successfully",
        token,
        user: formatUser(user),
      });
    } catch (err) {
      console.error("Profile update error:", err);

      if (req.file) {
        deleteUploadedFile(`/uploads/${req.file.filename}`);
      }

      return res.status(500).json({ message: "Failed to update profile" });
    }
  }
);

/* ============================== ===========
   BOOK ROUTES
========================================= */
app.get("/api/books", async (req, res) => {
  try {
    const { search, filter } = req.query;
    const query = {};

    if (filter === "available") {
      query.availableCopies = { $gt: 0 };
    }

    if (filter === "new") {
      query.isNewArrival = true;
    }

    if (
      filter &&
      filter !== "all" &&
      filter !== "available" &&
      filter !== "new"
    ) {
      query.department = normalizeDepartmentName(filter);
    }
    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), "i");
      query.$or = [
        { title: regex },
        { author: regex },
        { courseCode: regex },
        { department: regex },
      ];
    }

    // Sweep any pre-books whose 24-hour window has passed before reading
    // availableCopies from the DB. Without this, a book listing can show
    // 0 copies available — and be hidden by filter=available — even though
    // the only "reserved" record blocking it expired hours ago.
    await expireStalePreBookings();

    const books = await Book.find(query).sort({ createdAt: -1 });

    return res.json({ books });
  } catch (err) {
    console.error("Get books error:", err);
    return res.status(500).json({ message: "Failed to fetch books" });
  }
});

app.post(
  "/api/books",
  authMiddleware,
  requireAdmin,
  upload.single("image"),
  async (req, res) => {
    try {
      const {
        title,
        author,
        department,
        courseCode,
        location,
        coverImage,
        publishedYear,
        isNewArrival,
        totalCopies,
      } = req.body;

      if (!title || !author) {
        if (req.file) {
          deleteUploadedFile(`/uploads/${req.file.filename}`);
        }
        return res.status(400).json({ message: "Title and author are required" });
      }

      const copies = Math.max(Number(totalCopies) || 1, 1);

      const normalizedBookQuery = {
        title: title.trim(),
        author: author.trim(),
        department: normalizeDepartmentName(department || "General"),
        courseCode: (courseCode || "").trim(),
        location: (location || "Shelf").trim(),
      };

      const uploadedImagePath = req.file ? `/uploads/${req.file.filename}` : "";
      const finalCoverImage =
        uploadedImagePath ||
        (coverImage && String(coverImage).trim()
          ? String(coverImage).trim()
          : "");

      const existing = await Book.findOne(normalizedBookQuery);

      if (existing) {
        existing.totalCopies += copies;
        existing.availableCopies += copies;
        existing.isNewArrival =
          String(isNewArrival) === "true" ||
          !!isNewArrival ||
          existing.isNewArrival;

        if (finalCoverImage) {
          existing.coverImage = finalCoverImage;
        }
        if (publishedYear !== undefined && publishedYear !== "") {
          existing.publishedYear = Number(publishedYear);
        }
        await existing.save();

        return res.json({
          message: "Existing book found. Copies merged successfully",
          book: existing,
        });
      }

      const book = await Book.create({
        title: title.trim(),
        author: author.trim(),
        department: normalizeDepartmentName(department || "General"),
        courseCode: (courseCode || "").trim(),
        location: (location || "Shelf").trim(),
        coverImage: finalCoverImage,
        publishedYear:
          publishedYear !== undefined && publishedYear !== ""
            ? Number(publishedYear)
            : null,
        totalCopies: copies,
        availableCopies: copies,
        isNewArrival: String(isNewArrival) === "true" || !!isNewArrival,
      });

      return res.status(201).json({
        message: "Book added successfully",
        book,
      });
    } catch (err) {
      console.error("Add book error:", err);

      if (req.file) {
        deleteUploadedFile(`/uploads/${req.file.filename}`);
      }

      return res.status(500).json({ message: "Failed to add book" });
    }
  }
);

app.put(
  "/api/books/:id",
  authMiddleware,
  requireAdmin,
  upload.single("image"),
  async (req, res) => {
    try {
      const {
        title,
        author,
        department,
        courseCode,
        location,
        coverImage,
        publishedYear,
        totalCopies,
        isNewArrival,
      } = req.body;

      const book = await Book.findById(req.params.id);

      if (!book) {
        if (req.file) {
          deleteUploadedFile(`/uploads/${req.file.filename}`);
        }
        return res.status(404).json({ message: "Book not found" });
      }

      const newTotal = Math.max(Number(totalCopies) || 1, 1);
      const borrowedOrReserved = book.totalCopies - book.availableCopies;

      if (newTotal < borrowedOrReserved) {
        if (req.file) {
          deleteUploadedFile(`/uploads/${req.file.filename}`);
        }
        return res.status(400).json({
          message:
            "Cannot reduce total copies below currently reserved/borrowed quantity",
        });
      }

      const newAvailable = Math.max(newTotal - borrowedOrReserved, 0);

      const uploadedImagePath = req.file ? `/uploads/${req.file.filename}` : "";
      const finalCoverImage =
        uploadedImagePath ||
        (coverImage !== undefined ? String(coverImage).trim() : book.coverImage);

      book.title = title?.trim() || book.title;
      book.author = author?.trim() || book.author;
      book.department = department ? normalizeDepartmentName(department) : book.department;
      book.courseCode =
        courseCode !== undefined ? String(courseCode).trim() : book.courseCode;
      book.location = location?.trim() || book.location;
      book.coverImage = finalCoverImage;
      book.publishedYear =
        publishedYear !== undefined && publishedYear !== ""
          ? Number(publishedYear)
          : book.publishedYear;
      book.totalCopies = newTotal;
      book.availableCopies = newAvailable;
      book.isNewArrival = String(isNewArrival) === "true" || !!isNewArrival;

      await book.save();

      return res.json({
        message: "Book updated successfully",
        book,
      });
    } catch (err) {
      console.error("Edit book error:", err);

      if (req.file) {
        deleteUploadedFile(`/uploads/${req.file.filename}`);
      }

      return res.status(500).json({ message: "Failed to update book" });
    }
  }
);

app.put("/api/books/:id/copies", authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { action } = req.body;

    if (!["increase", "decrease"].includes(action)) {
      return res.status(400).json({ message: "Invalid action" });
    }

    const book = await Book.findById(req.params.id);
    if (!book) {
      return res.status(404).json({ message: "Book not found" });
    }

    if (action === "increase") {
      book.totalCopies += 1;
      book.availableCopies += 1;
    }

    if (action === "decrease") {
      if (book.totalCopies <= 1) {
        return res
          .status(400)
          .json({ message: "Book must have at least 1 total copy" });
      }

      const borrowedOrReserved = book.totalCopies - book.availableCopies;

      if (book.totalCopies - 1 < borrowedOrReserved) {
        return res.status(400).json({
          message:
            "Cannot reduce copies below currently reserved/borrowed quantity",
        });
      }

      book.totalCopies -= 1;

      if (book.availableCopies > 0) {
        book.availableCopies -= 1;
      }
    }

    await book.save();

    return res.json({
      message: "Book copies updated successfully",
      book,
    });
  } catch (err) {
    console.error("Update copies error:", err);
    return res.status(500).json({ message: "Failed to update book copies" });
  }
});

app.delete("/api/books/:id", authMiddleware, requireAdmin, async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);

    if (!book) {
      return res.status(404).json({ message: "Book not found" });
    }

    const activeReservations = await Reservation.countDocuments({
      book: book._id,
      status: { $in: ACTIVE_STATUSES },
    });

    if (activeReservations > 0) {
      return res.status(400).json({
        message: "Cannot delete a book with active reservations",
      });
    }

    await Book.findByIdAndDelete(book._id);

    return res.json({
      message: "Book deleted successfully",
    });
  } catch (err) {
    console.error("Delete book error:", err);
    return res.status(500).json({ message: "Failed to delete book" });
  }
});

/* =========================================
   RESERVATION ROUTES
========================================= */
app.post("/api/reservations", authMiddleware, async (req, res) => {
  try {
    const { bookId } = req.body;

    if (!bookId) {
      return res.status(400).json({ message: "Missing bookId" });
    }

    // Expire any stale pre-books across the whole collection first so that
    // availableCopies is accurate and the duplicate check below is correct.
    await expireStalePreBookings();

    const book = await Book.findById(bookId);
    if (!book) {
      return res.status(404).json({ message: "Book not found" });
    }

    // ── Per-student+book duplicate guard ──────────────────────────────────────
    // RULE: block ONLY when THIS student already has an ACTIVE record for THIS
    // book. Different students may freely pre-book or check out the same book
    // concurrently (as long as copies are available).
    //
    // Active = "reserved" | "collected" (covers overdue, which is "collected" in DB).
    // Terminal states (returned, cancelled, expired) and lost+paid records are
    // excluded — a prior closed record must never block a fresh pre-book.
    const existingReservation = await Reservation.findOne({
      user: req.user.userId,
      book: book._id,
      ...activeDuplicateFilter(),
    });

    if (existingReservation) {
      // `conflictStatus` lets the frontend apply the correct disabled-button style
      // without fragile string-matching on the human-readable message.
      const conflictStatus = existingReservation.status; // "reserved" | "collected"
      const msg =
        conflictStatus === "collected"
          ? "Book already checked out by this student"
          : "Book already pre-booked by this student";
      return res.status(400).json({ message: msg, conflictStatus });
    }

    // ── Book-level availability guard ─────────────────────────────────────────
    // Only block when there are literally no copies left in stock.
    // Multiple students are allowed to pre-book / check out the same book as long
    // as copies are available — do NOT block based on other students' reservations.
    if (book.availableCopies <= 0) {
      return res.status(400).json({ message: "Book is not available — no copies left in stock." });
    }

    const reservedAt = new Date();
    const dueDate = new Date();
    dueDate.setMonth(dueDate.getMonth() + 1);

    // Set return time to 5:00 PM
    dueDate.setHours(17, 0, 0, 0);

    const reservation = await Reservation.create({
      user: req.user.userId,
      book: book._id,
      status: "reserved",
      reservedAt,
      dueDate,
    });

    await decrementAvailableCopiesSafely(book._id);

    // ── Send immediate pre-book confirmation email ─────────────────────────
    // Populate user so buildMailerPayload() gets a real object, not a bare ID.
    // Wrapped in try/catch so a mail failure never breaks the reservation response.
    try {
      const populatedUser = await User.findById(req.user.userId).lean();
      const mailerPayload = buildMailerPayload({
        user: populatedUser,
        book,                              // already a full Mongoose doc from above
        reservedAt: reservation.reservedAt,
        createdAt: reservation.createdAt,
        dueDate: reservation.dueDate,
        status: reservation.status,
      });
      await sendPrebookConfirmationEmail(mailerPayload);
      await Reservation.findByIdAndUpdate(reservation._id, {
        $set: { prebookConfirmationSent: true },
      });
      reservation.prebookConfirmationSent = true;
    } catch (err) {
      console.error("[PREBOOK] immediate confirmation email failed:", err);
    }
    // ──────────────────────────────────────────────────────────────────────

    return res.status(201).json({
      message: "Book reserved successfully",
      reservation: serializeReservation(reservation),
      remainingCopies: book.availableCopies,
    });
  } catch (err) {
    console.error("Create reservation error:", err);
    return res.status(500).json({ message: "Failed to reserve book" });
  }
});

app.get("/api/reservations", authMiddleware, async (req, res) => {
  try {
    // Expire any stale pre-books before loading the list so every record
    // returned already reflects its true status and availableCopies is correct.
    await expireStalePreBookings();

    const filter = {};

    if (req.user.role === "student") {
      filter.user = req.user.userId;
    }

    const reservations = await Reservation.find(filter)
      .populate("book")
      .populate("user", "-passwordHash")
      .sort({ createdAt: -1 });

    const reservationsWithDerivedStatus = reservations.map((r) =>
      serializeReservation(r)
    );

    return res.json({ reservations: reservationsWithDerivedStatus });
  } catch (err) {
    console.error("Get reservations error:", err);
    return res.status(500).json({ message: "Failed to fetch reservations" });
  }
});

app.put("/api/reservations/:id/status", authMiddleware, async (req, res) => {
  try {
    const { action } = req.body;

    // Expire all stale pre-books before any mutation so the DB is truthful.
    await expireStalePreBookings();

    const reservation = await Reservation.findById(req.params.id).populate("book");
    if (!reservation) {
      return res.status(404).json({ message: "Reservation not found" });
    }

    // If this specific reservation was just expired by the sweep above (or was
    // already expired in a prior request) block ALL actions — expired records
    // are fully terminal. The message is action-aware so the client receives
    // the correct reason regardless of which action was attempted.
    if (reservation.status === "expired") {
      const expiredMsg =
        action === "return"
          ? "An expired pre-booking was never collected, so it cannot be returned."
          : action === "cancel"
            ? "This pre-booking has already expired — it cannot be cancelled manually."
            : "This pre-booking expired after 24 hours and cannot be collected.";
      return res.status(400).json({
        message: expiredMsg,
        reservation: serializeReservation(reservation),
      });
    }

    const isAdmin = req.user.role === "admin";
    const isOwner =
      String(reservation.user?._id || reservation.user) === String(req.user.userId);

    if (!isAdmin && !isOwner) {
      return res.status(403).json({ message: "Not authorized" });
    }

    const book = await Book.findById(reservation.book._id);
    if (!book) {
      return res.status(404).json({ message: "Book not found" });
    }

    let message = "Reservation updated successfully";

    if (action === "collect") {
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin only action" });
      }

      if (reservation.status === "damaged") {
        return res.status(400).json({
          message: "Cannot collect a reservation marked as damaged",
        });
      }

      // ── Expiry check (defense-in-depth, collect-specific) ──────────────────
      // Case 1: still "reserved" but the 24-h window has just passed — expire
      //         now and block with a clear, collect-specific reason.
      if (isPreBookExpired(reservation)) {
        await autoExpireReservation(reservation);
        return res.status(400).json({
          message: "This pre-booking expired after 24 hours and cannot be collected.",
          reservation: serializeReservation(reservation),
        });
      }

      // Case 2: already expired in a prior request (status written as "expired"
      //         in the DB). The top-of-route generic check handles the normal
      //         path; this guard is a final safety net inside the collect branch.
      if (reservation.status === "expired") {
        return res.status(400).json({
          message: "This pre-booking expired after 24 hours and cannot be collected.",
          reservation: serializeReservation(reservation),
        });
      }
      // ───────────────────────────────────────────────────────────────────────

      if (reservation.status !== "reserved") {
        return res
          .status(400)
          .json({ message: "Only reserved books can be collected" });
      }

      reservation.status = "collected";
      reservation.collectedAt = new Date();

      // Normalize dueDate to exactly 5:00 PM — pre-book may carry a different
      // time component (legacy data, manual edits, or timezone drift). Locking
      // to 17:00:00.000 here guarantees consistency for all collected records.
      const normalizedCollectDueDate = new Date(reservation.dueDate);
      normalizedCollectDueDate.setHours(17, 0, 0, 0);
      reservation.dueDate = normalizedCollectDueDate;

      // Reset overdue payment state for fresh active collection
      reservation.overduePaid = false;
      reservation.overduePaidAmount = 0;
      reservation.overduePaidAt = null;

      message = "Book marked as collected";
    } else if (action === "return") {
      if (!ACTIVE_STATUSES.includes(reservation.status)) {
        return res
          .status(400)
          .json({ message: "Only active reservations can be returned" });
      }

      // A lost book is NOT physically returnable — it is permanently gone.
      if (isLostRecord(reservation)) {
        return res.status(400).json({
          message: "Cannot return a reservation marked as lost",
        });
      }

      // A damaged book has already been settled via the damage action.
      if (isDamagedRecord(reservation)) {
        return res.status(400).json({
          message: "Cannot return a reservation marked as damaged",
        });
      }

      // If overdue, fine must be paid first before returning
      if (calculateOverdueDays(reservation) > 0 && !reservation.overduePaid) {
        return res.status(400).json({
          message: "Overdue fine must be paid before returning this book",
        });
      }

      reservation.status = "returned";

      /* Separate return timestamp */
      reservation.returnedAt = new Date();

      /* Preserve overdue payment timestamp separately */
      if (reservation.overduePaid && !reservation.overduePaidAt) {
        reservation.overduePaidAt = new Date();
      }

      // Returned book is physically back on the shelf — restore one copy.
      // incrementAvailableCopiesSafely clamps to totalCopies, preventing
      // double-increment if the admin clicks Return twice concurrently.
      await incrementAvailableCopiesSafely(book._id);

      message = "Book returned successfully";
    } else if (action === "cancel") {
      if (isAdmin) {
        if (!ACTIVE_STATUSES.includes(reservation.status)) {
          return res
            .status(400)
            .json({ message: "Only active reservations can be cancelled" });
        }

        reservation.status = "cancelled";

        if (!reservation.returnedAt) {
          reservation.returnedAt = new Date();
        }

        // Inventory: both "reserved" and "collected" decremented availableCopies
        // when created/collected, so restoring one copy on cancel is always correct.
        // Lost books can NEVER reach here (ACTIVE_STATUSES guard above blocks them).
        await incrementAvailableCopiesSafely(book._id);

        message = "Reservation cancelled successfully";
      } else {
        if (!isOwner) {
          return res.status(403).json({ message: "Not authorized" });
        }

        if (reservation.status === "damaged") {
          return res.status(400).json({
            message: "Cannot cancel a reservation marked as damaged",
          });
        }

        if (reservation.status !== "reserved") {
          return res
            .status(400)
            .json({ message: "Students can only cancel reserved books" });
        }

        reservation.status = "cancelled";
        reservation.returnedAt = new Date();

        await incrementAvailableCopiesSafely(book._id);

        message = "Reservation cancelled successfully";
      }
    } else if (action === "damage") {
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin only action" });
      }

      if (!ACTIVE_STATUSES.includes(reservation.status)) {
        return res.status(400).json({
          message: "Book damage can only be marked for active reservations",
        });
      }

      if (isLostRecord(reservation)) {
        return res.status(400).json({
          message: "This reservation is already marked as lost",
        });
      }

      if (reservation.status === "damaged") {
        return res.status(400).json({
          message: "Book is already marked as damaged",
        });
      }

      // Mark the book as damaged and set the fine amount.
      // Payment is handled separately through /pay-fine.
      reservation.damageFine = BOOK_DAMAGE_FINE;

      if (reservation.damageFinePaid == null) {
        reservation.damageFinePaid = false;
      }

      if (!reservation.damageFinePaid) {
        reservation.damageFinePaidAt = null;
      }

      reservation.finePaid = isReservationFullySettled(reservation);

      if (!reservation.finePaid) {
        reservation.finePaidAt = null;
      }

      // Keep reservation collectible until all fines are settled.
      reservation.status = "damaged";

      if (!reservation.returnedAt) {
        reservation.returnedAt = new Date();
      }

      // Damaged book is physically returned — restore one copy.
      // incrementAvailableCopiesSafely clamps to totalCopies.
      await incrementAvailableCopiesSafely(book._id);

      message = `Book marked as damaged. Please collect the damage fine${reservation.overdueDays > 0 ? ' and overdue fine' : ''} via the fine payment option.`;
    } else if (action === "lost") {
      if (!isAdmin) {
        return res.status(403).json({ message: "Admin only action" });
      }

      if (!ACTIVE_STATUSES.includes(reservation.status)) {
        return res.status(400).json({
          message: "Book lost can only be marked for active reservations",
        });
      }

      if (reservation.status === "damaged") {
        return res.status(400).json({
          message: "This reservation is already marked as damaged",
        });
      }

      // "lost" is the dedicated terminal lost-book status — single source of truth.
      if (isLostRecord(reservation)) {
        return res.status(400).json({
          message: "Book is already marked as lost",
        });
      }

      // Mark lost and create payable lost fine.
      // Payment happens separately through /pay-fine.
      reservation.lostFine = BOOK_LOST_FINE;

      if (reservation.lostFinePaid == null) {
        reservation.lostFinePaid = false;
      }

      if (!reservation.lostFinePaid) {
        reservation.lostFinePaidAt = null;
      }

      reservation.finePaid = isReservationFullySettled(reservation);

      if (!reservation.finePaid) {
        reservation.finePaidAt = null;
      }

      // Keep reservation blocked until all fines are settled.
      reservation.status = "lost";

      // Lost book is NOT returned to stock — do NOT increment availableCopies
      // and do NOT call book.save(). The copy is permanently gone.
      // returnedAt is NOT set for lost books — the book was never returned.
      message = `Book marked as lost. Collect all pending fines through the payment option.`;
    } else {
      return res.status(400).json({ message: "Invalid action" });
    }

    await reservation.save();

    return res.json({
      message,
      reservation: serializeReservation(reservation),
    });
  } catch (err) {
    console.error("Update reservation status error:", err);
    return res.status(500).json({ message: "Failed to update reservation" });
  }
});

/* CANCEL RESERVATION (student only) - kept for backward compatibility */
app.put("/api/reservations/:id/cancel", authMiddleware, async (req, res) => {
  try {
    const reservation = await Reservation.findById(req.params.id).populate("book");

    if (!reservation) {
      return res.status(404).json({ message: "Reservation not found" });
    }

    if (req.user.role !== "student") {
      return res.status(403).json({ message: "Only students can cancel reservations" });
    }

    if (String(reservation.user) !== String(req.user.userId)) {
      return res.status(403).json({ message: "Not authorized" });
    }

    // Enforce 24-hour pre-book expiry before allowing manual cancel
    if (isPreBookExpired(reservation)) {
      await autoExpireReservation(reservation);
      return res.status(400).json({
        message:
          "This pre-book has already expired (not collected within 24 hours) " +
          "and has been automatically expired by the system.",
        reservation: serializeReservation(reservation),
      });
    }

    if (reservation.status === "damaged") {
      return res.status(400).json({
        message: "Cannot cancel a reservation marked as damaged",
      });
    }

    if (reservation.status !== "reserved") {
      return res
        .status(400)
        .json({ message: "Only reserved books can be cancelled" });
    }

    reservation.status = "cancelled";
    reservation.returnedAt = new Date();
    await reservation.save();

    const book = await Book.findById(reservation.book._id);
    if (book) {
      await incrementAvailableCopiesSafely(book._id);
    }

    return res.json({
      message: "Reservation cancelled successfully",
      reservation: serializeReservation(reservation),
    });
  } catch (err) {
    console.error("Cancel reservation error:", err);
    return res.status(500).json({ message: "Failed to cancel reservation" });
  }
});

/* UPDATE DUE DATE (admin only) */
app.put(
  "/api/reservations/:id/due-date",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      const { dueDate } = req.body;

      if (!dueDate) {
        return res.status(400).json({ message: "Due date is required" });
      }

      const reservation = await Reservation.findById(req.params.id)
        .populate("book")
        .populate("user", "-passwordHash");

      if (!reservation) {
        return res.status(404).json({ message: "Reservation not found" });
      }

      if (!ACTIVE_STATUSES.includes(reservation.status)) {
        return res.status(400).json({
          message: "Due date can only be updated for active reservations",
        });
      }

      const parsedDueDate = new Date(dueDate);

      if (Number.isNaN(parsedDueDate.getTime())) {
        return res.status(400).json({ message: "Invalid due date format" });
      }

      parsedDueDate.setHours(17, 0, 0, 0); // fixed 5:00 PM return time
      reservation.dueDate = parsedDueDate;
      reservation.overduePaid = false;
      reservation.overduePaidAmount = 0;
      reservation.overduePaidAt = null;

      await reservation.save();

      return res.json({
        message: "Due date updated successfully",
        reservation: serializeReservation(reservation),
      });
    } catch (err) {
      console.error("Update due date error:", err);
      return res.status(500).json({ message: "Failed to update due date" });
    }
  }
);

/**
 * sendManualDueReminder(reservation)
 *
 * Chooses and sends the correct due-date / overdue reminder email based on
 * how many days remain until the reservation's dueDate.
 *
 *   overdue        → sendOverdueReminderEmail
 *   due today      → sendDueTodayReminderEmail
 *   due in 1 day   → sendDue1DayReminderEmail
 *   due in 2 days  → sendDue2DayReminderEmail
 *   due in 5 days  → sendDue5DayReminderEmail
 *   otherwise      → sendDue10DayReminderEmail
 *
 * Requires reservation.user and reservation.book to be populated objects.
 */
async function sendManualDueReminder(reservation) {
  const payload = buildMailerPayload(reservation);
  const now = new Date();
  const dueDate = reservation.dueDate ? new Date(reservation.dueDate) : null;

  if (dueDate && !Number.isNaN(dueDate.getTime())) {
    dueDate.setHours(17, 0, 0, 0);
  }

  if (!dueDate || Number.isNaN(dueDate.getTime())) {
    throw new Error("Reservation has no valid dueDate");
  }

  const msUntilDue = dueDate.getTime() - now.getTime();
  const daysLeft = msUntilDue / (1000 * 60 * 60 * 24);

  const isToday =
    now.getFullYear() === dueDate.getFullYear() &&
    now.getMonth() === dueDate.getMonth() &&
    now.getDate() === dueDate.getDate();

  if (daysLeft < 0 && !isToday) {
    return await sendOverdueReminderEmail(payload);
  } else if (isToday) {
    return await sendDueTodayReminderEmail(payload);
  } else if (daysLeft <= 1) {
    return await sendDue1DayReminderEmail(payload);
  } else if (daysLeft <= 2) {
    return await sendDue2DayReminderEmail(payload);
  } else if (daysLeft <= 5) {
    return await sendDue5DayReminderEmail(payload);
  } else {
    return await sendDue10DayReminderEmail(payload);
  }
}

/* MANUAL REMINDER (admin only) */
app.post(
  "/api/reservations/:id/remind",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      const reservation = await Reservation.findById(req.params.id)
        .populate("user", "-passwordHash")
        .populate("book");

      if (!reservation) {
        return res.status(404).json({ message: "Reservation not found" });
      }

      const payload = buildMailerPayload(reservation);
      let sent = false;

      if (reservation.status === "reserved") {
        sent = await sendManualPrebookReminderEmail(payload);
      } else if (reservation.status === "expired") {
        sent = await sendPrebookExpiredEmail(payload);
      } else if (
        reservation.status === "collected" ||
        reservation.status === "overdue"
      ) {
        sent = await sendManualCollectedReminderEmail(payload);
      } else {
        return res.status(400).json({
          message:
            "Reminder is only available for reserved, collected, overdue, or expired records.",
        });
      }

      if (!sent) {
        return res.status(400).json({
          message: "Reminder email could not be sent. Check student email or mail configuration.",
        });
      }

      return res.json({
        message: `Reminder sent to ${payload.studentEmail || "student email"}`,
      });

    } catch (err) {
      console.error("Manual reminder error:", err);
      return res.status(500).json({ message: "Failed to send reminder" });
    }
  }
);

/* PAY OVERDUE FINE (admin only) */
app.post(
  "/api/reservations/:id/pay-overdue",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      const reservation = await Reservation.findById(req.params.id)
        .populate("book")
        .populate("user", "-passwordHash");

      if (!reservation) {
        return res.status(404).json({ message: "Reservation not found" });
      }

      // Allow active reservations AND damaged/lost — both can carry an unpaid
      // overdue fine that must be settled before the record is fully closed.
      const isPayableStatus =
        ACTIVE_STATUSES.includes(reservation.status) ||
        reservation.status === "damaged" ||
        reservation.status === "lost";

      if (!isPayableStatus) {
        return res.status(400).json({
          message: "Overdue payment is only allowed for active, damaged, or lost reservations",
        });
      }

      const overdueDays = calculateOverdueDays(reservation);
      const payableOverdue = overdueDays * OVERDUE_FINE_PER_DAY;

      if (payableOverdue <= 0) {
        return res.status(400).json({ message: "This reservation is not overdue" });
      }

      if (reservation.overduePaid) {
        return res.status(400).json({ message: "Overdue fine already paid" });
      }

      const paymentTimestamp = new Date();

      reservation.overduePaid = true;
      reservation.overduePaidAmount = payableOverdue;
      reservation.overduePaidAt = paymentTimestamp;

      // For damaged/lost records: check if paying overdue now fully settles
      // everything (i.e. the damage/lost fine was already paid earlier).
      // If so, stamp finePaid so the record is considered completely closed.
      if (reservation.status === "damaged" || reservation.status === "lost") {
        const fullySettled = isReservationFullySettled(reservation);
        if (fullySettled) {
          reservation.finePaid = true;
          reservation.finePaidAt = paymentTimestamp;
          // status stays "damaged" / "lost" — getFinalSettlementStatus preserves it
          reservation.status = getFinalSettlementStatus(reservation);
        }
      }

      await reservation.save();

      // Re-fetch with populated refs so serializeReservation has full book/user data
      const populated = await Reservation.findById(reservation._id)
        .populate("book")
        .populate("user", "-passwordHash");

      return res.json({
        message: `Overdue fine paid successfully: ₹${payableOverdue}`,
        reservation: serializeReservation(populated),
      });
    } catch (err) {
      console.error("Pay overdue fine error:", err);
      return res.status(500).json({ message: "Failed to process overdue payment" });
    }
  }
);

/* PAY LOST / DAMAGE FINE (admin only)
 *
 * POST /api/reservations/:id/pay-fine
 * Body: { type: "damage" | "lost" }
 *
 * Single endpoint that atomically MARKS the book AND RECORDS payment.
 * It is only called after the admin confirms the payment simulation in the
 * QR modal, so the book is never marked as damaged/lost until real payment
 * is confirmed.
 *
 * For "damage":
 *   • If the book is still active (collected/overdue) and not yet marked:
 *       – Sets damageFine = BOOK_DAMAGE_FINE
 *       – Sets status = "damaged", returnedAt = now
 *       – Increments availableCopies (book is physically back on the shelf)
 *   • Then immediately records damageFinePaid = true.
 *
 * For "lost":
 *   • If the book is still active and not yet marked:
 *       – Sets lostFine = BOOK_LOST_FINE
 *       – Sets status = "lost"
 *       – Does NOT touch availableCopies (lost books never return to stock)
 *       – Does NOT set returnedAt (book was never physically returned)
 *   • Then immediately records lostFinePaid = true.
 *
 * In both cases finePaid becomes true only when ALL outstanding fines
 * (overdue + this) are fully settled.
 */
app.post(
  "/api/reservations/:id/pay-fine",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      const { type } = req.body || {};

      if (type !== "damage" && type !== "lost") {
        return res.status(400).json({
          message: 'Request body must include { type: "damage" } or { type: "lost" }.',
        });
      }

      const reservation = await Reservation.findById(req.params.id)
        .populate("book")
        .populate("user", "-passwordHash");

      if (!reservation) {
        return res.status(404).json({ message: "Reservation not found" });
      }

      const book = reservation.book;
      const paymentTimestamp = new Date();

      // ── DAMAGE ────────────────────────────────────────────────────────────
      if (type === "damage") {

        if (reservation.damageFinePaid) {
          return res.status(400).json({
            message: "Damage fine has already been paid for this reservation.",
          });
        }

        if (isLostRecord(reservation)) {
          return res.status(400).json({
            message: "This reservation is marked as lost. Cannot pay damage fine.",
          });
        }

        const alreadyMarked =
          isDamagedRecord(reservation) || Number(reservation.damageFine || 0) > 0;

        if (!alreadyMarked) {
          // Book must be physically collected before it can be damaged.
          // "reserved" = pre-booked but never picked up → no collectedAt, cannot be damaged.
          if (reservation.status !== "collected") {
            return res.status(400).json({
              message: "Book damage can only be recorded after the book has been collected.",
            });
          }

          reservation.damageFine = BOOK_DAMAGE_FINE;
          reservation.damageFinePaid = false;
          reservation.damageFinePaidAt = null;
          reservation.status = "damaged";
          if (!reservation.returnedAt) reservation.returnedAt = paymentTimestamp;

          // Restore one copy to available stock — damaged book is physically back
          if (book?._id) await incrementAvailableCopiesSafely(book._id);
        }

        // Record the payment — this is what moves the record to the Damaged section
        reservation.damageFinePaid = true;
        reservation.damageFinePaidAt = paymentTimestamp;
        reservation.status = "damaged";

        reservation.finePaid = isReservationFullySettled(reservation);
        if (reservation.finePaid) reservation.finePaidAt = paymentTimestamp;

        await reservation.save();

        return res.json({
          message: `Damage fine paid successfully: ₹${reservation.damageFine}`,
          reservation: serializeReservation(reservation),
        });
      }

      // ── LOST ──────────────────────────────────────────────────────────────
      if (type === "lost") {

        if (reservation.lostFinePaid) {
          return res.status(400).json({
            message: "Lost fine has already been paid for this reservation.",
          });
        }

        if (isDamagedRecord(reservation)) {
          return res.status(400).json({
            message: "This reservation is marked as damaged. Cannot pay lost fine.",
          });
        }

        const alreadyMarked =
          isLostRecord(reservation) || Number(reservation.lostFine || 0) > 0;

        if (!alreadyMarked) {
          // Book must be physically collected before it can be reported lost.
          // "reserved" = pre-booked but never picked up → no collectedAt, cannot be lost.
          if (reservation.status !== "collected") {
            return res.status(400).json({
              message: "Book lost can only be recorded after the book has been collected.",
            });
          }

          reservation.lostFine = BOOK_LOST_FINE;
          reservation.lostFinePaid = false;
          reservation.lostFinePaidAt = null;
          reservation.status = "lost";
          // Do NOT set returnedAt — lost books are never physically returned
          // Do NOT increment availableCopies — lost books are permanently gone
        }

        // Record the payment — this is what moves the record to the Lost section
        reservation.lostFinePaid = true;
        reservation.lostFinePaidAt = paymentTimestamp;
        reservation.status = "lost";

        reservation.finePaid = isReservationFullySettled(reservation);
        if (reservation.finePaid) reservation.finePaidAt = paymentTimestamp;

        await reservation.save();

        return res.json({
          message: `Lost fine paid successfully: ₹${reservation.lostFine}`,
          reservation: serializeReservation(reservation),
        });
      }

    } catch (err) {
      console.error("Pay fine error:", err);
      return res.status(500).json({ message: "Failed to process fine payment" });
    }
  }
);

/* =========================================
   WALK-IN CHECKOUT (admin only)
   POST /api/reservations/walkin
========================================= */
app.post(
  "/api/reservations/walkin",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      const { userId, bookId, dueDate } = req.body;

      if (!userId || !bookId || !dueDate) {
        return res
          .status(400)
          .json({ message: "userId, bookId, and dueDate are required." });
      }

      // Run expiry sweep so availableCopies is accurate
      await expireStalePreBookings();

      const [user, book] = await Promise.all([
        User.findById(userId).select("name email studentId"),
        Book.findById(bookId),
      ]);

      if (!user) return res.status(404).json({ message: "Student not found." });
      if (!book) return res.status(404).json({ message: "Book not found." });

      // ── Per-student+book duplicate guard ───────────────────────────────────
      // RULE: block ONLY when THIS student already has an ACTIVE record for THIS
      // book. Different students may check out or pre-book the same book
      // concurrently (as long as copies are available — checked below).
      //
      // Active = "reserved" | "collected" (covers overdue and active walk-in
      // checkouts — both carry status "collected" in the database).
      // Terminal states (returned, cancelled, expired) and lost+paid records are
      // excluded — a prior closed record must never block a fresh walk-in checkout.
      //
      // This check intentionally runs BEFORE the availableCopies guard so that
      // the most actionable error is surfaced first: "student already has it" is
      // more specific than "no copies left".
      const existingUserReservation = await Reservation.findOne({
        user: userId,
        book: book._id,
        ...activeDuplicateFilter(),
      });

      if (existingUserReservation) {
        const conflictStatus = existingUserReservation.status; // "reserved" | "collected"
        const msg =
          conflictStatus === "collected"
            ? "Book already checked out by this student"
            : "Book already pre-booked by this student";
        return res.status(400).json({ message: msg, conflictStatus });
      }

      // ── Stock availability guard ────────────────────────────────────────────
      // Only block when there are literally no copies left in stock.
      // This is a physical-copy constraint, not a duplicate check — it applies
      // to ALL students equally (you cannot lend a copy that does not exist).
      if (book.availableCopies <= 0) {
        return res
          .status(400)
          .json({ message: "No copies available for this book." });
      }

      // Create reservation directly in "collected" state — no pre-book step
      const walkInDueDate = new Date(dueDate);
      walkInDueDate.setHours(17, 0, 0, 0); // fixed 5:00 PM return time
      const reservation = await Reservation.create({
        user: userId,
        book: bookId,
        status: "collected",
        reservedAt: null,
        dueDate: walkInDueDate,
        collectedAt: new Date(),
        isWalkIn: true,
      });

      // Decrement available copies, clamped to 0
      await decrementAvailableCopiesSafely(bookId);

      const populated = await Reservation.findById(reservation._id)
        .populate("user", "-passwordHash")
        .populate("book");

      return res.status(201).json({
        message: "Walk-in checkout recorded successfully.",
        reservation: serializeReservation(populated),
      });
    } catch (err) {
      console.error("[walkin-checkout]", err);
      return res.status(500).json({ message: err.message || "Server error." });
    }
  }
);

/* =========================================
   ADMIN: UPDATE STUDENT ID FOR EXISTING USERS
   PUT /api/admin/users/:id/student-id
========================================= */
app.put(
  "/api/admin/users/:id/student-id",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      const { studentId } = req.body;

      if (!studentId?.trim()) {
        return res.status(400).json({ message: "Student ID is required" });
      }

      const conflict = await User.findOne({
        studentId: studentId.trim(),
        _id: { $ne: req.params.id },
      });

      if (conflict) {
        return res
          .status(409)
          .json({ message: "Student ID already assigned to another account" });
      }

      const user = await User.findByIdAndUpdate(
        req.params.id,
        { studentId: studentId.trim() },
        { new: true }
      );

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      return res.json({
        message: "Student ID updated successfully",
        user: formatUser(user),
      });
    } catch (err) {
      console.error("Update student ID error:", err);
      return res.status(500).json({ message: "Failed to update Student ID" });
    }
  }
);

/* =========================================
   ADMIN: LIST ALL STUDENTS (for ID management)
   GET /api/admin/users
========================================= */
app.get(
  "/api/admin/users",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      const students = await User.find({ role: "student" }).select("-passwordHash");
      return res.json({ users: students.map(formatUser) });
    } catch (err) {
      console.error("List users error:", err);
      return res.status(500).json({ message: "Failed to fetch users" });
    }
  }
);

/* =========================================
   ADMIN: REPORTS
   ─────────────────────────────────────────
   Shared internal helper — single DB query,
   expiry sweep, then buildReservationReport.
   All report routes call this.
========================================= */

/**
 * Fetches all reservations created in [from, to], runs the pre-book
 * expiry sweep first, then delegates to buildReservationReport.
 *
 * @param {Date}   from   Period start — must already have getStartOfDay applied
 * @param {Date}   to     Period end   — must already have getEndOfDay applied
 * @param {string} label  Human-readable label returned to the frontend
 */
async function fetchReport(from, to, label) {
  await expireStalePreBookings();

  const reservations = await Reservation.find({
    createdAt: { $gte: from, $lte: to },
  })
    .populate("book")
    .populate("user", "-passwordHash");

  return buildReservationReport(reservations, label, from, to);
}

/* =========================================
   EXCEL EXPORT HELPERS  (ExcelJS)
   ─────────────────────────────────────────
   Pure, side-effect-free helpers.
   No DB calls. No HTTP. No file I/O here.

   Call sequence inside every export route:

     const { report, reservations } = await fetchReportWithRaw(from, to, label);
     const wb       = await buildReportWorkbook(report, reservations);
     const filename = filenameForDay(date);          // or filenameForMonth / filenameForYear / etc.
     await streamWorkbookResponse(res, wb, filename);
========================================= */

// ── Filename helpers (one explicit helper per export shape) ────────────────

/**
 * Zero-pads n to 2 digits. Used only for DD.MM.YYYY formatting.
 * @param {number} n
 * @returns {string}
 */
function _p2(n) {
  return String(n).padStart(2, "0");
}

/**
 * Formats a Date as DD.MM.YYYY for use in filenames.
 * @param {Date} d
 * @returns {string}  e.g. "26.04.2026"
 */
function fmtFilenameDate(d) {
  return `${_p2(d.getDate())}.${_p2(d.getMonth() + 1)}.${d.getFullYear()}`;
}

const MONTH_NAMES_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Single day  →  report_DD.MM.YYYY.xlsx */
function filenameForDay(date) {
  return `report_${fmtFilenameDate(date)}.xlsx`;
}

/** Date range  →  report_DD.MM.YYYY_to_DD.MM.YYYY.xlsx */
function filenameForDateRange(from, to) {
  return `report_${fmtFilenameDate(from)}_to_${fmtFilenameDate(to)}.xlsx`;
}

// ── Label helpers (human-readable strings stored in report.label) ──────────

// fmtLabelDay removed — use formatDate(d) instead

/**
 * Formats a Date as "April 2026" for report labels.
 * @param {Date} d
 * @returns {string}
 */
function fmtLabelMonth(d) {
  return `${MONTH_NAMES_LONG[d.getMonth()]} ${d.getFullYear()}`;
}

/** Single month  →  report_Month_YYYY.xlsx  (e.g. report_April_2026.xlsx) */
function filenameForMonth(date) {
  return `report_${MONTH_NAMES_LONG[date.getMonth()]}_${date.getFullYear()}.xlsx`;
}

/** Month range  →  report_Month_YYYY_to_Month_YYYY.xlsx */
function filenameForMonthRange(fromDate, toDate) {
  return `report_${MONTH_NAMES_LONG[fromDate.getMonth()]}_${fromDate.getFullYear()}_to_${MONTH_NAMES_LONG[toDate.getMonth()]}_${toDate.getFullYear()}.xlsx`;
}

/** Single year  →  report_YYYY.xlsx  (e.g. report_2026.xlsx) */
function filenameForYear(year) {
  return `report_${year}.xlsx`;
}

/** Year range  →  report_YYYY_to_YYYY.xlsx  (e.g. report_2025_to_2026.xlsx) */
function filenameForYearRange(fromYear, toYear) {
  return `report_${fromYear}_to_${toYear}.xlsx`;
}

// fmtXlsxDate removed — use formatDateTime(value) instead

/**
 * Formats a Date as "DD/MM/YYYY" for report labels and Excel cells.
 * Returns "-" for null / invalid values.
 * @param {Date|string|null} value
 * @returns {string}
 */
function formatDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Formats a Date as "DD/MM/YYYY, H:MM AM/PM" for report cells.
 * Returns "-" for null / invalid values.
 * @param {Date|string|null} value
 * @returns {string}
 */
function formatDateTime(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  let hh = d.getHours();
  const min = String(d.getMinutes()).padStart(2, "0");
  const ampm = hh >= 12 ? "PM" : "AM";
  hh = hh % 12 || 12;
  return `${dd}/${mm}/${yyyy} • ${hh}:${min} ${ampm}`;
}

/**
 * Flattens an array of populated Reservation documents into plain row objects
 * for the "Detailed Transactions" worksheet.
 *
 * Reuses helpers already defined in this file:
 *   getDerivedReservationStatus(r)  → virtual status string (incl. "overdue")
 *   getReservationFinancials(r)     → { overdueDays, overdueFine, damageFine,
 *                                       lostFine, totalFine }
 *
 * @param  {Object[]} reservations  Populated Reservation docs (.book + .user)
 * @returns {Object[]}              Plain row objects keyed to the column definitions
 *                                  in buildReportWorkbook (Sheet 3)
 */
function formatTransactionRows(reservations) {
  const formatStatusLabel = (status) => {
    const raw = String(status || "").trim().toLowerCase();

    switch (raw) {
      case "pending":
        return "Pending";
      case "approved":
        return "Approved";
      case "collected":
        return "Collected";
      case "returned":
        return "Returned";
      case "cancelled":
        return "Cancelled";
      case "expired":
        return "Expired";
      case "rejected":
        return "Rejected";
      case "overdue":
        return "Overdue";
      case "damaged":
        return "Damaged";
      case "lost":
        return "Lost";
      default:
        return raw
          ? raw.charAt(0).toUpperCase() + raw.slice(1)
          : "-";
    }
  };

  return reservations.map((r, index) => {
    const student =
      r.user && typeof r.user === "object"
        ? r.user
        : r.studentId && typeof r.studentId === "object"
          ? r.studentId
          : null;

    const book =
      r.book && typeof r.book === "object"
        ? r.book
        : r.bookId && typeof r.bookId === "object"
          ? r.bookId
          : null;

    // overdueFine is not stored in the DB schema — compute it from the
    // stored primitive fields so the report always reflects the real amount.
    const overdueDaysR = calculateOverdueDays(r);
    const overdueFine = r.overduePaid
      ? Number(r.overduePaidAmount || 0)
      : overdueDaysR * OVERDUE_FINE_PER_DAY;
    const damageFine = Number(r.damageFine || 0);
    const lostFine = Number(r.lostFine || 0);
    const totalFine =
      Number(overdueFine || 0) +
      Number(damageFine || 0) +
      Number(lostFine || 0);

    const paymentStatus =
      totalFine <= 0
        ? "No Fine"
        : r.finePaid || r.lostFinePaid || r.damageFinePaid || r.overdueFinePaid || r.overduePaid
          ? "Paid"
          : "Pending";

    return {
      serialNo: index + 1,
      studentName: student?.name || "-",
      registerNo:
        student?.registerNumber ||
        student?.studentId ||
        student?.registerNo ||
        student?.rollNumber ||
        "-",
      bookTitle: book?.title || "-",
      author: book?.author || "-",
      type: r.isWalkIn ? "Walk-In" : "Pre-Booking",
      // Use derivedStatus so the status label reflects the stored terminal status.
      status: formatStatusLabel(getDerivedReservationStatus(r)),
      reservedOn: formatDateTime(r.createdAt),
      collectedOn: formatDateTime(r.collectedAt),
      dueDate: formatDateTime(r.dueDate),
      returnedOn: formatDateTime(r.returnedAt),
      totalFine,
      paymentStatus,
    };
  });
}

// Shared bold + fill style applied to every header row across all three sheets.
const HEADER_STYLE = {
  font: { bold: true, color: { argb: "FF1F2937" } },  // near-black text
  fill: {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE5E7EB" },                       // light grey background
  },
  alignment: { vertical: "middle", horizontal: "left" },
  border: {
    bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
  },
};

/**
 * Applies HEADER_STYLE to every cell in the first row of a worksheet.
 *
 * @param {ExcelJS.Worksheet} ws
 */
function styleHeaderRow(ws) {
  ws.getRow(1).eachCell((cell) => {
    cell.font = HEADER_STYLE.font;
    cell.fill = HEADER_STYLE.fill;
    cell.alignment = HEADER_STYLE.alignment;
    cell.border = HEADER_STYLE.border;
  });
  ws.getRow(1).height = 20;
}

/**
 * Builds a three-sheet ExcelJS workbook from a report summary + raw reservations.
 *
 *  Sheet 1 — Summary
 *    Two-column key/value table of every top-level metric.
 *
 *  Sheet 2 — Top Books
 *    Ranked list (up to 5) of the most-reserved books in the period.
 *
 *  Sheet 3 — Detailed Transactions
 *    One fully-flattened row per reservation, with all financials.
 *
 * The returned workbook is ready to stream:
 *   await wb.xlsx.write(res);
 *
 * @param  {Object}   report        Return value of buildReservationReport
 * @param  {Object[]} reservations  Populated Reservation docs for the same period
 * @returns {Promise<ExcelJS.Workbook>}
 */
async function buildReportWorkbook(report, reservations) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Library Management System";
  workbook.created = new Date();

  const safeLabel = report?.label || "Library Report";

  // ─────────────────────────────────────────────────────────────
  // Shared style helpers
  // ─────────────────────────────────────────────────────────────
  function styleMainTitle(cell) {
    cell.font = { bold: true, size: 18, color: { argb: "1F2937" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  }

  function styleSubTitle(cell) {
    cell.font = { bold: true, size: 12, color: { argb: "4B5563" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  }

  function styleSectionTitle(cell) {
    cell.font = { bold: true, size: 12, color: { argb: "111827" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "E5E7EB" },
    };
    cell.alignment = { horizontal: "left", vertical: "middle" };
    cell.border = {
      top: { style: "thin", color: { argb: "D1D5DB" } },
      left: { style: "thin", color: { argb: "D1D5DB" } },
      bottom: { style: "thin", color: { argb: "D1D5DB" } },
      right: { style: "thin", color: { argb: "D1D5DB" } },
    };
  }

  function styleHeaderRow(row) {
    row.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "2563EB" },
      };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = {
        top: { style: "thin", color: { argb: "D1D5DB" } },
        left: { style: "thin", color: { argb: "D1D5DB" } },
        bottom: { style: "thin", color: { argb: "D1D5DB" } },
        right: { style: "thin", color: { argb: "D1D5DB" } },
      };
    });
  }

  function styleBodyBorders(ws, fromRow, toRow, fromCol, toCol) {
    for (let r = fromRow; r <= toRow; r++) {
      for (let c = fromCol; c <= toCol; c++) {
        const cell = ws.getCell(r, c);
        cell.border = {
          top: { style: "thin", color: { argb: "E5E7EB" } },
          left: { style: "thin", color: { argb: "E5E7EB" } },
          bottom: { style: "thin", color: { argb: "E5E7EB" } },
          right: { style: "thin", color: { argb: "E5E7EB" } },
        };
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Sheet 1: Summary
  // ─────────────────────────────────────────────────────────────
  const summary = workbook.addWorksheet("Summary");
  summary.columns = [
    { width: 28 },
    { width: 32 },
  ];

  summary.mergeCells("A1:B1");
  summary.getCell("A1").value = "Library Usage Report";
  styleMainTitle(summary.getCell("A1"));
  summary.getRow(1).height = 26;

  summary.mergeCells("A2:B2");
  summary.getCell("A2").value = safeLabel;
  styleSubTitle(summary.getCell("A2"));
  summary.getRow(2).height = 20;

  summary.addRow([]);

  const generatedOn = formatDateTime(new Date());

  summary.mergeCells("A4:B4");
  summary.getCell("A4").value = "Report Information";
  styleSectionTitle(summary.getCell("A4"));

  summary.addRow(["Period", report?.label || "-"]);
  summary.addRow(["From Date", formatDate(report?.fromDate)]);
  summary.addRow(["To Date", formatDate(report?.toDate)]);
  summary.addRow(["Generated On", generatedOn]);

  const infoStartRow = 5;
  const infoEndRow = 8;
  styleBodyBorders(summary, infoStartRow, infoEndRow, 1, 2);

  summary.addRow([]);

  const metricsHeaderRow = 10;
  summary.getCell(`A${metricsHeaderRow}`).value = "Metric";
  summary.getCell(`B${metricsHeaderRow}`).value = "Count";
  styleHeaderRow(summary.getRow(metricsHeaderRow));

  const metricRows = [
    ["Total Transactions", report?.totalTransactions ?? 0],
    ["Pre-Bookings", report?.totalPreBookings ?? 0],
    ["Walk-In Checkouts", report?.totalWalkInCheckouts ?? 0],
    ["Collected", report?.totalCollected ?? 0],
    ["Returned", report?.totalReturned ?? 0],
    ["Cancelled", report?.totalCancelled ?? 0],
    ["Expired", report?.totalExpired ?? 0],
    ["Overdue Active", report?.totalOverdueActive ?? 0],
    ["Damaged Books", report?.totalDamaged ?? 0],
    ["Lost Books", report?.totalLost ?? 0],
  ];

  metricRows.forEach((row) => summary.addRow(row));

  const metricStartRow = metricsHeaderRow + 1;
  const metricEndRow = metricStartRow + metricRows.length - 1;
  styleBodyBorders(summary, metricStartRow, metricEndRow, 1, 2);

  for (let r = metricStartRow; r <= metricEndRow; r++) {
    summary.getCell(`B${r}`).alignment = { horizontal: "center", vertical: "middle" };
  }

  summary.views = [{ state: "frozen", ySplit: 10 }];
  summary.autoFilter = `A${metricsHeaderRow}:B${metricsHeaderRow}`;

  // ─────────────────────────────────────────────────────────────
  // Sheet 2: Top Books
  // ─────────────────────────────────────────────────────────────
  const topBooks = workbook.addWorksheet("Top Books");
  topBooks.columns = [
    { header: "Rank", key: "rank", width: 10 },
    { header: "Book Title", key: "title", width: 38 },
    { header: "Author", key: "author", width: 24 },
    { header: "Total Reservations", key: "count", width: 18 },
  ];

  const topBooksHeader = topBooks.getRow(1);
  styleHeaderRow(topBooksHeader);
  topBooksHeader.height = 22;

  (report?.topBooks || []).forEach((b, index) => {
    topBooks.addRow({
      rank: index + 1,
      title: b.title || "-",
      author: b.author || "-",
      count: b.count || 0,
    });
  });

  if ((report?.topBooks || []).length === 0) {
    topBooks.addRow({
      rank: "-",
      title: "No book data available for this report period",
      author: "-",
      count: 0,
    });
  }

  const topBooksLastRow = topBooks.rowCount;
  styleBodyBorders(topBooks, 2, topBooksLastRow, 1, 4);

  for (let r = 2; r <= topBooksLastRow; r++) {
    topBooks.getCell(`A${r}`).alignment = { horizontal: "center", vertical: "middle" };
    topBooks.getCell(`D${r}`).alignment = { horizontal: "center", vertical: "middle" };
  }

  topBooks.views = [{ state: "frozen", ySplit: 1 }];
  topBooks.autoFilter = "A1:D1";

  // ─────────────────────────────────────────────────────────────
  // Sheet 3: Detailed Transactions
  // ─────────────────────────────────────────────────────────────
  const detailRows = formatTransactionRows(reservations);
  const details = workbook.addWorksheet("Detailed Transactions");

  details.columns = [
    { header: "#", key: "serialNo", width: 8 },
    { header: "Student Name", key: "studentName", width: 24 },
    { header: "Register No", key: "registerNo", width: 16 },
    { header: "Book Title", key: "bookTitle", width: 34 },
    { header: "Author", key: "author", width: 20 },
    { header: "Type", key: "type", width: 14 },
    { header: "Status", key: "status", width: 14 },
    { header: "Reserved On", key: "reservedOn", width: 22 },
    { header: "Collected On", key: "collectedOn", width: 22 },
    { header: "Due Date", key: "dueDate", width: 22 },
    { header: "Returned On", key: "returnedOn", width: 22 },
    { header: "Total Fine (₹)", key: "totalFine", width: 16 },
    { header: "Payment Status", key: "paymentStatus", width: 16 },
  ];

  const detailsHeader = details.getRow(1);
  styleHeaderRow(detailsHeader);
  detailsHeader.height = 22;

  detailRows.forEach((row) => details.addRow(row));

  if (detailRows.length === 0) {
    details.addRow({
      serialNo: "-",
      studentName: "No transactions found for this report period",
      registerNo: "-",
      bookTitle: "-",
      author: "-",
      type: "-",
      status: "-",
      reservedOn: "-",
      collectedOn: "-",
      dueDate: "-",
      returnedOn: "-",
      totalFine: 0,
      paymentStatus: "-",
    });
  }

  const detailsLastRow = details.rowCount;
  styleBodyBorders(details, 2, detailsLastRow, 1, 13);

  for (let r = 2; r <= detailsLastRow; r++) {
    details.getCell(`A${r}`).alignment = { horizontal: "center", vertical: "middle" };
    details.getCell(`F${r}`).alignment = { horizontal: "center", vertical: "middle" };
    details.getCell(`G${r}`).alignment = { horizontal: "center", vertical: "middle" };
    details.getCell(`L${r}`).alignment = { horizontal: "center", vertical: "middle" };
    details.getCell(`M${r}`).alignment = { horizontal: "center", vertical: "middle" };
    details.getCell(`L${r}`).numFmt = '₹#,##0.00';
  }

  details.views = [{ state: "frozen", ySplit: 1 }];
  details.autoFilter = "A1:M1";

  return workbook;
}
/**
 * Like fetchReport, but returns BOTH the summary object AND the raw populated
 * reservations array — both are needed by buildReportWorkbook.
 *
 * All existing report routes keep calling fetchReport (unchanged).
 * All export routes call this instead.
 */
async function fetchReportWithRaw(from, to, label) {
  await expireStalePreBookings();

  const reservations = await Reservation.find({
    createdAt: { $gte: from, $lte: to },
  })
    .populate("book")
    .populate("user", "-passwordHash");

  const report = buildReservationReport(reservations, label, from, to);
  return { report, reservations };
}

/**
 * Sets response headers and pipes the ExcelJS workbook directly into the
 * HTTP response stream. Call this BEFORE writing any other data to res.
 */

async function streamWorkbookResponse(res, workbook, filename) {
  const encodedFilename = encodeURIComponent(filename);

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );

  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filename}"; filename*=UTF-8''${encodedFilename}`
  );

  res.setHeader("Cache-Control", "no-store");

  await workbook.xlsx.write(res);
}

/* TODAY
   GET /api/admin/reports/today
========================================= */
app.get(
  "/api/admin/reports/today",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      const now = new Date();
      const from = getStartOfDay(now);
      const to = getEndOfDay(now);
      const label = formatDate(now);

      const report = await fetchReport(from, to, label);
      return res.json({ report });
    } catch (err) {
      console.error("Report today error:", err);
      return res.status(500).json({ message: "Failed to generate today's report" });
    }
  }
);

/* THIS WEEK  (Monday → Sunday, ISO 8601)
   GET /api/admin/reports/week
========================================= */
app.get(
  "/api/admin/reports/week",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      const now = new Date();
      const from = getStartOfWeek(now);
      const to = getEndOfWeek(now);
      const label = `${formatDate(from)} – ${formatDate(to)}`;

      const report = await fetchReport(from, to, label);
      return res.json({ report });
    } catch (err) {
      console.error("Report week error:", err);
      return res.status(500).json({ message: "Failed to generate weekly report" });
    }
  }
);

/* THIS MONTH
   GET /api/admin/reports/month
========================================= */
app.get(
  "/api/admin/reports/month",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      const now = new Date();
      const from = getStartOfMonth(now);
      const to = getEndOfMonth(now);
      const label = fmtLabelMonth(now);

      const report = await fetchReport(from, to, label);
      return res.json({ report });
    } catch (err) {
      console.error("Report month error:", err);
      return res.status(500).json({ message: "Failed to generate monthly report" });
    }
  }
);

/* THIS YEAR
   GET /api/admin/reports/year
========================================= */
app.get(
  "/api/admin/reports/year",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      const now = new Date();
      const from = getStartOfYear(now);
      const to = getEndOfYear(now);
      const label = `${now.getFullYear()}`;

      const report = await fetchReport(from, to, label);
      return res.json({ report });
    } catch (err) {
      console.error("Report year error:", err);
      return res.status(500).json({ message: "Failed to generate yearly report" });
    }
  }
);

/* LAST 10 DAYS  — one summary object per calendar day, oldest → newest
   GET /api/admin/reports/last-10-days
   Response: { days: [ ...10 report objects ] }
========================================= */
app.get(
  "/api/admin/reports/last-10-days",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      await expireStalePreBookings();

      const today = new Date();

      // Build the full 10-day window for a SINGLE DB round-trip
      const windowStart = getStartOfDay(new Date(today));
      windowStart.setDate(windowStart.getDate() - 9); // 9 days ago → 10 days incl. today
      const windowEnd = getEndOfDay(today);

      const reservations = await Reservation.find({
        createdAt: { $gte: windowStart, $lte: windowEnd },
      })
        .populate("book")
        .populate("user", "-passwordHash");

      // Slice the in-memory set into individual daily reports (no extra DB calls)
      const days = [];
      for (let i = 9; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const from = getStartOfDay(d);
        const to = getEndOfDay(d);

        const label = formatDate(from);

        const daySlice = reservations.filter((r) => {
          const created = new Date(r.createdAt);
          return created >= from && created <= to;
        });

        // Build the stat object and stamp a plain local "YYYY-MM-DD" string on it.
        // Using arithmetic instead of new Date(isoString) prevents any UTC ↔ local
        // shift when the frontend reads it back.
        const isoDate =
          `${from.getFullYear()}-` +
          `${String(from.getMonth() + 1).padStart(2, "0")}-` +
          `${String(from.getDate()).padStart(2, "0")}`;

        const dayObj = buildReservationReport(daySlice, label, from, to);
        dayObj.date = isoDate;
        days.push(dayObj);
      }

      return res.json({ days });
    } catch (err) {
      console.error("Report last-10-days error:", err);
      return res.status(500).json({ message: "Failed to generate last-10-days report" });
    }
  }
);

/* SINGLE DAY BY DATE
   GET /api/admin/reports/day/:date    (format: YYYY-MM-DD)
========================================= */
app.get(
  "/api/admin/reports/day/:date",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      // Split manually so Node never treats "YYYY-MM-DD" as UTC midnight,
      // which would shift the date by one day in timezones east of UTC.
      const parts = req.params.date.split("-").map(Number);
      const [year, month, day] = parts;

      if (
        parts.length !== 3 ||
        !year || !month || !day ||
        month < 1 || month > 12 ||
        day < 1 || day > 31
      ) {
        return res
          .status(400)
          .json({ message: "Invalid date. Expected format: YYYY-MM-DD" });
      }

      // new Date(year, month - 1, day) → local midnight — no UTC shift
      const parsed = new Date(year, month - 1, day);

      if (isNaN(parsed.getTime())) {
        return res
          .status(400)
          .json({ message: "Invalid date. Expected format: YYYY-MM-DD" });
      }

      const from = getStartOfDay(parsed);
      const to = getEndOfDay(parsed);
      const label = formatDate(from);

      const report = await fetchReport(from, to, label);
      return res.json({ report });
    } catch (err) {
      console.error("Report day error:", err);
      return res.status(500).json({ message: "Failed to generate day report" });
    }
  }
);

/* CUSTOM RANGE
   GET /api/admin/reports/range?mode=date&from=YYYY-MM-DD&to=YYYY-MM-DD
   GET /api/admin/reports/range?mode=month&from=YYYY-MM&to=YYYY-MM
   GET /api/admin/reports/range?mode=year&from=YYYY&to=YYYY
========================================= */
app.get(
  "/api/admin/reports/range",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      const { mode, from: fromParam, to: toParam } = req.query;

      if (!mode || !fromParam || !toParam) {
        return res.status(400).json({
          message: "Query params 'mode', 'from', and 'to' are all required.",
        });
      }

      let from, to, label;

      // ── mode=date  (YYYY-MM-DD → YYYY-MM-DD) ─────────────────────────
      if (mode === "date") {
        // Split manually so Node never treats "YYYY-MM-DD" as UTC midnight,
        // which would shift the date by one day in timezones east of UTC.
        const fromParts = fromParam.split("-").map(Number);
        const toParts = toParam.split("-").map(Number);
        const [fromYear, fromMonthD, fromDay] = fromParts;
        const [toYear, toMonthD, toDay] = toParts;

        if (
          fromParts.length !== 3 || !fromYear || !fromMonthD || !fromDay ||
          fromMonthD < 1 || fromMonthD > 12 || fromDay < 1 || fromDay > 31 ||
          toParts.length !== 3 || !toYear || !toMonthD || !toDay ||
          toMonthD < 1 || toMonthD > 12 || toDay < 1 || toDay > 31
        ) {
          return res.status(400).json({
            message: "Invalid date values. Use YYYY-MM-DD for mode=date.",
          });
        }

        // new Date(year, month - 1, day) → local midnight — no UTC shift
        const fromParsed = new Date(fromYear, fromMonthD - 1, fromDay);
        const toParsed = new Date(toYear, toMonthD - 1, toDay);

        if (isNaN(fromParsed.getTime()) || isNaN(toParsed.getTime())) {
          return res.status(400).json({
            message: "Invalid date values. Use YYYY-MM-DD for mode=date.",
          });
        }
        if (fromParsed > toParsed) {
          return res
            .status(400)
            .json({ message: "'from' date must not be after 'to' date." });
        }

        from = getStartOfDay(fromParsed);
        to = getEndOfDay(toParsed);
        label = `${formatDate(fromParsed)} – ${formatDate(toParsed)}`;

        // ── mode=month  (YYYY-MM → YYYY-MM) ──────────────────────────────
      } else if (mode === "month") {
        const [fromYear, fromMonth] = fromParam.split("-").map(Number);
        const [toYear, toMonth] = toParam.split("-").map(Number);

        if (
          !fromYear || !fromMonth || !toYear || !toMonth ||
          fromMonth < 1 || fromMonth > 12 ||
          toMonth < 1 || toMonth > 12
        ) {
          return res.status(400).json({
            message: "Invalid month values. Use YYYY-MM for mode=month.",
          });
        }

        const fromBase = new Date(fromYear, fromMonth - 1, 1);
        const toBase = new Date(toYear, toMonth - 1, 1);

        if (fromBase > toBase) {
          return res
            .status(400)
            .json({ message: "'from' month must not be after 'to' month." });
        }

        from = getStartOfMonth(fromBase);
        to = getEndOfMonth(toBase);

        label = fromYear === toYear && fromMonth === toMonth
          ? fmtLabelMonth(fromBase)
          : `${fmtLabelMonth(fromBase)} – ${fmtLabelMonth(toBase)}`;

        // ── mode=year  (YYYY → YYYY) ──────────────────────────────────────
      } else if (mode === "year") {
        const fromYear = parseInt(fromParam, 10);
        const toYear = parseInt(toParam, 10);

        if (isNaN(fromYear) || isNaN(toYear)) {
          return res.status(400).json({
            message: "Invalid year values. Use YYYY for mode=year.",
          });
        }
        if (fromYear > toYear) {
          return res
            .status(400)
            .json({ message: "'from' year must not be after 'to' year." });
        }

        from = getStartOfYear(new Date(fromYear, 0, 1));
        to = getEndOfYear(new Date(toYear, 0, 1));
        label = fromYear === toYear ? `${fromYear}` : `${fromYear} – ${toYear}`;

        // ── unknown mode ──────────────────────────────────────────────────
      } else {
        return res.status(400).json({
          message: "Invalid 'mode'. Must be one of: date | month | year",
        });
      }

      const report = await fetchReport(from, to, label);
      return res.status(200).json({ report });
    } catch (err) {
      console.error("Report range error:", err);
      return res.status(500).json({ message: "Failed to generate range report" });
    }
  }
);

/* =========================================
   ADMIN: EXCEL EXPORT ROUTES
   ─────────────────────────────────────────
   Each route mirrors its JSON sibling exactly —
   same auth, same date logic, same labels —
   but streams an .xlsx workbook instead of JSON.
========================================= */

/* TODAY EXPORT
   GET /api/admin/reports/today/export
========================================= */
app.get(
  "/api/admin/reports/today/export",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      const now = new Date();
      const from = getStartOfDay(now);
      const to = getEndOfDay(now);

      const label = formatDate(now);
      const { report, reservations } = await fetchReportWithRaw(from, to, label);
      const wb = await buildReportWorkbook(report, reservations);
      const filename = filenameForDay(now);

      await streamWorkbookResponse(res, wb, filename);
    } catch (err) {
      console.error("Export today error:", err);
      return res.status(500).json({ message: "Failed to export today's report" });
    }
  }
);

/* THIS WEEK EXPORT  (Monday → Sunday, ISO 8601)
   GET /api/admin/reports/week/export
========================================= */
app.get(
  "/api/admin/reports/week/export",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      const now = new Date();
      const from = getStartOfWeek(now);
      const to = getEndOfWeek(now);

      const label = `${formatDate(from)} – ${formatDate(to)}`;
      const { report, reservations } = await fetchReportWithRaw(from, to, label);
      const wb = await buildReportWorkbook(report, reservations);
      const filename = filenameForDateRange(from, to);

      await streamWorkbookResponse(res, wb, filename);
    } catch (err) {
      console.error("Export week error:", err);
      return res.status(500).json({ message: "Failed to export weekly report" });
    }
  }
);

/* THIS MONTH EXPORT
   GET /api/admin/reports/month/export
========================================= */
app.get(
  "/api/admin/reports/month/export",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      const now = new Date();
      const from = getStartOfMonth(now);
      const to = getEndOfMonth(now);
      const label = fmtLabelMonth(now);

      const { report, reservations } = await fetchReportWithRaw(from, to, label);
      const wb = await buildReportWorkbook(report, reservations);
      const filename = filenameForMonth(now);

      await streamWorkbookResponse(res, wb, filename);
    } catch (err) {
      console.error("Export month error:", err);
      return res.status(500).json({ message: "Failed to export monthly report" });
    }
  }
);

/* THIS YEAR EXPORT
   GET /api/admin/reports/year/export
========================================= */
app.get(
  "/api/admin/reports/year/export",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      const now = new Date();
      const from = getStartOfYear(now);
      const to = getEndOfYear(now);
      const label = `${now.getFullYear()}`;

      const { report, reservations } = await fetchReportWithRaw(from, to, label);
      const wb = await buildReportWorkbook(report, reservations);
      const filename = filenameForYear(now.getFullYear());

      await streamWorkbookResponse(res, wb, filename);
    } catch (err) {
      console.error("Export year error:", err);
      return res.status(500).json({ message: "Failed to export yearly report" });
    }
  }
);

/* LAST 10 DAYS EXPORT
   GET /api/admin/reports/last-10-days/export
   ─────────────────────────────────────────
   One combined workbook for the full 10-day window.
   Summary + Top Books aggregate all 10 days.
   Detailed Transactions lists every reservation in the window.
========================================= */
app.get(
  "/api/admin/reports/last-10-days/export",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      const today = new Date();

      const windowStart = getStartOfDay(new Date(today));
      windowStart.setDate(windowStart.getDate() - 9);
      const windowEnd = getEndOfDay(today);

      const label = `Last 10 Days (${formatDate(windowStart)} to ${formatDate(windowEnd)})`;

      const { report, reservations } = await fetchReportWithRaw(
        windowStart,
        windowEnd,
        label
      );
      const wb = await buildReportWorkbook(report, reservations);
      const filename = filenameForDateRange(windowStart, windowEnd);

      await streamWorkbookResponse(res, wb, filename);
    } catch (err) {
      console.error("Export last-10-days error:", err);
      return res.status(500).json({ message: "Failed to export last-10-days report" });
    }
  }
);

/* SINGLE DAY BY DATE EXPORT
   GET /api/admin/reports/day/:date/export    (format: YYYY-MM-DD)
========================================= */
app.get(
  "/api/admin/reports/day/:date/export",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      // Split manually — avoids UTC midnight interpretation that shifts the
      // date by one day in timezones east of UTC (e.g. IST UTC+5:30).
      const parts = req.params.date.split("-").map(Number);
      const [year, month, day] = parts;

      if (
        parts.length !== 3 ||
        !year || !month || !day ||
        month < 1 || month > 12 ||
        day < 1 || day > 31
      ) {
        return res
          .status(400)
          .json({ message: "Invalid date. Expected format: YYYY-MM-DD" });
      }

      // new Date(year, month - 1, day) → local midnight — no UTC shift
      const parsed = new Date(year, month - 1, day);

      if (isNaN(parsed.getTime())) {
        return res
          .status(400)
          .json({ message: "Invalid date. Expected format: YYYY-MM-DD" });
      }

      const from = getStartOfDay(parsed);
      const to = getEndOfDay(parsed);
      const label = formatDate(from);

      const { report, reservations } = await fetchReportWithRaw(from, to, label);
      const wb = await buildReportWorkbook(report, reservations);
      const filename = filenameForDay(parsed);

      await streamWorkbookResponse(res, wb, filename);
    } catch (err) {
      console.error("Export day error:", err);
      return res.status(500).json({ message: "Failed to export day report" });
    }
  }
);

/* CUSTOM RANGE EXPORT
   GET /api/admin/reports/range/export?mode=date&from=YYYY-MM-DD&to=YYYY-MM-DD
   GET /api/admin/reports/range/export?mode=month&from=YYYY-MM&to=YYYY-MM
   GET /api/admin/reports/range/export?mode=year&from=YYYY&to=YYYY
========================================= */
app.get(
  "/api/admin/reports/range/export",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      const { mode, from: fromParam, to: toParam } = req.query;

      if (!mode || !fromParam || !toParam) {
        return res.status(400).json({
          message: "Query params 'mode', 'from', and 'to' are all required.",
        });
      }

      let from, to, label;

      if (mode === "date") {
        // Split manually so Node never treats "YYYY-MM-DD" as UTC midnight,
        // which would shift the date by one day in timezones east of UTC.
        const fromParts = fromParam.split("-").map(Number);
        const toParts = toParam.split("-").map(Number);
        const [fromYear, fromMonthD, fromDay] = fromParts;
        const [toYear, toMonthD, toDay] = toParts;

        if (
          fromParts.length !== 3 || !fromYear || !fromMonthD || !fromDay ||
          fromMonthD < 1 || fromMonthD > 12 || fromDay < 1 || fromDay > 31 ||
          toParts.length !== 3 || !toYear || !toMonthD || !toDay ||
          toMonthD < 1 || toMonthD > 12 || toDay < 1 || toDay > 31
        ) {
          return res.status(400).json({
            message: "Invalid date values. Use YYYY-MM-DD for mode=date.",
          });
        }

        // new Date(year, month - 1, day) → local midnight — no UTC shift
        const fromParsed = new Date(fromYear, fromMonthD - 1, fromDay);
        const toParsed = new Date(toYear, toMonthD - 1, toDay);

        if (isNaN(fromParsed.getTime()) || isNaN(toParsed.getTime())) {
          return res.status(400).json({
            message: "Invalid date values. Use YYYY-MM-DD for mode=date.",
          });
        }
        if (fromParsed > toParsed) {
          return res
            .status(400)
            .json({ message: "'from' date must not be after 'to' date." });
        }

        from = getStartOfDay(fromParsed);
        to = getEndOfDay(toParsed);
        label = `${formatDate(fromParsed)} – ${formatDate(toParsed)}`;

      } else if (mode === "month") {
        const [fromYear, fromMonth] = fromParam.split("-").map(Number);
        const [toYear, toMonth] = toParam.split("-").map(Number);

        if (
          !fromYear || !fromMonth || !toYear || !toMonth ||
          fromMonth < 1 || fromMonth > 12 ||
          toMonth < 1 || toMonth > 12
        ) {
          return res.status(400).json({
            message: "Invalid month values. Use YYYY-MM for mode=month.",
          });
        }

        const fromBase = new Date(fromYear, fromMonth - 1, 1);
        const toBase = new Date(toYear, toMonth - 1, 1);

        if (fromBase > toBase) {
          return res
            .status(400)
            .json({ message: "'from' month must not be after 'to' month." });
        }

        from = getStartOfMonth(fromBase);
        to = getEndOfMonth(toBase);

        label = fromYear === toYear && fromMonth === toMonth
          ? fmtLabelMonth(fromBase)
          : `${fmtLabelMonth(fromBase)} – ${fmtLabelMonth(toBase)}`;

      } else if (mode === "year") {
        const fromYear = parseInt(fromParam, 10);
        const toYear = parseInt(toParam, 10);

        if (isNaN(fromYear) || isNaN(toYear)) {
          return res.status(400).json({
            message: "Invalid year values. Use YYYY for mode=year.",
          });
        }
        if (fromYear > toYear) {
          return res
            .status(400)
            .json({ message: "'from' year must not be after 'to' year." });
        }

        from = getStartOfYear(new Date(fromYear, 0, 1));
        to = getEndOfYear(new Date(toYear, 0, 1));
        label = fromYear === toYear ? `${fromYear}` : `${fromYear} – ${toYear}`;

      } else {
        return res.status(400).json({
          message: "Invalid 'mode'. Must be one of: date | month | year",
        });
      }

      const { report, reservations } = await fetchReportWithRaw(from, to, label);
      const wb = await buildReportWorkbook(report, reservations);

      let filename;
      if (mode === "date") {
        filename = filenameForDateRange(from, to);
      } else if (mode === "month") {
        const sameMonth =
          from.getFullYear() === to.getFullYear() &&
          from.getMonth() === to.getMonth();
        filename = sameMonth ? filenameForMonth(from) : filenameForMonthRange(from, to);
      } else {
        const fy = from.getFullYear();
        const ty = to.getFullYear();
        filename = fy === ty ? filenameForYear(fy) : filenameForYearRange(fy, ty);
      }

      await streamWorkbookResponse(res, wb, filename);
    } catch (err) {
      console.error("Export range error:", err);
      return res.status(500).json({ message: "Failed to export range report" });
    }
  }
);


/* =========================================
   ADMIN: STUDENT DETAILS
   ─────────────────────────────────────────
   Three routes:
     GET  /api/admin/student-details
     GET  /api/admin/student-details/export-all
     GET  /api/admin/student-details/export-overdue
========================================= */

/*
 * Enrich a plain reservation object with computed financials and derivedStatus.
 *
 * Overdue detection delegates to calculateOverdueDays() which requires:
 *   • status in ACTIVE_STATUSES  (reserved | collected)
 *   • dueDate < now
 * So returned / cancelled / expired records are never flagged as overdue.
 */
function enrichReservation(r) {
  const overdueDays = calculateOverdueDays(r);
  const overdueFine = r.overduePaid
    ? Number(r.overduePaidAmount || 0)
    : overdueDays * OVERDUE_FINE_PER_DAY;
  // Read the amounts written to DB when the admin took the damage / lost action;
  // fall back to 0 for records where neither flag is set.
  const damageFine = Number(r.damageFine || 0);
  const lostFine = Number(r.lostFine || 0);
  const totalFine =
    Number(overdueFine || 0) +
    Number(damageFine || 0) +
    Number(lostFine || 0);
  const derivedStatus = getDerivedReservationStatus(r);

  // Safely extract book fields from the populated book sub-document.
  // r.book is a full object when .populate("book") ran; it is a bare
  // ObjectId string when it was not populated (e.g. lean queries that
  // skipped populate). In both cases we never throw — we fall back to
  // empty strings so StudentDetailsPage.jsx never renders "Unknown Book".
  const bookObj =
    r.book && typeof r.book === "object" && !Array.isArray(r.book)
      ? r.book
      : null;

  const book_title = bookObj?.title || "";
  const author = bookObj?.author || "";
  const book_id = bookObj?._id ?? r.book ?? null;

  return {
    ...r,
    derivedStatus,
    overdueDays,
    overdueFine,
    damageFine,
    lostFine,
    totalFine,
    // ── flat book fields expected by StudentDetailsPage.jsx ──────────
    book_title,
    author,
    book_id,
  };
}

/*
 * Fold an array of enriched reservations into per-student summary counts.
 */
function computeStudentSummary(enrichedReservations) {
  let totalTransactions = 0;
  let totalActive = 0;
  let totalCollected = 0;
  let totalReturned = 0;
  let totalCancelled = 0;
  let totalExpired = 0;
  let totalOverdue = 0;
  let totalDamaged = 0;
  let totalLost = 0;
  let totalOutstandingFines = 0;

  for (const r of enrichedReservations) {
    totalTransactions++;

    if (ACTIVE_STATUSES.includes(r.status)) {
      totalActive++;
      if (r.status === "collected") totalCollected++;
      if (r.derivedStatus === "overdue") totalOverdue++;
      totalOutstandingFines += r.totalFine || 0;
    } else if (r.status === "returned") {
      // status="returned" is a clean return by definition.
      totalReturned++;
    } else if (r.status === "damaged") {
      // Damage fine is always paid atomically when status is set to "damaged".
      // Only an unpaid overdue fine can still be outstanding at this point.
      if (!r.overduePaid && Number(r.overdueFine || 0) > 0) {
        totalOutstandingFines += Number(r.overdueFine || 0);
      }
    } else if (r.status === "lost") {
      // Same pattern for lost records.
      if (!r.overduePaid && Number(r.overdueFine || 0) > 0) {
        totalOutstandingFines += Number(r.overdueFine || 0);
      }
    } else if (r.status === "cancelled") { totalCancelled++; }
    else if (r.status === "expired") { totalExpired++; }

    // status is the single source of truth; helpers are pure status checks.
    if (isDamagedRecord(r)) totalDamaged++;
    if (isLostRecord(r)) totalLost++;
  }

  return {
    totalTransactions,
    totalActive,
    totalCollected,
    totalReturned,
    totalCancelled,
    totalExpired,
    totalOverdue,
    totalDamaged,
    totalLost,
    totalOutstandingFines,
  };
}

/* ─────────────────────────────────────────────────────────────────────────
   GET /api/admin/student-details
   Returns all students with full profile + enriched reservation history
   in a FLAT shape matching StudentDetailsPage.jsx.
   ───────────────────────────────────────────────────────────────────────── */
app.get(
  "/api/admin/student-details",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      await expireStalePreBookings();

      const students = await User.find({ role: "student" })
        .select("-passwordHash")
        .lean();

      if (!students.length) {
        return res.json({
          summary: {
            total_students: 0,
            total_reservations: 0,
            active_count: 0,
            overdue_count: 0,
            total_fine: 0,
          },
          students: [],
        });
      }

      const studentIds = students.map((s) => s._id);

      const allReservations = await Reservation.find({ user: { $in: studentIds } })
        .populate("book")
        .populate("user", "-passwordHash")
        .sort({ createdAt: -1 })
        .lean();

      // Group reservations by student id
      const reservationsByStudent = {};
      for (const reservation of allReservations) {
        const userId = String(reservation.user?._id ?? reservation.user);
        if (!reservationsByStudent[userId]) {
          reservationsByStudent[userId] = [];
        }
        reservationsByStudent[userId].push(reservation);
      }

      let totalStudents = students.length;
      let totalReservations = 0;
      let totalActive = 0;
      let totalOverdue = 0;
      let totalFine = 0;

      const studentDetails = students.map((student) => {
        const studentIdKey = String(student._id);
        const rawReservations = reservationsByStudent[studentIdKey] || [];
        const enrichedReservations = rawReservations.map(enrichReservation);
        const studentSummary = computeStudentSummary(enrichedReservations);
        const formattedStudent = formatUser(student);
        const flattenedStudent = {
          id: formattedStudent.id || String(student._id),
          name: formattedStudent.name || student.name || "Unknown Student",
          email: formattedStudent.email || student.email || "",
          profileImage: formattedStudent.profileImage || "",
          studentId: formattedStudent.studentId || student.studentId || "",
          roll_no:
            formattedStudent.studentId ||
            student.studentId ||
            formattedStudent.roll_no ||
            student.roll_no ||
            "",
          roll_number:
            formattedStudent.studentId ||
            student.studentId ||
            formattedStudent.roll_number ||
            student.roll_number ||
            "",
          department:
            formattedStudent.department ||
            student.department ||
            student.dept ||
            "",
          phone:
            formattedStudent.phone ||
            student.phone ||
            student.mobile ||
            "",
          year:
            formattedStudent.year ||
            student.year ||
            student.academicYear ||
            student.academic_year ||
            "",

          total_reservations: Number(studentSummary.totalTransactions || 0),
          active_count: Number(studentSummary.totalActive || 0),
          collected_count: Number(studentSummary.totalCollected || 0),
          returned_count: Number(studentSummary.totalReturned || 0),
          cancelled_count: Number(studentSummary.totalCancelled || 0),
          expired_count: Number(studentSummary.totalExpired || 0),
          overdue_count: Number(studentSummary.totalOverdue || 0),
          lost_count: Number(studentSummary.totalLost || 0),
          total_fine: Number(studentSummary.totalOutstandingFines || 0),

          reservations: enrichedReservations,
        };

        totalReservations += flattenedStudent.total_reservations;
        totalActive += flattenedStudent.active_count;
        totalOverdue += flattenedStudent.overdue_count;
        totalFine += flattenedStudent.total_fine;


        return flattenedStudent;
      });

      return res.json({
        summary: {
          total_students: totalStudents,
          total_reservations: totalReservations,
          active_count: totalActive,
          overdue_count: totalOverdue,
          total_fine: totalFine,
        },
        students: studentDetails,
      });
    } catch (err) {
      console.error("Student details error:", err);
      return res.status(500).json({ message: "Failed to fetch student details" });
    }
  }
);

/* ─────────────────────────────────────────────────────────────────────────
   Excel workbook: All Students Export
   Sheet 1: Summary           — aggregate totals across all students
   Sheet 2: All Reservations  — every reservation for every student, flat
   Sheet 3: Students Summary  — one row per student with summary counts
   ───────────────────────────────────────────────────────────────────────── */
async function buildStudentDetailsAllWorkbook(studentDetails) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Library Management System";
  workbook.created = new Date();

  const generatedAt = formatDateTime(new Date());

  // ── Shared style helpers ──────────────────────────────────────────────
  function styleTableHeader(row) {
    row.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "2563EB" } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = {
        top: { style: "thin", color: { argb: "D1D5DB" } },
        left: { style: "thin", color: { argb: "D1D5DB" } },
        bottom: { style: "thin", color: { argb: "D1D5DB" } },
        right: { style: "thin", color: { argb: "D1D5DB" } },
      };
    });
    row.height = 22;
  }

  function styleBodyBorders(ws, fromRow, toRow, colCount) {
    for (let r = fromRow; r <= toRow; r++) {
      for (let c = 1; c <= colCount; c++) {
        ws.getCell(r, c).border = {
          top: { style: "thin", color: { argb: "E5E7EB" } },
          left: { style: "thin", color: { argb: "E5E7EB" } },
          bottom: { style: "thin", color: { argb: "E5E7EB" } },
          right: { style: "thin", color: { argb: "E5E7EB" } },
        };
      }
    }
  }

  function styleMainTitle(cell, text) {
    cell.value = text;
    cell.font = { bold: true, size: 16, color: { argb: "1F2937" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  }

  function styleSectionTitle(cell, text) {
    cell.value = text;
    cell.font = { bold: true, size: 11, color: { argb: "111827" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "E5E7EB" } };
    cell.alignment = { horizontal: "left", vertical: "middle" };
  }

  // ── Aggregate across all students ─────────────────────────────────────
  let aggTransactions = 0, aggActive = 0, aggCollected = 0;
  let aggReturned = 0, aggCancelled = 0, aggExpired = 0;
  let aggOverdue = 0, aggDamaged = 0, aggLost = 0, aggFines = 0;

  const allFlatReservations = [];

  for (const sd of studentDetails) {
    aggTransactions += sd.summary.totalTransactions;
    aggActive += sd.summary.totalActive;
    aggCollected += sd.summary.totalCollected;
    aggReturned += sd.summary.totalReturned;
    aggCancelled += sd.summary.totalCancelled;
    aggExpired += sd.summary.totalExpired;
    aggOverdue += sd.summary.totalOverdue;
    aggDamaged += sd.summary.totalDamaged;
    aggLost += sd.summary.totalLost;
    aggFines += sd.summary.totalOutstandingFines;

    for (const r of sd.reservations) {
      allFlatReservations.push({ student: sd.student, reservation: r });
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // Sheet 1: Summary
  // ══════════════════════════════════════════════════════════════════════
  const summarySheet = workbook.addWorksheet("Summary");
  summarySheet.columns = [{ width: 30 }, { width: 22 }];

  summarySheet.mergeCells("A1:B1");
  styleMainTitle(summarySheet.getCell("A1"), "Student Details — All Students");
  summarySheet.getRow(1).height = 28;

  summarySheet.addRow([]);

  summarySheet.mergeCells("A3:B3");
  styleSectionTitle(summarySheet.getCell("A3"), "Report Information");
  summarySheet.getRow(3).height = 18;

  summarySheet.addRow(["Generated On", generatedAt]);
  summarySheet.addRow(["Total Students", studentDetails.length]);
  styleBodyBorders(summarySheet, 4, 5, 2);

  summarySheet.addRow([]);

  summarySheet.mergeCells("A7:B7");
  styleSectionTitle(summarySheet.getCell("A7"), "Aggregate Metrics");
  summarySheet.getRow(7).height = 18;

  const metHeader = summarySheet.getRow(8);
  metHeader.values = ["Metric", "Count"];
  styleTableHeader(metHeader);

  const aggRows = [
    ["Total Transactions", aggTransactions],
    ["Currently Active", aggActive],
    ["Collected (Active)", aggCollected],
    ["Returned", aggReturned],
    ["Cancelled", aggCancelled],
    ["Expired", aggExpired],
    ["Overdue (Active)", aggOverdue],
    ["Damaged", aggDamaged],
    ["Lost", aggLost],
    ["Outstanding Fines (₹)", aggFines],
  ];

  aggRows.forEach((row) => summarySheet.addRow(row));
  styleBodyBorders(summarySheet, 9, 9 + aggRows.length - 1, 2);

  for (let r = 9; r < 9 + aggRows.length; r++) {
    summarySheet.getCell(`B${r}`).alignment = { horizontal: "center", vertical: "middle" };
  }
  summarySheet.getCell(`B${9 + aggRows.length - 1}`).numFmt = "₹#,##0.00";

  summarySheet.views = [{ state: "frozen", ySplit: 8 }];
  summarySheet.autoFilter = "A8:B8";

  // ══════════════════════════════════════════════════════════════════════
  // Sheet 2: All Reservations
  // ══════════════════════════════════════════════════════════════════════
  const allResSheet = workbook.addWorksheet("All Reservations");
  allResSheet.columns = [
    { header: "#", key: "serialNo", width: 7 },
    { header: "Student Name", key: "studentName", width: 22 },
    { header: "Register No", key: "registerNo", width: 15 },
    { header: "Book Title", key: "bookTitle", width: 32 },
    { header: "Author", key: "author", width: 20 },
    { header: "Type", key: "type", width: 13 },
    { header: "Status", key: "status", width: 13 },
    { header: "Derived Status", key: "derivedStatus", width: 15 },
    { header: "Reserved On", key: "reservedOn", width: 20 },
    { header: "Collected On", key: "collectedOn", width: 20 },
    { header: "Due Date", key: "dueDate", width: 20 },
    { header: "Returned On", key: "returnedOn", width: 20 },
    { header: "Overdue Days", key: "overdueDays", width: 13 },
    { header: "Overdue Fine (₹)", key: "overdueFine", width: 15 },
    { header: "Damage Fine (₹)", key: "damageFine", width: 14 },
    { header: "Lost Fine (₹)", key: "lostFine", width: 13 },
    { header: "Total Fine (₹)", key: "totalFine", width: 14 },
    { header: "Fine Paid", key: "finePaid", width: 12 },
  ];

  styleTableHeader(allResSheet.getRow(1));

  if (allFlatReservations.length === 0) {
    allResSheet.addRow({ serialNo: "-", studentName: "No reservations found", bookTitle: "-" });
  } else {
    allFlatReservations.forEach(({ student, reservation: r }, idx) => {
      const book = r.book && typeof r.book === "object" ? r.book : null;
      const row = allResSheet.addRow({
        serialNo: idx + 1,
        studentName: student.name || "-",
        registerNo: student.studentId || "-",
        bookTitle: book?.title || "-",
        author: book?.author || "-",
        type: r.isWalkIn ? "Walk-In" : "Pre-Booking",
        status: r.status,
        derivedStatus: r.derivedStatus,
        reservedOn: formatDateTime(r.createdAt),
        collectedOn: formatDateTime(r.collectedAt),
        dueDate: formatDateTime(r.dueDate),
        returnedOn: formatDateTime(r.returnedAt),
        overdueDays: r.overdueDays || 0,
        overdueFine: r.overdueFine || 0,
        damageFine: r.damageFine || 0,
        lostFine: r.lostFine || 0,
        totalFine: r.totalFine || 0,
        finePaid: r.finePaid || r.lostFinePaid || r.damageFinePaid || r.overduePaid
          ? "Yes"
          : (r.totalFine > 0 ? "No" : "—"),
      });

      ["A", "F", "G", "H", "M", "R"].forEach((col) => {
        row.getCell(col).alignment = { horizontal: "center", vertical: "middle" };
      });
      ["N", "O", "P", "Q"].forEach((col) => {
        row.getCell(col).numFmt = "₹#,##0.00";
      });

      // Amber tint for overdue rows; red tint for lost rows; orange tint for damaged rows.
      if (r.derivedStatus === "overdue") {
        row.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
        });
      } else if (r.derivedStatus === "lost") {
        row.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF2F2" } };
        });
      } else if (r.derivedStatus === "damaged") {
        row.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF7ED" } };
        });
      }
    });

    styleBodyBorders(allResSheet, 2, allResSheet.rowCount, 18);
  }

  allResSheet.views = [{ state: "frozen", ySplit: 1 }];
  allResSheet.autoFilter = "A1:R1";

  // ══════════════════════════════════════════════════════════════════════
  // Sheet 3: Students Summary
  // ══════════════════════════════════════════════════════════════════════
  const studentSumSheet = workbook.addWorksheet("Students Summary");
  studentSumSheet.columns = [
    { header: "#", key: "serialNo", width: 7 },
    { header: "Student Name", key: "name", width: 22 },
    { header: "Register No", key: "studentId", width: 15 },
    { header: "Email", key: "email", width: 28 },
    { header: "Total Transactions", key: "total", width: 18 },
    { header: "Active", key: "active", width: 10 },
    { header: "Collected", key: "collected", width: 11 },
    { header: "Returned", key: "returned", width: 11 },
    { header: "Overdue", key: "overdue", width: 11 },
    { header: "Cancelled", key: "cancelled", width: 11 },
    { header: "Expired", key: "expired", width: 11 },
    { header: "Damaged", key: "damaged", width: 11 },
    { header: "Lost", key: "lost", width: 10 },
    { header: "Outstanding Fines (₹)", key: "fines", width: 20 },
  ];

  styleTableHeader(studentSumSheet.getRow(1));

  if (studentDetails.length === 0) {
    studentSumSheet.addRow({ serialNo: "-", name: "No students found" });
  } else {
    studentDetails.forEach((sd, idx) => {
      const row = studentSumSheet.addRow({
        serialNo: idx + 1,
        name: sd.student.name || "-",
        studentId: sd.student.studentId || "-",
        email: sd.student.email || "-",
        total: sd.summary.totalTransactions,
        active: sd.summary.totalActive,
        collected: sd.summary.totalCollected,
        returned: sd.summary.totalReturned,
        overdue: sd.summary.totalOverdue,
        cancelled: sd.summary.totalCancelled,
        expired: sd.summary.totalExpired,
        damaged: sd.summary.totalDamaged,
        lost: sd.summary.totalLost,
        fines: sd.summary.totalOutstandingFines,
      });

      ["E", "F", "G", "H", "I", "J", "K", "L", "M", "N"].forEach((col) => {
        row.getCell(col).alignment = { horizontal: "center", vertical: "middle" };
      });
      row.getCell("N").numFmt = "₹#,##0.00";

      // Amber tint for students with overdue items
      if (sd.summary.totalOverdue > 0) {
        row.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
        });
      }
    });

    styleBodyBorders(studentSumSheet, 2, studentSumSheet.rowCount, 14);
  }

  studentSumSheet.views = [{ state: "frozen", ySplit: 1 }];
  studentSumSheet.autoFilter = "A1:N1";

  return workbook;
}

/* ─────────────────────────────────────────────────────────────────────────
   Excel workbook: Overdue Only Export
   Sheet 1: Overdue Summary      — aggregate overdue stats
   Sheet 2: Overdue Reservations — one row per overdue reservation
   ───────────────────────────────────────────────────────────────────────── */
async function buildStudentDetailsOverdueWorkbook(overdueEntries) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Library Management System";
  workbook.created = new Date();

  const generatedAt = formatDateTime(new Date());

  // ── Shared style helpers ──────────────────────────────────────────────
  function styleTableHeader(row) {
    row.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "DC2626" } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = {
        top: { style: "thin", color: { argb: "D1D5DB" } },
        left: { style: "thin", color: { argb: "D1D5DB" } },
        bottom: { style: "thin", color: { argb: "D1D5DB" } },
        right: { style: "thin", color: { argb: "D1D5DB" } },
      };
    });
    row.height = 22;
  }

  function styleBodyBorders(ws, fromRow, toRow, colCount) {
    for (let r = fromRow; r <= toRow; r++) {
      for (let c = 1; c <= colCount; c++) {
        ws.getCell(r, c).border = {
          top: { style: "thin", color: { argb: "E5E7EB" } },
          left: { style: "thin", color: { argb: "E5E7EB" } },
          bottom: { style: "thin", color: { argb: "E5E7EB" } },
          right: { style: "thin", color: { argb: "E5E7EB" } },
        };
      }
    }
  }

  // ── Aggregate stats ───────────────────────────────────────────────────
  const totalOverdueCount = overdueEntries.length;
  const totalOverdueFines = overdueEntries.reduce((s, e) => s + (e.reservation.overdueFine || 0), 0);
  const totalFinesAll = overdueEntries.reduce((s, e) => s + (e.reservation.totalFine || 0), 0);
  const overdueStudentIds = new Set(overdueEntries.map((e) => String(e.student.id || e.student._id)));
  const totalOverdueStudents = overdueStudentIds.size;
  const maxDays = overdueEntries.reduce((m, e) => Math.max(m, e.reservation.overdueDays || 0), 0);

  // ══════════════════════════════════════════════════════════════════════
  // Sheet 1: Overdue Summary
  // ══════════════════════════════════════════════════════════════════════
  const summarySheet = workbook.addWorksheet("Overdue Summary");
  summarySheet.columns = [{ width: 32 }, { width: 22 }];

  summarySheet.mergeCells("A1:B1");
  const titleCell = summarySheet.getCell("A1");
  titleCell.value = "Overdue Reservations Report";
  titleCell.font = { bold: true, size: 16, color: { argb: "DC2626" } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  summarySheet.getRow(1).height = 28;

  summarySheet.addRow([]);

  summarySheet.mergeCells("A3:B3");
  const infoTitle = summarySheet.getCell("A3");
  infoTitle.value = "Report Information";
  infoTitle.font = { bold: true, size: 11, color: { argb: "111827" } };
  infoTitle.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "E5E7EB" } };
  infoTitle.alignment = { horizontal: "left", vertical: "middle" };
  summarySheet.getRow(3).height = 18;

  summarySheet.addRow(["Generated On", generatedAt]);
  styleBodyBorders(summarySheet, 4, 4, 2);

  summarySheet.addRow([]);

  summarySheet.mergeCells("A6:B6");
  const metTitle = summarySheet.getCell("A6");
  metTitle.value = "Overdue Metrics";
  metTitle.font = { bold: true, size: 11, color: { argb: "111827" } };
  metTitle.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "E5E7EB" } };
  metTitle.alignment = { horizontal: "left", vertical: "middle" };
  summarySheet.getRow(6).height = 18;

  const metHeader = summarySheet.getRow(7);
  metHeader.values = ["Metric", "Value"];
  styleTableHeader(metHeader);

  const metRows = [
    ["Total Overdue Reservations", totalOverdueCount],
    ["Students with Overdue Books", totalOverdueStudents],
    ["Longest Overdue (days)", maxDays],
    ["Total Overdue Fines (₹)", totalOverdueFines],
    ["Total All Fines Outstanding (₹)", totalFinesAll],
  ];

  metRows.forEach((row) => summarySheet.addRow(row));
  styleBodyBorders(summarySheet, 8, 8 + metRows.length - 1, 2);

  for (let r = 8; r < 8 + metRows.length; r++) {
    summarySheet.getCell(`B${r}`).alignment = { horizontal: "center", vertical: "middle" };
  }
  summarySheet.getCell(`B${8 + 3}`).numFmt = "₹#,##0.00";
  summarySheet.getCell(`B${8 + 4}`).numFmt = "₹#,##0.00";

  summarySheet.views = [{ state: "frozen", ySplit: 7 }];
  summarySheet.autoFilter = "A7:B7";

  // ══════════════════════════════════════════════════════════════════════
  // Sheet 2: Overdue Reservations
  // ══════════════════════════════════════════════════════════════════════
  const overdueSheet = workbook.addWorksheet("Overdue Reservations");
  overdueSheet.columns = [
    { header: "#", key: "serialNo", width: 7 },
    { header: "Student Name", key: "studentName", width: 22 },
    { header: "Register No", key: "registerNo", width: 15 },
    { header: "Email", key: "email", width: 28 },
    { header: "Book Title", key: "bookTitle", width: 32 },
    { header: "Author", key: "author", width: 20 },
    { header: "Type", key: "type", width: 13 },
    { header: "Collected On", key: "collectedOn", width: 20 },
    { header: "Due Date", key: "dueDate", width: 20 },
    { header: "Days Overdue", key: "overdueDays", width: 13 },
    { header: "Overdue Fine (₹)", key: "overdueFine", width: 15 },
    { header: "Damage Fine (₹)", key: "damageFine", width: 14 },
    { header: "Lost Fine (₹)", key: "lostFine", width: 13 },
    { header: "Total Fine (₹)", key: "totalFine", width: 14 },
    { header: "Fine Paid", key: "finePaid", width: 12 },
  ];

  styleTableHeader(overdueSheet.getRow(1));

  if (overdueEntries.length === 0) {
    overdueSheet.addRow({ serialNo: "-", studentName: "No overdue reservations found", bookTitle: "-" });
  } else {
    overdueEntries.forEach(({ student, reservation: r }, idx) => {
      const book = r.book && typeof r.book === "object" ? r.book : null;
      const row = overdueSheet.addRow({
        serialNo: idx + 1,
        studentName: student.name || "-",
        registerNo: student.studentId || "-",
        email: student.email || "-",
        bookTitle: book?.title || "-",
        author: book?.author || "-",
        type: r.isWalkIn ? "Walk-In" : "Pre-Booking",
        collectedOn: formatDateTime(r.collectedAt),
        dueDate: formatDateTime(r.dueDate),
        overdueDays: r.overdueDays || 0,
        overdueFine: r.overdueFine || 0,
        damageFine: r.damageFine || 0,
        lostFine: r.lostFine || 0,
        totalFine: r.totalFine || 0,
        finePaid: r.overduePaid ? "Yes" : "No",
      });

      ["A", "G", "J", "O"].forEach((col) => {
        row.getCell(col).alignment = { horizontal: "center", vertical: "middle" };
      });
      ["K", "L", "M", "N"].forEach((col) => {
        row.getCell(col).numFmt = "₹#,##0.00";
      });

      // Pale-red tint for rows where fine is unpaid
      if (!r.overduePaid) {
        row.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF2F2" } };
        });
      }
    });

    styleBodyBorders(overdueSheet, 2, overdueSheet.rowCount, 15);
  }

  overdueSheet.views = [{ state: "frozen", ySplit: 1 }];
  overdueSheet.autoFilter = "A1:O1";

  return workbook;
}

/* ─────────────────────────────────────────────────────────────────────────
   GET /api/admin/student-details/export-all
   Downloads Excel workbook for ALL students' reservation details.
   ───────────────────────────────────────────────────────────────────────── */
app.get(
  "/api/admin/student-details/export-all",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      await expireStalePreBookings();

      const students = await User.find({ role: "student" })
        .select("-passwordHash")
        .lean();

      const studentIds = students.map((s) => s._id);

      const allReservations = await Reservation.find({ user: { $in: studentIds } })
        .populate("book")
        .populate("user", "-passwordHash")
        .sort({ createdAt: -1 })
        .lean();

      const byStudent = {};
      for (const r of allReservations) {
        const uid = String(r.user?._id ?? r.user);
        if (!byStudent[uid]) byStudent[uid] = [];
        byStudent[uid].push(r);
      }

      const studentDetails = students.map((student) => {
        const uid = String(student._id);
        const raw = byStudent[uid] || [];
        const enriched = raw.map(enrichReservation);
        return {
          student: formatUser(student),
          summary: computeStudentSummary(enriched),
          reservations: enriched,
        };
      });

      const wb = await buildStudentDetailsAllWorkbook(studentDetails);
      const now = new Date();
      const filename = `student_details_all_${fmtFilenameDate(now)}.xlsx`;

      await streamWorkbookResponse(res, wb, filename);
    } catch (err) {
      console.error("Export student-details/export-all error:", err);
      return res.status(500).json({ message: "Failed to export student details" });
    }
  }
);

/* ─────────────────────────────────────────────────────────────────────────
   GET /api/admin/student-details/export-overdue
   Downloads Excel workbook for OVERDUE reservations only.
   Overdue = status in ACTIVE_STATUSES AND dueDate < now, confirmed by
   calculateOverdueDays() to guard against edge cases.
   ───────────────────────────────────────────────────────────────────────── */
app.get(
  "/api/admin/student-details/export-overdue",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      await expireStalePreBookings();

      const now = new Date();

      // DB-level pre-filter: active + dueDate already past
      const activeOverdueRaw = await Reservation.find({
        status: { $in: Array.from(ACTIVE_STATUSES) },
        dueDate: { $lt: now },
      })
        .populate("book")
        .populate("user", "-passwordHash")
        .sort({ dueDate: 1 }) // oldest due date first (most urgent)
        .lean();

      // Enrich and confirm with calculateOverdueDays() — guards edge cases
      const overdueEntries = [];
      for (const r of activeOverdueRaw) {
        const enriched = enrichReservation(r);
        if (enriched.overdueDays > 0 && enriched.derivedStatus === "overdue") {
          const student = r.user && typeof r.user === "object" ? formatUser(r.user) : null;
          if (student) overdueEntries.push({ student, reservation: enriched });
        }
      }

      const wb = await buildStudentDetailsOverdueWorkbook(overdueEntries);
      const filename = `student_details_overdue_${fmtFilenameDate(now)}.xlsx`;

      await streamWorkbookResponse(res, wb, filename);
    } catch (err) {
      console.error("Export student-details/export-overdue error:", err);
      return res.status(500).json({ message: "Failed to export overdue details" });
    }
  }
);

/* =========================================
   BOOK CATALOGUE STATUS REPORT
   ─────────────────────────────────────────
   Title-level aggregated view of every book
   in the catalogue with live copy counts and
   catalogue status derived from Reservation data.
========================================= */

/**
 * Builds a title-level Book Catalogue Status Report.
 *
 * For each Book document, aggregates all active and terminal
 * Reservation records to compute copy-level counts:
 *   reservedCount   – status "reserved"  (active pre-book awaiting pickup)
 *   collectedCount  – status "collected" AND dueDate >= now  (on time)
 *   overdueCount    – status "collected" AND dueDate < now   (virtual overdue)
 *   lostCount       – status === "lost"    (dedicated terminal status)
 *   damagedCount    – status === "damaged" (dedicated terminal status)
 *
 * catalogueStatus priority (highest → lowest):
 *   Lost → Damaged → Fully Available → Fully Overdue →
 *   Fully Issued → Reserved → Partially Available
 */
async function buildBookCatalogueReport() {
  const now = new Date();

  // Fetch all books (title-based, one doc per title)
  const books = await Book.find({}).lean();

  // Fetch all ACTIVE reservations in a single query
  const activeReservations = await Reservation.find({
    status: { $in: Array.from(ACTIVE_STATUSES) },
  }).lean();

  // Fetch reservations with terminal lost/damaged status.
  const flaggedReservations = await Reservation.find({
    status: { $in: ["lost", "damaged"] },
  }).lean();

  // Index active reservations by bookId
  const activeByBook = {};
  for (const r of activeReservations) {
    const bookId = String(r.book);
    if (!activeByBook[bookId]) activeByBook[bookId] = [];
    activeByBook[bookId].push(r);
  }

  // Index flagged reservations by bookId
  const flaggedByBook = {};
  for (const r of flaggedReservations) {
    const bookId = String(r.book);
    if (!flaggedByBook[bookId]) flaggedByBook[bookId] = [];
    flaggedByBook[bookId].push(r);
  }

  // Aggregate totals across all books
  let totalTitles = books.length;
  let totalCopiesAll = 0;
  let availableCopiesAll = 0;
  let reservedCopiesAll = 0;
  let collectedCopiesAll = 0;
  let overdueCopiesAll = 0;
  let lostCopiesAll = 0;
  let damagedCopiesAll = 0;

  const bookRows = books.map((book) => {
    const bookId = String(book._id);
    const active = activeByBook[bookId] || [];
    const flagged = flaggedByBook[bookId] || [];

    // Count from active reservations using existing project semantics
    let reservedCount = 0;
    let collectedCount = 0;
    let overdueCount = 0;

    for (const r of active) {
      const enriched = enrichReservation(r);
      const derivedStatus = enriched?.derivedStatus || r.status;

      if (derivedStatus === "reserved") {
        reservedCount++;
      } else if (derivedStatus === "overdue") {
        overdueCount++;
      } else if (derivedStatus === "collected") {
        collectedCount++;
      }
    }

    // Count from flagged reservations. status is the single source of truth.
    let lostCount = 0;
    let damagedCount = 0;
    for (const r of flagged) {
      if (isLostRecord(r)) lostCount++;
      if (isDamagedRecord(r)) damagedCount++;
    }

    const totalCopies = book.totalCopies || 0;
    const availableCopies = book.availableCopies || 0;

    // Determine catalogueStatus (strict required logic)
    let catalogueStatus;
    if (lostCount >= totalCopies && totalCopies > 0) {
      catalogueStatus = "Lost";
    } else if (damagedCount >= totalCopies && totalCopies > 0) {
      catalogueStatus = "Damaged";
    } else if (availableCopies === totalCopies) {
      catalogueStatus = "Fully Available";
    } else if (availableCopies === 0 && overdueCount > 0) {
      catalogueStatus = "Fully Overdue";
    } else if (availableCopies === 0 && collectedCount > 0) {
      catalogueStatus = "Fully Issued";
    } else if (reservedCount > 0 && collectedCount === 0) {
      catalogueStatus = "Reserved";
    } else {
      catalogueStatus = "Partially Available";
    }

    // Accumulate totals
    totalCopiesAll += totalCopies;
    availableCopiesAll += availableCopies;
    reservedCopiesAll += reservedCount;
    collectedCopiesAll += collectedCount;
    overdueCopiesAll += overdueCount;
    lostCopiesAll += lostCount;
    damagedCopiesAll += damagedCount;

    return {
      bookId,
      title: book.title || "",
      author: book.author || "",
      department: book.department || "",
      courseCode: book.courseCode || "",
      location: book.location || "",
      totalCopies,
      availableCopies,
      reservedCount,
      collectedCount,
      overdueCount,
      lostCount,
      damagedCount,
      catalogueStatus,
    };
  });

  return {
    label: "Book Catalogue Status Report",
    generatedAt: new Date(),
    totalTitles,
    totalCopies: totalCopiesAll,
    availableCopies: availableCopiesAll,
    reservedCopies: reservedCopiesAll,
    collectedCopies: collectedCopiesAll,
    overdueCopies: overdueCopiesAll,
    lostCopies: lostCopiesAll,
    damagedCopies: damagedCopiesAll,
    books: bookRows,
  };
}

/**
 * Builds a two-sheet ExcelJS workbook for the Book Catalogue Status Report.
 *
 * Sheet 1: Summary   — key metrics
 * Sheet 2: Catalogue — one row per book title with all counts and status
 */
async function buildBookCatalogueWorkbook(report) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Library Management System";
  workbook.created = new Date();

  const generatedAt = formatDateTime(report.generatedAt);

  // ── Shared style helpers ──────────────────────────────────────────────
  function styleTableHeader(row) {
    row.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "059669" } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = {
        top: { style: "thin", color: { argb: "D1D5DB" } },
        left: { style: "thin", color: { argb: "D1D5DB" } },
        bottom: { style: "thin", color: { argb: "D1D5DB" } },
        right: { style: "thin", color: { argb: "D1D5DB" } },
      };
    });
    row.height = 22;
  }

  function styleBodyBorders(ws, fromRow, toRow, colCount) {
    for (let r = fromRow; r <= toRow; r++) {
      for (let c = 1; c <= colCount; c++) {
        ws.getCell(r, c).border = {
          top: { style: "thin", color: { argb: "E5E7EB" } },
          left: { style: "thin", color: { argb: "E5E7EB" } },
          bottom: { style: "thin", color: { argb: "E5E7EB" } },
          right: { style: "thin", color: { argb: "E5E7EB" } },
        };
      }
    }
  }

  // Catalogue status → background colour
  function statusFill(status) {
    const map = {
      "Lost": "FFFEF2F2", // pale red
      "Damaged": "FFFEF3C7", // pale amber
      "Fully Available": "FFF0FDF4", // pale green
      "Fully Overdue": "FFFDE8E8", // light red
      "Fully Issued": "FFEFF6FF", // pale blue
      "Reserved": "FFFFFBEB", // pale yellow
      "Partially Available": "FFF9FAFB", // very light grey
    };
    return map[status] || "FFFFFFFF";
  }

  // ══════════════════════════════════════════════════════════════════════
  // Sheet 1: Summary
  // ══════════════════════════════════════════════════════════════════════
  const summarySheet = workbook.addWorksheet("Summary");
  summarySheet.columns = [{ width: 28 }, { width: 22 }];

  summarySheet.mergeCells("A1:B1");
  const titleCell = summarySheet.getCell("A1");
  titleCell.value = "Book Catalogue Status Report";
  titleCell.font = { bold: true, size: 16, color: { argb: "1F2937" } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  summarySheet.getRow(1).height = 28;

  summarySheet.addRow([]);

  summarySheet.mergeCells("A3:B3");
  const infoCell = summarySheet.getCell("A3");
  infoCell.value = "Report Information";
  infoCell.font = { bold: true, size: 11, color: { argb: "111827" } };
  infoCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "E5E7EB" } };
  infoCell.alignment = { horizontal: "left", vertical: "middle" };
  summarySheet.getRow(3).height = 18;

  summarySheet.addRow(["Generated On", generatedAt]);
  styleBodyBorders(summarySheet, 4, 4, 2);

  summarySheet.addRow([]);

  summarySheet.mergeCells("A6:B6");
  const metricsCell = summarySheet.getCell("A6");
  metricsCell.value = "Catalogue Metrics";
  metricsCell.font = { bold: true, size: 11, color: { argb: "111827" } };
  metricsCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "E5E7EB" } };
  metricsCell.alignment = { horizontal: "left", vertical: "middle" };
  summarySheet.getRow(6).height = 18;

  const metHeader = summarySheet.getRow(7);
  metHeader.values = ["Metric", "Value"];
  styleTableHeader(metHeader);

  const metRows = [
    ["Report Name", report.label],
    ["Total Titles", report.totalTitles],
    ["Total Copies", report.totalCopies],
    ["Available Copies", report.availableCopies],
    ["Reserved Copies", report.reservedCopies],
    ["Collected Copies", report.collectedCopies],
    ["Overdue Copies", report.overdueCopies],
    ["Lost Copies", report.lostCopies],
    ["Damaged Copies", report.damagedCopies],
  ];

  metRows.forEach((row) => summarySheet.addRow(row));
  styleBodyBorders(summarySheet, 8, 8 + metRows.length - 1, 2);

  for (let r = 8; r < 8 + metRows.length; r++) {
    summarySheet.getCell(`B${r}`).alignment = { horizontal: "center", vertical: "middle" };
  }

  summarySheet.views = [{ state: "frozen", ySplit: 7 }];

  // ══════════════════════════════════════════════════════════════════════
  // Sheet 2: Catalogue
  // ══════════════════════════════════════════════════════════════════════
  const catSheet = workbook.addWorksheet("Catalogue");
  catSheet.columns = [
    { header: "S.No", key: "sno", width: 7 },
    { header: "Title", key: "title", width: 34 },
    { header: "Author", key: "author", width: 22 },
    { header: "Department", key: "department", width: 18 },
    { header: "Course Code", key: "courseCode", width: 14 },
    { header: "Location", key: "location", width: 14 },
    { header: "Total Copies", key: "totalCopies", width: 13 },
    { header: "Available Copies", key: "availableCopies", width: 16 },
    { header: "Reserved", key: "reserved", width: 11 },
    { header: "Collected", key: "collected", width: 11 },
    { header: "Overdue", key: "overdue", width: 11 },
    { header: "Lost", key: "lost", width: 9 },
    { header: "Damaged", key: "damaged", width: 10 },
    { header: "Catalogue Status", key: "status", width: 20 },
  ];

  styleTableHeader(catSheet.getRow(1));

  if (report.books.length === 0) {
    catSheet.addRow({ sno: "-", title: "No books found in catalogue", status: "-" });
  } else {
    report.books.forEach((b, idx) => {
      const row = catSheet.addRow({
        sno: idx + 1,
        title: b.title || "-",
        author: b.author || "-",
        department: b.department || "-",
        courseCode: b.courseCode || "-",
        location: b.location || "-",
        totalCopies: b.totalCopies,
        availableCopies: b.availableCopies,
        reserved: b.reservedCount,
        collected: b.collectedCount,
        overdue: b.overdueCount,
        lost: b.lostCount,
        damaged: b.damagedCount,
        status: b.catalogueStatus,
      });

      // Centre numeric & status columns
      ["A", "G", "H", "I", "J", "K", "L", "M", "N"].forEach((col) => {
        row.getCell(col).alignment = { horizontal: "center", vertical: "middle" };
      });

      // Zebra rows (even rows get a very light grey base)
      const zebraFill = idx % 2 === 1
        ? { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FAFB" } }
        : null;

      // Status-based colouring overrides zebra for the whole row
      const fill = { type: "pattern", pattern: "solid", fgColor: { argb: statusFill(b.catalogueStatus) } };
      row.eachCell((cell) => {
        cell.fill = fill;
      });
      // If no special status fill applies (Partially Available / default), restore zebra
      if (zebraFill && b.catalogueStatus === "Partially Available") {
        row.eachCell((cell) => { cell.fill = zebraFill; });
      }
    });

    styleBodyBorders(catSheet, 2, catSheet.rowCount, 14);
  }

  catSheet.views = [{ state: "frozen", ySplit: 1 }];
  catSheet.autoFilter = "A1:N1";

  return workbook;
}

/* ─────────────────────────────────────────────────────────────────────────
   GET /api/admin/reports/book-catalogue
   Returns the Book Catalogue Status Report as JSON.
   ───────────────────────────────────────────────────────────────────────── */
app.get(
  "/api/admin/reports/book-catalogue",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      await expireStalePreBookings();
      const report = await buildBookCatalogueReport();
      return res.json({ report });
    } catch (err) {
      console.error("Book catalogue report error:", err);
      return res.status(500).json({ message: "Failed to generate book catalogue report" });
    }
  }
);

/* ─────────────────────────────────────────────────────────────────────────
   GET /api/admin/reports/book-catalogue/export
   Downloads Book Catalogue Status Report as an Excel workbook.
   Filename: book-catalogue-report-YYYY-MM-DD.xlsx
   ───────────────────────────────────────────────────────────────────────── */
app.get(
  "/api/admin/reports/book-catalogue/export",
  authMiddleware,
  requireAdmin,
  async (req, res) => {
    try {
      await expireStalePreBookings();
      const report = await buildBookCatalogueReport();
      const wb = await buildBookCatalogueWorkbook(report);

      const now = new Date();
      const dateStr = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
      ].join("-");
      const filename = `book-catalogue-report-${dateStr}.xlsx`;

      await streamWorkbookResponse(res, wb, filename);
    } catch (err) {
      console.error("Book catalogue export error:", err);
      return res.status(500).json({ message: "Failed to export book catalogue report" });
    }
  }
);

/* =========================================
   GLOBAL ERROR HANDLER
========================================= */
app.use((err, req, res, next) => {
  console.error("Unhandled server error:", err);

  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({ message: "CORS blocked this request" });
  }

  if (err instanceof multer.MulterError) {
    return res.status(400).json({ message: err.message || "File upload error" });
  }

  if (err.message === "Only image files are allowed") {
    return res.status(400).json({ message: err.message });
  }

  if (err.message === "Only JSON files are allowed") {
    return res.status(400).json({ message: err.message });
  }

  return res.status(500).json({ message: "Internal server error" });
});

/* =========================================
   AUTOMATED REMINDER CYCLE
========================================= */

/**
 * Simple overlap lock — prevents a second cycle from starting while
 * one is still running (e.g. if the DB is slow and 15 min elapses).
 */
let isReminderCycleRunning = false;

/**
 * runAutomatedReminderCycle()
 *
 * Fetches every reservation that may still need an email:
 *   • status "reserved"   — pre-book lifecycle reminders
 *   • status "collected"  — due-date / overdue reminders
 *   • status "expired"    — expired notification (only when not yet sent)
 *
 * For each reservation it calls processPrebookReminder() and
 * processDueReminder() in sequence, then moves on even if one fails.
 *
 * Does NOT expire reservations — that is handled exclusively by
 * expireStalePreBookings() which runs at the top of every relevant route.
 */
async function runAutomatedReminderCycle() {
  if (isReminderCycleRunning) {
    console.log("[REMINDER-CYCLE] Skipped — previous cycle still running.");
    return;
  }

  isReminderCycleRunning = true;
  console.log("[REMINDER-CYCLE] Starting automated reminder cycle…");

  try {
    const reservations = await Reservation.find({
      $or: [
        { status: "reserved" },
        { status: "collected" },
        { status: "expired", prebookExpiredMailSent: false },
      ],
    })
      .populate("user")
      .populate("book");

    console.log(`[REMINDER-CYCLE] Found ${reservations.length} reservation(s) to process.`);

    let sent = 0;
    let skipped = 0;
    let errors = 0;

    for (const reservation of reservations) {
      try {
        if (
          reservation.status === "reserved" ||
          reservation.status === "expired"
        ) {
          await processPrebookReminder(reservation);
          sent++;
        } else if (reservation.status === "collected") {
          await processDueReminder(reservation);
          sent++;
        } else {
          // Defensive guard: skip anything else that slipped through
          skipped++;
        }
      } catch (err) {
        errors++;
        console.error(
          `[REMINDER-CYCLE] Error processing reservation ${reservation._id}:`,
          err.message || err
        );
      }
    }

    console.log(
      `[REMINDER-CYCLE] Cycle complete — processed: ${sent}, skipped: ${skipped}, errors: ${errors}.`
    );
  } catch (err) {
    console.error("[REMINDER-CYCLE] Fatal error during cycle:", err.message || err);
  } finally {
    isReminderCycleRunning = false;
  }
}
console.log("Starting server...");
console.log("PORT =", PORT);
console.log("MONGO_URI exists =", !!MONGO_URI);

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log("MongoDB Connected");

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("MongoDB Connection Error:");
    console.error(err);
  });