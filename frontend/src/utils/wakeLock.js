import { useEffect } from "react";

// useScreenWakeLock asks the browser to keep the screen awake while `active`
// is true. Uses the Screen Wake Lock API (navigator.wakeLock). Released when
// the component unmounts, when `active` flips false, or when the page
// becomes hidden. A listener re-acquires the lock on tab visibility-change
// because the browser auto-releases it when the page goes into the
// background.
//
// Browser support (as of 2026): Chrome/Edge since 84, Safari 16.4+, Firefox
// 126+. Requires a secure context — HTTPS or localhost. On http:// over
// plain LAN the API is unavailable and the hook silently no-ops, which is
// fine for a best-effort UX nicety.
export function useScreenWakeLock(active) {
  useEffect(() => {
    if (!active) return;
    if (typeof navigator === "undefined" || !navigator.wakeLock) return;

    let sentinel = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (cancelled) {
          lock.release().catch(() => {});
          return;
        }
        sentinel = lock;
      } catch {
        // Either the request was rejected (no user gesture on some platforms)
        // or the feature isn't available. Not fatal.
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && !sentinel) {
        acquire();
      }
    };

    acquire();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (sentinel) {
        sentinel.release().catch(() => {});
        sentinel = null;
      }
    };
  }, [active]);
}
