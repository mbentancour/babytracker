import { useState } from "react";
import { api } from "../../api";
import Modal, { FormField, FormInput, FormButton, FormDeleteButton } from "../Modal";
import PhotoPicker from "../PhotoPicker";
import { colors } from "../../utils/colors";
import { useUnits } from "../../utils/units";

function toLocalDatetime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function TemperatureForm({ childId, entry, onDone, onClose, onDelete }) {
  const units = useUnits();
  const isEdit = !!entry;
  const [temp, setTemp] = useState(entry?.temperature ? String(entry.temperature) : "");
  const [time, setTime] = useState(
    entry?.time ? toLocalDatetime(new Date(entry.time)) : toLocalDatetime(new Date())
  );
  const [notes, setNotes] = useState(entry?.notes || "");
  const [photoFile, setPhotoFile] = useState(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!temp) return;
    setSaving(true);
    try {
      const data = { temperature: parseFloat(temp), time: `${time}:00` };
      if (notes.trim()) data.notes = notes.trim();
      let result;
      if (isEdit) {
        result = await api.updateTemperature(entry.id, data);
      } else {
        data.child = childId;
        result = await api.createTemperature(data);
      }
      if (photoFile && result?.id) {
        await api.uploadEntryPhoto("temperature", result.id, photoFile);
      }
      onDone();
    } catch {
      setSaving(false);
    }
  };

  return (
    <Modal title={isEdit ? "Edit Temperature" : "Log Temperature"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <FormField label={`Temperature (${units.temp})`}>
          <FormInput type="number" value={temp} onChange={(e) => setTemp(e.target.value)} placeholder="36.6" min="30" max="45" step="0.1" autoFocus />
        </FormField>
        <FormField label="Time">
          <FormInput type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} required />
        </FormField>
        <FormField label="Notes">
          <FormInput type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        </FormField>
        <PhotoPicker currentPhoto={entry?.photo} onPhotoSelected={setPhotoFile} />
        <FormButton color={colors.temp} disabled={saving || !temp}>
          {saving ? "Saving..." : isEdit ? "Update" : "Save Temperature"}
        </FormButton>
      </form>
      {onDelete && <FormDeleteButton onDelete={onDelete} />}
    </Modal>
  );
}
