import { useState } from "react";
import { api } from "../api";
import { Icons } from "./Icons";
import { colors } from "../utils/colors";

export default function OnboardingScreen({ onChildAdded }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await api.createChild({
        first_name: firstName,
        last_name: lastName,
        birth_date: birthDate,
      });
      onChildAdded();
    } catch (err) {
      setError(err.message || "Failed to add baby");
      setSaving(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-header">
          <div className="login-icon">
            <Icons.Baby />
          </div>
          <h1 className="login-title">Welcome!</h1>
          <p className="login-subtitle">Add your baby to get started</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {error && <div className="login-error">{error}</div>}

          <div className="login-field">
            <label className="login-label">First Name</label>
            <input
              type="text"
              className="login-input"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              autoFocus
              placeholder="Emma"
            />
          </div>

          <div className="login-field">
            <label className="login-label">Last Name (optional)</label>
            <input
              type="text"
              className="login-input"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder=""
            />
          </div>

          <div className="login-field">
            <label className="login-label">Birth Date</label>
            <input
              type="date"
              className="login-input"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            className="login-button"
            style={{ background: colors.feeding }}
            disabled={saving}
          >
            {saving ? "Adding..." : "Add Baby"}
          </button>
        </form>
      </div>
    </div>
  );
}
