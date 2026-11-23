import { useState } from "react";
import { api, setAccessToken } from "../api";
import { Icons } from "./Icons";
import { colors } from "../utils/colors";
import { useI18n } from "../utils/i18n";

// Callback error codes from the server (oidc.go) → translation keys.
const OIDC_ERRORS = {
  unavailable: "auth.oidcErrorUnavailable",
  expired: "auth.oidcErrorExpired",
  denied: "auth.oidcErrorDenied",
  failed: "auth.oidcErrorFailed",
  not_allowed: "auth.oidcErrorNotAllowed",
  no_account: "auth.oidcErrorNoAccount",
  username_taken: "auth.oidcErrorUsernameTaken",
  already_linked: "auth.oidcErrorAlreadyLinked",
};

export function oidcErrorKey(code) {
  return OIDC_ERRORS[code] || "auth.oidcErrorFailed";
}

// oidc: { enabled, providerName } from /api/config. passwordLogin is false
// when the server only accepts OIDC sign-in. oidcError is the code the OIDC
// callback redirected back with, if any.
export default function LoginScreen({ isSetup, onAuthenticated, onBack, oidc, passwordLogin = true, oidcError }) {
  const { t } = useI18n();
  const oidcEnabled = !!oidc?.enabled;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (isSetup) {
        if (password !== confirmPassword) {
          setError("Passwords do not match");
          setLoading(false);
          return;
        }
        if (password.length < 8) {
          setError("Password must be at least 8 characters");
          setLoading(false);
          return;
        }
        const data = await api.register(username, password);
        setAccessToken(data.access_token);
      } else {
        const data = await api.login(username, password);
        setAccessToken(data.access_token);
      }
      onAuthenticated();
    } catch (err) {
      setError(err.error || err.message || "Authentication failed");
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-header">
          <div className="login-icon">
            <Icons.Baby />
          </div>
          <h1 className="login-title">BabyTracker</h1>
          <p className="login-subtitle">
            {isSetup
              ? t("auth.createAccountHint")
              : t("auth.signInHint")}
          </p>
        </div>

        {oidcEnabled && (
          <div className="login-form" style={{ marginBottom: passwordLogin ? 16 : 0 }}>
            {oidcError && !error && <div className="login-error">{t(oidcErrorKey(oidcError))}</div>}
            {/* A plain navigation, not a fetch: the server redirects to the
                provider, and only a top-level navigation can follow that. */}
            <a
              href="./api/auth/oidc/login"
              className="login-button login-oidc-button"
              style={{ background: colors.feeding }}
            >
              {t("auth.signInWith", { provider: oidc.providerName || "SSO" })}
            </a>
            {passwordLogin && <div className="login-divider">{t("auth.or")}</div>}
          </div>
        )}

        {passwordLogin && (
        <form onSubmit={handleSubmit} className="login-form">
          {error && <div className="login-error">{error}</div>}

          <div className="login-field">
            <label className="login-label">{t("auth.username")}</label>
            <input
              type="text"
              className="login-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
              autoComplete="username"
              autoFocus
            />
          </div>

          <div className="login-field">
            <label className="login-label">{t("auth.password")}</label>
            <input
              type="password"
              className="login-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={isSetup ? "new-password" : "current-password"}
            />
          </div>

          {isSetup && (
            <div className="login-field">
              <label className="login-label">{t("auth.confirmPassword")}</label>
              <input
                type="password"
                className="login-input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
          )}

          <button
            type="submit"
            className="login-button"
            style={{ background: colors.feeding }}
            disabled={loading}
          >
            {loading
              ? t("auth.pleaseWait")
              : isSetup
                ? t("auth.createAccount")
                : t("auth.signIn")}
          </button>

          {isSetup && onBack && (
            <button
              type="button"
              onClick={onBack}
              disabled={loading}
              style={{
                background: "none", border: "none", color: "var(--text-muted)",
                fontSize: 13, cursor: loading ? "not-allowed" : "pointer",
                fontFamily: "inherit", marginTop: 4, padding: 8,
              }}
            >
              {t("form.back")}
            </button>
          )}
        </form>
        )}
      </div>
    </div>
  );
}
