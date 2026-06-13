/**
 * mailer.js — Reusable email helper for Library Management System
 * Uses Nodemailer with environment variables for configuration.
 * Safe to import even if email config is missing (will not crash the app).
 */

const nodemailer = require("nodemailer");

// ─── Transporter Setup ───────────────────────────────────────────────────────

let transporter = null;

if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    connectionTimeout: 5000,   // give up connecting after 5 s (ENETUNREACH fails fast)
    greetingTimeout: 5000,     // give up waiting for SMTP greeting after 5 s
    socketTimeout: 10000,      // give up on an idle socket after 10 s
  });
  console.log("[Mailer] Nodemailer transporter initialised.");
} else {
  console.warn(
    "[Mailer] WARNING: EMAIL_USER or EMAIL_PASS not set. " +
      "All email functions will be skipped silently."
  );
}

// ─── Core Send Helper ─────────────────────────────────────────────────────────

async function sendMail(to, subject, html) {
  console.log("[MAIL DEBUG]", {
    to,
    hasTransporter: !!transporter,
    emailUser: process.env.EMAIL_USER,
    hasEmailPass: !!process.env.EMAIL_PASS,
  });

  if (!transporter) {
    console.warn(`[Mailer] Skipped email to ${to} — transporter not configured.`);
    return false;
  }

  try {
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to,
      subject,
      html,
    });

    console.log(
      `[Mailer] Email sent → ${to} | Subject: "${subject}" | ID: ${info.messageId}`
    );
    return true;
  } catch (err) {
    console.error(`[Mailer] Failed to send email to ${to}:`, err.message);
    return false;
  }
}

// ─── Shared Utilities ─────────────────────────────────────────────────────────

