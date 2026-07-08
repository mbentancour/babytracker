/**
 * OfflineBanner — top-of-page indicator that the app is offline
 * and a brief green flash when connectivity is restored.
 *
 * Uses useOfflineStatus() from utils/offline.js for reactive state.
 *
 * Exported:
 *   - OfflineBanner  React component → inline top banner
 */

import { useState, useEffect } from "react";
import { useOfflineStatus } from "../utils/offline";
import { useI18n } from "../utils/i18n";

/**
 * Top-banner component that appears when the app goes offline
 * and briefly flashes green when reconnected.
 */
export function OfflineBanner() {
  const { offline, reason } = useOfflineStatus();
  const { t } = useI18n();
  const [justReconnected, setJustReconnected] = useState(false);

  // Detect reconnection: offline was true, now false
  useEffect(() => {
    if (!offline) {
      setJustReconnected(true);
      const timer = setTimeout(() => setJustReconnected(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [offline]);

  if (offline) {
    return (
      <div className="offline-banner offline-banner--offline" role="alert" aria-live="polite">
        <span className="offline-banner-icon" aria-hidden="true">
          ⚠
        </span>
        <span className="offline-banner-text">{t("general.offline")}</span>
      </div>
    );
  }

  if (justReconnected) {
    return (
      <div className="offline-banner offline-banner--reconnecting" role="status" aria-live="polite">
        <span className="offline-banner-icon" aria-hidden="true">
          ✓
        </span>
        <span className="offline-banner-text">{t("general.reconnecting")}</span>
      </div>
    );
  }

  return null;
}