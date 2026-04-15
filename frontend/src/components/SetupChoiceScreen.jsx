import { useState } from "react";
import { api } from "../api";
import { Icons } from "./Icons";
import { colors } from "../utils/colors";
import { useI18n } from "../utils/i18n";

// SetupChoiceScreen is the first thing a visitor sees on a fresh install.
// Three branches:
//   - "fresh"   → create admin, then add a first baby
//   - "import"  → create admin, then run the Baby Buddy import wizard
//   - "restore" → upload backup (no account creation — credentials come from
//                 the archive's users table)
// The parent stores the non-restore intent and forwards it to the post-auth
// OnboardingScreen so the user doesn't have to pick between "fresh" and
// "import" a second time.
export default function SetupChoiceScreen({ onCreateAccount, onImport, onRestored }) {
  const { t } = useI18n();
  const [mode, setMode] = useState("choose"); // "choose" | "restore"

  if (mode === "restore") {
    return <SetupRestore onRestored={onRestored} onBack={() => setMode("choose")} />;
  }

  return (
    <div className="login-screen">
      <div className="login-card" style={{ maxWidth: 480 }}>
        <div className="login-header">
          <div className="login-icon">
            <Icons.Baby />
          </div>
          <h1 className="login-title">{t("onboarding.welcome")}</h1>
          <p className="login-subtitle">{t("onboarding.howToStart")}</p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SetupOption
            icon={<Icons.Plus />}
            title={t("onboarding.startFresh")}
            description={t("onboarding.startFreshDesc")}
            color={colors.feeding}
            onClick={onCreateAccount}
          />
          <SetupOption
            icon={<Icons.Clock />}
            title={t("setup.restoreBackup")}
            description={t("setup.restoreBackupDesc")}
            color="#00b894"
            onClick={() => setMode("restore")}
          />
          <SetupOption
            icon={<Icons.Download />}
            title={t("onboarding.importBB")}
            description={t("onboarding.importBBDesc")}
            color="#6C5CE7"
            onClick={onImport}
          />
        </div>
      </div>
    </div>
  );
}

function SetupOption({ icon, title, description, color, onClick }) {
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

function SetupRestore({ onRestored, onBack }) {
  const { t } = useI18n();
  const [file, setFile] = useState(null);
  const [passphrase, setPassphrase] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState("");

  const isEncrypted = file && file.name.endsWith(".enc");

  const handleFile = (e) => {
    setError("");
    setFile(e.target.files?.[0] || null);
    setPassphrase("");
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!file) return;
    if (isEncrypted && !passphrase) {
      setError(t("settings.passphraseRequired"));
      return;
    }
    setRestoring(true);
    setError("");
    try {
      // wipe_photos=false is the right default here: a fresh install has no
      // existing photos to conflict with, and if MEDIA_PATH points at a
      // shared folder (HA media), leaving it alone is the safe choice.
      await api.setupRestore(file, passphrase, false);
      onRestored();
    } catch (err) {
      setError(err.error || err.message || t("settings.restoreFailed"));
      setRestoring(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-header">
          <div className="login-icon" style={{ background: "#00b89418", color: "#00b894" }}><Icons.Clock /></div>
          <h1 className="login-title">{t("setup.restoreBackup")}</h1>
          <p className="login-subtitle">{t("setup.restoreBackupHint")}</p>
        </div>

        <form onSubmit={submit} className="login-form">
          {error && <div className="login-error">{error}</div>}

          <label
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              padding: "20px", borderRadius: 12,
              border: "2px dashed var(--border)", background: "var(--bg)",
              color: restoring ? "var(--text-dim)" : "var(--text-muted)",
              fontSize: 14, cursor: restoring ? "not-allowed" : "pointer",
              fontFamily: "inherit",
            }}
          >
            <Icons.Download />
            {file ? file.name : t("onboarding.chooseBackup")}
            <input
              type="file"
              accept=".gz,.enc,application/gzip,application/octet-stream"
              style={{ display: "none" }}
              onChange={handleFile}
              disabled={restoring}
            />
          </label>

          {isEncrypted && (
            <div className="login-field">
              <label className="login-label">{t("settings.passphrase")}</label>
              <input
                type="password"
                className="login-input"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                autoFocus
                autoComplete="off"
              />
            </div>
          )}

          <button
            type="submit"
            className="login-button"
            style={{ background: "#00b894" }}
            disabled={!file || restoring}
          >
            {restoring ? t("onboarding.restoring") : t("setup.startRestore")}
          </button>

          <button
            type="button"
            onClick={onBack}
            disabled={restoring}
            style={{
              background: "none", border: "none", color: "var(--text-muted)",
              fontSize: 13, cursor: restoring ? "not-allowed" : "pointer",
              fontFamily: "inherit", marginTop: 4, padding: 8,
            }}
          >
            {t("form.back")}
          </button>

          <p style={{ fontSize: 11, color: "var(--text-dim)", textAlign: "center", marginTop: 8 }}>
            {t("setup.restoreCredsHint")}
          </p>
        </form>
      </div>
    </div>
  );
}
