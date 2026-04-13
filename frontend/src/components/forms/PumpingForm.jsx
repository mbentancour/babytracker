import { useState } from "react";
import { api } from "../../api";
import Modal, { FormField, FormInput, FormButton, FormDeleteButton } from "../Modal";
import PhotoPicker from "../PhotoPicker";
import { useUnits } from "../../utils/units";

function toLocalDatetime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function PumpingForm({ childId, entry, onDone, onClose, onDelete }) {
  const units = useUnits();
  const isEdit = !!entry;
  const now = new Date();
  const fifteenMinsAgo = new Date(now.getTime() - 15 * 60 * 1000);
  const [start, setStart] = useState(entry?.start ? toLocalDatetime(new Date(entry.start)) : toLocalDatetime(fifteenMinsAgo));
  const [end, setEnd] = useState(entry?.end ? toLocalDatetime(new Date(entry.end)) : toLocalDatetime(now));
  const [amount, setAmount] = useState(entry?.amount != null ? String(entry.amount) : "");
  const [photoFile, setPhotoFile] = useState(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data = {
        start: `${start}:00`,
        end: `${end}:00`,
      };
      if (amount) data.amount = parseFloat(amount);
      let result;
      if (isEdit) {
        result = await api.updatePumping?.(entry.id, data);
      } else {
        data.child = childId;
        result = await api.createPumping(data);
      }
      if (photoFile && result?.id) {
        await api.uploadEntryPhoto("pumping", result.id, photoFile);
      }
      onDone();
    } catch {
      setSaving(false);
    }
  };

  return (
    <Modal title={isEdit ? "Edit Pumping" : "Log Pumping"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <FormField label="Start">
          <FormInput type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
        </FormField>
        <FormField label="End">
          <FormInput type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required />
        </FormField>
        <FormField label={`Amount (${units.volume})`}>
          <FormInput type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Optional" min="0" step="5" />
        </FormField>
        <PhotoPicker currentPhoto={entry?.photo} onPhotoSelected={setPhotoFile} />
        <FormButton color="#6C5CE7" disabled={saving}>
          {saving ? "Saving..." : isEdit ? "Update" : "Save Pumping"}
        </FormButton>
      </form>
      {onDelete && <FormDeleteButton onDelete={onDelete} />}
    </Modal>
  );
}
