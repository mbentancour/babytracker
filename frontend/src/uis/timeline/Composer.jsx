import { useEffect, useMemo, useRef, useState } from "react";
import { formatElapsed, timeAgo } from "../../utils/formatters";
import { useI18n } from "../../utils/i18n";
import { agoAnchor } from "../../utils/overlayTime";
import { BREAST_METHODS, FEEDING_TYPES, methodsForType, usePreferences } from "../../utils/preferences";
import { BOTH_BREASTS, halves, nursingStart, pumpingAmounts, pumpingStart, sumSides } from "../../utils/sides";
import { toUTC, quickSpan, nursingSpan, clock, lastClock, isNapSleep } from "../simple/time";
import { Glyph } from "./icons";
import { KINDS, toneOf, iconOf, feedingIcon } from "./kinds";
import { usualFeeds } from "./insights";
import { describeRow, newest, timerElapsed } from "./story";

const MINUTE = 60000;
const SOLID_TONE = "#A1622B";

// What "More" offers, in order. Tummy time and pumping have a tray of their
// own; the rest open the full form, where a date or a photo can be added.
const MORE = ["tummy", "pumping", "temp", "weight", "height", "headcirc", "bmi", "note", "medication", "milestone", "milkWaste"];
const LABELS = {
  tummy: "action.tummy", pumping: "action.pumping", temp: "action.temp", weight: "action.weight", height: "action.height",
  headcirc: "action.headCirc", bmi: "action.bmi", note: "action.note", medication: "action.medication",
  milestone: "action.milestone", milkWaste: "action.milkWaste",
};
const TITLES = {
  feeding: "feeding.log", sleep: "sleep.log", diaper: "diaper.log", tummy: "tummy.log", pumping: "pumping.log", more: "action.more",
};

// With nothing logged yet there is no "usual" to offer: start from the
// device's default feed, and nursing on either side.
function starterFeeds(getFormDefault, bottleAmount) {
  const type = getFormDefault("feeding", "type") || "breast milk";
  const allowed = methodsForType(type).map((m) => m.value);
  const wanted = getFormDefault("feeding", "method");
  const method = allowed.includes(wanted) ? wanted : allowed[0];
  const feeds = [{ type, method, amount: method === "bottle" ? bottleAmount : null }];
  for (const side of ["left breast", "right breast"]) {
    if (feeds.length < 3 && !feeds.some((f) => f.method === side)) feeds.push({ type: "breast milk", method: side, amount: null });
  }
  return feeds;
}

function lastAmount(entries, fallback) {
  const withAmount = (entries || []).find((e) => Number(e.amount) > 0);
  return withAmount ? Number(withAmount.amount) : fallback;
}

function Stepper({ value, onChange, step, unit, min = 0 }) {
  const { t } = useI18n();
  const shown = Number.isInteger(value) ? value : value.toFixed(1);
  return (
    <div className="tl-stepper">
      <button type="button" aria-label={t("simple.less")} onClick={() => onChange(Math.max(min, +(value - step).toFixed(2)))}><Glyph.Minus /></button>
      <output aria-live="polite">{unit ? `${shown} ${unit}` : shown}</output>
      <button type="button" aria-label={t("simple.more")} onClick={() => onChange(+(value + step).toFixed(2))}><Glyph.Plus /></button>
    </div>
  );
}

// The two sides of one entry, left on the left and right on the right: how
// much each breast gave, or how long each took. The unit is said once, in
// each caption, which leaves the number room on a narrow phone.
function Sides({ label, unit, left, right, onLeft, onRight, ...stepper }) {
  const { t } = useI18n();
  const side = (name, value, onChange) => (
    <div className="tl-breast" role="group" aria-label={name}>
      <span>{name} ({unit})</span>
      <Stepper value={value} onChange={onChange} {...stepper} />
    </div>
  );
  return (
    <div className="tl-breasts" role="group" aria-label={label}>
      {side(t("sides.left"), left, onLeft)}
      {side(t("sides.right"), right, onRight)}
    </div>
  );
}

