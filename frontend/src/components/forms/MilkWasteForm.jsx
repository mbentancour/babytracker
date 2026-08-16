import { useState } from "react";
import { api } from "../../api";
import Modal, { FormField, FormInput, FormButton, FormDeleteButton } from "../Modal";
import { useUnits } from "../../utils/units";
import { colors } from "../../utils/colors";
import { useI18n } from "../../utils/i18n";
import { toLocalDatetime, localInputToUTC } from "../../utils/datetime";

// Milk that was prepared but poured away. Deliberately the simplest form in
// the app — no tags, no photo — because the row exists only so the stock
// balance can subtract it. See migration 017.
export default function MilkWasteForm({ childId, entry, onDone, onClose, onDelete }) {
  const units = useUnits();
  const { t } = useI18n();
  const isEdit = !!entry;
  const [time, setTime] = useState(
    entry?.time ? toLocalDatetime(new Date(entry.time)) : toLocalDatetime(new Date()),
  );
  const [amount, setAmount] = useState(entry?.amount != null ? String(entry.amount) : "");
  const [notes, setNotes] = useState(entry?.notes || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    // The server rejects a non-positive amount; catching it here means the
    // household sees why rather than a bare failed save.
    const parsed = parseFloat(amount);
    if (!(parsed > 0)) {
      setError(t("milkWaste.amountRequired"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const data = { time: localInputToUTC(time), amount: parsed, notes };
      if (isEdit) await api.updateMilkWaste(entry.id, data);
      else await api.createMilkWaste({ ...data, child: childId });
      onDone();
    } catch {
      setSaving(false);
      setError(t("general.saveFailed"));
    }
  };

  return (
    <Modal title={isEdit ? t("milkWaste.edit") : t("milkWaste.log")} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <FormField label={t("general.time")}>
          <FormInput
            type="datetime-local"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            required
          />
        </FormField>
        <FormField label={`${t("feeding.amount")} (${units.volume})`}>
          <FormInput
            type="number"
            value={amount}
            onChange={(e) => { setAmount(e.target.value); setError(""); }}
            min="0"
            step="5"
            required
          />
        </FormField>
        <FormField label={t("general.notes")}>
          <FormInput
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t("milkWaste.notesPlaceholder")}
            maxLength={500}
          />
        </FormField>
        {error && (
          <div style={{ color: colors.temp, fontSize: 13, marginBottom: 12 }}>{error}</div>
        )}
        <FormButton color={colors.milkWaste} disabled={saving}>
          {saving ? t("form.saving") : isEdit ? t("milkWaste.edit") : t("milkWaste.log")}
        </FormButton>
      </form>
      {onDelete && <FormDeleteButton onDelete={onDelete} />}
    </Modal>
  );
}
