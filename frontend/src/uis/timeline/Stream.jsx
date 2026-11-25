import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import TagChips from "../../components/TagChips";
import { formatTime, formatElapsed, getDisplayLocale } from "../../utils/formatters";
import { useI18n } from "../../utils/i18n";
import { Glyph } from "./icons";
import { KINDS, toneOf, iconOf } from "./kinds";
import { gapBefore, nudged } from "./story";

const DAY = 24 * 3600000;
const NUDGE = 5; // minutes
const CONFIRM_MS = 5000;

// "Today" and "Yesterday" by name; older days by their date alone.
function dayTitle(start, todayStart, t) {
  const text = new Date(start).toLocaleDateString(getDisplayLocale(), { weekday: "long", day: "numeric", month: "long" });
  const date = text.charAt(0).toUpperCase() + text.slice(1);
  const ago = Math.round((todayStart - start) / DAY);
  if (ago === 0) return { name: t("day.today"), date };
  if (ago === 1) return { name: t("timeline.yesterday"), date };
  return { name: date, date: null };
}

// A button that asks once more before doing something that can't be undone:
// the first tap arms it, a second within a few seconds goes ahead.
function ConfirmChip({ label, confirm, icon, onConfirm }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const id = setTimeout(() => setArmed(false), CONFIRM_MS);
    return () => clearTimeout(id);
  }, [armed]);
  return (
    <button
      type="button"
      className={`tl-chip tl-chip-compact tl-chip-danger${armed ? " is-armed" : ""}`}
      aria-label={armed ? confirm : label}
      onClick={() => (armed ? onConfirm() : setArmed(true))}
    >
      {icon}
      <span>{armed ? confirm : label}</span>
    </button>
  );
}

