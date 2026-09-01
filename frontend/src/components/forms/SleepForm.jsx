import { useEffect, useState } from "react";
import { api } from "../../api";
import Modal, { FormField, FormInput, FormButton, FormDeleteButton } from "../Modal";
import TagPicker from "../TagPicker";
import PhotoPicker from "../PhotoPicker";
import TimerPauseInfo from "../TimerPauseInfo";
import { colors } from "../../utils/colors";
import { useI18n } from "../../utils/i18n";
import { toLocalDatetime, localInputToUTC } from "../../utils/datetime";

export default function SleepForm({ childId, timerId, entry, onDone, onClose, onDelete }) {
  const { t } = useI18n();
  const isEdit = !!entry;
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const [start, setStart] = useState(entry?.start ? toLocalDatetime(new Date(entry.start)) : toLocalDatetime(oneHourAgo));
  const [end, setEnd] = useState(entry?.end ? toLocalDatetime(new Date(entry.end)) : toLocalDatetime(now));
  const [nap, setNap] = useState(entry?.nap ?? false);
  const [notes, setNotes] = useState(entry?.notes || "");
  const [photoFile, setPhotoFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [tagIds, setTagIds] = useState([]);
  const [timer, setTimer] = useState(null);
  // Load full timer data when using a timer (new entry) or when editing an entry that was created with a timer
  useEffect(() => {
    const loadTimer = async () => {
      const tId = timerId || entry?.timer;
      console.log("[SleepForm] Loading timer. timerId:", timerId, "entry?.timer:", entry?.timer, "resolved tId:", tId);
      if (!tId) return;
      try {
        const timerData = await api.getTimer(tId);
        console.log("[SleepForm] Timer loaded:", timerData);
        setTimer(timerData);
      } catch (err) {
        console.error("[SleepForm] Error loading timer:", err);
      }
    };
    loadTimer();
  }, [timerId, entry?.timer]);
  // Load existing tags when editing an entry so the picker starts pre-populated.
  useEffect(() => {
    if (!entry?.id) return;
    api.getEntityTags("sleep", entry.id)
      .then((tags) => setTagIds((tags || []).map((t) => t.id)))
      .catch(() => {});
  }, [entry?.id]);


  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      let result;
      if (isEdit) {
        const data = {
          start: localInputToUTC(start),
          end: localInputToUTC(end),
          nap,
        };
        if (notes.trim()) data.notes = notes.trim();
        result = await api.updateSleep(entry.id, data);
      } else {
        const data = { child: childId, nap };
        if (notes.trim()) data.notes = notes.trim();
        if (timerId) {
          data.timer = timerId;
        } else {
          data.start = localInputToUTC(start);
          data.end = localInputToUTC(end);
        }
        result = await api.createSleep(data);
      }
      const entryId = result?.id || entry?.id;
      if (photoFile && entryId) {
        try { await api.uploadEntryPhoto("sleep", entryId, photoFile); }
        catch (err) { console.error("photo upload failed", err); }
      }
      if (entryId) {
        try { await api.setEntityTags("sleep", entryId, tagIds); }
        catch (err) { console.error("tag set failed", err); }
      }
      onDone();
    } catch {
      setSaving(false);
    }
  };

  return (
    <Modal title={isEdit ? t("sleep.edit") : t("sleep.log")} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {!isEdit && timerId ? (
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
            The timer's start and end times will be used for this sleep entry.
          </p>
        ) : (
          <>
            <FormField label={t("general.start")}>
              <FormInput
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                required
              />
            </FormField>
            <FormField label={t("general.end")}>
              <FormInput
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                required
              />
            </FormField>
          </>
        )}
        {!isEdit && timerId && timerPauses.length > 0 && (
          <TimerPauseInfo start={start} end={end} pauses={timerPauses} />
        )}
        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          {[
            { key: "nap", label: t("sleep.nap"), active: nap },
            { key: "night", label: t("sleep.night"), active: !nap },
          ].map((btn) => (
            <button
              key={btn.key}
              type="button"
              aria-pressed={btn.active}
              onClick={() => setNap(btn.key === "nap")}
              style={{
                flex: 1,
                padding: "10px 16px",
                borderRadius: 10,
                border: btn.active ? `2px solid ${colors.sleep}` : "1px solid var(--border)",
                background: btn.active ? `${colors.sleep}15` : "var(--bg)",
                color: btn.active ? colors.sleep : "var(--text-muted)",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {btn.label}
            </button>
          ))}
        </div>
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
        <FormButton color={colors.sleep} disabled={saving}>
          {saving ? t("form.saving") : isEdit ? t("form.update") + " " : t("form.save") + " "}
        </FormButton>
      </form>
      {onDelete && <FormDeleteButton onDelete={onDelete} />}
    </Modal>
  );
}
