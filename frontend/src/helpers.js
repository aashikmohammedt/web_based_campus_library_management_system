import { SERVER_ORIGIN } from "./api";

export function getInitials(name = "") {
  return (
    name
      .trim()
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || "")
      .join("") || "U"
  );
}

export function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  return "Good Evening";
}

export function getRoleLabel(role) {
  return role === "admin" ? "Administrator" : "Student";
}

export function normalizeDepartment(dept) {
  const raw = String(dept || "").trim();
  if (!raw) return "GENERAL";

  const value = raw.toUpperCase();

  // Computer Science / IT
  if (
    ["CSE", "IT", "COMPUTER SCIENCE", "COMPUTER SCIENCE / IT", "COMPUTER SCIENCE AND ENGINEERING"]
      .includes(value)
  ) {
    return "Computer Science / IT";
  }

  // Electronics & Communication (ECE)
  if (
    ["ECE", "ELECTRONICS", "ELECTRONICS AND COMMUNICATION", "ELECTRONICS & COMMUNICATION (ECE)"]
      .includes(value)
  ) {
    return "Electronics & Communication (ECE)";
  }

  // Electrical & Electronics Engineering (EEE)
  if (
    ["EEE", "ELECTRICAL", "ELECTRICAL AND ELECTRONICS", "ELECTRICAL & ELECTRONICS ENGINEERING (EEE)"]
      .includes(value)
  ) {
    return "Electrical & Electronics Engineering (EEE)";
  }

  // Mechanical Engineering
  if (
    ["MECH", "MECHANICAL", "MECHANICAL ENGINEERING"].includes(value)
  ) {
    return "Mechanical Engineering";
  }

  // Civil Engineering
  if (
    ["CIVIL", "CIVIL ENGINEERING"].includes(value)
  ) {
    return "Civil Engineering";
  }

  // Artificial Intelligence / Data Science
  if (
    ["AI", "AIDS", "AI&DS", "AI / DS", "ARTIFICIAL INTELLIGENCE / DATA SCIENCE", "ARTIFICIAL INTELLIGENCE AND DATA SCIENCE"]
      .includes(value)
  ) {
    return "Artificial Intelligence / Data Science";
  }

  // Management / MBA / Commerce
  if (
    ["MBA", "BBA", "COMMERCE", "MANAGEMENT", "MANAGEMENT / MBA / COMMERCE"].includes(value)
  ) {
    return "Management / MBA / Commerce";
  }

  // English / Communication / Soft Skills
  if (
    ["ENGLISH", "COMMUNICATION", "SOFT SKILLS", "ENGLISH / COMMUNICATION / SOFT SKILLS"].includes(value)
  ) {
    return "English / Communication / Soft Skills";
  }

  // Mathematics
  if (
    ["MATHS", "MATHEMATICS"].includes(value)
  ) {
    return "Mathematics";
  }

  // Physics / Basic Sciences
  if (
    ["PHYSICS", "BASIC SCIENCES", "PHYSICS / BASIC SCIENCES"].includes(value)
  ) {
    return "Physics / Basic Sciences";
  }

  // Chemistry / Environmental Science
  if (
    ["CHEMISTRY", "ENVIRONMENTAL SCIENCE", "CHEMISTRY / ENVIRONMENTAL SCIENCE"].includes(value)
  ) {
    return "Chemistry / Environmental Science";
  }

  // General Aptitude / Placement
  if (
    ["APTITUDE", "PLACEMENT", "GENERAL APTITUDE", "GENERAL APTITUDE / PLACEMENT"].includes(value)
  ) {
    return "General Aptitude / Placement";
  }

  // Others
  if (
    ["OTHER", "OTHERS", "OTHERS (MODERN READING / POPULAR SHELF)"].includes(value)
  ) {
    return "Others (Modern Reading / Popular Shelf)";
  }

  return raw;
}

export function getReservationDerivedStatus(reservation) {
  if (!reservation) return "reserved";

  if (reservation.status === "returned") return "returned";
  if (reservation.status === "cancelled") return "cancelled";

  const dueDate = reservation.dueDate ? new Date(reservation.dueDate) : null;
  const isOverdue =
    dueDate &&
    !Number.isNaN(dueDate.getTime()) &&
    dueDate.getTime() < Date.now() &&
    ["reserved", "collected"].includes(reservation.status);

  if (isOverdue) return "overdue";

  return reservation.status;
}

export function getBookImage(book) {
  const raw = book?.coverImage ? String(book.coverImage).trim() : "";
  if (!raw) return "";

  if (raw.startsWith("/uploads/")) {
    return `${SERVER_ORIGIN}${raw}`;
  }

  return raw;
}
export function sortBooks(list, sortBy) {
  const cloned = [...list];

  if (sortBy === "title") {
    return cloned.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  }

  if (sortBy === "available") {
    return cloned.sort((a, b) => {
      const aAvailable = (a.availableCopies || 0) > 0 ? 1 : 0;
      const bAvailable = (b.availableCopies || 0) > 0 ? 1 : 0;
      return bAvailable - aAvailable;
    });
  }

  if (sortBy === "new") {
    return cloned.sort((a, b) => {
      const aNew = a.isNewArrival ? 1 : 0;
      const bNew = b.isNewArrival ? 1 : 0;
      if (bNew !== aNew) return bNew - aNew;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });
  }

  return cloned.sort(
    (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
  );
}