// One line of the story. Tapping it opens a strip of things to do with it:
// move it five minutes, change how much was drunk, edit it, delete it. The
// row just logged opens by itself, with Undo in place of Delete.
const Row = memo(function Row({ row, text, gap, first, open, fresh, editable, elapsed, tags, volume, actions }) {
  const { t } = useI18n();
  const Icon = iconOf(row.kind, row);
  const entry = row.entry || {};
  const paused = row.live && row.timer.is_paused;
  const amount = Number(entry.amount);

  let detail = text.detail;
  if (row.live) {
    const clock = formatElapsed(elapsed || 0);
    detail = paused ? `${t("general.paused")} · ${clock}` : row.kind === "sleep" ? t("simple.asleepFor", { value: clock }) : clock;
  }
  const note = row.kind === "note" ? null : entry.notes;

  const className = [
    "tl-row",
    row.live && "is-live",
    paused && "is-paused",
    open && "is-open",
    fresh && "is-fresh",
    first && "is-first",
    row.asleepBefore && "sleep-before",
    row.asleepAfter && "sleep-after",
  ].filter(Boolean).join(" ");

  const body = (
    <>
      <time className="tl-time" dateTime={new Date(row.at).toISOString()}>{formatTime(row.at)}</time>
      <span className="tl-node"><Icon /></span>
      <span className="tl-text">
        <span className="tl-title">
          {text.title}
          {tags?.length > 0 && <TagChips tags={tags} />}
        </span>
        {detail && <span className="tl-detail">{detail}</span>}
        {note && <span className="tl-note">{note}</span>}
      </span>
      {entry.photo && (
        <img className="tl-thumb" src={`./api/media/photos/${entry.photo}?size=thumb`} alt="" loading="lazy" />
      )}
    </>
  );

  const minutes = t("simple.minUnit");
  const now = Date.now();

  return (
    <li className={className} data-key={row.key} style={{ "--gap": `${gap}px`, "--tone": toneOf(row.kind) }}>
      <div className="tl-row-line">
        {editable ? (
          <button type="button" className="tl-row-main" aria-expanded={open} onClick={() => actions.toggle(row.key)}>
            {body}
          </button>
        ) : (
          <div className="tl-row-main">{body}</div>
        )}
        {row.live && editable && (
          <button type="button" className="tl-go" onClick={() => actions.finish(row.timer)}>
            {t(row.kind === "sleep" ? "simple.wakeUp" : "simple.finish")}
          </button>
        )}
      </div>

      {open && editable && (
        <div className="tl-strip" role="group" aria-label={text.title}>
          {/* Each pair is one control, with its unit said once at the end:
              "−5 | +5 min" moves the entry, "−10 | +10 mL" changes the amount.
              The amount can be put right at any time: what a bottle held is
              known when it is given, what was drunk only afterwards. */}
          <span className="tl-pair">
            <button
              type="button"
              className="tl-chip"
              disabled={!nudged(row, -NUDGE, now)}
              aria-label={t("timeline.earlier", { count: NUDGE })}
              onClick={() => actions.nudge(row, -NUDGE)}
            >
              −{NUDGE}
            </button>
            <button
              type="button"
              className="tl-chip"
              disabled={!nudged(row, NUDGE, now)}
              aria-label={t("timeline.later", { count: NUDGE })}
              onClick={() => actions.nudge(row, NUDGE)}
            >
              +{NUDGE} {minutes}
            </button>
          </span>
          {!row.live && amount > 0 && KINDS[row.kind].span && (
            <span className="tl-pair">
              <button
                type="button"
                className="tl-chip"
                disabled={amount - volume.step <= 0}
                aria-label={`${t("simple.less")} (${volume.step} ${volume.unit})`}
                onClick={() => actions.amount(row, +(amount - volume.step).toFixed(2))}
              >
                −{volume.step}
              </button>
              <button
                type="button"
                className="tl-chip"
                aria-label={`${t("simple.more")} (${volume.step} ${volume.unit})`}
                onClick={() => actions.amount(row, +(amount + volume.step).toFixed(2))}
              >
                +{volume.step} {volume.unit}
              </button>
            </span>
          )}
          {fresh ? (
            <button type="button" className="tl-chip tl-chip-strong" onClick={actions.undo}>
              <Glyph.Undo />
              {t("simple.undo")}
            </button>
          ) : row.live ? (
            <>
              <button
                type="button"
                className="tl-chip tl-chip-compact"
                aria-label={t(paused ? "timer.resume" : "timer.pause")}
                onClick={() => actions.pause(row.timer, !paused)}
              >
                {paused ? <Glyph.Play /> : <Glyph.Pause />}
                <span>{t(paused ? "timer.resume" : "timer.pause")}</span>
              </button>
              <ConfirmChip
                label={t("timer.discard")}
                confirm={t("timeline.confirm")}
                icon={<Glyph.Trash />}
                onConfirm={() => actions.discard(row.timer)}
              />
            </>
          ) : (
            <>
              <button type="button" className="tl-chip tl-chip-compact" aria-label={t("general.edit")} onClick={() => actions.edit(row.kind, row.entry)}>
                <Glyph.Pencil />
                <span>{t("general.edit")}</span>
              </button>
              <ConfirmChip
                label={t("general.delete")}
                confirm={t("timeline.confirm")}
                icon={<Glyph.Trash />}
                onConfirm={() => actions.remove(row.kind, row.entry.id)}
              />
            </>
          )}
        </div>
      )}
    </li>
  );
});

