import { useEffect, useMemo, useRef, useState } from "react";
import { formatElapsed } from "../../utils/formatters";
import { useI18n } from "../../utils/i18n";
import { FEEDING_TYPES, methodsForType, usePreferences } from "../../utils/preferences";
import { toUTC, clock, lastClock, isNapSleep } from "../simple/time";
import { Glyph } from "./icons";
import { KINDS, toneOf, iconOf, feedingIcon } from "./kinds";
import { usualFeeds } from "./insights";
import { describeRow, timerElapsed } from "./story";

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
      <output aria-live="polite">{shown} {unit}</output>
      <button type="button" aria-label={t("simple.more")} onClick={() => onChange(+(value + step).toFixed(2))}><Glyph.Plus /></button>
    </div>
  );
}

function Choices({ label, options, value, onChange }) {
  return (
    <>
      <div className="tl-label">{label}</div>
      <div className="tl-seg" data-count={options.length} role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} type="button" className="tl-seg-btn" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </>
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
    <>
      <Choices label={t("simple.when")} options={options} value={value.key} onChange={(key) => onChange({ ...value, key })} />
      {value.key === "other" && (
        <input
          type="time"
          className="tl-time-input"
          aria-label={t("general.time")}
          value={value.clock}
          onChange={(e) => onChange({ ...value, clock: e.target.value })}
        />
      )}
    </>
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

function FeedTray({ log, feedings, running, elapsed, units, volume, busy, run, onForm }) {
  const { t } = useI18n();
  const { getFormDefault } = usePreferences();
  const tone = toneOf("feeding");
  const [detail, setDetail] = useState(false);
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
  const methods = methodsForType(type);
  const pickType = (next) => {
    setType(next);
    const allowed = methodsForType(next);
    if (!allowed.some((m) => m.value === method)) setMethod(allowed[0].value);
  };

  const words = (feed) => describeRow({ kind: "feeding", entry: feed }, { t, units });
  const body = (feed) => (Number(feed.amount) > 0 ? { type: feed.type, method: feed.method, amount: feed.amount } : { type: feed.type, method: feed.method });

  if (running) {
    // A feed is being timed. All that is left to say is how it was given.
    const ways = [...usual];
    for (const side of ["left breast", "right breast", "both breasts"]) {
      if (ways.length < 4 && !ways.some((w) => w.method === side)) ways.push({ type: "breast milk", method: side, amount: null });
    }
    return (
      <>
        <p className="tl-lead">{t("timeline.finishAs", { value: formatElapsed(elapsed) })}</p>
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
      const stamp = toUTC(at);
      const feed = { type, method, start: stamp, end: stamp };
      if (method === "bottle" && amount > 0) feed.amount = amount;
      return run(() => log.add("feeding", feed));
    };
    return (
      <>
        <Choices label={t("simple.what")} options={FEEDING_TYPES.map((f) => ({ value: f.value, label: t(f.labelKey) }))} value={type} onChange={pickType} />
        <Choices label={t("simple.how")} options={methods.map((m) => ({ value: m.value, label: t(m.labelKey) }))} value={method} onChange={setMethod} />
        {method === "bottle" && (
          <>
            <div className="tl-label">{t("feeding.amount")}</div>
            <Stepper value={amount} onChange={setAmount} step={volume.step} unit={volume.unit} />
          </>
        )}
        <When value={when} onChange={setWhen} />
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

  const logNow = (feed) => run(() => {
    const stamp = toUTC(new Date());
    return log.add("feeding", { ...body(feed), start: stamp, end: stamp });
  });

  return (
    <>
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

  const savePast = () => {
    const end = lastClock(woke, new Date());
    const start = end && lastClock(asleep, end);
    if (!end || !start || start >= end) return setBad(true);
    setBad(false);
    return run(() => log.add("sleep", { start: toUTC(start), end: toUTC(end), nap: isNapSleep(start, end) }));
  };

  return (
    <>
      <button type="button" className="tl-primary" style={{ background: toneOf("sleep") }} disabled={busy} onClick={() => run(() => log.startTimer("sleep"))}>
        <Glyph.Moon />
        {t("simple.startSleep")}
      </button>
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

function TummyTray({ log, running, elapsed, busy, run, onForm }) {
  const { t } = useI18n();
  const tone = toneOf("tummy");
  if (running) {
    return (
      <>
        <p className="tl-lead">{t("simple.inProgress", { value: formatElapsed(elapsed) })}</p>
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
  const [amount, setAmount] = useState(() => lastAmount(pumping, volume.pumping));
  const save = () => run(() => {
    const stamp = toUTC(new Date());
    return log.add("pumping", amount > 0 ? { start: stamp, end: stamp, amount } : { start: stamp, end: stamp });
  });
  return (
    <>
      <div className="tl-label">{t("feeding.amount")}</div>
      <Stepper value={amount} onChange={setAmount} step={volume.step} unit={volume.unit} />
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

  useEffect(() => {
    if (tray) trayRef.current?.focus({ preventScroll: true });
    else opener.current?.focus?.({ preventScroll: true });
  }, [tray]);

  const buttons = [
    can("feeding") && {
      id: "feeding",
      icon: Glyph.Bottle,
      tone: toneOf("feeding"),
      label: timers.feeding ? formatElapsed(elapsed(timers.feeding)) : t("action.feeding"),
      live: !!timers.feeding,
    },
    can("sleep") && (timers.sleep
      ? { id: "wake", icon: Glyph.Sunrise, tone: toneOf("sleep"), label: t("simple.wakeUp"), live: true }
      : { id: "sleep", icon: Glyph.Moon, tone: toneOf("sleep"), label: t("action.sleep") }),
    can("diaper") && { id: "diaper", icon: Glyph.Drop, tone: toneOf("diaper"), label: t("action.diaper") },
    more.length > 0 && { id: "more", icon: Glyph.Plus, label: t("action.more"), live: !!timers.tummy },
  ].filter(Boolean);

  if (!buttons.length) return null;

  const press = (button, event) => {
    if (button.id === "wake") return run(() => log.finishTimer(timers.sleep));
    opener.current = event.currentTarget;
    return setTray(tray === button.id ? null : button.id);
  };

  const shared = { log, busy, run, onForm };
  const isMoreChild = tray === "tummy" || tray === "pumping";

  return (
    <div className="tl-composer">
      {tray && <div className="tl-scrim" onClick={() => setTray(null)} aria-hidden="true" />}

      {tray && (
        <div ref={trayRef} className="tl-tray" role="dialog" aria-label={t(TITLES[tray])} tabIndex={-1}>
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
              <FeedTray {...shared} feedings={feedings} running={timers.feeding} elapsed={elapsed(timers.feeding)} units={units} volume={volume} />
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
                      <span className={`tl-badge${kind === "tummy" && timers.tummy ? " is-live" : ""}`} style={{ background: KINDS[kind].tone }}><Icon /></span>
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
