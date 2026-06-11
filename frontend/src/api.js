import { getToken } from "./auth";

export const API_BASE =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ||
  import.meta.env.VITE_API_URL?.replace(/\/$/, "") ||
  "http://localhost:4000/api";

console.log("API_BASE =", API_BASE);

export const SERVER_ORIGIN = API_BASE.replace(/\/api$/, "");

/**
 * Central fetch wrapper used by every component and page in this app.
 *
 * • Reads the JWT via getToken() from auth.js — the single source of truth.
 * • Attaches Authorization: Bearer <token> automatically.
 * • Throws an Error with the server's own message on non-2xx responses.
 *
 * PATH CONVENTION (important):
 *   API_BASE already contains "/api" (e.g. "http://localhost:4000/api").
 *   Endpoint paths passed here must NOT start with "/api/" or the URL
 *   will be doubled ("…/api/api/…") and every request will 404.
 *
 *   ✓ correct:  apiRequest("/admin/reports/today")
 *   ✗ wrong:    apiRequest("/api/admin/reports/today")
 *
 *   App.jsx confirms this: apiRequest("/auth/me") — no "/api" prefix.
 */
export async function apiRequest(endpoint, options = {}) {
  const token = getToken();
  const isFormData = options.body instanceof FormData;

  const headers = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || "Request failed");
  }

  return data;
}

/**
 * Downloads an Excel (.xlsx) report from a backend export endpoint and
 * triggers a browser save-as dialog.
 *
 * Uses the same API_BASE and getToken() as apiRequest() — no separate
 * auth or base-URL logic.
 *
 * PATH CONVENTION: same as apiRequest() — no leading "/api/".
 *
 * @param {string} endpoint          e.g. "/admin/reports/today/export"
 * @param {string} fallbackFilename  e.g. "report-today.xlsx"
 */
export async function downloadExcel(endpoint, fallbackFilename = "export.xlsx") {
  const token = getToken();

  const headers = {
    Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: "GET",
    headers,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || "Export failed");
  }

  const contentType        = response.headers.get("Content-Type") || "";
  const contentDisposition = response.headers.get("Content-Disposition") || "";

  // Safety check: prevent saving a JSON error body as an .xlsx file
  if (
    !contentType.includes(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
  ) {
    const text = await response.text().catch(() => "");
    throw new Error(
      text || "Invalid export response: backend did not return an Excel file."
    );
  }

  const blob = await response.blob();

  // Prefer the filename the server declared in Content-Disposition
  let filename = fallbackFilename;
  const utf8Match   = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  const normalMatch = contentDisposition.match(/filename="([^"]+)"/i);
  if (utf8Match?.[1])   filename = decodeURIComponent(utf8Match[1]);
  else if (normalMatch?.[1]) filename = normalMatch[1];

  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}