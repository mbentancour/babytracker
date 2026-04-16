import { useEffect, useState } from "react";
import { api } from "../../api";
import Modal, { FormField, FormInput, FormButton, FormDeleteButton } from "../Modal";
import TagPicker from "../TagPicker";
import PhotoPicker from "../PhotoPicker";
import { colors } from "../../utils/colors";
import { useUnits } from "../../utils/units";
import { useI18n } from "../../utils/i18n";

export default function HeadCircumferenceForm({ childId, entry, onDone, onClose, onDelete }) {
  const units = useUnits();
  const { t } = useI18n();
  const isEdit = !!entry;
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(entry?.date?.slice(0, 10) || today);
  const [headCircumference, setHeadCircumference] = useState(
    entry?.head_circumference != null ? String(entry.head_circumference) : ""
  );
  const [notes, setNotes] = useState(entry?.notes || "");
  const [photoFile, setPhotoFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [tagIds, setTagIds] = useState([]);
  // Load existing tags when editing an entry so the picker starts pre-populated.
  useEffect(() => {
    if (!entry?.id) return;
    api.getEntityTags("head_circumference", entry.id)
      .then((tags) => setTagIds((tags || []).map((t) => t.id)))
      .catch(() => {});
  }, [entry?.id]);


  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data = { date, head_circumference: parseFloat(headCircumference) };
      if (notes.trim()) data.notes = notes.trim();
      let result;
      if (isEdit) {
        result = await api.updateHeadCircumference(entry.id, data);
      } else {
        data.child = childId;
        result = await api.createHeadCircumference(data);
      }
      if (photoFile && result?.id) {
        await api.uploadEntryPhoto("head-circumference", result.id, photoFile);
      }
      onDone();
    } catch {
      setSaving(false);
    }
  };

  return (
    <Modal title={isEdit ? t("headCirc.edit") : t("headCirc.log")} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <FormField label={t("general.date")}>
          <FormInput type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </FormField>
        <FormField label={`Circumference (${units.length})`}>
          <FormInput type="number" value={headCircumference} onChange={(e) => setHeadCircumference(e.target.value)} required min="0" step="0.1" />
        </FormField>
        <FormField label={t("general.notes")}>
          <FormInput type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("form.optional")} />
        </FormField>
        <FormField label={t("tags.title")}>
          <TagPicker value={tagIds} onChange={setTagIds} />
        </FormField>
        <PhotoPicker currentPhoto={entry?.photo} onPhotoSelected={setPhotoFile} />
        <FormButton color={colors.growth} disabled={saving}>
          {saving ? t("form.saving") : isEdit ? t("form.update") + " " : t("form.save") + " "}
        </FormButton>
      </form>
      {onDelete && <FormDeleteButton onDelete={onDelete} />}
    </Modal>
  );
}