// One question of a form: its label and whatever answers it, kept together
// so that a wide screen can set two questions side by side.
function Field({ label, children }) {
  return (
    <div className="tl-field">
      <div className="tl-label">{label}</div>
      {children}
    </div>
  );
}

function Choices({ label, options, value, onChange, children }) {
  return (
    <Field label={label}>
      <div className="tl-seg" data-count={options.length} role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} type="button" className="tl-seg-btn" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
      {children}
    </Field>
  );
}

// "When" as a choice rather than a date and a time: now, a little while ago,
// or a clock time, read as the last time the clock showed it.
function When({ value, onChange }) {
  const { t } = useI18n();
  const options = [
    { value: "now", label: t("simple.now") },
    { value: "15", label: t("simple.minAgo", { count: 15 }) },
    { value: "30", label: t("simple.minAgo", { count: 30 }) },
    { value: "other", label: t("simple.otherTime") },
  ];
  return (
    <Choices label={t("simple.when")} options={options} value={value.key} onChange={(key) => onChange({ ...value, key })}>
      {value.key === "other" && (
        <input
          type="time"
          className="tl-time-input"
          aria-label={t("general.time")}
          value={value.clock}
          onChange={(e) => onChange({ ...value, clock: e.target.value })}
        />
      )}
    </Choices>
  );
}

function whenToDate(when, now) {
  if (when.key === "now") return now;
  if (when.key === "other") return lastClock(when.clock, now);
  return new Date(now.getTime() - Number(when.key) * MINUTE);
}

// Asks once more before throwing a running timer away.
function Discard({ onConfirm }) {
  const { t } = useI18n();
  const [armed, setArmed] = useState(false);
  return (
    <button type="button" className="tl-plain tl-plain-danger" onClick={() => (armed ? onConfirm() : setArmed(true))}>
      {armed ? t("timeline.confirm") : t("timer.discard")}
    </button>
  );
}

// A timer that is running, at the top of its tray: what it is, and the way
// to stop the clock for a while. A baby takes breaks; the feed is not over.
function Running({ text, timer, busy, onPause }) {
  const { t } = useI18n();
  const paused = !!timer.is_paused;
  return (
    <div className="tl-running">
      <p className="tl-lead">{paused ? `${t("general.paused")} · ${text}` : text}</p>
      <button type="button" className="tl-chip" disabled={busy} onClick={() => onPause(timer)}>
        {paused ? <Glyph.Play /> : <Glyph.Pause />}
        {t(paused ? "timer.resume" : "timer.pause")}
      </button>
    </div>
  );
}

function Option({ icon: Icon, tone, title, detail, badgeStyle, ...rest }) {
  return (
    <button type="button" className="tl-option" {...rest}>
      <span className="tl-badge" style={badgeStyle || { background: tone }}><Icon /></span>
      <span className="tl-option-text">
        <span>{title}</span>
        {detail && <small>{detail}</small>}
      </span>
    </button>
  );
}

