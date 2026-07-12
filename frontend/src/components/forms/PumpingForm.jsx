import { useEffect, useState } from "react";
import { api } from "../../api";
import Modal, { FormField, FormInput, FormButton, FormDeleteButton } from "../Modal";
import TagPicker from "../TagPicker";
import PhotoPicker from "../PhotoPicker";
import { useUnits } from "../../utils/units";
import { colors } from "../../utils/colors";
import { useI18n } from "../../utils/i18n";
import { toLocalDatetime, localInputToUTC } from "../../utils/datetime";

export default function PumpingForm({ childId, entry, onDone, onClose, onDelete }) {
  const units = useUnits();
  const { t } = useI18n();
  const isEdit = !!entry;
  const now = new Date();
  const fifteenMinsAgo = new Date(now.getTime() - 15 * 60 * 1000);
  const [start, setStart] = useState(entry?.start ? toLocalDatetime(new Date(entry.start)) : toLocalDatetime(fifteenMinsAgo));
  const [end, setEnd] = useState(entry?.end ? toLocalDatetime(new Date(entry.end)) : toLocalDatetime(now));
  const [amount, setAmount] = useState(entry?.amount != null ? String(entry.amount) : "");
  const [photoFile, setPhotoFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [tagIds, setTagIds] = useState([]);
  // Load existing tags when editing an entry so the picker starts pre-populated.
  useEffect(() => {
    if (!entry?.id) return;
    api.getEntityTags("pumping", entry.id)
      .then((tags) => setTagIds((tags || []).map((t) => t.id)))
      .catch(() => {});
  }, [entry?.id]);


  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data = {
        start: localInputToUTC(start),
        end: localInputToUTC(end),
      };
      let result;
      if (isEdit) {
        // Always send amount so clearing the field clears the value.
        data.amount = amount ? parseFloat(amount) : null;
        result = await api.updatePumping(entry.id, data);
      } else {
        if (amount) data.amount = parseFloat(amount);
        data.child = childId;
        result = await api.createPumping(data);
      }
      const entryId = result?.id || entry?.id;
      if (photoFile && entryId) {
        try { await api.uploadEntryPhoto("pumping", entryId, photoFile); }
        catch (err) { console.error("photo upload failed", err); }
      }
      if (entryId) {
        try { await api.setEntityTags("pumping", entryId, tagIds); }
        catch (err) { console.error("tag set failed", err); }
      }
      onDone();
    } catch {
      setSaving(false);
    }
  };

  return (
    <Modal title={isEdit ? t("pumping.edit") : t("pumping.log")} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <FormField label={t("general.start")}>
          <FormInput type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
        </FormField>
        <FormField label={t("general.end")}>
          <FormInput type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required />
        </FormField>
        <FormField label={`${t("feeding.amount")} (${units.volume})`}>
          <FormInput type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={t("form.optional")} min="0" step="5" />
        </FormField>
        <FormField label={t("tags.title")}>
          <TagPicker value={tagIds} onChange={setTagIds} />
        </FormField>
        <PhotoPicker currentPhoto={entry?.photo} onPhotoSelected={setPhotoFile} />
        <FormButton color={colors.pumping} disabled={saving}>
          {saving ? t("form.saving") : isEdit ? t("pumping.edit") : t("pumping.log")}
        </FormButton>
      </form>
      {onDelete && <FormDeleteButton onDelete={onDelete} />}
    </Modal>
  );
}
