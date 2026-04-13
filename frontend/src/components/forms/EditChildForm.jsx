import { useState } from "react";
import { api } from "../../api";
import Modal, { FormField, FormInput, FormButton, FormDeleteButton } from "../Modal";
import PhotoPicker from "../PhotoPicker";
import { colors } from "../../utils/colors";

function toLocalDate(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function EditChildForm({ child, onDone, onClose, onDelete }) {
  const [firstName, setFirstName] = useState(child.first_name || "");
  const [lastName, setLastName] = useState(child.last_name || "");
  const [birthDate, setBirthDate] = useState(child.birth_date ? toLocalDate(child.birth_date) : "");
  const [photoFile, setPhotoFile] = useState(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.updateChild(child.id, {
        first_name: firstName,
        last_name: lastName,
        birth_date: birthDate,
      });
      if (photoFile) {
        await api.uploadChildPhoto(child.id, photoFile);
      }
      onDone();
    } catch {
      setSaving(false);
    }
  };

  return (
    <Modal title="Edit Baby" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <FormField label="First Name">
          <FormInput type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} required autoFocus />
        </FormField>
        <FormField label="Last Name">
          <FormInput type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Optional" />
        </FormField>
        <FormField label="Birth Date">
          <FormInput type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} required />
        </FormField>
        <PhotoPicker currentPhoto={child.picture} onPhotoSelected={setPhotoFile} />
        <FormButton color={colors.feeding} disabled={saving}>
          {saving ? "Saving..." : "Update"}
        </FormButton>
      </form>
      {onDelete && <FormDeleteButton onDelete={onDelete} />}
    </Modal>
  );
}
