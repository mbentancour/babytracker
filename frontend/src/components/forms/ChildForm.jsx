import { useState } from "react";
import { api } from "../../api";
import Modal, { FormField, FormInput, FormButton } from "../Modal";
import { colors } from "../../utils/colors";

export default function ChildForm({ onDone, onClose }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.createChild({
        first_name: firstName,
        last_name: lastName,
        birth_date: birthDate,
      });
      onDone();
    } catch {
      setSaving(false);
    }
  };

  return (
    <Modal title="Add Baby" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <FormField label="First Name">
          <FormInput
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
            autoFocus
          />
        </FormField>
        <FormField label="Last Name">
          <FormInput
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Optional"
          />
        </FormField>
        <FormField label="Birth Date">
          <FormInput
            type="date"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
            required
          />
        </FormField>
        <FormButton color={colors.feeding} disabled={saving}>
          {saving ? "Adding..." : "Add Baby"}
        </FormButton>
      </form>
    </Modal>
  );
}
