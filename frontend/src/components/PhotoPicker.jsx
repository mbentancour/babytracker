import { useState } from "react";
import { Icons } from "./Icons";
import { useI18n } from "../utils/i18n";

export default function PhotoPicker({ currentPhoto, onPhotoSelected }) {
  const { t } = useI18n();
  const [preview, setPreview] = useState(() => {
    if (!currentPhoto) return null;
    if (currentPhoto.startsWith("./api/") || currentPhoto.startsWith("/api/") || currentPhoto.startsWith("http") || currentPhoto.startsWith("data:")) {
      return currentPhoto;
    }
    return `./api/media/photos/${currentPhoto}`;
  });

  const handleChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setPreview(ev.target.result);
    reader.readAsDataURL(file);
    onPhotoSelected(file);
    e.target.value = "";
  };

  const handleRemove = () => {
    setPreview(null);
    onPhotoSelected(null);
  };

  return (
    <div style={{ marginBottom: 14 }}>
      <label
        style={{
          display: "block",
          fontSize: 12,
          fontWeight: 500,
          color: "var(--text-muted)",
          marginBottom: 6,
          textTransform: "uppercase",
          letterSpacing: "0.03em",
        }}
      >
        {t("photo.label")}
      </label>

      {preview ? (
        <div style={{ position: "relative" }}>
          {/* Clicking the image opens file picker to replace */}
          <label style={{ cursor: "pointer", display: "block" }}>
            <img
              src={preview}
              alt="Preview"
              style={{
                width: "100%",
                maxHeight: 200,
                objectFit: "cover",
                borderRadius: 10,
                border: "1px solid var(--border)",
              }}
            />
            <div style={{
              position: "absolute", bottom: 0, left: 0, right: 0,
              background: "linear-gradient(transparent, rgba(0,0,0,0.6))",
              borderRadius: "0 0 10px 10px",
              padding: "16px 12px 8px",
              textAlign: "center",
              color: "rgba(255,255,255,0.8)",
              fontSize: 12,
            }}>
              {t("photo.change")}
            </div>
            <input
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleChange}
            />
          </label>
          <button
            type="button"
            onClick={handleRemove}
            title="Remove photo"
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              background: "rgba(0,0,0,0.6)",
              border: "none",
              borderRadius: "50%",
              width: 24,
              height: 24,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: "white",
            }}
          >
            <Icons.X />
          </button>
        </div>
      ) : (
        <label
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "16px",
            borderRadius: 10,
            border: "1px dashed var(--border)",
            background: "var(--bg)",
            color: "var(--text-dim)",
            fontSize: 13,
            cursor: "pointer",
            transition: "border-color 0.2s",
          }}
        >
          <Icons.Plus />
          {t("photo.add")}
          <input
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleChange}
          />
        </label>
      )}
    </div>
  );
}
