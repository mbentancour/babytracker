import { useEffect, useState } from "react";
import { api } from "../../api";
import Modal, { FormField, FormInput, FormButton, FormDeleteButton } from "../Modal";
import TagPicker from "../TagPicker";
import PhotoPicker from "../PhotoPicker";
import { useI18n } from "../../utils/i18n";

function toLocalDatetime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function MedicationForm({ childId, entry, defaultDosageUnit, onDone, onClose, onDelete }) {
  const { t } = useI18n();
  const isEdit = !!entry;
  const [name, setName] = useState(entry?.name || "");
  const [dosage, setDosage] = useState(entry?.dosage || "");
  const [dosageUnit, setDosageUnit] = useState(entry?.dosage_unit || defaultDosageUnit || "ml");
  const [time, setTime] = useState(
    entry?.time ? toLocalDatetime(new Date(entry.time)) : toLocalDatetime(new Date())
  );
  const [notes, setNotes] = useState(entry?.notes || "");
  const [photoFile, setPhotoFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [tagIds, setTagIds] = useState([]);
  // Load existing tags when editing an entry so the picker starts pre-populated.
  useEffect(() => {
    if (!entry?.id) return;
    api.getEntityTags("medication", entry.id)
      .then((tags) => setTagIds((tags || []).map((t) => t.id)))
      .catch(() => {});
  }, [entry?.id]);


  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data = { name, dosage, dosage_unit: dosageUnit, time: `${time}:00` };
      if (notes.trim()) data.notes = notes.trim();
      let result;
      if (isEdit) {
        result = await api.updateMedication(entry.id, data);
      } else {
        data.child = childId;
        result = await api.createMedication(data);
      }
      if (photoFile && result?.id) {
        try { await api.uploadEntryPhoto("medications", result.id, photoFile); }
        catch (err) { console.error("photo upload failed", err); }
      }
      onDone();
    } catch {
      setSaving(false);
    }
  };

  return (
    <Modal title={isEdit ? t("medication.edit") : t("medication.log")} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <FormField label={t("medication.name")}>
          <FormInput type="text" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Vitamin D" />
        </FormField>
        <FormField label={t("medication.dosage")}>
          <div style={{ display: "flex", gap: 8 }}>
            <FormInput type="text" value={dosage} onChange={(e) => setDosage(e.target.value)} placeholder="e.g. 5" style={{ flex: 1 }} />
            <FormInput type="text" value={dosageUnit} onChange={(e) => setDosageUnit(e.target.value)} placeholder="ml" style={{ width: 80 }} />
          </div>
        </FormField>
        <FormField label={t("general.time")}>
          <FormInput type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} required />
        </FormField>
        <FormField label={t("general.notes")}>
          <FormInput type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("form.optional")} />
        </FormField>
        <FormField label={t("tags.title")}>
          <TagPicker value={tagIds} onChange={setTagIds} />
        </FormField>
        <PhotoPicker currentPhoto={entry?.photo} onPhotoSelected={setPhotoFile} />
        <FormButton color="#e67e22" disabled={saving}>
          {saving ? t("form.saving") : isEdit ? t("medication.edit") : t("medication.log")}
        </FormButton>
      </form>
      {onDelete && <FormDeleteButton onDelete={onDelete} />}
    </Modal>
  );
}
