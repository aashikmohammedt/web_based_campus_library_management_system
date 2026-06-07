import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { apiRequest } from "../api";
import { saveToken } from "../auth";

export default function LoginPage({ onAuthSuccess, setToast }) {
  const [isLogin, setIsLogin] = useState(true);
  const [selectedRole, setSelectedRole] = useState("student");
  const [roleSelected, setRoleSelected] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [studentId, setStudentId] = useState("");

  const [loading, setLoading] = useState(false);
  const [inlineError, setInlineError] = useState("");

  const resetFormState = (nextLogin = isLogin, nextRole = selectedRole) => {
    const normalizedRole = nextRole === "admin" ? "admin" : "student";
    const normalizedLogin = normalizedRole === "admin" ? true : nextLogin;

    setInlineError("");
    setName("");
    setEmail("");
    setPassword("");
    setStudentId("");
    setSelectedRole(normalizedRole);
    setIsLogin(normalizedLogin);
    setRoleSelected(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;

    setInlineError("");
    setLoading(true);

    try {
      const path = isLogin ? "/auth/login" : "/auth/register";
      const payload = isLogin
        ? { email, password }
        : { name, email, password, studentId };

      const data = await apiRequest(path, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      saveToken(data.token);
      onAuthSuccess(data.user);

      const actionText = isLogin
        ? "Logged in successfully"
        : "Account created successfully";
      const roleText = data?.user?.role === "admin" ? "Admin" : "Student";

      setToast({
        type: "success",
        message: `${roleText} ${actionText}`,
      });
    } catch (err) {
      setInlineError(err.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  const isAdmin = selectedRole === "admin";
  const authTitle = `${isAdmin ? "Admin" : "Student"} ${isLogin ? "Login" : "Sign Up"
    }`;

  const authDescription = isLogin
    ? `Sign in to continue to the ${isAdmin ? "admin" : "student"} dashboard.`
    : "Create a student account to continue.";

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="brand-block" style={{ textAlign: "center" }}>
          <span className="brand-eyebrow">Campus Library</span>
          <h1>BookAhead</h1>
          <p>
            Reserve smarter. Manage faster. A modern campus library experience.
          </p>
        </div>

        <div className="auth-head" style={{ textAlign: "center" }}>
          <h2>{authTitle}</h2>
          <p className="muted">{authDescription}</p>
        </div>

        <div className="auth-role-block">
          <p className="auth-role-label">Are you Student or Admin ?</p>

          <div
            className="auth-role-switch"
            role="tablist"
            aria-label="Select account type"
          >
            <button
              type="button"
              className={`auth-role-btn ${roleSelected && selectedRole === "student" ? "active" : ""
                }`}
              onClick={() => resetFormState(isLogin, "student")}
              disabled={loading}
            >
              Student
            </button>

            <button
              type="button"
              className={`auth-role-btn ${roleSelected && selectedRole === "admin" ? "active" : ""
                }`}
              onClick={() => resetFormState(true, "admin")}
              disabled={loading}
            >
              Admin
            </button>
          </div>
        </div>

        {isAdmin ? (
          roleSelected ? (
            <div className="auth-note">
              Admin access is restricted. Only authorized admin accounts can log
              in.
            </div>
          ) : null
        ) : null}

        {roleSelected ? (
          <>
            {inlineError ? <div className="error-text">{inlineError}</div> : null}

            <form className="form-stack" onSubmit={handleSubmit}>
              {!isLogin && !isAdmin && (
                <label>
                  Full Name
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required={!isLogin}
                    disabled={loading}
                    placeholder="Enter your full name"
                  />
                </label>
              )}

              {!isLogin && !isAdmin && (
                <label>
                  Student ID
                  <input
                    value={studentId}
                    onChange={(e) => setStudentId(e.target.value)}
                    required={!isLogin}
                    disabled={loading}
                    placeholder="Enter your Student ID"
                  />
                </label>
              )}

              <label>
                Email Address
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                  placeholder={`Enter ${isAdmin ? "admin" : "student"} email`}
                />
              </label>

              <label>
                Password

                <div className="password-input-wrap">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />

                  <button
                    type="button"
                    className="password-toggle-btn"
                    onClick={() => setShowPassword((prev) => !prev)}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </label>

              <button
                className="primary-btn full-btn"
                type="submit"
                disabled={loading}
              >
                {loading ? "Please wait..." : authTitle}
              </button>
            </form>

            <div className="auth-switch">
              {isAdmin ? (
                <span>Admin login only. Public admin sign up is disabled.</span>
              ) : (
                <>
                  {isLogin ? "Need a new account? " : "Already have an account? "}
                  <button
                    className="link-btn"
                    type="button"
                    onClick={() => resetFormState(!isLogin, "student")}
                    disabled={loading}
                  >
                    {isLogin ? "Switch to Sign Up" : "Switch to Login"}
                  </button>
                </>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}