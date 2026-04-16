import { useEffect, useState } from "react";
import { api } from "../../api";
import Modal, { FormField, FormInput, FormButton, FormDeleteButton } from "../Modal";
import TagPicker from "../TagPicker";
import PhotoPicker from "../PhotoPicker";
import { colors } from "../../utils/colors";
import { useI18n } from "../../utils/i18n";

export default function BMIForm({ childId, entry, onDone, onClose, onDelete }) {
  const { t } = useI18n();
  const isEdit = !!entry;
  const today = new Date().toISOString().slice(0, 10);
  const [bmi, setBmi] = useState(entry?.bmi ? String(entry.bmi) : "");
  const [date, setDate] = useState(entry?.date?.slice(0, 10) || today);
  const [notes, setNotes] = useState(entry?.notes || "");
  const [photoFile, setPhotoFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [tagIds, setTagIds] = useState([]);
  // Load existing tags when editing an entry so the picker starts pre-populated.
  useEffect(() => {
    if (!entry?.id) return;
    api.getEntityTags("bmi", entry.id)
      .then((tags) => setTagIds((tags || []).map((t) => t.id)))
      .catch(() => {});
  }, [entry?.id]);


  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!bmi) return;
    setSaving(true);
    try {
      const data = { bmi: parseFloat(bmi), date };
      if (notes.trim()) data.notes = notes.trim();
      let result;
      if (isEdit) {
        result = await api.updateBMI(entry.id, data);
      } else {
        data.child = childId;
        result = await api.createBMI(data);
      }
      if (photoFile && result?.id) {
        try { await api.uploadEntryPhoto("bmi", result.id, photoFile); }
        catch (err) { console.error("photo upload failed", err); }
      }
      onDone();
    } catch {
      setSaving(false);
    }
  };

  return (
    <Modal title={isEdit ? t("bmi.edit") : t("bmi.log")} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <FormField label="BMI">
          <FormInput type="number" value={bmi} onChange={(e) => setBmi(e.target.value)} placeholder="e.g. 15.2" min="0" max="50" step="0.1" autoFocus required />
        </FormField>
        <FormField label={t("general.date")}>
          <FormInput type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </FormField>
        <FormField label={t("general.notes")}>
          <FormInput type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("form.optional")} />
        </FormField>
        <FormField label={t("tags.title")}>
          <TagPicker value={tagIds} onChange={setTagIds} />
        </FormField>
        <PhotoPicker currentPhoto={entry?.photo} onPhotoSelected={setPhotoFile} />
        <FormButton color={colors.feeding} disabled={saving || !bmi}>
          {saving ? t("form.saving") : isEdit ? t("bmi.edit") : t("bmi.log")}
        </FormButton>
      </form>
      {onDelete && <FormDeleteButton onDelete={onDelete} />}
    </Modal>
  );
}
