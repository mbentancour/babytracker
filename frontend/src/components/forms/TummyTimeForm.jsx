import { useEffect, useState } from "react";
import { api } from "../../api";
import Modal, { FormField, FormInput, FormButton, FormDeleteButton } from "../Modal";
import TagPicker from "../TagPicker";
import PhotoPicker from "../PhotoPicker";
import { colors } from "../../utils/colors";
import { useI18n } from "../../utils/i18n";

function toLocalDatetime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function TummyTimeForm({ childId, timerId, entry, onDone, onClose, onDelete }) {
  const { t } = useI18n();
  const isEdit = !!entry;
  const now = new Date();
  const tenMinsAgo = new Date(now.getTime() - 10 * 60 * 1000);
  const [milestone, setMilestone] = useState(entry?.milestone || "");
  const [start, setStart] = useState(entry?.start ? toLocalDatetime(new Date(entry.start)) : toLocalDatetime(tenMinsAgo));
  const [end, setEnd] = useState(entry?.end ? toLocalDatetime(new Date(entry.end)) : toLocalDatetime(now));
  const [photoFile, setPhotoFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [tagIds, setTagIds] = useState([]);
  // Load existing tags when editing an entry so the picker starts pre-populated.
  useEffect(() => {
    if (!entry?.id) return;
    api.getEntityTags("tummy_time", entry.id)
      .then((tags) => setTagIds((tags || []).map((t) => t.id)))
      .catch(() => {});
  }, [entry?.id]);


  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      let result;
      if (isEdit) {
        const data = { start: `${start}:00`, end: `${end}:00` };
        if (milestone.trim()) data.milestone = milestone.trim();
        result = await api.updateTummyTime(entry.id, data);
      } else {
        const data = { child: childId };
        if (timerId) {
          data.timer = timerId;
        } else {
          data.start = `${start}:00`;
          data.end = `${end}:00`;
        }
        if (milestone.trim()) data.milestone = milestone.trim();
        result = await api.createTummyTime(data);
      }
      const entryId = result?.id || entry?.id;
      if (photoFile && entryId) {
        await api.uploadEntryPhoto("tummy-times", entryId, photoFile);
      }
      if (entryId) await api.setEntityTags("tummy_time", entryId, tagIds);
      onDone();
    } catch {
      setSaving(false);
    }
  };

  return (
    <Modal title={isEdit ? t("tummy.edit") : t("tummy.log")} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {!isEdit && timerId ? (
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
            The timer's start and end times will be used for this tummy time entry.
          </p>
        ) : null}
        {(isEdit || !timerId) && (
          <>
            <FormField label={t("general.start")}>
              <FormInput
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                required
              />
            </FormField>
            <FormField label={t("general.end")}>
              <FormInput
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                required
              />
            </FormField>
          </>
        )}
        <FormField label={`${t("milestone.title")} (${t("form.optional").toLowerCase()})`}>
          <FormInput
            value={milestone}
            onChange={(e) => setMilestone(e.target.value)}
            placeholder="e.g., Lifted head"
          />
        </FormField>
        <FormField label={t("tags.title")}>
          <TagPicker value={tagIds} onChange={setTagIds} />
        </FormField>
        <PhotoPicker currentPhoto={entry?.photo} onPhotoSelected={setPhotoFile} />
        <FormButton color={colors.tummy} disabled={saving}>
          {saving ? t("form.saving") : isEdit ? t("tummy.edit") : t("tummy.log")}
        </FormButton>
      </form>
      {onDelete && <FormDeleteButton onDelete={onDelete} />}
    </Modal>
  );
}
