import { useEffect, useState } from "react";
import LoginPage from "./pages/LoginPage";
import StudentDashboardPage from "./pages/StudentDashboardPage";
import AdminDashboardPage from "./pages/AdminDashboardPage";

import Toast from "./components/Toast";
import ConfirmModal from "./components/ConfirmModal";

import { apiRequest } from "./api";
import { getToken, clearToken } from "./auth";

/* =========================================
   APP

   Student sub-page routing (dashboard ↔ reservations)
   is managed internally by StudentDashboardPage via its
   own `activeStudentPage` state.  No Router needed here.
========================================= */
export default function App() {
  const [user, setUser] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [toast, setToast] = useState(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  useEffect(() => {
    const token = getToken();

    if (!token) {
      setCheckingAuth(false);
      return;
    }

    apiRequest("/auth/me")
      .then((data) => {
        setUser(data.user);
      })
      .catch(() => {
        clearToken();
      })
      .finally(() => {
        setCheckingAuth(false);
      });
  }, []);

  const requestLogout = () => {
    setShowLogoutConfirm(true);
  };

  const handleLogout = () => {
    clearToken();
    setUser(null);
    setShowLogoutConfirm(false);
    setToast({ type: "success", message: "Logged out successfully" });
  };

  if (checkingAuth) {
    return (
      <div className="loading-screen">
        <div className="loading-card">Loading BookAhead...</div>
      </div>
    );
  }

  return (
    <>
      <Toast toast={toast} onClose={() => setToast(null)} />

      {!user ? (
        <LoginPage onAuthSuccess={setUser} setToast={setToast} />
      ) : user.role === "admin" ? (
        <AdminDashboardPage
          user={user}
          onUserUpdated={setUser}
          onLogoutClick={requestLogout}
          setToast={setToast}
        />
      ) : (
        /* StudentDashboardPage manages its own sub-navigation:
           "dashboard" renders the main view,
           "reservations" renders StudentReservationsPage.        */
        <StudentDashboardPage
          user={user}
          onUserUpdated={setUser}
          onLogoutClick={requestLogout}
          setToast={setToast}
        />
      )}

      <ConfirmModal
        open={showLogoutConfirm}
        title="Logout"
        message="Are you sure you want to logout from your account?"
        subtext="You will need to sign in again to continue using the dashboard."
        confirmText="Logout"
        confirmVariant="primary"
        onCancel={() => setShowLogoutConfirm(false)}
        onConfirm={handleLogout}
      />
    </>
  );
}