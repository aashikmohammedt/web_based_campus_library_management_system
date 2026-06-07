import { useEffect, useRef, useState } from "react";
import { Pencil, X } from "lucide-react";
import "./ProfileSidebar.css";
import { apiRequest, SERVER_ORIGIN } from "../api";
import { saveToken } from "../auth";
import { getInitials, getRoleLabel } from "../helpers";

function resolveProfileImage(raw) {
  if (!raw) return "";
  if (raw.startsWith("blob:") || raw.startsWith("data:")) return raw;
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  return `${SERVER_ORIGIN}${raw.startsWith("/") ? "" : "/"}${raw}`;
}

export default function ProfileSidebar({
  open,
  onClose,
  user,
  onProfileUpdated,
  onLogoutClick,
  setToast,
}) {
  const [view, setView] = useState("info"); // "info" | "edit"

  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [studentId, setStudentId] = useState(user?.studentId || "");
  const [saving, setSaving] = useState(false);

  const [profilePreview, setProfilePreview] = useState("");
  const [profileFile, setProfileFile] = useState(null);
  const [removeProfileImage, setRemoveProfileImage] = useState(false);

  const fileInputRef = useRef(null);
  const objectUrlRef = useRef(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    setName(user?.name || "");
    setEmail(user?.email || "");
    setStudentId(user?.studentId || "");
    setProfilePreview(resolveProfileImage(user?.profileImage));
    setProfileFile(null);
    setRemoveProfileImage(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, [user]);

  useEffect(() => {
    if (open) {
      setView("info");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    }
  }, [open]);

  // Scroll lock — prevent background scroll when sidebar is open
  useEffect(() => {
    if (open) {
      document.body.classList.add("body-scroll-locked");
    } else {
      document.body.classList.remove("body-scroll-locked");
    }
    return () => {
      document.body.classList.remove("body-scroll-locked");
    };
  }, [open]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  const resetEditFields = () => {
    setName(user?.name || "");
    setEmail(user?.email || "");
    setStudentId(user?.studentId || "");
    setProfileFile(null);
    setRemoveProfileImage(false);
    setProfilePreview(resolveProfileImage(user?.profileImage));
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  };

  const goEdit = () => {
    resetEditFields();
    setView("edit");
  };

  const goInfo = () => {
    resetEditFields();
    setView("info");
  };

  const handleChooseImage = () => {
    fileInputRef.current?.click();
  };

  const handleImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setToast?.({
        type: "error",
        message: "Please select a valid image file",
      });
      return;
    }

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }

    const previewUrl = URL.createObjectURL(file);
    objectUrlRef.current = previewUrl;

    setProfileFile(file);
    setRemoveProfileImage(false);
    setProfilePreview(previewUrl);
  };

  const handleRemoveImage = () => {
    setProfileFile(null);
    setRemoveProfileImage(true);
    setProfilePreview("");

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  };

  const handleSaveProfile = async () => {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();

    if (!trimmedName) {
      setToast?.({
        type: "error",
        message: "Name cannot be empty",
      });
      return;
    }

    if (!trimmedEmail) {
      setToast?.({
        type: "error",
        message: "Email cannot be empty",
      });
      return;
    }

    const wantsPasswordChange =
      currentPassword.trim() || newPassword.trim() || confirmPassword.trim();

    if (wantsPasswordChange) {
      if (!currentPassword.trim() || !newPassword.trim() || !confirmPassword.trim()) {
        setToast?.({
          type: "error",
          message: "Fill all password fields to change password",
        });
        return;
      }

      if (newPassword.trim().length < 6) {
        setToast?.({
          type: "error",
          message: "New password must be at least 6 characters",
        });
        return;
      }

      if (newPassword.trim() !== confirmPassword.trim()) {
        setToast?.({
          type: "error",
          message: "New password and confirm password do not match",
        });
        return;
      }
    }

    setSaving(true);

    try {
      const formData = new FormData();
      formData.append("name", trimmedName);
      formData.append("email", trimmedEmail);
      formData.append("studentId", studentId.trim());

      if (profileFile) {
        formData.append("profileImage", profileFile);
      }

      if (removeProfileImage) {
        formData.append("removeProfileImage", "true");
      }

      if (wantsPasswordChange) {
        formData.append("currentPassword", currentPassword.trim());
        formData.append("newPassword", newPassword.trim());
      }

      const data = await apiRequest("/auth/profile", {
        method: "PUT",
        body: formData,
      });

      if (data?.token) {
        saveToken(data.token);
      }

      if (data?.user) {
        onProfileUpdated?.(data.user);
      }

      setProfilePreview(resolveProfileImage(data?.user?.profileImage));
      setProfileFile(null);
      setRemoveProfileImage(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }

      setView("info");

      setToast?.({
        type: "success",
        message: data?.message || "Profile updated successfully",
      });
    } catch (err) {
      setToast?.({
        type: "error",
        message: err.message || "Failed to update profile",
      });
    } finally {
      setSaving(false);
    }
  };

  const SavedAvatar = () => {
    const src = resolveProfileImage(user?.profileImage);

    return (
      <div className="profile-avatar-large">
        {src ? (
          <img src={src} alt={user?.name || "Profile"} />
        ) : (
          <span>{getInitials(user?.name)}</span>
        )}
      </div>
    );
  };

  const EditAvatar = () => {
    return (
      <div className="profile-avatar-large">
        {profilePreview ? (
          <img src={profilePreview} alt="Profile preview" />
        ) : (
          <span>{getInitials(name || user?.name)}</span>
        )}
      </div>
    );
  };

  if (!open) return null;

  return (
    <>
      <div className={`overlay ${open ? "show" : ""}`} onClick={onClose} />

      <aside className={`profile-sidebar ${open ? "open" : ""}`}>
        <div className="side-panel-header">
          <div>
            <h3>{view === "info" ? "My Profile" : "Edit Profile"}</h3>
            <p className="muted">
              {view === "info"
                ? "Your account information"
                : "Update your details below"}
            </p>
          </div>

          <button
            type="button"
            className="icon-close-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} strokeWidth={2.2} />
          </button>
        </div>

        <div className="profile-user-box">
          <SavedAvatar />

          <div className="profile-user-meta">
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: "10px",
                width: "100%",
              }}
            >
              <div>
                <h4>{user?.name || "User"}</h4>
                <p>{user?.email || "No email"}</p>
              </div>

              {view === "info" && (
                <button
                  type="button"
                  className="profile-edit-icon-btn"
                  onClick={goEdit}
                  aria-label="Edit profile"
                  title="Edit profile"
                >
                  <Pencil size={16} strokeWidth={2.2} />
                </button>
              )}
            </div>

            <span className="role-chip">{getRoleLabel(user?.role)}</span>
          </div>
        </div>

        {view === "info" && (
          <div className="profile-sidebar-content">
            <div className="profile-section">
              <p className="profile-section-title">Personal Information</p>

              <div className="profile-detail-list">
                <div className="profile-detail-item">
                  <span>Full Name</span>
                  <strong>{user?.name || "—"}</strong>
                </div>

                <div className="profile-detail-item">
                  <span>Email Address</span>
                  <strong>{user?.email || "—"}</strong>
                </div>

                {user?.role === "student" && (
                  <div className="profile-detail-item">
                    <span>Student ID</span>
                    <strong>{user?.studentId || "—"}</strong>
                  </div>
                )}

                <div className="profile-detail-item">
                  <span>Role</span>
                  <strong>{getRoleLabel(user?.role)}</strong>
                </div>
              </div>
            </div>

            <div className="profile-sidebar-footer">
              <button
                type="button"
                className="danger-soft-btn full-btn"
                onClick={() => onLogoutClick?.()}
              >
                Logout
              </button>
            </div>
          </div>
        )}

        {view === "edit" && (
          <div className="profile-sidebar-content">
            <div className="profile-section">
              <p className="profile-section-title">Profile Picture</p>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                  alignItems: "flex-start",
                }}
              >
                <EditAvatar />

                <div className="profile-image-actions">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImageChange}
                    style={{ display: "none" }}
                  />

                  <button
                    type="button"
                    className="secondary-btn full-btn"
                    onClick={handleChooseImage}
                    disabled={saving}
                  >
                    Upload Photo
                  </button>

                  <button
                    type="button"
                    className="danger-soft-btn full-btn"
                    onClick={handleRemoveImage}
                    disabled={saving || (!user?.profileImage && !profileFile)}
                  >
                    Remove Photo
                  </button>
                </div>
              </div>
            </div>

            <div className="profile-section">
              <p className="profile-section-title">Account Details</p>

              <div className="form-stack">
                <label>
                  Full Name
                  <input
                    type="text"
                    value={name}
                    disabled={saving}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter your full name"
                  />
                </label>

                <label>
                  Email Address
                  <input
                    type="email"
                    value={email}
                    disabled={saving}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email"
                  />
                </label>

                {user?.role === "student" && (
                  <label>
                    Student ID
                    <input
                      type="text"
                      value={studentId}
                      disabled={saving}
                      onChange={(e) => setStudentId(e.target.value)}
                      placeholder="Enter your Student ID"
                    />
                  </label>
                )}
              </div>
            </div>

            <div className="profile-section">
              <p className="profile-section-title">Change Password (Optional)</p>

              <div className="form-stack">
                <label>
                  Current Password
                  <input
                    type="password"
                    value={currentPassword}
                    disabled={saving}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Required only if changing password"
                  />
                </label>

                <label>
                  New Password
                  <input
                    type="password"
                    value={newPassword}
                    disabled={saving}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                  />
                </label>

                <label>
                  Confirm New Password
                  <input
                    type="password"
                    value={confirmPassword}
                    disabled={saving}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter new password"
                  />
                </label>
              </div>
            </div>

            <div className="profile-edit-actions">
              <button
                type="button"
                className="primary-btn full-btn"
                onClick={handleSaveProfile}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>

              <button
                type="button"
                className="secondary-btn full-btn"
                onClick={goInfo}
                disabled={saving}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}