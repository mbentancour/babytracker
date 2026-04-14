import { useState } from "react";
import { api } from "../../api";
import Modal, { FormField, FormInput, FormSelect, FormButton } from "../Modal";
import { colors } from "../../utils/colors";
import { useI18n } from "../../utils/i18n";

export default function ChildForm({ onDone, onClose }) {
  const { t } = useI18n();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [sex, setSex] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.createChild({
        first_name: firstName,
        last_name: lastName,
        birth_date: birthDate,
        sex: sex || null,
      });
      onDone();
    } catch {
      setSaving(false);
    }
  };

  return (
    <Modal title={t("onboarding.addBaby")} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <FormField label={t("onboarding.firstName")}>
          <FormInput
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
            autoFocus
          />
        </FormField>
        <FormField label={t("onboarding.lastName")}>
          <FormInput
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder={t("form.optional")}
          />
        </FormField>
        <FormField label={t("onboarding.birthDate")}>
          <FormInput
            type="date"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
            required
          />
        </FormField>
        <FormField label={t("onboarding.sex")}>
          <FormSelect
            value={sex}
            onChange={(e) => setSex(e.target.value)}
            options={[
              { value: "", label: t("onboarding.sexUnspecified") },
              { value: "male", label: t("onboarding.sexMale") },
              { value: "female", label: t("onboarding.sexFemale") },
            ]}
          />
        </FormField>
        <FormButton color={colors.feeding} disabled={saving}>
          {saving ? t("form.saving") : t("onboarding.addBabyBtn")}
        </FormButton>
      </form>
    </Modal>
  );
}
