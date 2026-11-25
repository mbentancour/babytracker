import { useEffect, useMemo, useRef } from "react";
import { getAge, formatTime, getDisplayLocale } from "../../utils/formatters";
import { useI18n } from "../../utils/i18n";
import { Glyph } from "./icons";
import { skyAt, skyStops, skyDown, inkOn, gradient, hourMarks, nightness, stars, span, SKY_HOLD } from "./daylight";
import { time } from "./story";

const DAY = 24 * 3600000;
const STARS = stars(44);
// How far down the header the strip's two icons and the hours under it sit,
// 0 at the top and 1 at the bottom. That low the sky may be bright, so they
// are written in whichever ink reads on it (see inkOn).
const STRIP_AT = 0.78;
const HOURS_AT = 0.92;

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
      image: `linear-gradient(to bottom, ${here.high} 0%, ${here.high} ${SKY_HOLD * 100}%, ${here.horizon} 100%)`,
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

  const sky = useMemo(() => {
    const here = skyAt(to);
    return {
      strip: gradient(skyStops(from, to), "strip"),
      hours: hourMarks(from, to, 3).filter((m) => m.pos > 0.035 && m.pos < 0.87),
      ink: { "--tl-ink-strip": inkOn(skyDown(here, STRIP_AT)), "--tl-ink-hours": inkOn(skyDown(here, HOURS_AT)) },
    };
  }, [from, to]);

  // With several children the names are the switch, and the one whose log
  // this is can have been scrolled out of sight on a phone.
  const several = kids.length > 1;
  const kidsRow = useRef(null);
  useEffect(() => {
    const current = kidsRow.current?.querySelector('[aria-pressed="true"]');
    if (current?.scrollIntoView) current.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [child?.id, several]);

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
    <header className={`tl-sky${several ? " has-kids" : ""}`}>
      <SkyPaint at={to} />

      <div className="tl-sky-top">
        {/* One child: the name and age stand here. Several: the row of names
            beside it says whose log this is, so the name is not said twice. */}
        <button
          type="button"
          className="tl-id"
          onClick={onEditChild}
          title={t("general.tapToEdit")}
          aria-label={several ? `${child?.first_name || t("general.baby")} – ${t("general.tapToEdit")}` : undefined}
        >
          <span className="tl-avatar">
            {child?.picture ? <img src={child.picture} alt="" /> : <Glyph.Head />}
          </span>
          {!several && (
            <span className="tl-id-text">
              <span className="tl-name">{child?.first_name || t("general.baby")}</span>
              {child?.birth_date && <span className="tl-age">{getAge(child.birth_date, t)}</span>}
            </span>
          )}
        </button>

        {several && (
          <div className="tl-kids" role="group" aria-label={t("timeline.children")} ref={kidsRow}>
            {kids.map((kid) => {
              const current = kid.id === child?.id;
              return (
                <button key={kid.id} type="button" className="tl-kid" aria-pressed={current} onClick={() => onSelectChild(kid.id)}>
                  {kid.first_name}
                  {current && kid.birth_date && <span className="tl-kid-age">{getAge(kid.birth_date, t)}</span>}
                </button>
              );
            })}
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
              {/* The words around a figure ("ago") are set small: the figure
                  has to fit a third of a phone's width in every language. */}
              <dd className={`tl-kpi-value${kpi.word ? " is-word" : ""}`}>
                {kpi.before && <small>{kpi.before} </small>}
                {kpi.value}
                {kpi.after && <small> {kpi.after}</small>}
              </dd>
              {kpi.sub && <dd className="tl-kpi-sub">{kpi.sub}</dd>}
            </div>
          ))}
        </dl>
      )}

      <div className="tl-strip24" role="img" aria-label={t("timeline.last24")} style={sky.ink}>
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
            // On a phone the time at the right-hand end takes a fifth of the
            // strip: a sun right beside "04:29 PM" would read as one label.
            <span
              key={m.ms}
              className={`tl-hour${m.hour % 6 === 0 ? "" : " is-minor"}${m.pos > 0.74 ? " is-late" : ""}`}
              style={{ left: pct(m.pos) }}
            >
              {m.kind === "noon" ? <Glyph.Sun /> : m.kind === "midnight" ? <Glyph.Moon /> : hourLabel(m.ms)}
            </span>
          ))}
          <span className="tl-hour tl-hour-now">{formatTime(to)}</span>
        </div>
      </div>
    </header>
  );
}
