import { useEffect, useState } from "react";
import { api } from "../../api";
import Modal, { FormField, FormSelect, FormInput, FormButton, FormDeleteButton } from "../Modal";
import TagPicker from "../TagPicker";
import PhotoPicker from "../PhotoPicker";
import EntryTiming from "../EntryTiming";
import { colors } from "../../utils/colors";
import { methodsForType, FEEDING_METHODS } from "../../utils/preferences";
import { useUnits } from "../../utils/units";
import { useI18n } from "../../utils/i18n";
import { toLocalDatetime, localInputToUTC, timerEndToUTC } from "../../utils/datetime";
import { BOTH_BREASTS, nursedSides } from "../../utils/sides";

// A side's length as the form shows it: minutes, to one decimal.
const sideMinutes = (seconds) => (seconds == null ? "" : String(+(seconds / 60).toFixed(1)));

export default function FeedingForm({ childId, timerId, entry, defaultType, defaultMethod, onDone, onClose, onDelete }) {
  const units = useUnits();
  const { t } = useI18n();
  const isEdit = !!entry;

  const TYPES = [
    { value: "breast milk", label: t("feeding.breastMilk") },
    { value: "formula", label: t("feeding.formula") },
    { value: "fortified breast milk", label: t("feeding.fortified") },
    { value: "solid food", label: t("feeding.solidFood") },
  ];

  // Fixed at first render: when a timer was just stopped, this is the stop time.
  const [now] = useState(() => new Date());
  const fifteenMinsAgo = new Date(now.getTime() - 15 * 60 * 1000);
  const initialType = entry?.type || defaultType || "breast milk";
  const initialMethod = entry?.method || defaultMethod || "bottle";
  const initialMethods = methodsForType(initialType);
  const [type, setType] = useState(initialType);
  // A saved entry keeps its method even when the combination is no longer
  // offered (older or imported entries), so opening and saving it changes
  // nothing. Only defaults for a new entry are coerced to fit the type.
  const [method, setMethod] = useState(
    entry?.method || (initialMethods.some((m) => m.value === initialMethod) ? initialMethod : initialMethods[0].value)
  );
  const typeMethods = methodsForType(type);
  const offeredMethods = typeMethods.some((m) => m.value === method)
    ? typeMethods
    : [...typeMethods, ...FEEDING_METHODS.filter((m) => m.value === method)];
  const METHODS = offeredMethods.map((m) => ({ value: m.value, label: t(m.labelKey) }));
  const [amount, setAmount] = useState(entry?.amount != null ? String(entry.amount) : "");
  // How long each side took, for a feed on both breasts, in minutes. Only a
  // side that was changed is sent, so opening and saving an entry leaves a
  // length recorded to the second as it was.
  const [sidesWere] = useState(() => {
    const sides = nursedSides(entry);
    return { left: sideMinutes(sides?.left), right: sideMinutes(sides?.right) };
  });
  const [leftMinutes, setLeftMinutes] = useState(sidesWere.left);
  const [rightMinutes, setRightMinutes] = useState(sidesWere.right);
  const [start, setStart] = useState(entry?.start ? toLocalDatetime(new Date(entry.start)) : toLocalDatetime(fifteenMinsAgo));
  const [end, setEnd] = useState(entry?.end ? toLocalDatetime(new Date(entry.end)) : toLocalDatetime(now));
  const [pausedMinutes, setPausedMinutes] = useState(entry ? String(Math.floor((Number(entry.paused_seconds) || 0) / 60)) : "0");
  const [notes, setNotes] = useState(entry?.notes || "");
  const [photoFile, setPhotoFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [tagIds, setTagIds] = useState([]);
  // Load existing tags when editing an entry so the picker starts pre-populated.
  useEffect(() => {
    if (!entry?.id) return;
    api.getEntityTags("feeding", entry.id)
      .then((tags) => setTagIds((tags || []).map((t) => t.id)))
      .catch(() => {});
  }, [entry?.id]);


  // A new feed that says how long each side took lasted that long: its start
  // follows, and can still be changed afterwards.
  const setSide = (set, other) => (e) => {
    const value = e.target.value;
    set(value);
    if (isEdit || timerId) return;
    const minutes = (parseFloat(value) || 0) + (parseFloat(other) || 0);
    const ended = new Date(end).getTime();
    if (minutes > 0 && Number.isFinite(ended)) setStart(toLocalDatetime(new Date(ended - minutes * 60000)));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data = { type, method };
      if (amount) data.amount = parseFloat(amount);
      if (notes.trim()) data.notes = notes.trim();
      if (method === BOTH_BREASTS) {
        const seconds = (value) => (value === "" ? null : Math.round(parseFloat(value) * 60));
        if (leftMinutes !== (isEdit ? sidesWere.left : "")) data.left_seconds = seconds(leftMinutes);
        if (rightMinutes !== (isEdit ? sidesWere.right : "")) data.right_seconds = seconds(rightMinutes);
      }
      let result;
      if (isEdit) {
        data.start = localInputToUTC(start);
        data.end = localInputToUTC(end);
        data.paused_seconds = Math.max(0, Math.round(Number(pausedMinutes) || 0) * 60);
        result = await api.updateFeeding(entry.id, data);
      } else {
        data.child = childId;
        if (timerId) {
          data.timer = timerId;
          data.end = timerEndToUTC(end, now);
        } else {
          data.start = localInputToUTC(start);
          data.end = localInputToUTC(end);
        }
        result = await api.createFeeding(data);
      }
      const entryId = result?.id || entry?.id;
      if (photoFile && entryId) {
        try { await api.uploadEntryPhoto("feedings", entryId, photoFile); }
        catch (err) { console.error("photo upload failed", err); }
      }
      if (entryId) {
        // Tag write is best-effort — the entry itself is saved. Don't let a
        // tag failure block the modal close and make the save look silent.
        try { await api.setEntityTags("feeding", entryId, tagIds); }
        catch (err) { console.error("tag set failed", err); }
      }
      onDone();
    } catch {
      setSaving(false);
    }
  };

  return (
    <Modal title={isEdit ? t("feeding.edit") : t("feeding.log")} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <FormField label={t("feeding.type")}>
          <FormSelect
            options={TYPES}
            value={type}
            onChange={(e) => {
              const nextType = e.target.value;
              setType(nextType);
              if (!methodsForType(nextType).some((m) => m.value === method)) setMethod(methodsForType(nextType)[0].value);
            }}
          />
        </FormField>
        <FormField label={t("feeding.method")}>
          <FormSelect options={METHODS} value={method} onChange={(e) => setMethod(e.target.value)} />
        </FormField>
        {method === BOTH_BREASTS && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <FormField label={`${t("sides.left")} (${t("simple.minUnit")})`}>
              <FormInput type="number" aria-label={t("sides.left")} value={leftMinutes} onChange={setSide(setLeftMinutes, rightMinutes)} placeholder={t("form.optional")} min="0" step="any" />
            </FormField>
            <FormField label={`${t("sides.right")} (${t("simple.minUnit")})`}>
              <FormInput type="number" aria-label={t("sides.right")} value={rightMinutes} onChange={setSide(setRightMinutes, leftMinutes)} placeholder={t("form.optional")} min="0" step="any" />
            </FormField>
          </div>
        )}
        <FormField label={`${t("feeding.amount")} (${units.volume})`}>
          <FormInput type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={t("form.optional")} min="0" step="any" />
        </FormField>
        {(isEdit || !timerId) && (
          <FormField label={t("general.start")}>
            <FormInput
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              required
            />
          </FormField>
        )}
        <FormField label={t("general.end")}>
          <FormInput
            type="datetime-local"
            value={end}
            max={!isEdit && timerId ? toLocalDatetime(now) : undefined}
            onChange={(e) => setEnd(e.target.value)}
            required
          />
        </FormField>
        <EntryTiming entry={entry} pausedMinutes={pausedMinutes} onPausedMinutesChange={isEdit ? setPausedMinutes : undefined} />
        <FormField label={t("general.notes")}>
          <FormInput
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t("form.optional")}
          />
        </FormField>
        <FormField label={t("tags.title")}>
          <TagPicker value={tagIds} onChange={setTagIds} />
        </FormField>
        <PhotoPicker currentPhoto={entry?.photo} onPhotoSelected={setPhotoFile} />
        <FormButton color={colors.feeding} disabled={saving}>
          {saving ? t("form.saving") : isEdit ? t("form.update") + " " : t("form.save") + " "}
        </FormButton>
      </form>
      {onDelete && <FormDeleteButton onDelete={onDelete} />}
    </Modal>
  );
}
