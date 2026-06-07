/**
 * @module dateFormat
 *
 * Single source of truth for ALL date/time formatting across backend and frontend.
 * No toLocaleDateString / toLocaleString / toLocaleTimeString anywhere in this file.
 *
 * Exported functions:
 *   formatDate(dateValue)      → "DD/MM/YYYY"
 *   formatDateTime(dateValue)  → "DD/MM/YYYY, hh:mm AM/PM"
 *   formatTimeOnly(dateValue)  → "hh:mm AM/PM"
 *
 * All functions return "-" for null / undefined / invalid input.
 * Compatible with ESM (import) and CommonJS (require).
 */

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Pads a number to at least 2 digits with a leading zero if needed.
 * @param {number} n
 * @returns {string}
 */
function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * Safely parses any value into a valid Date object.
 * Rejects null, undefined, empty string, and NaN dates.
 * @param {Date|string|number|null|undefined} dateValue
 * @returns {Date|null}
 */
function parseDate(dateValue) {
  if (dateValue === null || dateValue === undefined || dateValue === "") {
    return null;
  }
  const d = new Date(dateValue);
  return isNaN(d.getTime()) ? null : d;
}

// ─── Public formatters ────────────────────────────────────────────────────────

/**
 * Formats a date value as DD/MM/YYYY.
 * Returns "-" if the value is missing or invalid.
 * @param {Date|string|number|null|undefined} dateValue
 * @returns {string}  e.g. "05/01/2026"
 */
export function formatDate(dateValue) {
  const d = parseDate(dateValue);
  if (!d) return "-";

  const day   = pad2(d.getDate());
  const month = pad2(d.getMonth() + 1); // getMonth() is 0-indexed
  const year  = d.getFullYear();

  return `${day}/${month}/${year}`;
}

/**
 * Formats a date value as DD/MM/YYYY, hh:mm AM/PM (12-hour, zero-padded).
 * Returns "-" if the value is missing or invalid.
 * @param {Date|string|number|null|undefined} dateValue
 * @returns {string}  e.g. "05/01/2026, 02:30 PM"
 */
export function formatDateTime(dateValue) {
  const d = parseDate(dateValue);
  if (!d) return "-";

  const day     = pad2(d.getDate());
  const month   = pad2(d.getMonth() + 1);
  const year    = d.getFullYear();

  const hours24 = d.getHours();
  const period  = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12; // 0 → 12 (midnight), 13 → 1, etc.
  const hours   = pad2(hours12);
  const minutes = pad2(d.getMinutes());

  return `${day}/${month}/${year}, ${hours}:${minutes} ${period}`;
}

/**
 * Formats a date value as hh:mm AM/PM (12-hour, zero-padded, no date portion).
 * Returns "-" if the value is missing or invalid.
 * @param {Date|string|number|null|undefined} dateValue
 * @returns {string}  e.g. "02:30 PM"
 */
export function formatTimeOnly(dateValue) {
  const d = parseDate(dateValue);
  if (!d) return "-";

  const hours24 = d.getHours();
  const period  = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  const hours   = pad2(hours12);
  const minutes = pad2(d.getMinutes());

  return `${hours}:${minutes} ${period}`;
}

// ─── CommonJS interop (Node / backend) ───────────────────────────────────────
// Allows:  const { formatDate, formatDateTime, formatTimeOnly } = require('./dateFormat');

if (typeof module !== "undefined" && module.exports) {
  module.exports = { formatDate, formatDateTime, formatTimeOnly };
}