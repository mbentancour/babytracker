import { useState, useEffect, useRef } from "react";
import { api } from "../api";
import SectionCard from "../components/SectionCard";
import { Icons } from "../components/Icons";

const TYPE_LABELS = {
  photo: "Photo",
  profile: "Profile",
  weight: "Weight",
  height: "Height",
  head_circumference: "Head Circ.",
  milestone: "Milestone",
  temperature: "Temperature",
  medication: "Medication",
  feeding: "Feeding",
  sleep: "Sleep",
  tummy_time: "Tummy Time",
  diaper: "Diaper",
  note: "Note",
};

const TYPE_COLORS = {
  photo: "#636e72",
  profile: "#2d3436",
  weight: "#6C5CE7",
  height: "#00b894",
  head_circumference: "#6C5CE7",
  milestone: "#00b894",
  temperature: "#e74c3c",
  medication: "#e67e22",
  feeding: "#F59E0B",
  sleep: "#6366F1",
  tummy_time: "#F97316",
  diaper: "#3B82F6",
  note: "#8B5CF6",
};

// Map gallery entity_type back to API route path for photo delete
const TYPE_API_PATH = {
  profile: "children",
  weight: "weight",
  height: "height",
  head_circumference: "head-circumference",
  milestone: "milestones",
  temperature: "temperature",
  medication: "medications",
  feeding: "feedings",
  sleep: "sleep",
  tummy_time: "tummy-times",
  diaper: "changes",
  note: "notes",
};

export default function GalleryTab({ childId, canWrite = false }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  const [refreshKey, setRefreshKey] = useState(0);

  // Only show loading spinner on first load or child switch
  const hasLoaded = useRef(false);

  useEffect(() => {
    if (!childId) return;
    if (!hasLoaded.current) setLoading(true);
    api.getGallery({ child: childId })
      .then((res) => setItems(res.results || []))
      .catch(() => setItems([]))
      .finally(() => {
        setLoading(false);
        hasLoaded.current = true;
      });
  }, [childId, refreshKey]);

  const [uploading, setUploading] = useState(false);

  const handleDeletePhoto = async (item) => {
    if (!confirm(`Remove this ${TYPE_LABELS[item.entity_type] || ""} photo?`)) return;
    try {
      if (item.entity_type === "photo") {
        // Standalone photo — delete the whole record
        await api.deleteStandalonePhoto(item.id);
      } else {
        // Entry photo — just clear the photo field
        const apiPath = TYPE_API_PATH[item.entity_type];
        if (!apiPath) return;
        await api.deleteEntryPhoto(apiPath, item.id);
      }
      setRefreshKey((k) => k + 1);
    } catch {
      alert("Failed to remove photo");
    }
  };

  const MAX_BATCH = 20;

  const handleBulkUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0 || !childId) return;
    e.target.value = "";
    setUploading(true);

    try {
      // Upload in batches to avoid overwhelming the server
      let totalUploaded = 0;
      for (let i = 0; i < files.length; i += MAX_BATCH) {
        const batch = files.slice(i, i + MAX_BATCH);
        const result = await api.uploadPhotos(childId, batch);
        totalUploaded += result.uploaded || 0;
      }
      setRefreshKey((k) => k + 1);
    } catch (err) {
      const msg = err?.error || err?.message || "Upload failed";
      alert(`Upload error: ${msg}`);
      // Still refresh in case some photos were uploaded before the error
      setRefreshKey((k) => k + 1);
    }
    setUploading(false);
  };

  const types = [...new Set(items.map((i) => i.entity_type))];
  const filtered = filter === "all" ? items : items.filter((i) => i.entity_type === filter);

  // Group by date
  const grouped = {};
  for (const item of filtered) {
    const date = item.date;
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(item);
  }
  const dates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 40, color: "var(--text-dim)" }}>
        Loading photos...
      </div>
    );
  }

  return (
    <>
      {/* Upload button */}
      {canWrite && <div className="fade-in" style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <label
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "8px 16px", borderRadius: 10,
            border: "1px solid var(--border)", background: "var(--card-bg)",
            color: "var(--text-muted)", fontSize: 13, fontWeight: 500,
            cursor: uploading ? "not-allowed" : "pointer", fontFamily: "inherit",
            opacity: uploading ? 0.6 : 1,
          }}
        >
          <Icons.Plus />
          {uploading ? "Uploading..." : "Add Photos"}
          <input
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={handleBulkUpload}
            disabled={uploading}
          />
        </label>
      </div>}

      {/* Filter chips */}
      {types.length > 1 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }} className="fade-in">
          <button
            onClick={() => setFilter("all")}
            style={{
              padding: "5px 12px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: filter === "all" ? "var(--border)" : "none",
              color: filter === "all" ? "var(--text)" : "var(--text-muted)",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            All ({items.length})
          </button>
          {types.map((t) => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              style={{
                padding: "5px 12px",
                borderRadius: 8,
                border: `1px solid ${filter === t ? TYPE_COLORS[t] || "var(--border)" : "var(--border)"}`,
                background: filter === t ? `${TYPE_COLORS[t]}18` : "none",
                color: filter === t ? TYPE_COLORS[t] : "var(--text-muted)",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {TYPE_LABELS[t] || t} ({items.filter((i) => i.entity_type === t).length})
            </button>
          ))}
        </div>
      )}

      {dates.length === 0 ? (
        <div className="fade-in" style={{ textAlign: "center", padding: 60, color: "var(--text-dim)" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>
            <Icons.Baby />
          </div>
          <div style={{ fontSize: 14 }}>No photos yet</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>
            Add photos when logging measurements or milestones
          </div>
        </div>
      ) : (
        dates.map((date) => (
          <div key={date} className="fade-in" style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.03em" }}>
              {new Date(date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "long", day: "numeric" })}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
              {grouped[date].map((item) => (
                <div
                  key={`${item.entity_type}-${item.id}`}
                  style={{
                    borderRadius: 12,
                    overflow: "hidden",
                    border: "1px solid var(--border)",
                    background: "var(--card-bg)",
                    position: "relative",
                  }}
                >
                  {canWrite && (
                    <button
                      className="delete-entry-btn"
                      onClick={() => handleDeletePhoto(item)}
                      title="Remove photo"
                      style={{
                        position: "absolute",
                        top: 6,
                        right: 6,
                        background: "rgba(0,0,0,0.6)",
                        color: "white",
                        borderRadius: "50%",
                        width: 24,
                        height: 24,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: 0.7,
                        zIndex: 1,
                      }}
                    >
                      x
                    </button>
                  )}
                  <img
                    src={`./api/media/photos/${item.photo}`}
                    alt={item.label}
                    style={{
                      width: "100%",
                      height: 150,
                      objectFit: "cover",
                      display: "block",
                    }}
                  />
                  <div style={{ padding: "8px 10px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 600,
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          color: TYPE_COLORS[item.entity_type] || "var(--text-muted)",
                          background: `${TYPE_COLORS[item.entity_type] || "#666"}18`,
                          padding: "2px 6px",
                          borderRadius: 4,
                        }}
                      >
                        {TYPE_LABELS[item.entity_type] || item.entity_type}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                      {item.label}
                    </div>
                    {item.detail && (
                      <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
                        {item.detail}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </>
  );
}
