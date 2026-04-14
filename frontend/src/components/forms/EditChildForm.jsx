import { useState, useEffect } from "react";
import { api } from "../../api";
import Modal, { FormField, FormInput, FormSelect, FormButton, FormDeleteButton } from "../Modal";
import PhotoPicker from "../PhotoPicker";
import { colors } from "../../utils/colors";
import { useI18n } from "../../utils/i18n";

function toLocalDate(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function EditChildForm({ child, onDone, onClose, onDelete }) {
  const { t } = useI18n();
  const [firstName, setFirstName] = useState(child.first_name || "");
  const [lastName, setLastName] = useState(child.last_name || "");
  const [birthDate, setBirthDate] = useState(child.birth_date ? toLocalDate(child.birth_date) : "");
  const [sex, setSex] = useState(child.sex || "");
  const [photoFile, setPhotoFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showGalleryPicker, setShowGalleryPicker] = useState(false);
  const [galleryPhotos, setGalleryPhotos] = useState([]);

  useEffect(() => {
    if (showGalleryPicker && child.id) {
      api.getGallery({ child: child.id })
        .then((res) => setGalleryPhotos(res.results || []))
        .catch(() => {});
    }
  }, [showGalleryPicker, child.id]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.updateChild(child.id, {
        first_name: firstName,
        last_name: lastName,
        birth_date: birthDate,
        sex: sex || null,
      });
      if (photoFile) {
        await api.uploadChildPhoto(child.id, photoFile);
      }
      onDone();
    } catch {
      setSaving(false);
    }
  };

  const handlePickFromGallery = async (filename) => {
    setSaving(true);
    try {
      await api.updateChild(child.id, {
        first_name: firstName,
        last_name: lastName,
        birth_date: birthDate,
        sex: sex || null,
      });
      await api.setChildPhotoFromFilename(child.id, filename);
      onDone();
    } catch {
      setSaving(false);
    }
  };

  return (
    <Modal title={t("onboarding.addBaby")} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <FormField label={t("onboarding.firstName")}>
          <FormInput type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} required autoFocus />
        </FormField>
        <FormField label={t("onboarding.lastName")}>
          <FormInput type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder={t("form.optional")} />
        </FormField>
        <FormField label={t("onboarding.birthDate")}>
          <FormInput type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} required />
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

        {showGalleryPicker ? (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                Pick from Gallery
              </label>
              <button
                type="button"
                onClick={() => setShowGalleryPicker(false)}
                style={{ fontSize: 12, color: "var(--text-dim)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}
              >
                Upload new instead
              </button>
            </div>
            {galleryPhotos.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, maxHeight: 200, overflowY: "auto" }}>
                {galleryPhotos.map((p) => (
                  <button
                    key={`${p.entity_type}-${p.id}`}
                    type="button"
                    onClick={() => handlePickFromGallery(p.photo)}
                    disabled={saving}
                    style={{
                      padding: 0, border: "2px solid var(--border)", borderRadius: 8,
                      overflow: "hidden", cursor: "pointer", background: "none",
                      transition: "border-color 0.2s",
                    }}
                    onMouseOver={(e) => e.currentTarget.style.borderColor = colors.feeding}
                    onMouseOut={(e) => e.currentTarget.style.borderColor = "var(--border)"}
                  >
                    <img
                      src={`./api/media/photos/${p.photo}?size=thumb`}
                      alt={p.label}
                      loading="lazy"
                      style={{ width: "100%", height: 70, objectFit: "cover", display: "block" }}
                    />
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: 20 }}>
                No photos in gallery yet
              </div>
            )}
          </div>
        ) : (
          <div>
            <PhotoPicker currentPhoto={child.picture} onPhotoSelected={setPhotoFile} />
            <button
              type="button"
              onClick={() => setShowGalleryPicker(true)}
              style={{ fontSize: 12, color: "#6C5CE7", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: "4px 0", marginBottom: 14 }}
            >
              Or pick from existing photos
            </button>
          </div>
        )}

        {!showGalleryPicker && (
          <FormButton color={colors.feeding} disabled={saving}>
            {saving ? t("form.saving") : t("form.update")}
          </FormButton>
        )}
      </form>
      {onDelete && <FormDeleteButton onDelete={onDelete} />}
    </Modal>
  );
}
