import { useState } from "react";
import { api } from "../api";
import { Icons } from "./Icons";
import { colors } from "../utils/colors";

export default function OnboardingScreen({ onChildAdded }) {
  const [mode, setMode] = useState(null); // null = choose, "new", "import", "restore"

  if (!mode) {
    return (
      <div className="login-screen">
        <div className="login-card" style={{ maxWidth: 480 }}>
          <div className="login-header">
            <div className="login-icon">
              <Icons.Baby />
            </div>
            <h1 className="login-title">Welcome to BabyTracker!</h1>
            <p className="login-subtitle">How would you like to get started?</p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <OnboardingOption
              icon={<Icons.Plus />}
              title="Start Fresh"
              description="Add your baby and start tracking"
              color={colors.feeding}
              onClick={() => setMode("new")}
            />
            <OnboardingOption
              icon={<Icons.Download />}
              title="Import from Baby Buddy"
              description="Migrate data from an existing Baby Buddy instance"
              color="#6C5CE7"
              onClick={() => setMode("import")}
            />
            <OnboardingOption
              icon={<Icons.Clock />}
              title="Restore from Backup"
              description="Restore a previous BabyTracker backup file"
              color="#00b894"
              onClick={() => setMode("restore")}
            />
          </div>
        </div>
      </div>
    );
  }

  if (mode === "new") return <NewBabyForm onDone={onChildAdded} onBack={() => setMode(null)} />;
  if (mode === "import") return <BabyBuddyImport onDone={onChildAdded} onBack={() => setMode(null)} />;
  if (mode === "restore") return <RestoreBackup onDone={onChildAdded} onBack={() => setMode(null)} />;
}

function OnboardingOption({ icon, title, description, color, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 14,
        padding: "16px 18px", borderRadius: 12,
        border: "1px solid var(--border)", background: "var(--card-bg)",
        cursor: "pointer", textAlign: "left", fontFamily: "inherit",
        transition: "border-color 0.2s",
      }}
      onMouseOver={(e) => e.currentTarget.style.borderColor = color}
      onMouseOut={(e) => e.currentTarget.style.borderColor = "var(--border)"}
    >
      <div style={{
        width: 40, height: 40, borderRadius: 10,
        background: `${color}18`, color,
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2 }}>{description}</div>
      </div>
    </button>
  );
}

function NewBabyForm({ onDone, onBack }) {
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
      await api.createChild({ first_name: firstName, last_name: lastName, birth_date: birthDate });
      onDone();
    } catch (err) {
      setError(err.message || "Failed to add baby");
      setSaving(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-header">
          <div className="login-icon"><Icons.Baby /></div>
          <h1 className="login-title">Add Your Baby</h1>
        </div>
        <form onSubmit={handleSubmit} className="login-form">
          {error && <div className="login-error">{error}</div>}
          <div className="login-field">
            <label className="login-label">First Name</label>
            <input type="text" className="login-input" value={firstName} onChange={(e) => setFirstName(e.target.value)} required autoFocus placeholder="Emma" />
          </div>
          <div className="login-field">
            <label className="login-label">Last Name (optional)</label>
            <input type="text" className="login-input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
          <div className="login-field">
            <label className="login-label">Birth Date</label>
            <input type="date" className="login-input" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} required />
          </div>
          <button type="submit" className="login-button" style={{ background: colors.feeding }} disabled={saving}>
            {saving ? "Adding..." : "Add Baby"}
          </button>
          <button type="button" onClick={onBack} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 13, cursor: "pointer", fontFamily: "inherit", marginTop: 4, padding: 8 }}>
            Back
          </button>
        </form>
      </div>
    </div>
  );
}

function BabyBuddyImport({ onDone, onBack }) {
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const handleImport = async (e) => {
    e.preventDefault();
    setError("");
    setImporting(true);
    try {
      const res = await api.importFromBabyBuddy(url, token);
      setResult(res.stats);
    } catch (err) {
      setError(err.error || err.message || "Import failed");
      setImporting(false);
    }
  };

  if (result) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-header">
            <div className="login-icon" style={{ background: "#00b89418", color: "#00b894" }}><Icons.Activity /></div>
            <h1 className="login-title">Import Complete!</h1>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 20 }}>
            {Object.entries(result).map(([key, count]) => (
              <div key={key} style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", borderRadius: 8, background: "var(--bg)", border: "1px solid var(--border)", fontSize: 13 }}>
                <span style={{ color: "var(--text-muted)", textTransform: "capitalize" }}>{key.replace(/-/g, " ")}</span>
                <span style={{ fontWeight: 600, color: "var(--text)" }}>{count}</span>
              </div>
            ))}
          </div>
          <button onClick={onDone} className="login-button" style={{ background: colors.feeding, width: "100%" }}>
            Continue to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-header">
          <div className="login-icon" style={{ background: "#6C5CE718", color: "#6C5CE7" }}><Icons.Download /></div>
          <h1 className="login-title">Import from Baby Buddy</h1>
          <p className="login-subtitle">Enter your Baby Buddy server URL and API token</p>
        </div>
        <form onSubmit={handleImport} className="login-form">
          {error && <div className="login-error">{error}</div>}
          <div className="login-field">
            <label className="login-label">Baby Buddy URL</label>
            <input type="url" className="login-input" value={url} onChange={(e) => setUrl(e.target.value)} required placeholder="http://192.168.1.100:8000" autoFocus />
          </div>
          <div className="login-field">
            <label className="login-label">API Token</label>
            <input type="text" className="login-input" value={token} onChange={(e) => setToken(e.target.value)} required placeholder="From Baby Buddy Settings > API Key" style={{ fontFamily: "var(--mono)", fontSize: 12 }} />
          </div>
          <button type="submit" className="login-button" style={{ background: "#6C5CE7" }} disabled={importing}>
            {importing ? "Importing... this may take a moment" : "Start Import"}
          </button>
          <button type="button" onClick={onBack} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 13, cursor: "pointer", fontFamily: "inherit", marginTop: 4, padding: 8 }}>
            Back
          </button>
        </form>
      </div>
    </div>
  );
}

function RestoreBackup({ onDone, onBack }) {
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState("");

  const handleRestore = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setRestoring(true);
    try {
      await api.restoreBackup(file);
      onDone();
    } catch (err) {
      setError(err.error || err.message || "Restore failed");
      setRestoring(false);
    }
    e.target.value = "";
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-header">
          <div className="login-icon" style={{ background: "#00b89418", color: "#00b894" }}><Icons.Clock /></div>
          <h1 className="login-title">Restore from Backup</h1>
          <p className="login-subtitle">Select a BabyTracker backup file (.tar.gz)</p>
        </div>
        <div className="login-form">
          {error && <div className="login-error">{error}</div>}
          <label
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              padding: "20px", borderRadius: 12,
              border: "2px dashed var(--border)", background: "var(--bg)",
              color: restoring ? "var(--text-dim)" : "var(--text-muted)",
              fontSize: 14, cursor: restoring ? "not-allowed" : "pointer",
              fontFamily: "inherit", transition: "border-color 0.2s",
            }}
          >
            <Icons.Download />
            {restoring ? "Restoring..." : "Choose backup file"}
            <input type="file" accept=".gz,.tar.gz" style={{ display: "none" }} onChange={handleRestore} disabled={restoring} />
          </label>
          <button type="button" onClick={onBack} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 13, cursor: "pointer", fontFamily: "inherit", marginTop: 12, padding: 8, width: "100%", textAlign: "center" }}>
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
