import { useState, useEffect, useCallback } from "react";
import { api } from "../api";
import { useI18n } from "../utils/i18n";
import { usePreferences } from "../utils/preferences";
import { timeAgo, formatElapsed } from "../utils/formatters";
import { useScreenWakeLock } from "../utils/wakeLock";

export default function PictureFrame({ photos, children = [], onWake }) {
  const { t } = useI18n();
  const { prefs } = usePreferences();
  const overlay = prefs.pictureFrame?.overlay || {};
  const overlayActive = Object.values(overlay).some(Boolean);

  // While the picture frame is mounted, ask the browser to keep the screen
  // awake — a tablet sitting on a shelf as a photo frame should stay lit.
  // No-op if the browser or context doesn't support it (e.g. plain http://).
  useScreenWakeLock(true);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [fading, setFading] = useState(false);

  // Shuffle on mount
  const [shuffled] = useState(() => {
    const arr = [...photos];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  });

  // Cycle photos every 8 seconds with a crossfade
  useEffect(() => {
    if (shuffled.length <= 1) return;
    const timer = setInterval(() => {
      setFading(true);
      setTimeout(() => {
        setCurrentIndex((i) => (i + 1) % shuffled.length);
        setFading(false);
      }, 800);
    }, 8000);
    return () => clearInterval(timer);
  }, [shuffled]);

  const handleWake = useCallback(() => {
    onWake();
  }, [onWake]);

  const current = shuffled[currentIndex];
  if (!current) return null;

  return (
    <div
      className="picture-frame"
      onClick={handleWake}
      onTouchStart={handleWake}
    >
      <div
        className={`picture-frame-image ${fading ? "picture-frame-fade" : ""}`}
        style={{
          backgroundImage: `url(./api/media/photos/${current.photo})`,
        }}
      />
      <div className="picture-frame-overlay">
        <div className="picture-frame-info">
          <div className="picture-frame-label">{current.label}</div>
          {current.detail && (
            <div className="picture-frame-detail">{current.detail}</div>
          )}
          <div className="picture-frame-date">
            {new Date(current.date + "T00:00:00").toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </div>
        </div>
      </div>
      {overlayActive && <StatusOverlay overlay={overlay} children={children} />}
      <div className="picture-frame-hint">{t("pictureFrame.tapToReturn")}</div>
      <div className="picture-frame-counter">
        {currentIndex + 1} / {shuffled.length}
      </div>
    </div>
  );
}

function StatusOverlay({ overlay, children }) {
  const { t } = useI18n();
  const [data, setData] = useState({ feedings: {}, sleeps: {}, changes: {}, timers: [] });
  const [now, setNow] = useState(Date.now());
  const [isPortrait, setIsPortrait] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(orientation: portrait)").matches
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(orientation: portrait)");
    const onChange = (e) => setIsPortrait(e.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  // Refresh data every 60 seconds
  useEffect(() => {
    let cancelled = false;
    const fetchAll = async () => {
      try {
        const promises = [];
        const childIds = (children || []).map((c) => c.id);

        if (overlay.lastFeeding) {
          for (const id of childIds) {
            promises.push(api.getFeedings({ child: id, limit: 1, ordering: "-start" }).then((r) => ({ kind: "feedings", id, item: r.results?.[0] })));
          }
        }
        if (overlay.lastSleep) {
          for (const id of childIds) {
            promises.push(api.getSleep({ child: id, limit: 1, ordering: "-start" }).then((r) => ({ kind: "sleeps", id, item: r.results?.[0] })));
          }
        }
        if (overlay.lastDiaper) {
          for (const id of childIds) {
            promises.push(api.getChanges({ child: id, limit: 1, ordering: "-time" }).then((r) => ({ kind: "changes", id, item: r.results?.[0] })));
          }
        }
        if (overlay.timers) {
          promises.push(api.getTimers().then((r) => ({ kind: "timers", items: r.results || [] })));
        }

        const results = await Promise.all(promises);
        if (cancelled) return;

        const next = { feedings: {}, sleeps: {}, changes: {}, timers: [] };
        for (const r of results) {
          if (r.kind === "timers") next.timers = r.items;
          else if (r.item) next[r.kind][r.id] = r.item;
        }
        setData(next);
      } catch {
        // best effort — overlay just won't update
      }
    };

    fetchAll();
    const interval = setInterval(fetchAll, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [overlay.lastFeeding, overlay.lastSleep, overlay.lastDiaper, overlay.timers, children]);

  // Tick the wall clock and timer elapsed displays every second
  useEffect(() => {
    if (!overlay.timers && !overlay.currentTime) return;
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, [overlay.timers, overlay.currentTime]);

  const childById = Object.fromEntries((children || []).map((c) => [c.id, c]));
  const multiChild = (children || []).length > 1;

  // Build a lookup of "is this child currently doing X?" so we can suppress
  // the misleading "last X N ago" line while a timer of that type is running.
  const activeFor = (childId, kind) => data.timers.some((tmr) => {
    if (tmr.child !== childId) return false;
    const name = (tmr.name || "").toLowerCase();
    if (kind === "feeding") return name.includes("feed");
    if (kind === "sleep") return name.includes("sleep") || name.includes("nap");
    return false;
  });

  // Build display lines
  const lines = [];

  if (overlay.timers && data.timers.length > 0) {
    for (const tmr of data.timers) {
      const elapsed = Math.max(0, Math.floor((now - new Date(tmr.start).getTime()) / 1000));
      const child = childById[tmr.child];
      const prefix = multiChild && child ? `${child.first_name}: ` : "";
      lines.push({ icon: "⏱", text: `${prefix}${tmr.name || t("pictureFrame.timer")} ${formatElapsed(elapsed)}` });
    }
  }

  const summary = (kind, icon, labelKey, timerKind) => {
    if (!overlay[kind === "feedings" ? "lastFeeding" : kind === "sleeps" ? "lastSleep" : "lastDiaper"]) return;
    for (const c of children || []) {
      // Suppress "last X" if a timer for that activity is currently running for this child
      if (timerKind && activeFor(c.id, timerKind)) continue;
      const item = data[kind][c.id];
      if (!item) continue;
      const dateStr = item.start || item.time;
      if (!dateStr) continue;
      const prefix = multiChild ? `${c.first_name}: ` : "";
      lines.push({ icon, text: `${prefix}${t(labelKey)} ${timeAgo(dateStr)}` });
    }
  };

  summary("feedings", "🍼", "pictureFrame.lastFed", "feeding");
  summary("sleeps", "😴", "pictureFrame.lastSlept", "sleep");
  summary("changes", "👶", "pictureFrame.lastChanged", null);

  if (overlay.currentTime) {
    lines.push({
      icon: "🕐",
      text: new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    });
  }

  if (lines.length === 0) return null;

  // Landscape: keep everything in a single top-left column.
  // Portrait: split items roughly in half so left/right edges are used and the
  // middle stays free for the "tap to return" hint.
  const mid = isPortrait ? Math.ceil(lines.length / 2) : lines.length;
  const leftLines = lines.slice(0, mid);
  const rightLines = lines.slice(mid);

  const renderLine = (l, i) => (
    <div key={i} className="picture-frame-status-item">
      <span className="picture-frame-status-icon">{l.icon}</span>
      <span>{l.text}</span>
    </div>
  );

  return (
    <>
      <div className="picture-frame-status picture-frame-status-left">
        {leftLines.map(renderLine)}
      </div>
      {rightLines.length > 0 && (
        <div className="picture-frame-status picture-frame-status-right">
          {rightLines.map(renderLine)}
        </div>
      )}
    </>
  );
}
