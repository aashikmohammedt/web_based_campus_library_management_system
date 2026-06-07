import { useState } from "react";
import { SERVER_ORIGIN } from "../api";
import { getInitials } from "../helpers";
import "./TopBar.css";

// Filter options for the left dropdown inside the search bar
const FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "department", label: "Department" },
  { value: "author", label: "Author" },
  { value: "new", label: "New Arrivals" },
];

export default function TopBar({
  title,
  subtitle,
  user,
  onProfileClick,

  // Search bar props — search bar is hidden when these are not passed
  searchValue,
  onSearchChange,
  onSearchSubmit,
  filterType,
  onFilterTypeChange,

  // Admin-only quick actions strip
  // Array of { label: string, onClick: fn, badge?: number }
  quickActions,
}) {
  const [filterOpen, setFilterOpen] = useState(false);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good Morning";
    if (hour < 17) return "Good Afternoon";
    return "Good Evening";
  };

  const resolveImage = (raw) => {
    if (!raw) return "";
    if (raw.startsWith("blob:") || raw.startsWith("data:")) return raw;
    if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
    return `${SERVER_ORIGIN}${raw.startsWith("/") ? "" : "/"}${raw}`;
  };

  const avatarSrc = resolveImage(user?.profileImage);
  const displayName =
    user?.name ||
    user?.username ||
    user?.fullName ||
    user?.email?.split("@")[0] ||
    "User";

  const headerTitle = `${getGreeting()}, ${displayName}`;

  // Search bar is always shown; handlers/value are optional and default to no-ops
  const showSearch = true;
  const safeSearchValue = searchValue ?? "";
  const safeOnSearchChange = typeof onSearchChange === "function" ? onSearchChange : () => {};
  const safeOnSearchSubmit = typeof onSearchSubmit === "function" ? onSearchSubmit : () => {};
  const safeOnFilterTypeChange = typeof onFilterTypeChange === "function" ? onFilterTypeChange : () => {};

  const showQuickActions =
    Array.isArray(quickActions) && quickActions.length > 0;

  const handleFormSubmit = (e) => {
    e.preventDefault();
    safeOnSearchSubmit();
  };

  const getPlaceholder = () => {
    switch (filterType) {
      case "department":
        return "Search by department...";
      case "author":
        return "Search by author...";
      case "new":
        return "Showing new arrivals — type to narrow...";
      default:
        return "Search title, author, department, course code...";
    }
  };

  return (
    <div
      className={`topbar-wrapper ${
        showQuickActions ? "topbar-wrapper--with-qa" : ""
      }`}
    >
      <header className={`topbar${showQuickActions ? " topbar--with-qa" : ""}`}>
        {/* ── Left: title + subtitle ── */}
        <div className="topbar-copy">
          <span className="topbar-eyebrow">Campus Library · BookAhead</span>
          <h1>{headerTitle}</h1>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>

        {/* ── Center: search bar ── */}
        {showSearch ? (
          <form className="topbar-search" onSubmit={handleFormSubmit}>
            <div className="topbar-filter-wrap">
              <select
                className="topbar-search-filter"
                value={filterType || "all"}
                onChange={(e) => {
                  safeOnFilterTypeChange(e.target.value);
                  setFilterOpen(false);
                }}
                onMouseDown={() => setFilterOpen((prev) => !prev)}
                onBlur={() => setFilterOpen(false)}
                aria-label="Filter category"
              >
                {FILTER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              <span className="topbar-filter-arrow" aria-hidden="true">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    transform: filterOpen ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 0.25s ease",
                  }}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </span>
            </div>

            <div className="topbar-search-sep" aria-hidden="true" />

            <div className="topbar-search-input-wrap">
              <input
                type="text"
                className="topbar-search-input"
                placeholder={getPlaceholder()}
                value={safeSearchValue}
                onChange={(e) => safeOnSearchChange(e.target.value)}
                aria-label="Search books"
              />
              {safeSearchValue ? (
                <button
                  type="button"
                  className="topbar-search-clear"
                  onClick={() => safeOnSearchChange("")}
                  aria-label="Clear search"
                >
                  ×
                </button>
              ) : null}
            </div>

            <button
              type="submit"
              className="topbar-search-btn"
              aria-label="Search"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>
          </form>
        ) : (
          /* Spacer keeps the grid balanced when there's no search bar */
          <div className="topbar-search-spacer" aria-hidden="true" />
        )}

        {/* ── Right: avatar ── */}
        <div className="topbar-actions">
          <button
            type="button"
            className={
              avatarSrc
                ? "topbar-avatar-btn topbar-avatar-btn--photo"
                : "topbar-avatar-btn topbar-avatar-btn--initials"
            }
            onClick={onProfileClick}
            aria-label="Open profile"
            title="My Profile"
          >
            {avatarSrc ? (
              <img
                src={avatarSrc}
                alt={user?.name || "Profile"}
                className="topbar-avatar-img"
              />
            ) : (
              <span>{getInitials(user?.name)}</span>
            )}
          </button>
        </div>

        {/* ── Row 2: quick actions — sit below the search bar ── */}
        {showQuickActions ? (
          <div
            className="topbar-quick-actions-inner"
            role="toolbar"
            aria-label="Admin quick actions"
          >
            {quickActions.map((action) => (
              <button
                key={action.label}
                type="button"
                className="topbar-qa-btn"
                onClick={action.onClick}
              >
                {action.label}
                {action.badge ? (
                  <span className="topbar-qa-badge">{action.badge}</span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}

      </header>
    </div>
  );
}