// `detail` is whether the tray shows the form for "something else"; the
// composer holds it, since that form is given more room on a wide screen.
function FeedTray({ log, feedings, running, elapsed, units, volume, busy, run, pause, onForm, detail, setDetail }) {
  const { t } = useI18n();
  const { getFormDefault } = usePreferences();
  const tone = toneOf("feeding");
  const [bad, setBad] = useState(false);

  // The feeds this family actually gives, most often first.
  const usual = useMemo(() => {
    const learned = usualFeeds(feedings, 3);
    return learned.length ? learned : starterFeeds(getFormDefault, volume.feeding);
  }, [feedings, getFormDefault, volume.feeding]);

  const first = usual[0];
  const [type, setType] = useState(first.type);
  const [method, setMethod] = useState(first.method);
  const [amount, setAmount] = useState(() => lastAmount(feedings.filter((f) => f.method === "bottle"), volume.feeding));
  const [when, setWhen] = useState(() => ({ key: "now", clock: clock(new Date()) }));
  // How long a breastfeed took, starting from how long the last one did.
  const [nursing, setNursing] = useState(() => nursingStart(feedings));
  const nursed = BREAST_METHODS.includes(method);
  const methods = methodsForType(type);
  const pickType = (next) => {
    setType(next);
    const allowed = methodsForType(next);
    if (!allowed.some((m) => m.value === method)) setMethod(allowed[0].value);
  };

  const words = (feed) => describeRow({ kind: "feeding", entry: feed }, { t, units });
  // What was fed last and how long ago: with nursing, which side it was. The
  // tray lies over the end of the list, where that would otherwise be read.
  const last = useMemo(() => newest(feedings), [feedings]);
  const body = (feed) => (Number(feed.amount) > 0 ? { type: feed.type, method: feed.method, amount: feed.amount } : { type: feed.type, method: feed.method });

  if (running) {
    // A feed is being timed. All that is left to say is how it was given.
    const ways = [...usual];
    for (const side of ["left breast", "right breast", "both breasts"]) {
      if (ways.length < 4 && !ways.some((w) => w.method === side)) ways.push({ type: "breast milk", method: side, amount: null });
    }
    return (
      <>
        <Running text={t("timeline.finishAs", { value: formatElapsed(elapsed) })} timer={running} busy={busy} onPause={pause} />
        <div className="tl-options">
          {ways.map((feed) => {
            const text = words(feed);
            return (
              <Option
                key={`${feed.type}|${feed.method}`}
                icon={feedingIcon(feed)}
                tone={tone}
                title={text.title}
                detail={text.detail}
                disabled={busy}
                onClick={() => run(() => log.finishTimer(running, { feeding: body(feed) }))}
              />
            );
          })}
        </div>
        <div className="tl-foot">
          <button type="button" className="tl-plain" onClick={() => onForm("feeding", { timerId: running.id })}>{t("simple.moreOptions")}</button>
          <Discard onConfirm={() => run(() => log.discardTimer(running))} />
        </div>
      </>
    );
  }

  if (detail) {
    const save = () => {
      const at = whenToDate(when, new Date());
      if (!at) return setBad(true);
      setBad(false);
      const feed = { type, method, ...(nursed ? nursingSpan(at, method, nursing) : quickSpan(at)) };
      if (method === "bottle" && amount > 0) feed.amount = amount;
      return run(() => log.add("feeding", feed));
    };
    return (
      <>
        <div className="tl-fields">
          <Choices label={t("simple.what")} options={FEEDING_TYPES.map((f) => ({ value: f.value, label: t(f.labelKey) }))} value={type} onChange={pickType} />
          <Choices label={t("simple.how")} options={methods.map((m) => ({ value: m.value, label: t(m.labelKey) }))} value={method} onChange={setMethod} />
          {method === "bottle" && (
            <Field label={t("feeding.amount")}>
              <Stepper value={amount} onChange={setAmount} step={volume.step} unit={volume.unit} />
            </Field>
          )}
          {nursed && (
            <Field label={t("simple.howLong")}>
              {method === BOTH_BREASTS ? (
                <Sides
                  label={t("simple.howLong")}
                  unit={t("simple.minUnit")}
                  left={nursing.left}
                  right={nursing.right}
                  onLeft={(left) => setNursing({ ...nursing, left })}
                  onRight={(right) => setNursing({ ...nursing, right })}
                  step={1}
                  min={1}
                />
              ) : (
                <Stepper value={nursing.minutes} onChange={(minutes) => setNursing({ ...nursing, minutes })} step={1} min={1} unit={t("simple.minUnit")} />
              )}
            </Field>
          )}
          <When value={when} onChange={setWhen} />
        </div>
        {bad && <p className="tl-error" role="alert">{t("simple.badTime")}</p>}
        <button type="button" className="tl-primary" style={{ background: tone }} disabled={busy} onClick={save}>
          {busy ? t("form.saving") : t("form.save")}
        </button>
        <div className="tl-foot">
          <button type="button" className="tl-plain" onClick={() => setDetail(false)}>{t("form.back")}</button>
          <button type="button" className="tl-plain" onClick={() => onForm("feeding")}>{t("simple.moreOptions")}</button>
        </div>
      </>
    );
  }

  const logNow = (feed) => run(() => log.add("feeding", { ...body(feed), ...quickSpan(new Date()) }));

  return (
    <>
      {last && (
        <p className="tl-lead tl-lead-fact">
          {t("timeline.lastFeedWas", { what: words(last).title, ago: timeAgo(agoAnchor(last), t) })}
        </p>
      )}
      <p className="tl-lead">{t("simple.oneTap")}</p>
      <div className="tl-options">
        {usual.map((feed) => {
          const text = words(feed);
          return (
            <Option
              key={`${feed.type}|${feed.method}`}
              icon={feedingIcon(feed)}
              tone={tone}
              title={text.title}
              detail={text.detail}
              disabled={busy}
              onClick={() => logNow(feed)}
            />
          );
        })}
      </div>
      <div className="tl-foot">
        <button type="button" className="tl-plain" onClick={() => setDetail(true)}>{t("timeline.somethingElse")}</button>
        <button type="button" className="tl-plain" disabled={busy} onClick={() => run(() => log.startTimer("feeding"))}>
          <Glyph.Timer />
          {t("simple.startTimer")}
        </button>
      </div>
    </>
  );
}

