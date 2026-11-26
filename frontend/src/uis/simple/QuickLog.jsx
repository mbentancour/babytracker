import { useState } from "react";
import { api } from "../../api";
import Modal from "../../components/Modal";
import { useSession } from "../../core/session";
import { colors } from "../../utils/colors";
import { formatElapsed } from "../../utils/formatters";
import { useI18n } from "../../utils/i18n";
import { BREAST_METHODS, FEEDING_TYPES, methodsForType, usePreferences } from "../../utils/preferences";
import { BOTH_BREASTS, halves, nursingStart, pumpingAmounts, pumpingStart, sumSides } from "../../utils/sides";
import { useUnits } from "../../utils/units";
import { toUTC, quickSpan, nursingSpan, clock, lastClock, isNapSleep } from "./time";

const TITLES = {
  feeding: "feeding.log",
  sleep: "sleep.log",
  diaper: "diaper.log",
  tummy: "tummy.log",
  pumping: "pumping.log",
};

// Amount steppers start from the last amount logged, or these. Stored values
// are in the device's unit system, so the step differs too.
const VOLUME = {
  mL: { step: 10, feeding: 120, pumping: 90 },
  oz: { step: 0.5, feeding: 4, pumping: 3 },
};

const MINUTE = 60 * 1000;

// defaultFeeding is the type and method a feeding gets when the sheet (or a
// finished feeding timer) has nothing more specific: the device's form
// defaults, with the method coerced to one the type allows.
export function defaultFeeding(getFormDefault) {
  const type = getFormDefault("feeding", "type") || "breast milk";
  const methods = methodsForType(type);
  const wanted = getFormDefault("feeding", "method");
  const method = methods.some((m) => m.value === wanted) ? wanted : methods[0].value;
  return { type, method, methods };
}

function lastAmount(entries, fallback) {
  const withAmount = (entries || []).find((e) => Number(e.amount) > 0);
  return withAmount ? Number(withAmount.amount) : fallback;
}

// `label` names what is being counted, in small type above the figure: the
// side, where there is a stepper for each.
function Stepper({ value, onChange, step, unit, label, min = 0 }) {
  const { t } = useI18n();
  const shown = Number.isInteger(value) ? value : value.toFixed(1);
  return (
    <div className="simple-stepper">
      <button type="button" aria-label={t("simple.less")} onClick={() => onChange(Math.max(min, +(value - step).toFixed(2)))}>−</button>
      <output aria-live="polite">{label && <small>{label}</small>}{shown} {unit}</output>
      <button type="button" aria-label={t("simple.more")} onClick={() => onChange(+(value + step).toFixed(2))}>+</button>
    </div>
  );
}

// One stepper for each side, each with its name above its figure: how much
// each breast gave, or how long each took.
function Sides({ label, left, right, onLeft, onRight, ...stepper }) {
  const { t } = useI18n();
  return (
    <div className="simple-sides" role="group" aria-label={label}>
      <div role="group" aria-label={t("sides.left")}><Stepper value={left} onChange={onLeft} label={t("sides.left")} {...stepper} /></div>
      <div role="group" aria-label={t("sides.right")}><Stepper value={right} onChange={onRight} label={t("sides.right")} {...stepper} /></div>
    </div>
  );
}

