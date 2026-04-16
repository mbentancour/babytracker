import { useEffect, useState } from "react";
import { api } from "../../api";
import Modal, { FormField, FormSelect, FormInput, FormButton, FormDeleteButton } from "../Modal";
import TagPicker from "../TagPicker";
import PhotoPicker from "../PhotoPicker";
import { colors } from "../../utils/colors";
import { useI18n } from "../../utils/i18n";
import { usePreferences } from "../../utils/preferences";
import { toLocalDatetime, localInputToUTC } from "../../utils/datetime";

const COLORS = [
  { value: "", label: "Not specified" },
  { value: "black", label: "Black" },
  { value: "brown", label: "Brown" },
  { value: "green", label: "Green" },
  { value: "yellow", label: "Yellow" },
];

export default function DiaperForm({ childId, entry, onDone, onClose, onDelete, preset }) {
  const { t } = useI18n();
  const { getFormDefault } = usePreferences();
  const isEdit = !!entry;
  const [time, setTime] = useState(entry?.time ? toLocalDatetime(new Date(entry.time)) : toLocalDatetime(new Date()));
  const [wet, setWet] = useState(entry ? entry.wet : (preset === "wet" || preset === "both"));
  const [solid, setSolid] = useState(entry ? entry.solid : (preset === "solid" || preset === "both"));
  const [color, setColor] = useState(entry?.color ?? (isEdit ? "" : getFormDefault("diaper", "color") || ""));
  const [notes, setNotes] = useState(entry?.notes || "");
  const [photoFile, setPhotoFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [tagIds, setTagIds] = useState([]);
  // Load existing tags when editing an entry so the picker starts pre-populated.
  useEffect(() => {
    if (!entry?.id) return;
    api.getEntityTags("diaper", entry.id)
      .then((tags) => setTagIds((tags || []).map((t) => t.id)))
      .catch(() => {});
  }, [entry?.id]);


  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data = { wet, solid, time: localInputToUTC(time) };
      if (color) data.color = color;
      if (notes.trim()) data.notes = notes.trim();
      let result;
      if (isEdit) {
        result = await api.updateChange(entry.id, data);
      } else {
        data.child = childId;
        result = await api.createChange(data);
      }
      const entryId = result?.id || entry?.id;
      if (photoFile && entryId) {
        try { await api.uploadEntryPhoto("changes", entryId, photoFile); }
        catch (err) { console.error("photo upload failed", err); }
      }
      if (entryId) {
        try { await api.setEntityTags("diaper", entryId, tagIds); }
        catch (err) { console.error("tag set failed", err); }
      }
      onDone();
    } catch {
      setSaving(false);
    }
  };

  return (
    <Modal title={isEdit ? t("diaper.edit") : t("diaper.log")} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <FormField label={t("general.time")}>
          <FormInput
            type="datetime-local"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            required
          />
        </FormField>
        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          {[
            { key: "wet", label: t("diaper.wet"), active: wet, toggle: () => setWet(!wet) },
            { key: "solid", label: t("diaper.solid"), active: solid, toggle: () => setSolid(!solid) },
          ].map((btn) => (
            <button
              key={btn.key}
              type="button"
              onClick={btn.toggle}
              style={{
                flex: 1,
                padding: "10px 16px",
                borderRadius: 10,
                border: btn.active ? `2px solid ${colors.diaper}` : "1px solid var(--border)",
                background: btn.active ? `${colors.diaper}15` : "var(--bg)",
                color: btn.active ? colors.diaper : "var(--text-muted)",
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
        {solid && (
          <FormField label={t("diaper.color")}>
            <FormSelect options={COLORS} value={color} onChange={(e) => setColor(e.target.value)} />
          </FormField>
        )}
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
        <FormButton color={colors.diaper} disabled={saving || (!wet && !solid)}>
          {saving ? t("form.saving") : isEdit ? t("form.update") + " " : t("form.save") + " "}
        </FormButton>
      </form>
      {onDelete && <FormDeleteButton onDelete={onDelete} />}
    </Modal>
  );
}