function SleepTray({ log, busy, run, onForm }) {
  const { t } = useI18n();
  const [asleep, setAsleep] = useState(() => clock(new Date(Date.now() - 60 * MINUTE)));
  const [woke, setWoke] = useState(() => clock(new Date()));
  const [bad, setBad] = useState(false);
  // Asleep already, and for a while: the time it began, once "Other time" is
  // picked. Null while that choice is closed.
  const [since, setSince] = useState(null);
  const [badSince, setBadSince] = useState(false);

  const start = (at) => run(() => log.startTimer("sleep", at));
  const startSince = () => {
    const at = lastClock(since, new Date());
    if (!at) return setBadSince(true);
    setBadSince(false);
    return start(at);
  };

  const savePast = () => {
    const end = lastClock(woke, new Date());
    const start = end && lastClock(asleep, end);
    if (!end || !start || start >= end) return setBad(true);
    setBad(false);
    return run(() => log.add("sleep", { start: toUTC(start), end: toUTC(end), nap: isNapSleep(start, end) }));
  };

  return (
    <>
      <button type="button" className="tl-primary" style={{ background: toneOf("sleep") }} disabled={busy} onClick={() => start()}>
        <Glyph.Moon />
        {t("simple.startSleep")}
      </button>
      {/* Sleep is the entry most often logged late: the baby goes down, and
          the phone comes out a while after. */}
      <div className="tl-label">{t("timeline.asleepEarlier")}</div>
      <div className="tl-seg tl-seg-fit">
        {[15, 30].map((minutes) => (
          <button
            key={minutes}
            type="button"
            className="tl-seg-btn"
            disabled={busy}
            aria-label={t("simple.minAgo", { count: minutes })}
            onClick={() => start(new Date(Date.now() - minutes * MINUTE))}
          >
            {minutes} {t("simple.minUnit")}
          </button>
        ))}
        <button
          type="button"
          className="tl-seg-btn"
          aria-pressed={since !== null}
          onClick={() => setSince(since === null ? clock(new Date(Date.now() - 45 * MINUTE)) : null)}
        >
          {t("simple.otherTime")}
        </button>
      </div>
      {since !== null && (
        <div className="tl-times tl-times-one">
          <label>
            {t("simple.fellAsleep")}
            <input type="time" className="tl-time-input" value={since} onChange={(e) => setSince(e.target.value)} />
          </label>
          <button type="button" className="tl-secondary" disabled={busy} onClick={startSince}>{t("timeline.startThen")}</button>
        </div>
      )}
      {badSince && <p className="tl-error" role="alert">{t("simple.badTime")}</p>}
      <div className="tl-label">{t("simple.pastSleep")}</div>
      <div className="tl-times">
        <label>
          {t("simple.fellAsleep")}
          <input type="time" className="tl-time-input" value={asleep} onChange={(e) => setAsleep(e.target.value)} />
        </label>
        <label>
          {t("simple.wokeUp")}
          <input type="time" className="tl-time-input" value={woke} onChange={(e) => setWoke(e.target.value)} />
        </label>
        <button type="button" className="tl-secondary" disabled={busy} onClick={savePast}>{t("form.save")}</button>
      </div>
      {bad && <p className="tl-error" role="alert">{t("simple.badTime")}</p>}
      <div className="tl-foot">
        <button type="button" className="tl-plain" onClick={() => onForm("sleep")}>{t("simple.moreOptions")}</button>
      </div>
    </>
  );
}