function fmt(date) {
  if (!date) return "N/A";
  return new Date(date).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const FOOTER = `
  <hr style="margin-top:32px;border:none;border-top:1px solid #e2e8f0"/>
  <p style="color:#94a3b8;font-size:12px;margin-top:8px">
    This is an automated message from the Library Management System.<br/>
    Please do not reply to this email.
  </p>
`;

function template(title, accentColor, bodyHtml) {
  return `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;
                border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
      <div style="background:${accentColor};padding:20px 28px">
        <h2 style="margin:0;color:#fff;font-size:20px">${title}</h2>
      </div>
      <div style="padding:24px 28px;color:#334155;line-height:1.6">
        ${bodyHtml}
        ${FOOTER}
      </div>
    </div>`;
}

// ─── Flexible field readers (supports user/book, studentId/bookId, mapped payload) ───

function getStudentName(reservation) {
  return (
    reservation?.user?.name ??
    reservation?.studentId?.name ??
    reservation?.studentName ??
    "Student"
  );
}

function getStudentEmail(reservation) {
  return (
    reservation?.user?.email ??
    reservation?.studentId?.email ??
    reservation?.studentEmail ??
    null
  );
}

function getBookTitle(reservation, fallback = "Book") {
  return (
    reservation?.book?.title ??
    reservation?.bookId?.title ??
    reservation?.bookTitle ??
    fallback
  );
}

function getBookAuthor(reservation) {
  return (
    reservation?.book?.author ??
    reservation?.bookId?.author ??
    reservation?.author ??
    null
  );
}

function getExpiryTime(reservation) {
  return reservation?.expiryTime ?? reservation?.expiry ?? reservation?.expiredAt ?? null;
}

function getDueDate(reservation) {
  return reservation?.dueDate ?? reservation?.returnDate ?? null;
}

function formatRemainingPrebookTime(reservation) {
  const baseTime = reservation?.reservedAt
    ? new Date(reservation.reservedAt)
    : reservation?.createdAt
    ? new Date(reservation.createdAt)
    : null;

  if (!baseTime || Number.isNaN(baseTime.getTime())) {
    return "less than 24 hours";
  }

  const expiryTime = new Date(baseTime.getTime() + 24 * 60 * 60 * 1000);
  const remainingMs = expiryTime.getTime() - Date.now();

  if (remainingMs <= 0) {
    return "0 minutes";
  }

  const totalMinutes = Math.ceil(remainingMs / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) {
    return `${hours} hour${hours !== 1 ? "s" : ""} ${minutes} minute${
      minutes !== 1 ? "s" : ""
    }`;
  }

  if (hours > 0) {
    return `${hours} hour${hours !== 1 ? "s" : ""}`;
  }

  return `${minutes} minute${minutes !== 1 ? "s" : ""}`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  PRE-BOOK EMAILS
// ─────────────────────────────────────────────────────────────────────────────

async function sendPrebookConfirmationEmail(reservation) {
  const studentName = getStudentName(reservation);
  const studentEmail = getStudentEmail(reservation);
  const bookTitle = getBookTitle(reservation, "Your reserved book");
  const author = getBookAuthor(reservation);
  const expiryTime = getExpiryTime(reservation);

  if (!studentEmail) {
    console.warn("[Mailer] sendPrebookConfirmationEmail: no student email found.");
    return false;
  }

  const body = `
    <p>Hi <strong>${studentName}</strong>,</p>
    <p>Your pre-book reservation has been <strong>confirmed</strong>! 🎉</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:6px 0;color:#64748b;width:40%">Book</td>
          <td><strong>${bookTitle}</strong></td></tr>
      ${author ? `<tr><td style="padding:6px 0;color:#64748b">Author</td>
          <td>${author}</td></tr>` : ""}
      ${expiryTime ? `<tr><td style="padding:6px 0;color:#64748b">Reserve expires</td>
          <td><strong>${fmt(expiryTime)}</strong></td></tr>` : ""}
    </table>
    <p>Please collect the book from the library before the reservation expires.</p>`;

  return sendMail(
    studentEmail,
    `📚 Pre-book Confirmed: "${bookTitle}"`,
    template("Pre-book Reservation Confirmed", "#2563eb", body)
  );
}

async function sendPrebook12HourReminderEmail(reservation) {
  const studentName = getStudentName(reservation);
  const studentEmail = getStudentEmail(reservation);
  const bookTitle = getBookTitle(reservation, "Your reserved book");
  const author = getBookAuthor(reservation);
  const expiryTime = getExpiryTime(reservation);

  if (!studentEmail) {
    console.warn("[Mailer] sendPrebook12HourReminderEmail: no student email found.");
    return false;
  }

  const body = `
    <p>Hi <strong>${studentName}</strong>,</p>
    <p>⏰ Your pre-book reservation expires in <strong>approximately 12 hours</strong>.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:6px 0;color:#64748b;width:40%">Book</td>
          <td><strong>${bookTitle}</strong></td></tr>
      ${author ? `<tr><td style="padding:6px 0;color:#64748b">Author</td>
          <td>${author}</td></tr>` : ""}
      ${expiryTime ? `<tr><td style="padding:6px 0;color:#64748b">Expires at</td>
          <td><strong>${fmt(expiryTime)}</strong></td></tr>` : ""}
    </table>
    <p>Please collect the book soon, or the reservation will be released to other students.</p>`;

  return sendMail(
    studentEmail,
    `⏰ 12-Hour Reminder: Collect "${bookTitle}" Before It Expires`,
    template("Pre-book Expiry Reminder — 12 Hours Left", "#f59e0b", body)
  );
}

async function sendManualPrebookReminderEmail(reservation) {
  const studentName = getStudentName(reservation);
  const studentEmail = getStudentEmail(reservation);
  const bookTitle = getBookTitle(reservation);
  const author = getBookAuthor(reservation);
  const remainingTime = formatRemainingPrebookTime(reservation);
  const expiryTime = getExpiryTime(reservation);

  if (!studentEmail) {
    console.warn("[Mailer] sendManualPrebookReminderEmail: no student email found.");
    return false;
  }

  const subject = `Reminder: Collect your pre-booked book within ${remainingTime}`;

  const body = `
    <p>Hi <strong>${studentName}</strong>,</p>
    <p>This is a reminder to collect your pre-booked book from the library.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:6px 0;color:#64748b;width:40%">Book</td>
          <td><strong>${bookTitle}</strong></td></tr>
      ${author ? `<tr><td style="padding:6px 0;color:#64748b">Author</td>
          <td>${author}</td></tr>` : ""}
      <tr><td style="padding:6px 0;color:#64748b">Time remaining</td>
          <td><strong>${remainingTime}</strong></td></tr>
      ${expiryTime ? `<tr><td style="padding:6px 0;color:#64748b">Expires at</td>
          <td><strong>${fmt(expiryTime)}</strong></td></tr>` : ""}
    </table>
    <p>Please collect the book before the reservation expires automatically after 24 hours from the time of pre-booking.</p>`;

  return sendMail(
    studentEmail,
    subject,
    template("Pre-book Reminder", "#0ea5e9", body)
  );
}

async function sendPrebook20HourReminderEmail(reservation) {
  const studentName = getStudentName(reservation);
  const studentEmail = getStudentEmail(reservation);
  const bookTitle = getBookTitle(reservation, "Your reserved book");
  const author = getBookAuthor(reservation);
  const expiryTime = getExpiryTime(reservation);

  if (!studentEmail) {
    console.warn("[Mailer] sendPrebook20HourReminderEmail: no student email found.");
    return false;
  }

  const body = `
    <p>Hi <strong>${studentName}</strong>,</p>
    <p>📢 Your pre-book reservation expires in <strong>approximately 4 hours</strong>.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:6px 0;color:#64748b;width:40%">Book</td>
          <td><strong>${bookTitle}</strong></td></tr>
      ${author ? `<tr><td style="padding:6px 0;color:#64748b">Author</td>
          <td>${author}</td></tr>` : ""}
      ${expiryTime ? `<tr><td style="padding:6px 0;color:#64748b">Expires at</td>
          <td><strong>${fmt(expiryTime)}</strong></td></tr>` : ""}
    </table>
    <p>Head over to the library to collect your reserved book before time runs out!</p>`;

  return sendMail(
    studentEmail,
    `🚨 Final Reminder: "${bookTitle}" expires in about 4 hours`,
    template("Final Pre-book Reminder — 4 Hours Left", "#ef4444", body)
  );
}

async function sendPrebookExpiredEmail(reservation) {
  const studentName = getStudentName(reservation);
  const studentEmail = getStudentEmail(reservation);
  const bookTitle = getBookTitle(reservation, "Your reserved book");
  const author = getBookAuthor(reservation);

  if (!studentEmail) {
    console.warn("[Mailer] sendPrebookExpiredEmail: no student email found.");
    return false;
  }

  const body = `
    <p>Hi <strong>${studentName}</strong>,</p>
    <p>Unfortunately, your pre-book reservation has <strong>expired</strong> and the book has been
       released back to the library queue.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:6px 0;color:#64748b;width:40%">Book</td>
          <td><strong>${bookTitle}</strong></td></tr>
      ${author ? `<tr><td style="padding:6px 0;color:#64748b">Author</td>
          <td>${author}</td></tr>` : ""}
    </table>
    <p>You may visit the library or log in to place a new reservation if the book is still available.</p>`;

  return sendMail(
    studentEmail,
    `❌ Pre-book Expired: "${bookTitle}"`,
    template("Pre-book Reservation Expired", "#dc2626", body)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  RETURN / DUE-DATE REMINDER EMAILS
// ─────────────────────────────────────────────────────────────────────────────

async function _sendDueReminderEmail({
  reservation,
  daysLabel,
  accentColor,
  subject,
  urgencyNote,
}) {
  const studentName = getStudentName(reservation);
  const studentEmail = getStudentEmail(reservation);
  const bookTitle = getBookTitle(reservation, "Borrowed book");
  const author = getBookAuthor(reservation);
  const dueDate = getDueDate(reservation);

  if (!studentEmail) {
    console.warn(`[Mailer] ${subject}: no student email found.`);
    return false;
  }

  const body = `
    <p>Hi <strong>${studentName}</strong>,</p>
    <p>${urgencyNote}</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:6px 0;color:#64748b;width:40%">Book</td>
          <td><strong>${bookTitle}</strong></td></tr>
      ${author ? `<tr><td style="padding:6px 0;color:#64748b">Author</td>
          <td>${author}</td></tr>` : ""}
      ${dueDate ? `<tr><td style="padding:6px 0;color:#64748b">Due date</td>
          <td><strong>${fmt(dueDate)}</strong></td></tr>` : ""}
    </table>
    <p>Please return the book to the library on time to avoid late fees.</p>`;

  return sendMail(
    studentEmail,
    subject,
    template(`Return Reminder — ${daysLabel}`, accentColor, body)
  );
}

async function sendDue10DayReminderEmail(reservation) {
  return _sendDueReminderEmail({
    reservation,
    daysLabel: "10 Days Left",
    accentColor: "#0ea5e9",
    subject: `📅 Return Reminder: "${getBookTitle(reservation, "Book")}" due in 10 days`,
    urgencyNote:
      'This is a friendly reminder that your borrowed book is due in <strong>10 days</strong>.',
  });
}

async function sendDue5DayReminderEmail(reservation) {
  return _sendDueReminderEmail({
    reservation,
    daysLabel: "5 Days Left",
    accentColor: "#6366f1",
    subject: `📅 Return Reminder: "${getBookTitle(reservation, "Book")}" due in 5 days`,
    urgencyNote:
      'Your borrowed book is due in <strong>5 days</strong>. Please plan your return soon.',
  });
}

async function sendDue2DayReminderEmail(reservation) {
  return _sendDueReminderEmail({
    reservation,
    daysLabel: "2 Days Left",
    accentColor: "#f59e0b",
    subject: `⚠️ Return Reminder: "${getBookTitle(reservation, "Book")}" due in 2 days`,
    urgencyNote:
      '⚠️ Your book is due in just <strong>2 days</strong>. Please return it on time.',
  });
}

async function sendDue1DayReminderEmail(reservation) {
  return _sendDueReminderEmail({
    reservation,
    daysLabel: "1 Day Left",
    accentColor: "#ef4444",
    subject: `🚨 Final Reminder: "${getBookTitle(reservation, "Book")}" due TOMORROW`,
    urgencyNote:
      '🚨 <strong>Last reminder!</strong> Your book is due <strong>tomorrow</strong>. Please return it to avoid a late fee.',
  });
}

async function sendDueTodayReminderEmail(reservation) {
  return _sendDueReminderEmail({
    reservation,
    daysLabel: "Due Today",
    accentColor: "#dc2626",
    subject: `🔴 Due Today: Please Return "${getBookTitle(reservation, "Book")}"`,
    urgencyNote:
      '🔴 Your book is <strong>due TODAY</strong>. Please return it to the library before closing time.',
  });
}

async function sendOverdueReminderEmail(reservation) {
  const studentName = getStudentName(reservation);
  const studentEmail = getStudentEmail(reservation);
  const bookTitle = getBookTitle(reservation, "Borrowed book");
  const author = getBookAuthor(reservation);
  const dueDate = getDueDate(reservation);
  const overdueDays = reservation?.overdueDays ?? null;

  if (!studentEmail) {
    console.warn("[Mailer] sendOverdueReminderEmail: no student email found.");
    return false;
  }

  const overdueLine = overdueDays
    ? `Your book is now <strong>${overdueDays} day${
        overdueDays !== 1 ? "s" : ""
      } overdue</strong>.`
    : "Your book is <strong>overdue</strong>.";

  const body = `
    <p>Hi <strong>${studentName}</strong>,</p>
    <p>🚫 ${overdueLine} Late fees may be accumulating.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:6px 0;color:#64748b;width:40%">Book</td>
          <td><strong>${bookTitle}</strong></td></tr>
      ${author ? `<tr><td style="padding:6px 0;color:#64748b">Author</td>
          <td>${author}</td></tr>` : ""}
      ${dueDate ? `<tr><td style="padding:6px 0;color:#64748b">Was due on</td>
          <td><strong>${fmt(dueDate)}</strong></td></tr>` : ""}
      ${overdueDays ? `<tr><td style="padding:6px 0;color:#64748b">Days overdue</td>
          <td style="color:#dc2626"><strong>${overdueDays} day${
            overdueDays !== 1 ? "s" : ""
          }</strong></td></tr>` : ""}
    </table>
    <p>Please return the book to the library immediately to avoid further penalties.</p>`;

  return sendMail(
    studentEmail,
    `🚫 Overdue Notice: Please Return "${bookTitle}" Immediately`,
    template("Overdue Book Notice", "#991b1b", body)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  MANUAL COLLECTED REMINDER EMAIL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * sendManualCollectedReminderEmail(reservation)
 *
 * Sends a single, context-aware due-date reminder for a "collected" book.
 * Called only from the admin manual-remind route — never by the automated
 * scheduler. Does NOT touch or depend on any reminder-flag fields.
 *
 * diffDays is computed using calendar-day logic (midnight-anchored) so the
 * branch is stable regardless of what time of day the admin fires the reminder:
 *
 *   diffDays > 0  →  "due in X day(s)"
 *   diffDays = 0  →  "due today"
 *   diffDays < 0  →  "overdue by X day(s)"
 *
 * Returns false when studentEmail or dueDate is missing.
 * Returns the sendMail result (true/false) on success.
 *
 * @param {object} reservation  Flat mailer payload from buildMailerPayload()
 */
async function sendManualCollectedReminderEmail(reservation) {
  const studentName  = getStudentName(reservation);
  const studentEmail = getStudentEmail(reservation);
  const bookTitle    = getBookTitle(reservation, "Borrowed book");
  const bookAuthor   = getBookAuthor(reservation);
  const dueDate      = getDueDate(reservation);

  if (!studentEmail) {
    console.warn("[Mailer] sendManualCollectedReminderEmail: no student email found.");
    return false;
  }
  if (!dueDate) {
    console.warn("[Mailer] sendManualCollectedReminderEmail: no dueDate found.");
    return false;
  }

  // ── Calendar-day diff ────────────────────────────────────────────────────
  // Floor both sides to midnight so "due today" is exactly diffDays === 0
  // regardless of the time the admin clicks Send Reminder.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const dueStart = new Date(dueDate);
  dueStart.setHours(0, 0, 0, 0);

  const diffDays = Math.round(
    (dueStart.getTime() - todayStart.getTime()) / (1000 * 60 * 60 * 24)
  );

  // ── Build dynamic subject + body ─────────────────────────────────────────
  let subject, accentColor, urgencyLine;

  if (diffDays > 0) {
    subject     = `📅 Return Reminder: "${bookTitle}" is due in ${diffDays} day${diffDays !== 1 ? "s" : ""}`;
    accentColor = diffDays <= 2 ? "#f59e0b" : "#0ea5e9";
    urgencyLine = `Your borrowed book is due in <strong>${diffDays} day${diffDays !== 1 ? "s" : ""}</strong> (${fmt(dueDate)}). Please return it on time to avoid overdue fines.`;
  } else if (diffDays === 0) {
    subject     = `🔴 Due Today: Please Return "${bookTitle}"`;
    accentColor = "#dc2626";
    urgencyLine = `Your borrowed book is <strong>due TODAY</strong> (${fmt(dueDate)}). Please return it to the library before closing time.`;
  } else {
    const overdueDays = Math.abs(diffDays);
    subject     = `🚫 Overdue Notice: "${bookTitle}" is overdue by ${overdueDays} day${overdueDays !== 1 ? "s" : ""}`;
    accentColor = "#991b1b";
    urgencyLine = `Your borrowed book is <strong>overdue by ${overdueDays} day${overdueDays !== 1 ? "s" : ""}</strong> (was due: ${fmt(dueDate)}). Please return it immediately to avoid further penalties.`;
  }

  const body = `
    <p>Hi <strong>${studentName}</strong>,</p>
    <p>${urgencyLine}</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:6px 0;color:#64748b;width:40%">Book</td>
          <td><strong>${bookTitle}</strong></td></tr>
      ${bookAuthor ? `<tr><td style="padding:6px 0;color:#64748b">Author</td>
          <td>${bookAuthor}</td></tr>` : ""}
      <tr><td style="padding:6px 0;color:#64748b">Due date</td>
          <td><strong>${fmt(dueDate)}</strong></td></tr>
    </table>
    <p>If you have already returned the book, please disregard this message.</p>`;

  const titleLabel = diffDays > 0
    ? `Return Reminder — ${diffDays} Day${diffDays !== 1 ? "s" : ""} Left`
    : diffDays === 0
      ? "Return Reminder — Due Today"
      : "Overdue Book Notice";

  return sendMail(studentEmail, subject, template(titleLabel, accentColor, body));
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
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
};