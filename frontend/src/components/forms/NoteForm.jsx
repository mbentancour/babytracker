import { useEffect, useState } from "react";
import { api } from "../../api";
import Modal, { FormField, FormInput, FormButton, FormDeleteButton } from "../Modal";
import TagPicker from "../TagPicker";
import PhotoPicker from "../PhotoPicker";
import { colors } from "../../utils/colors";
import { useI18n } from "../../utils/i18n";
import { toLocalDatetime, localInputToUTC } from "../../utils/datetime";

export default function NoteForm({ childId, entry, onDone, onClose, onDelete }) {
  const { t } = useI18n();
  const isEdit = !!entry;
  const [time, setTime] = useState(entry?.time ? toLocalDatetime(new Date(entry.time)) : toLocalDatetime(new Date()));
  const [note, setNote] = useState(entry?.note || "");
  const [photoFile, setPhotoFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [tagIds, setTagIds] = useState([]);
  // Load existing tags when editing an entry so the picker starts pre-populated.
  useEffect(() => {
    if (!entry?.id) return;
    api.getEntityTags("note", entry.id)
      .then((tags) => setTagIds((tags || []).map((t) => t.id)))
      .catch(() => {});
  }, [entry?.id]);


  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!note.trim()) return;
    setSaving(true);
    try {
      const data = { note: note.trim(), time: localInputToUTC(time) };
      let result;
      if (isEdit) {
        result = await api.updateNote(entry.id, data);
      } else {
        data.child = childId;
        result = await api.createNote(data);
      }
      const entryId = result?.id || entry?.id;
      if (photoFile && entryId) {
        try { await api.uploadEntryPhoto("notes", entryId, photoFile); }
        catch (err) { console.error("photo upload failed", err); }
      }
      if (entryId) {
        try { await api.setEntityTags("note", entryId, tagIds); }
        catch (err) { console.error("tag set failed", err); }
      }
      onDone();
    } catch {
      setSaving(false);
    }
  };

  return (
    <Modal title={isEdit ? t("note.edit") : t("note.log")} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <FormField label={t("general.time")}>
          <FormInput
            type="datetime-local"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            required
          />
        </FormField>
        <FormField label={t("general.notes")}>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            autoFocus
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text)",
              fontSize: 14,
              fontFamily: "inherit",
              outline: "none",
              resize: "vertical",
            }}
          />
        </FormField>
        <FormField label={t("tags.title")}>
          <TagPicker value={tagIds} onChange={setTagIds} />
        </FormField>
        <PhotoPicker currentPhoto={entry?.photo} onPhotoSelected={setPhotoFile} />
        <FormButton color={colors.note} disabled={saving || !note.trim()}>
          {saving ? t("form.saving") : isEdit ? t("note.edit") : t("note.log")}
        </FormButton>
      </form>
      {onDelete && <FormDeleteButton onDelete={onDelete} />}
    </Modal>
  );
}
