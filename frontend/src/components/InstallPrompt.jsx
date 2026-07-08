import { useState, useEffect, useCallback, useRef } from "react";
import { useI18n } from "../utils/i18n";
import "./InstallPrompt.css";

const IOS_STANDALONE_DETECTION_QUERY = "(display-mode: standalone)";
const STORAGE_KEY = "babytracker_install_prompt_dismissed";

function hasDismissedInstallPrompt() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function markInstallPromptDismissed() {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // localStorage may be unavailable (e.g. private browsing)
  }
}

export default function InstallPrompt() {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState(null);
  const [iosInstallHint, setIosInstallHint] = useState(false);
  const [visible, setVisible] = useState(false);
  const deferredPromptRef = useRef(null);
  const iosHintDismissedRef = useRef(hasDismissedInstallPrompt());
  const isStandaloneRef = useRef(false);

  // --- Android: capture beforeinstallprompt ---
  useEffect(() => {
    if (hasDismissedInstallPrompt()) return;
    const handler = (e) => {
      e.preventDefault();
      deferredPromptRef.current = e;
      setPrompt("android");
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // --- iOS detection: check standalone via UA + media query ---
  useEffect(() => {
    const mql = window.matchMedia(IOS_STANDALONE_DETECTION_QUERY);
    const isStandalone =
      mql.matches ||
      window.navigator.standalone === true ||
      (navigator && /** @ts-ignore – iOS 15.4+ displayMode */ navigator.displayMode === "standalone");

    isStandaloneRef.current = isStandalone;

    if (!isStandalone) {
      // Show iOS hint after a short delay so the app is fully loaded
      const timer = setTimeout(() => {
        if (!isStandaloneRef.current && !iosHintDismissedRef.current && !hasDismissedInstallPrompt()) {
          setIosInstallHint(true);
          setVisible(true);
        }
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, []);

  // --- Listen for display-mode changes (iOS home-screen add) ---
  useEffect(() => {
    const mql = window.matchMedia(IOS_STANDALONE_DETECTION_QUERY);
    const handler = (e) => {
      if (e.matches || window.navigator.standalone === true) {
        isStandaloneRef.current = true;
        setVisible(false);
      }
    };
    mql.addEventListener?.("change", handler) || mql.addListener(handler);
    return () => {
      mql.removeEventListener?.("change", handler) || mql.removeListener(handler);
    };
  }, []);

  // --- Install action handler ---
  const handleInstall = useCallback(async () => {
    const deferredPrompt = deferredPromptRef.current;
    if (!deferredPrompt) return;
    try {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        setPrompt(null);
        setVisible(false);
        markInstallPromptDismissed();
      }
    } catch (e) {
      console.warn("Install prompt failed:", e);
    } finally {
      deferredPromptRef.current = null;
    }
  }, []);

  // --- Dismiss handlers ---
  const handleDismiss = useCallback(() => {
    setVisible(false);
    if (prompt === "ios") iosHintDismissedRef.current = true;
    markInstallPromptDismissed();
  }, [prompt]);

  // If standalone, don't render anything — already installed as PWA
  if (isStandaloneRef.current) return null;

  return (
    <>
      {/* Android install banner */}
      {prompt === "android" && visible && (
        <div className="install-prompt install-prompt-android" role="alert" aria-label={t("installPrompt.installBannerAria")}>
          <div className="install-prompt-content">
            <span className="install-prompt-icon">📲</span>
            <div className="install-prompt-text">
              <strong>{t("installPrompt.installBannerTitle")}</strong>
              <span>{t("installPrompt.installBannerDesc")}</span>
            </div>
            <div className="install-prompt-actions">
              <button className="install-prompt-btn install-prompt-btn-primary" onClick={handleInstall}>
                {t("installPrompt.install")}
              </button>
              <button className="install-prompt-btn install-prompt-btn-secondary" onClick={handleDismiss}>
                {t("installPrompt.dismiss")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* iOS home-screen hint */}
      {iosInstallHint && visible && (
        <div className="install-prompt install-prompt-ios" role="status" aria-label={t("installPrompt.iosHintAria")}>
          <div className="install-prompt-content">
            <span className="install-prompt-icon">📱</span>
            <div className="install-prompt-text">
              <strong>{t("installPrompt.iosHintTitle")}</strong>
              <span>{t("installPrompt.iosHintDesc")}</span>
            </div>
            <div className="install-prompt-actions">
              <button className="install-prompt-btn install-prompt-btn-secondary" onClick={handleDismiss}>
                {t("installPrompt.dismiss")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}