import { useEffect, useState } from "react";
import { api } from "../../api";
import Modal, { FormField, FormInput, FormSelect, FormButton, FormDeleteButton } from "../Modal";
import TagPicker from "../TagPicker";
import PhotoPicker from "../PhotoPicker";
import { useI18n } from "../../utils/i18n";

export default function MilestoneForm({ childId, entry, onDone, onClose, onDelete }) {
  const { t } = useI18n();
  const isEdit = !!entry;

  const CATEGORIES = [
    { value: "motor", label: t("milestone.motor") },
    { value: "cognitive", label: t("milestone.cognitive") },
    { value: "social", label: t("milestone.social") },
    { value: "language", label: t("milestone.language") },
    { value: "other", label: t("milestone.other") },
  ];

  const today = new Date().toISOString().slice(0, 10);
  const [title, setTitle] = useState(entry?.title || "");
  const [category, setCategory] = useState(entry?.category || "other");
  const [date, setDate] = useState(entry?.date?.slice(0, 10) || today);
  const [description, setDescription] = useState(entry?.description || "");
  const [photoFile, setPhotoFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [tagIds, setTagIds] = useState([]);
  // Load existing tags when editing an entry so the picker starts pre-populated.
  useEffect(() => {
    if (!entry?.id) return;
    api.getEntityTags("milestone", entry.id)
      .then((tags) => setTagIds((tags || []).map((t) => t.id)))
      .catch(() => {});
  }, [entry?.id]);


  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data = { title, category, date };
      if (description.trim()) data.description = description.trim();
      let result;
      if (isEdit) {
        result = await api.updateMilestone(entry.id, data);
      } else {
        data.child = childId;
        result = await api.createMilestone(data);
      }
      if (photoFile && result?.id) {
        await api.uploadEntryPhoto("milestones", result.id, photoFile);
      }
      onDone();
    } catch {
      setSaving(false);
    }
  };

  return (
    <Modal title={isEdit ? t("milestone.edit") : t("milestone.log")} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <FormField label={t("milestone.title")}>
          <FormInput type="text" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g. First smile, Rolled over" />
        </FormField>
        <FormField label={t("milestone.category")}>
          <FormSelect options={CATEGORIES} value={category} onChange={(e) => setCategory(e.target.value)} />
        </FormField>
        <FormField label={t("general.date")}>
          <FormInput type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </FormField>
        <FormField label={t("milestone.description")}>
          <FormInput type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("form.optional")} />
        </FormField>
        <FormField label={t("tags.title")}>
          <TagPicker value={tagIds} onChange={setTagIds} />
        </FormField>
        <PhotoPicker currentPhoto={entry?.photo} onPhotoSelected={setPhotoFile} />
        <FormButton color="#00b894" disabled={saving}>
          {saving ? t("form.saving") : isEdit ? t("milestone.edit") : t("milestone.log")}
        </FormButton>
      </form>
      {onDelete && <FormDeleteButton onDelete={onDelete} />}
    </Modal>
  );
}
