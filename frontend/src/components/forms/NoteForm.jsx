import { useState } from "react";
import { api } from "../../api";
import Modal, { FormField, FormInput, FormButton, FormDeleteButton } from "../Modal";
import { colors } from "../../utils/colors";
import { useI18n } from "../../utils/i18n";

function toLocalDatetime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function NoteForm({ childId, entry, onDone, onClose, onDelete }) {
  const { t } = useI18n();
  const isEdit = !!entry;
  const [time, setTime] = useState(entry?.time ? toLocalDatetime(new Date(entry.time)) : toLocalDatetime(new Date()));
  const [note, setNote] = useState(entry?.note || "");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!note.trim()) return;
    setSaving(true);
    try {
      const data = { note: note.trim(), time: `${time}:00` };
      if (isEdit) {
        await api.updateNote(entry.id, data);
      } else {
        data.child = childId;
        await api.createNote(data);
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
        <FormButton color={colors.note} disabled={saving || !note.trim()}>
          {saving ? t("form.saving") : isEdit ? t("note.edit") : t("note.log")}
        </FormButton>
      </form>
      {onDelete && <FormDeleteButton onDelete={onDelete} />}
    </Modal>
  );
}
