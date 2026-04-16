import { useEffect, useState } from "react";
import { api } from "../../api";
import Modal, { FormField, FormInput, FormButton, FormDeleteButton } from "../Modal";
import TagPicker from "../TagPicker";
import PhotoPicker from "../PhotoPicker";
import { colors } from "../../utils/colors";
import { useUnits } from "../../utils/units";
import { useI18n } from "../../utils/i18n";

function toLocalDate(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function WeightForm({ childId, entry, onDone, onClose, onDelete }) {
  const units = useUnits();
  const { t } = useI18n();
  const isEdit = !!entry;
  const [weight, setWeight] = useState(entry?.weight ? String(entry.weight) : "");
  const [date, setDate] = useState(entry?.date ? toLocalDate(entry.date) : toLocalDate(new Date()));
  const [photoFile, setPhotoFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [tagIds, setTagIds] = useState([]);
  // Load existing tags when editing an entry so the picker starts pre-populated.
  useEffect(() => {
    if (!entry?.id) return;
    api.getEntityTags("weight", entry.id)
      .then((tags) => setTagIds((tags || []).map((t) => t.id)))
      .catch(() => {});
  }, [entry?.id]);


  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!weight) return;
    setSaving(true);
    try {
      const data = { weight: parseFloat(weight), date };
      let result;
      if (isEdit) {
        result = await api.updateWeight(entry.id, data);
      } else {
        data.child = childId;
        result = await api.createWeight(data);
      }
      if (photoFile && result?.id) {
        await api.uploadEntryPhoto("weight", result.id, photoFile);
      }
      onDone();
    } catch {
      setSaving(false);
    }
  };

  return (
    <Modal title={isEdit ? t("weight.edit") : t("weight.log")} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <FormField label={`Weight (${units.weight})`}>
          <FormInput type="number" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="5.0" min="0" step="0.01" autoFocus required />
        </FormField>
        <FormField label={t("general.date")}>
          <FormInput type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </FormField>
        <FormField label={t("tags.title")}>
          <TagPicker value={tagIds} onChange={setTagIds} />
        </FormField>
        <PhotoPicker currentPhoto={entry?.photo} onPhotoSelected={setPhotoFile} />
        <FormButton color={colors.growth} disabled={saving || !weight}>
          {saving ? t("form.saving") : isEdit ? t("weight.edit") : t("weight.log")}
        </FormButton>
      </form>
      {onDelete && <FormDeleteButton onDelete={onDelete} />}
    </Modal>
  );
}