function DiaperTray({ log, busy, run, onForm }) {
  const { t } = useI18n();
  const wet = toneOf("diaper");
  const kinds = [
    { key: "wet", wet: true, solid: false, label: t("diaper.wet"), icon: Glyph.Drop, badge: { background: wet } },
    { key: "solid", wet: false, solid: true, label: t("diaper.solid"), icon: Glyph.Drop, badge: { background: SOLID_TONE } },
    { key: "both", wet: true, solid: true, label: t("diaper.both"), icon: Glyph.Drop, badge: { background: `linear-gradient(135deg, ${wet} 50%, ${SOLID_TONE} 50%)` } },
  ];
  return (
    <>
      <p className="tl-lead">{t("simple.oneTap")}</p>
      <div className="tl-tiles tl-tiles-3">
        {kinds.map((k) => (
          <button
            key={k.key}
            type="button"
            className="tl-tile"
            disabled={busy}
            onClick={() => run(() => log.add("diaper", { time: toUTC(new Date()), wet: k.wet, solid: k.solid }))}
          >
            <span className="tl-badge" style={k.badge}><k.icon /></span>
            {k.label}
          </button>
        ))}
      </div>
      <div className="tl-foot">
        <button type="button" className="tl-plain" onClick={() => onForm("diaper")}>{t("simple.moreOptions")}</button>
      </div>
    </>
  );
}

function TummyTray({ log, running, elapsed, busy, run, pause, onForm }) {
  const { t } = useI18n();
  const tone = toneOf("tummy");
  if (running) {
    return (
      <>
        <Running text={t("simple.inProgress", { value: formatElapsed(elapsed) })} timer={running} busy={busy} onPause={pause} />
        <button type="button" className="tl-primary" style={{ background: tone }} disabled={busy} onClick={() => run(() => log.finishTimer(running))}>
          {t("simple.finish")}
        </button>
        <div className="tl-foot">
          <Discard onConfirm={() => run(() => log.discardTimer(running))} />
        </div>
      </>
    );
  }
  const logMinutes = (minutes) => run(() => {
    const end = new Date();
    return log.add("tummy", { start: toUTC(new Date(end.getTime() - minutes * MINUTE)), end: toUTC(end) });
  });
  return (
    <>
      <button type="button" className="tl-primary" style={{ background: tone }} disabled={busy} onClick={() => run(() => log.startTimer("tummy"))}>
        <Glyph.Timer />
        {t("simple.startTimer")}
      </button>
      <div className="tl-label">{t("simple.orMinutes")}</div>
      <div className="tl-seg">
        {[3, 5, 10, 15].map((minutes) => (
          <button key={minutes} type="button" className="tl-seg-btn" disabled={busy} onClick={() => logMinutes(minutes)}>
            {minutes} {t("simple.minUnit")}
          </button>
        ))}
      </div>
      <div className="tl-foot">
        <button type="button" className="tl-plain" onClick={() => onForm("tummy")}>{t("simple.moreOptions")}</button>
      </div>
    </>
  );
}