// "When" as three choices instead of a date and time: now, a little while
// ago, or a clock time (read as the last time the clock showed it).
function When({ value, onChange }) {
  const { t } = useI18n();
  const options = [
    { key: "now", label: t("simple.now") },
    { key: "15", label: t("simple.minAgo", { count: 15 }) },
    { key: "30", label: t("simple.minAgo", { count: 30 }) },
    { key: "other", label: t("simple.otherTime") },
  ];
  return (
    <>
      <div className="simple-label">{t("simple.when")}</div>
      <div className="simple-chips" data-count={options.length}>
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            className="simple-chip"
            aria-pressed={value.key === o.key}
            style={value.key === o.key ? { borderColor: "var(--text)", borderWidth: 2 } : undefined}
            onClick={() => onChange({ ...value, key: o.key })}
          >
            {o.label}
          </button>
        ))}
      </div>
      {value.key === "other" && (
        <input
          type="time"
          className="simple-time"
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

// QuickLog is the simple UI's entry sheet: only the questions an activity
// needs, with "now" as the default answer to "when". Anything it leaves out
// (notes, tags, photos, another date) is one tap away in the full form.
//
// `running` is this activity's timer when one is going. onSaved(kind, id)
// reports a saved entry; onStarted(kind) a started timer.
export default function QuickLog({ kind, running, elapsed, onClose, onSaved, onStarted, onFinish, onMore }) {
  const { t } = useI18n();
  const units = useUnits();
  const { data, timer } = useSession();
  const { getFormDefault } = usePreferences();
  const volume = VOLUME[units.volume] || VOLUME.mL;
  const feeding = defaultFeeding(getFormDefault);
  const childId = data.child?.id;
  const color = colors[kind];

  // The feeding sheet opens on what was fed last time: a family on formula
  // or solids shouldn't have to switch away from breast milk on every entry.
  // With nothing logged yet it opens on the device's default.
  const lastFed = (data.weeklyFeedings || [])[0];
  const [type, setType] = useState(() =>
    FEEDING_TYPES.some((ft) => ft.value === lastFed?.type) ? lastFed.type : feeding.type
  );
  const methods = methodsForType(type);
  const [method, setMethod] = useState(() => {
    const known = (m) => methodsForType(type).some((x) => x.value === m);
    if (known(lastFed?.method)) return lastFed.method;
    return known(feeding.method) ? feeding.method : methodsForType(type)[0].value;
  });
  const pickType = (next) => {
    setType(next);
    const allowed = methodsForType(next);
    if (!allowed.some((m) => m.value === method)) setMethod(allowed[0].value);
  };
  const [amount, setAmount] = useState(() =>
    lastAmount((data.weeklyFeedings || []).filter((f) => f.method === "bottle"), volume.feeding)
  );
  // A pumping session is a total, or what each breast gave: the sheet opens
  // the way the last session was logged.
  const [pump, setPump] = useState(() => pumpingStart(data.weeklyPumping, volume.pumping, volume.step));
  const pumpAs = (split) => {
    if (split === pump.split) return;
    setPump(split
      ? { ...pump, split, ...(sumSides(pump.left, pump.right) === pump.amount ? {} : halves(pump.amount, volume.step)) }
      : { ...pump, split, amount: sumSides(pump.left, pump.right) });
  };
  // How long a breastfeed took, starting from how long the last one did.
  const [nursing, setNursing] = useState(() => nursingStart(data.weeklyFeedings));
  const [minutes, setMinutes] = useState(5);
  const [when, setWhen] = useState(() => ({ key: "now", clock: clock(new Date()) }));
  const [asleep, setAsleep] = useState(() => clock(new Date(Date.now() - 60 * MINUTE)));
  const [woke, setWoke] = useState(() => clock(new Date()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Runs a save: one at a time, and a failure stays on the sheet with the
  // choices intact instead of closing it.
  const run = async (work) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err?.message === "bad-time" ? t("simple.badTime") : t("simple.saveFailed"));
      setSaving(false);
    }
  };

  const pickedTime = () => {
    const at = whenToDate(when, new Date());
    if (!at) throw new Error("bad-time");
    return at;
  };

  const save = (create) => run(async () => onSaved(kind, (await create())?.id));

  const start = (name) => run(async () => {
    await timer.startTimer(name);
    onStarted(kind);
  });

  const saveFeeding = () => save(() => {
    const end = pickedTime();
    const body = {
      child: childId,
      type,
      method,
      ...(BREAST_METHODS.includes(method) ? nursingSpan(end, method, nursing) : quickSpan(end)),
    };
    if (method === "bottle" && amount > 0) body.amount = amount;
    return api.createFeeding(body);
  });

  const saveDiaper = (wet, solid) => save(() =>
    api.createChange({ child: childId, time: toUTC(pickedTime()), wet, solid })
  );

  const savePastSleep = () => save(() => {
    const end = lastClock(woke, new Date());
    const begin = end && lastClock(asleep, end);
    if (!end || !begin || begin >= end) throw new Error("bad-time");
    return api.createSleep({ child: childId, start: toUTC(begin), end: toUTC(end), nap: isNapSleep(begin, end) });
  });

  const saveTummy = () => save(() => {
    const end = new Date();
    return api.createTummyTime({
      child: childId,
      start: toUTC(new Date(end.getTime() - minutes * MINUTE)),
      end: toUTC(end),
    });
  });

  const savePumping = () => save(() => {
    const end = pickedTime();
    return api.createPumping({ child: childId, ...quickSpan(end), ...pumpingAmounts(pump) });
  });

  const big = (label, onClick, extra) => (
    <button type="button" className="simple-big" style={{ background: color }} disabled={saving} onClick={onClick} {...extra}>
      {label}
    </button>
  );

  return (
    <Modal title={t(TITLES[kind])} onClose={onClose}>
      {running ? (
        // A timer for this activity is already going: the only useful things
        // here are to finish it or throw it away.
        <div className="simple-stack">
          <div className="simple-label">{t("simple.inProgress", { value: formatElapsed(elapsed || 0) })}</div>
          {big(t(kind === "sleep" ? "simple.wakeUp" : "simple.finish"), () => run(() => onFinish(running)))}
          <button
            type="button"
            className="simple-plain"
            disabled={saving}
            onClick={() => run(async () => { await timer.discardTimer(running.id); onClose(); })}
          >
            {t("timer.discard")}
          </button>
        </div>
      ) : (
        <>
          {kind === "feeding" && (
            <>
              <div className="simple-label">{t("simple.what")}</div>
              <div className="simple-chips" data-count={FEEDING_TYPES.length} role="group" aria-label={t("simple.what")}>
                {FEEDING_TYPES.map((ft) => (
                  <button
                    key={ft.value}
                    type="button"
                    className="simple-chip"
                    aria-pressed={type === ft.value}
                    style={type === ft.value ? { borderColor: color, borderWidth: 2, color } : undefined}
                    onClick={() => pickType(ft.value)}
                  >
                    {t(ft.labelKey)}
                  </button>
                ))}
              </div>
              <div className="simple-label">{t("simple.how")}</div>
              <div className="simple-chips" data-count={methods.length} role="group" aria-label={t("simple.how")}>
                {methods.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    className="simple-chip"
                    aria-pressed={method === m.value}
                    style={method === m.value ? { borderColor: color, borderWidth: 2, color } : undefined}
                    onClick={() => setMethod(m.value)}
                  >
                    {t(m.labelKey)}
                  </button>
                ))}
              </div>
              {method === "bottle" && (
                <>
                  <div className="simple-label">{t("feeding.amount")}</div>
                  <Stepper value={amount} onChange={setAmount} step={volume.step} unit={units.volume} />
                </>
              )}
              {BREAST_METHODS.includes(method) && (
                <>
                  <div className="simple-label">{t("simple.howLong")}</div>
                  {method === BOTH_BREASTS ? (
                    <Sides
                      label={t("simple.howLong")}
                      left={nursing.left}
                      right={nursing.right}
                      onLeft={(left) => setNursing({ ...nursing, left })}
                      onRight={(right) => setNursing({ ...nursing, right })}
                      step={1}
                      min={1}
                      unit={t("simple.minUnit")}
                    />
                  ) : (
                    <Stepper value={nursing.minutes} onChange={(minutes) => setNursing({ ...nursing, minutes })} step={1} min={1} unit={t("simple.minUnit")} />
                  )}
                </>
              )}
              <When value={when} onChange={setWhen} />
              <div style={{ marginTop: 20 }}>{big(saving ? t("form.saving") : t("form.save"), saveFeeding)}</div>
            </>
          )}

          {kind === "diaper" && (
            <>
              {/* "When" comes first here: tapping a kind saves at once. */}
              <When value={when} onChange={setWhen} />
              <div className="simple-label">{t("simple.oneTap")}</div>
              <div className="simple-stack">
                {big(t("diaper.wet"), () => saveDiaper(true, false))}
                {big(t("diaper.solid"), () => saveDiaper(false, true))}
                {big(t("diaper.both"), () => saveDiaper(true, true))}
              </div>
            </>
          )}

          {kind === "sleep" && (
            <>
              <div className="simple-label">{t("simple.rightNow")}</div>
              {big(t("simple.startSleep"), () => start("sleep"))}
              <div className="simple-label">{t("simple.pastSleep")}</div>
              <div className="simple-times">
                <label>
                  {t("simple.fellAsleep")}
                  <input type="time" className="simple-time" value={asleep} onChange={(e) => setAsleep(e.target.value)} />
                </label>
                <label>
                  {t("simple.wokeUp")}
                  <input type="time" className="simple-time" value={woke} onChange={(e) => setWoke(e.target.value)} />
                </label>
              </div>
              <button type="button" className="simple-chip" style={{ width: "100%", marginTop: 10 }} disabled={saving} onClick={savePastSleep}>
                {saving ? t("form.saving") : t("form.save")}
              </button>
            </>
          )}

          {kind === "tummy" && (
            <>
              <div className="simple-label">{t("simple.rightNow")}</div>
              {big(t("simple.startTimer"), () => start("tummy"))}
              <div className="simple-label">{t("simple.orMinutes")}</div>
              <Stepper value={minutes} onChange={setMinutes} step={1} min={1} unit={t("simple.minUnit")} />
              <button type="button" className="simple-chip" style={{ width: "100%", marginTop: 10 }} disabled={saving} onClick={saveTummy}>
                {saving ? t("form.saving") : t("form.save")}
              </button>
            </>
          )}

          {kind === "pumping" && (
            <>
              <div className="simple-label">{t("feeding.amount")}</div>
              <div className="simple-chips" data-count="2" role="group" aria-label={t("feeding.amount")}>
                {[false, true].map((split) => (
                  <button
                    key={String(split)}
                    type="button"
                    className="simple-chip"
                    aria-pressed={pump.split === split}
                    style={pump.split === split ? { borderColor: color, borderWidth: 2, color } : undefined}
                    onClick={() => pumpAs(split)}
                  >
                    {t(split ? "sides.each" : "sides.total")}
                  </button>
                ))}
              </div>
              <div style={{ marginTop: 10 }}>
                {pump.split ? (
                  <>
                    <Sides
                      label={t("sides.each")}
                      left={pump.left}
                      right={pump.right}
                      onLeft={(left) => setPump({ ...pump, left })}
                      onRight={(right) => setPump({ ...pump, right })}
                      step={volume.step}
                      unit={units.volume}
                    />
                    <p className="simple-total">{t("sides.total")} {sumSides(pump.left, pump.right)} {units.volume}</p>
                  </>
                ) : (
                  <Stepper value={pump.amount} onChange={(next) => setPump({ ...pump, amount: next })} step={volume.step} unit={units.volume} />
                )}
              </div>
              <When value={when} onChange={setWhen} />
              <div style={{ marginTop: 20 }}>{big(saving ? t("form.saving") : t("form.save"), savePumping)}</div>
            </>
          )}

          <button type="button" className="simple-plain" style={{ marginTop: 10 }} disabled={saving} onClick={onMore}>
            {t("simple.moreOptions")}
          </button>
        </>
      )}
      {error && <p className="simple-error" role="alert">{error}</p>}
    </Modal>
  );
}