// Stream is the story of the last few days, oldest at the top, ending at
// "now" just above the buttons that add to it. It keeps itself scrolled to
// the end, the way a conversation does, unless you have scrolled up to read.
//
// With `follow` off it is a finished day instead (see DayPage): read from the
// top, with no "now" at the end and nothing to keep up with.
export default function Stream({
  days, todayStart, now, asleepNow, describe, summaryOf, fresh, open, actions, canEdit, tagMaps, volume, earlier,
  follow = true, emptyText, onDay,
}) {
  const { t } = useI18n();
  const scroller = useRef(null);
  const content = useRef(null);
  const pinned = useRef(true);
  const keepFromEnd = useRef(null);
  const [away, setAway] = useState(false);

  const toEnd = useCallback((smooth) => {
    const el = scroller.current;
    if (!el) return;
    if (smooth && el.scrollTo) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    else el.scrollTop = el.scrollHeight;
  }, []);

  useLayoutEffect(() => {
    if (follow) toEnd(false);
  }, [follow, toEnd]);

  // Stay at the end as rows arrive, strips open and the window resizes.
  useEffect(() => {
    if (!follow || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => {
      if (pinned.current) toEnd(false);
    });
    observer.observe(content.current);
    observer.observe(scroller.current);
    return () => observer.disconnect();
  }, [follow, toEnd]);

  // Earlier days are added above: hold the place being read.
  const firstDay = days[0]?.key;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && keepFromEnd.current !== null) el.scrollTop = el.scrollHeight - keepFromEnd.current;
    keepFromEnd.current = null;
  }, [firstDay]);

  // Bring the row just logged into view, wherever in the day it landed.
  useEffect(() => {
    if (!fresh) return;
    const row = content.current?.querySelector(`[data-key="${fresh}"]`);
    if (row?.scrollIntoView) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [fresh]);

  const onScroll = () => {
    const el = scroller.current;
    const fromEnd = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinned.current = fromEnd < 80;
    setAway(fromEnd > 360);
  };

  const showEarlier = () => {
    const el = scroller.current;
    keepFromEnd.current = el.scrollHeight - el.scrollTop;
    earlier.onClick();
  };

  const minute = Math.floor(now / 60000) * 60000;
  const lastDay = days[days.length - 1];
  const lastRow = [...days].reverse().find((d) => d.rows.length)?.rows.slice(-1)[0];

  return (
    <div className="tl-scroll" ref={scroller} onScroll={onScroll}>
      <div className={`tl-story${follow ? "" : " is-top"}`} ref={content}>
        {earlier && (
          <button type="button" className="tl-earlier" onClick={earlier.older ? earlier.onClick : showEarlier}>
            {earlier.older ? <Glyph.Calendar /> : <Glyph.ChevronUp />}
            {earlier.label}
          </button>
        )}

        {days.map((day) => {
          const title = dayTitle(day.start, todayStart, t);
          const summary = summaryOf(day);
          // The date is the way to any other day, where there is one.
          const date = (text, className) => (onDay ? (
            <button type="button" className={`${className} tl-day-pick`} title={t("timeline.otherDay")} onClick={() => onDay(day.start)}>
              {text}
              <Glyph.Calendar />
            </button>
          ) : <span className={className}>{text}</span>);
          const isLast = day === lastDay;
          let previous = null;
          return (
            <section key={day.key} className="tl-day" aria-label={title.date || title.name}>
              <header className="tl-day-head">
                <h2>
                  {title.date ? <span className="tl-day-name">{title.name}</span> : date(title.name, "tl-day-name")}
                  {title.date && date(title.date, "tl-day-date")}
                </h2>
                {summary && <p className="tl-day-sum">{summary}</p>}
              </header>

              {day.dated.length > 0 && (
                <ul className="tl-dated">
                  {day.dated.map((item) => {
                    const Icon = iconOf(item.kind, item);
                    const text = describe(item);
                    const label = (
                      <>
                        <span className="tl-dated-icon" style={{ background: toneOf(item.kind) }}><Icon /></span>
                        {text.title}
                      </>
                    );
                    return (
                      <li key={item.key}>
                        {canEdit(item.kind) ? (
                          <button type="button" className="tl-dated-chip" onClick={() => actions.edit(item.kind, item.entry)}>{label}</button>
                        ) : (
                          <span className="tl-dated-chip">{label}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              <ol className="tl-rows">
                {day.rows.map((row, index) => {
                  const gap = gapBefore(previous, row.at);
                  previous = row.at;
                  return (
                    <Row
                      key={row.key}
                      row={row}
                      text={describe(row)}
                      gap={gap}
                      first={index === 0}
                      open={open === row.key || fresh === row.key}
                      fresh={fresh === row.key}
                      editable={canEdit(row.kind)}
                      elapsed={row.live ? actions.elapsed(row.timer, now) : 0}
                      tags={row.entry ? tagMaps?.[KINDS[row.kind].tags]?.[row.entry.id] : undefined}
                      volume={volume}
                      actions={actions}
                    />
                  );
                })}

                {isLast && day.rows.length === 0 && (
                  <li className="tl-empty">{emptyText || t("timeline.nothingToday")}</li>
                )}

                {isLast && follow && (
                  <li
                    className={`tl-row tl-now${asleepNow ? " sleep-before" : ""}${day.rows.length === 0 ? " is-first" : ""}`}
                    style={{ "--gap": `${day.rows.length ? gapBefore(lastRow?.at, minute) : 0}px` }}
                  >
                    <div className="tl-row-line">
                      <div className="tl-row-main">
                        <time className="tl-time">{formatTime(minute)}</time>
                        <span className="tl-node" />
                        <span className="tl-text"><span className="tl-title">{t("simple.now")}</span></span>
                      </div>
                    </div>
                  </li>
                )}
              </ol>
            </section>
          );
        })}
      </div>

      {follow && away && (
        <button type="button" className="tl-jump" onClick={() => toEnd(true)}>
          <Glyph.ArrowDown />
          {t("simple.now")}
        </button>
      )}
    </div>
  );
}