function PumpTray({ log, pumping, volume, busy, run, onForm }) {
  const { t } = useI18n();
  // A session is a total, or what each breast gave: the tray opens the way
  // the last session was logged.
  const [pump, setPump] = useState(() => pumpingStart(pumping, volume.pumping, volume.step));
  const total = sumSides(pump.left, pump.right);
  // Changing over keeps what was already put in: a total is split in two,
  // two sides are added up.
  const pumpAs = (split) => {
    if (split === pump.split) return;
    setPump(split
      ? { ...pump, split, ...(total === pump.amount ? {} : halves(pump.amount, volume.step)) }
      : { ...pump, split, amount: total });
  };
  const save = () => run(() => log.add("pumping", { ...quickSpan(new Date()), ...pumpingAmounts(pump) }));
  return (
    <>
      <div className="tl-label">{t("feeding.amount")}</div>
      <div className="tl-seg" role="group" aria-label={t("feeding.amount")}>
        {[false, true].map((split) => (
          <button key={String(split)} type="button" className="tl-seg-btn" aria-pressed={pump.split === split} onClick={() => pumpAs(split)}>
            {t(split ? "sides.each" : "sides.total")}
          </button>
        ))}
      </div>
      {pump.split ? (
        <>
          <Sides
            label={t("sides.each")}
            unit={volume.unit}
            left={pump.left}
            right={pump.right}
            onLeft={(left) => setPump({ ...pump, left })}
            onRight={(right) => setPump({ ...pump, right })}
            step={volume.step}
          />
          <p className="tl-lead tl-lead-fact tl-sum">{t("sides.total")} {total} {volume.unit}</p>
        </>
      ) : (
        <Stepper value={pump.amount} onChange={(amount) => setPump({ ...pump, amount })} step={volume.step} unit={volume.unit} />
      )}
      <button type="button" className="tl-primary" style={{ background: toneOf("pumping") }} disabled={busy} onClick={save}>
        {busy ? t("form.saving") : t("form.save")}
      </button>
      <div className="tl-foot">
        <button type="button" className="tl-plain" onClick={() => onForm("pumping")}>{t("simple.moreOptions")}</button>
      </div>
    </>
  );
}

