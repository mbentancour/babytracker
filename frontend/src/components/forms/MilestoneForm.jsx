import { useState } from "react";
import { api } from "../../api";
import Modal, { FormField, FormInput, FormSelect, FormButton, FormDeleteButton } from "../Modal";
import PhotoPicker from "../PhotoPicker";

const CATEGORIES = [
  { value: "motor", label: "Motor" },
  { value: "cognitive", label: "Cognitive" },
  { value: "social", label: "Social" },
  { value: "language", label: "Language" },
  { value: "other", label: "Other" },
];

export default function MilestoneForm({ childId, entry, onDone, onClose, onDelete }) {
  const isEdit = !!entry;
  const today = new Date().toISOString().slice(0, 10);
  const [title, setTitle] = useState(entry?.title || "");
  const [category, setCategory] = useState(entry?.category || "other");
  const [date, setDate] = useState(entry?.date?.slice(0, 10) || today);
  const [description, setDescription] = useState(entry?.description || "");
  const [photoFile, setPhotoFile] = useState(null);
  const [saving, setSaving] = useState(false);

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
    <Modal title={isEdit ? "Edit Milestone" : "Log Milestone"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <FormField label="Title">
          <FormInput type="text" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g. First smile, Rolled over" />
        </FormField>
        <FormField label="Category">
          <FormSelect options={CATEGORIES} value={category} onChange={(e) => setCategory(e.target.value)} />
        </FormField>
        <FormField label="Date">
          <FormInput type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </FormField>
        <FormField label="Description">
          <FormInput type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional details" />
        </FormField>
        <PhotoPicker currentPhoto={entry?.photo} onPhotoSelected={setPhotoFile} />
        <FormButton color="#00b894" disabled={saving}>
          {saving ? "Saving..." : isEdit ? "Update" : "Save"}
        </FormButton>
      </form>
      {onDelete && <FormDeleteButton onDelete={onDelete} />}
    </Modal>
  );
}
