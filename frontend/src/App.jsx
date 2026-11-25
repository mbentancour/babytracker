import { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import { api, setAccessToken, getAccessToken, setOnAuthRequired, enableTokenPersistence, bootstrapSession } from "./api";
import { useI18n } from "./utils/i18n";
import LoginScreen, { oidcErrorKey } from "./components/LoginScreen";
import SetupChoiceScreen from "./components/SetupChoiceScreen";
import Session from "./core/session";
import UiHost from "./core/UiHost";
const SetupWizard = lazy(() => import("./components/SetupWizard"));
import "./styles.css";

// App is the part every UI shares before anyone is signed in: reading the
// server config, first-boot setup, and login. Once authenticated it hands over
// to <Session> (data, permissions, timers) and the UI chosen for this device.

// takeOidcResult reads ?oidc_error= / ?oidc_linked= left by the OIDC callback
// and removes them from the URL.
function takeOidcResult() {
  try {
    const url = new URL(window.location.href);
    const error = url.searchParams.get("oidc_error");
    const linked = url.searchParams.get("oidc_linked") === "1";
    if (!error && !linked) return null;
    url.searchParams.delete("oidc_error");
    url.searchParams.delete("oidc_linked");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    return { error, linked };
  } catch {
    return null;
  }
}

export default function App() {
  const { t } = useI18n();
  const [authState, setAuthState] = useState("loading"); // loading, setup-choice, setup, login, authenticated
  // setupIntent carries the user's first-boot choice past the register step so
  // OnboardingScreen can skip its own "what next?" picker. null after login or
  // on a pre-existing install.
  const [setupIntent, setSetupIntent] = useState(null); // null | "fresh" | "import" | "nara" | "nighp"
  const [demoMode, setDemoMode] = useState(false);
  const [applianceMode, setApplianceMode] = useState(false);
  const [oidc, setOidc] = useState({ enabled: false, providerName: "" });
  const [passwordLogin, setPasswordLogin] = useState(true);
  // What the OIDC callback redirected back with, read once and cleared from
  // the address bar so a reload doesn't show it again.
  const [oidcResult] = useState(takeOidcResult);

  const handleLogout = useCallback(() => {
    setAccessToken(null);
    api.logout().catch(() => {});
    setAuthState("login");
  }, []);

  useEffect(() => {
    setOnAuthRequired(() => setAuthState("login"));

    // Resolve config first so demo_mode can short-circuit the auth calls.
    // Previously we ran getAuthStatus + getConfig in parallel, which meant
    // a failing getAuthStatus (e.g. DB unreachable) would reject the whole
    // Promise.all and bury the demo_mode branch under a login screen.
    api.getConfig()
      .catch(() => ({ demo_mode: false }))
      .then(async (config) => {
        setDemoMode(config.demo_mode);
        setApplianceMode(config.appliance_mode || false);
        if (config.ha_ingress) enableTokenPersistence();
        setOidc({ enabled: !!config.oidc_enabled, providerName: config.oidc_provider_name || "" });
        setPasswordLogin(config.password_login !== false);

        if (config.demo_mode) {
          setAuthState("authenticated");
          return;
        }
        if (config.setup_mode) {
          setAuthState("wifi-setup");
          return;
        }

        const status = await api.getAuthStatus().catch(() => ({ setup_required: false }));
        if (status.setup_required) {
          setAuthState("setup-choice");
          return;
        }
      // If we have a persisted access token, try using it directly. The api
      // request layer will refresh it if it's expired (or fall back to login).
      if (getAccessToken()) {
        setAuthState("authenticated");
        return;
      }
      // No persisted access token — re-establish from the refresh token
      // (persisted under ingress, the cookie elsewhere). Retries transient
      // failures so a flaky network on first paint doesn't strand the user at
      // a login screen when their session is actually fine.
      bootstrapSession(2).then((outcome) => {
        if (outcome === "ok") setAuthState("authenticated");
        else setAuthState("login");
      });
    });
  }, []);

  // A link attempt from Settings → Account comes back to a signed-in app, so
  // its outcome can't go on the login screen.
  const oidcNoticeShown = useRef(false);
  useEffect(() => {
    if (authState !== "authenticated" || !oidcResult || oidcNoticeShown.current) return;
    oidcNoticeShown.current = true;
    if (oidcResult.linked) {
      alert(t("auth.oidcLinkedNotice", { provider: oidc.providerName || "SSO" }));
    } else if (oidcResult.error) {
      alert(t(oidcErrorKey(oidcResult.error)));
    }
  }, [authState, oidcResult, oidc.providerName, t]);

  if (authState === "loading") {
    return (
      <div className="app-loading">
        <div className="loading-spinner" />
        <span style={{ color: "var(--text-muted)", fontSize: 14 }}>{t("general.loading")}</span>
      </div>
    );
  }

  if (authState === "wifi-setup") {
    return (
      <Suspense fallback={null}>
        <SetupWizard />
      </Suspense>
    );
  }

  if (authState === "setup-choice") {
    return (
      <SetupChoiceScreen
        onCreateAccount={() => { setSetupIntent("fresh"); setAuthState("setup"); }}
        onImport={(intent) => { setSetupIntent(intent); setAuthState("setup"); }}
        onRestored={() => { setSetupIntent(null); setAuthState("login"); }}
      />
    );
  }

  if (authState === "setup" || authState === "login") {
    return (
      <LoginScreen
        isSetup={authState === "setup"}
        onAuthenticated={() => setAuthState("authenticated")}
        onBack={authState === "setup" ? () => setAuthState("setup-choice") : null}
        oidc={oidc}
        passwordLogin={passwordLogin}
        oidcError={oidcResult?.error}
      />
    );
  }

  return (
    <Session
      demoMode={demoMode}
      applianceMode={applianceMode}
      onLogout={handleLogout}
      setupIntent={setupIntent}
      onSetupIntentConsumed={() => setSetupIntent(null)}
    >
      <UiHost />
    </Session>
  );
}