// Composer is the bar the story is written from: Feeding, Sleep, Diaper and
// More. Each opens a small tray just above it with the one or two things
// there are to say, and what you pick is logged for now. While the baby is
// asleep the Sleep button is "Wake up" and needs no tray at all.
export default function Composer({ log, feedings, pumping, timers, can, now, units, volume, tray, setTray, onForm }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  // The feeding tray's form for "something else", back to the short list
  // whenever the tray is closed or another one opens.
  const [detail, setDetail] = useState(false);
  const trayRef = useRef(null);
  const opener = useRef(null);

  const elapsed = (timer) => (timer ? timerElapsed(timer, now) : 0);
  const more = MORE.filter(can);

  // Runs one action at a time; the tray closes when it worked and stays, with
  // the choices as they were, when it did not.
  const run = async (work) => {
    if (busy) return;
    setBusy(true);
    const result = await work();
    setBusy(false);
    if (result) setTray(null);
  };

  // Holding a timer, or letting it run again, leaves its tray open: the
  // feed is still to be finished.
  const pause = async (timer) => {
    if (busy) return;
    setBusy(true);
    await log.setPaused(timer, !timer.is_paused);
    setBusy(false);
  };

  useEffect(() => {
    if (tray) trayRef.current?.focus({ preventScroll: true });
    else opener.current?.focus?.({ preventScroll: true });
    if (tray !== "feeding") setDetail(false);
  }, [tray]);

  const buttons = [
    can("feeding") && {
      id: "feeding",
      // A feed on hold says so where its clock is read.
      icon: timers.feeding?.is_paused ? Glyph.Pause : Glyph.Bottle,
      tone: toneOf("feeding"),
      label: timers.feeding ? formatElapsed(elapsed(timers.feeding)) : t("action.feeding"),
      live: !!timers.feeding && !timers.feeding.is_paused,
    },
    can("sleep") && (timers.sleep
      ? { id: "wake", icon: Glyph.Sunrise, tone: toneOf("sleep"), label: t("simple.wakeUp"), live: true }
      : { id: "sleep", icon: Glyph.Moon, tone: toneOf("sleep"), label: t("action.sleep") }),
    can("diaper") && { id: "diaper", icon: Glyph.Drop, tone: toneOf("diaper"), label: t("action.diaper") },
    more.length > 0 && { id: "more", icon: Glyph.Plus, label: t("action.more"), live: !!timers.tummy && !timers.tummy.is_paused },
  ].filter(Boolean);

  if (!buttons.length) return null;

  const press = (button, event) => {
    if (button.id === "wake") return run(() => log.finishTimer(timers.sleep));
    opener.current = event.currentTarget;
    return setTray(tray === button.id ? null : button.id);
  };

  const shared = { log, busy, run, pause, onForm };
  const isMoreChild = tray === "tummy" || tray === "pumping";
  // A form with four questions is set two abreast where there is the width.
  const isForm = tray === "feeding" && detail && !timers.feeding;

  return (
    <div className="tl-composer">
      {tray && <div className="tl-scrim" onClick={() => setTray(null)} aria-hidden="true" />}

      {tray && (
        <div ref={trayRef} className={`tl-tray${isForm ? " is-form" : ""}`} role="dialog" aria-label={t(TITLES[tray])} tabIndex={-1}>
          <div className="tl-tray-head">
            {isMoreChild && (
              <button type="button" className="tl-tray-back" onClick={() => setTray("more")} aria-label={t("form.back")}>
                <Glyph.ChevronLeft />
              </button>
            )}
            <h2>{t(TITLES[tray])}</h2>
            <button type="button" className="tl-tray-close" onClick={() => setTray(null)} aria-label={t("general.close")}>
              <Glyph.X />
            </button>
          </div>
          <div className="tl-tray-body">
            {tray === "feeding" && (
              <FeedTray {...shared} feedings={feedings} running={timers.feeding} elapsed={elapsed(timers.feeding)} units={units} volume={volume} detail={detail} setDetail={setDetail} />
            )}
            {tray === "sleep" && <SleepTray {...shared} />}
            {tray === "diaper" && <DiaperTray {...shared} />}
            {tray === "tummy" && <TummyTray {...shared} running={timers.tummy} elapsed={elapsed(timers.tummy)} />}
            {tray === "pumping" && <PumpTray {...shared} pumping={pumping} volume={volume} />}
            {tray === "more" && (
              <div className="tl-tiles">
                {more.map((kind) => {
                  const Icon = iconOf(kind);
                  const own = kind === "tummy" || kind === "pumping";
                  return (
                    <button key={kind} type="button" className="tl-tile" onClick={() => (own ? setTray(kind) : onForm(kind))}>
                      <span className={`tl-badge${kind === "tummy" && timers.tummy && !timers.tummy.is_paused ? " is-live" : ""}`} style={{ background: KINDS[kind].tone }}><Icon /></span>
                      {kind === "tummy" && timers.tummy ? formatElapsed(elapsed(timers.tummy)) : t(LABELS[kind])}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="tl-dock" role="toolbar" aria-label={t("timeline.log")}>
        {buttons.map((button) => (
          <button
            key={button.id}
            type="button"
            className={`tl-act${button.live ? " is-live" : ""}${tray === button.id ? " is-open" : ""}`}
            style={button.tone ? { "--tone": button.tone } : undefined}
            aria-expanded={button.id === "wake" ? undefined : tray === button.id}
            disabled={button.id === "wake" && busy}
            onClick={(event) => press(button, event)}
          >
            <span className="tl-act-icon"><button.icon /></span>
            <span className="tl-act-label">{button.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
