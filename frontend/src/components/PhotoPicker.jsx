import { useState } from "react";
import { Icons } from "./Icons";

export default function PhotoPicker({ currentPhoto, onPhotoSelected }) {
  const [preview, setPreview] = useState(
    currentPhoto ? `./api/media/photos/${currentPhoto}` : null
  );

  const handleChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Show local preview immediately
    const reader = new FileReader();
    reader.onload = (ev) => setPreview(ev.target.result);
    reader.readAsDataURL(file);

    onPhotoSelected(file);
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
        Photo
      </label>

      {preview ? (
        <div style={{ position: "relative", display: "inline-block" }}>
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
          <button
            type="button"
            onClick={handleRemove}
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
          Add photo
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
