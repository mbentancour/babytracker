import { useMemo } from "react";
import { getAge, formatTime, getDisplayLocale } from "../../utils/formatters";
import { useI18n } from "../../utils/i18n";
import { Glyph } from "./icons";
import { skyAt, skyStops, gradient, hourMarks, nightness, stars, span } from "./daylight";
import { time } from "./story";

const DAY = 24 * 3600000;
const STARS = stars(44);

function hourLabel(ms) {
  return new Date(ms).toLocaleTimeString(getDisplayLocale(), { hour: "numeric" });
}

const pct = (value) => `${(value * 100).toFixed(2)}%`;

// SkyPaint is the sky itself, at one moment: the colour high up fading to the
// colour at the horizon, a brightness in one corner by day, stars by night.
// It fills whatever it is put in (the home header, and the head of each page).
export function SkyPaint({ at }) {
  const paint = useMemo(() => {
    const here = skyAt(at);
    return {
      image: `linear-gradient(to bottom, ${here.high} 0%, ${here.high} 24%, ${here.horizon} 100%)`,
      night: nightness(at),
    };
  }, [at]);
  return (
    <div className="tl-sky-paint" style={{ backgroundImage: paint.image }} aria-hidden="true">
      <i className="tl-sky-sun" style={{ opacity: 1 - paint.night }} />
      {paint.night > 0.05 && STARS.map((s, i) => (
        <i
          key={i}
          className="tl-star"
          style={{ left: pct(s.x), top: pct(s.y), width: s.size, height: s.size, opacity: s.glow * paint.night }}
        />
      ))}
    </div>
  );
}

// Sky is the top of the Timeline UI: who this is and how things stand right
// now, on a sky the colour of the hour it is. Inside it runs a strip of the
// last 24 hours — night where it was night — with the sleeps and the feeds
// marked on it. The strip's right-hand end is now.
export default function Sky({
  now, sleeps, feedings, asleepSince, kpis, child, kids, links, onPage, onSelectChild, onEditChild, onSettings, onOverview, error,
}) {
  const { t } = useI18n();
  // Redrawn once a minute: the strip moves a quarter of a pixel in that time.
  const to = Math.floor(now / 60000) * 60000;
  const from = to - DAY;

  const sky = useMemo(() => ({
    strip: gradient(skyStops(from, to), "strip"),
    hours: hourMarks(from, to, 3).filter((m) => m.pos > 0.035 && m.pos < 0.87),
  }), [from, to]);

  const marks = useMemo(() => {
    const bars = [];
    for (const s of sleeps) {
      const start = time(s.start);
      const end = time(s.end);
      const at = start !== null && end !== null ? span(start, end, from, to) : null;
      if (at) bars.push({ key: `s${s.id}`, ...at });
    }
    if (asleepSince !== null) {
      const at = span(asleepSince, to + 1, from, to + 1);
      if (at) bars.push({ key: "now", live: true, ...at });
    }
    const dots = [];
    for (const f of feedings) {
      const at = time(f.start);
      if (at !== null && at >= from && at <= to) dots.push({ key: `f${f.id}`, left: (at - from) / DAY });
    }
    return { bars, dots };
  }, [sleeps, feedings, asleepSince, from, to]);

  return (
    <header className="tl-sky">
      <SkyPaint at={to} />

      <div className="tl-sky-top">
        <button type="button" className="tl-id" onClick={onEditChild} title={t("general.tapToEdit")}>
          <span className="tl-avatar">
            {child?.picture ? <img src={child.picture} alt="" /> : <Glyph.Head />}
          </span>
          <span className="tl-id-text">
            <span className="tl-name">{child?.first_name || t("general.baby")}</span>
            {child?.birth_date && <span className="tl-age">{getAge(child.birth_date, t)}</span>}
          </span>
        </button>

        {kids.length > 1 && (
          <div className="tl-kids" role="group" aria-label={t("timeline.children")}>
            {kids.map((kid) => (
              <button
                key={kid.id}
                type="button"
                className="tl-kid"
                aria-pressed={kid.id === child?.id}
                onClick={() => onSelectChild(kid.id)}
              >
                {kid.first_name}
              </button>
            ))}
          </div>
        )}

        <div className="tl-sky-actions">
          {error && <span className="tl-offline" role="status">{t("general.connectionError")}</span>}
          {/* On a wide screen the pages that look further back are one click
              away up here; a phone reaches them through the chart button. */}
          {links.length > 0 && (
            <nav className="tl-nav" aria-label={t("timeline.lookBack")}>
              {links.map((link) => (
                <button key={link.id} type="button" className="tl-nav-btn" title={link.label} onClick={() => onPage(link.id)}>
                  <link.icon />
                  <span>{link.label}</span>
                </button>
              ))}
            </nav>
          )}
          <button type="button" className="tl-round tl-narrow-only" onClick={onOverview} aria-label={t("nav.overview")} title={t("nav.overview")}>
            <Glyph.Chart />
          </button>
          <button type="button" className="tl-round" onClick={onSettings} aria-label={t("settings.title")} title={t("settings.title")}>
            <Glyph.Gear />
          </button>
        </div>
      </div>

      {kpis.length > 0 && (
        <dl className="tl-kpis">
          {kpis.map((kpi) => (
            <div key={kpi.key} className="tl-kpi">
              <dt>{kpi.label}</dt>
              <dd className="tl-kpi-value">{kpi.value}</dd>
              {kpi.sub && <dd className="tl-kpi-sub">{kpi.sub}</dd>}
            </div>
          ))}
        </dl>
      )}

      <div className="tl-strip24" role="img" aria-label={t("timeline.last24")}>
        <div className="tl-strip-icons" aria-hidden="true">
          <Glyph.Moon />
          <Glyph.Bottle />
        </div>
        <div className="tl-track" style={{ backgroundImage: sky.strip }}>
          <div className="tl-lane">
            {marks.bars.map((b) => (
              <i key={b.key} className={`tl-slept${b.live ? " is-live" : ""}`} style={{ left: pct(b.left), width: pct(b.width) }} />
            ))}
          </div>
          <div className="tl-lane">
            {marks.dots.map((d) => <i key={d.key} className="tl-dot" style={{ left: pct(d.left) }} />)}
          </div>
        </div>
        <div className="tl-hours" aria-hidden="true">
          {sky.hours.map((m) => (
            <span key={m.ms} className={`tl-hour${m.hour % 6 === 0 ? "" : " is-minor"}`} style={{ left: pct(m.pos) }}>
              {m.kind === "noon" ? <Glyph.Sun /> : m.kind === "midnight" ? <Glyph.Moon /> : hourLabel(m.ms)}
            </span>
          ))}
          <span className="tl-hour tl-hour-now">{formatTime(to)}</span>
        </div>
      </div>
    </header>
  );
}
