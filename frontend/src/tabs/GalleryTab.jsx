import { useState, useEffect, useRef } from "react";
import { api } from "../api";
import { Icons } from "../components/Icons";
import { useI18n } from "../utils/i18n";

const TYPE_LABELS = {
  shared: "Shared",
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
  shared: "#0984e3",
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

export default function GalleryTab({ childId, children = [], canWrite = false }) {
  const { t } = useI18n();
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

  // progress is null when idle, { done, total } during an upload. Kept
  // separate from `uploading` booleans so the button can show "3 / 20"
  // instead of a generic spinner.
  const [progress, setProgress] = useState(null);
  const uploading = progress !== null;
  const [lightboxIndex, setLightboxIndex] = useState(null);

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

  const handleBulkUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0 || !childId) return;
    e.target.value = "";

    // Upload one file per request. The HA ingress reverse proxy imposes a
    // body-size limit on forwarded requests that large multi-file batches
    // can trip; sending files individually keeps every request small.
    // Partial failures don't abort the run — we collect them and show a
    // summary at the end.
    setProgress({ done: 0, total: files.length });
    const failed = [];
    for (let i = 0; i < files.length; i++) {
      try {
        await api.uploadPhotos(childId, [files[i]]);
      } catch (err) {
        failed.push({
          name: files[i].name,
          error: err?.error || err?.message || "upload failed",
        });
      }
      setProgress({ done: i + 1, total: files.length });
    }
    setProgress(null);
    setRefreshKey((k) => k + 1);

    if (failed.length > 0) {
      const list = failed.slice(0, 5).map((f) => `• ${f.name}: ${f.error}`).join("\n");
      const more = failed.length > 5 ? `\n…and ${failed.length - 5} more` : "";
      alert(`${files.length - failed.length} of ${files.length} uploaded.\n\nFailed:\n${list}${more}`);
    }
  };

  // Filter taxonomy:
  //   all       → everything
  //   tagged    → photos tagged to this child + their profile picture
  //   <entry>   → entry-specific photos (feeding, sleep, height, …)
  //   shared    → photos with no child tag
  const currentChild = children.find((c) => c.id === childId);
  const childName = currentChild?.first_name || "Tagged";

  const isChildTaggedType = (t) => t === "photo" || t === "profile";
  const taggedCount = items.filter((i) => isChildTaggedType(i.entity_type)).length;
  const sharedCount = items.filter((i) => i.entity_type === "shared").length;
  const entryTypeCounts = {};
  for (const i of items) {
    if (!isChildTaggedType(i.entity_type) && i.entity_type !== "shared") {
      entryTypeCounts[i.entity_type] = (entryTypeCounts[i.entity_type] || 0) + 1;
    }
  }
  const entryTypes = Object.keys(entryTypeCounts).sort();

  const filtered =
    filter === "all"
      ? items
      : filter === "tagged"
      ? items.filter((i) => isChildTaggedType(i.entity_type))
      : filter === "shared"
      ? items.filter((i) => i.entity_type === "shared")
      : items.filter((i) => i.entity_type === filter);

  // Group by date
  const grouped = {};
  for (const item of filtered) {
    const date = item.date;
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(item);
  }
  const dates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  // Flat list in display order (newest date first, then within each date) for lightbox navigation
  const flatItems = dates.flatMap((d) => grouped[d]);

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
          {uploading
            ? `${t("gallery.uploading")} (${progress.done}/${progress.total})`
            : t("gallery.addPhotos")}
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

      {/* Filter chips — ordered: All, [child], [entry types], Shared */}
      {(taggedCount + sharedCount + entryTypes.length) > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }} className="fade-in">
          <FilterChip
            active={filter === "all"}
            onClick={() => setFilter("all")}
            label={`All (${items.length})`}
          />
          {taggedCount > 0 && (
            <FilterChip
              active={filter === "tagged"}
              onClick={() => setFilter("tagged")}
              color={TYPE_COLORS.photo}
              label={`${childName} (${taggedCount})`}
            />
          )}
          {entryTypes.map((t) => (
            <FilterChip
              key={t}
              active={filter === t}
              onClick={() => setFilter(t)}
              color={TYPE_COLORS[t]}
              label={`${TYPE_LABELS[t] || t} (${entryTypeCounts[t]})`}
            />
          ))}
          {sharedCount > 0 && (
            <FilterChip
              active={filter === "shared"}
              onClick={() => setFilter("shared")}
              color={TYPE_COLORS.shared}
              label={`Shared (${sharedCount})`}
            />
          )}
        </div>
      )}

      {dates.length === 0 ? (
        <div className="fade-in" style={{ textAlign: "center", padding: 60, color: "var(--text-dim)" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>
            <Icons.Baby />
          </div>
          <div style={{ fontSize: 14 }}>{t("gallery.noPhotos")}</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>
            {t("gallery.noPhotosHint")}
          </div>
        </div>
      ) : (
        dates.map((date) => (
          // Include `filter` in the key so every date-group remounts on
          // filter change. Without this, React reuses the outer div and
          // has been leaving stale child nodes in place in some transitions
          // (e.g. Shared → Emma). Fade-in also re-triggers, which doubles
          // as a nice visual confirmation that the filter applied.
          <div key={`${filter}:${date}`} className="fade-in" style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.03em" }}>
              {new Date(date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "long", day: "numeric" })}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
              {grouped[date].map((item) => (
                <div
                  key={`${item.entity_type}-${item.id}-${item.photo}`}
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
                    src={`./api/media/photos/${item.photo}?size=thumb`}
                    alt={item.label}
                    loading="lazy"
                    onClick={() => setLightboxIndex(flatItems.indexOf(item))}
                    style={{
                      width: "100%",
                      height: 150,
                      objectFit: "cover",
                      display: "block",
                      cursor: "zoom-in",
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
                    {(item.entity_type === "shared" || item.entity_type === "photo") && children.length > 0 && canWrite && (
                      <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginTop: 4 }}>
                        {children.map((c) => {
                          const isTagged = (item.tagged_children || []).includes(c.id);
                          return (
                            <button
                              key={c.id}
                              onClick={async (e) => {
                                e.stopPropagation();
                                const current = item.tagged_children || [];
                                const next = isTagged
                                  ? current.filter((id) => id !== c.id)
                                  : [...current, c.id];
                                try {
                                  await api.tagPhoto(item.photo, next);
                                  setRefreshKey((k) => k + 1);
                                } catch { /* ignore */ }
                              }}
                              style={{
                                fontSize: 9, fontWeight: 600,
                                color: isTagged ? "white" : "var(--text-dim)",
                                background: isTagged ? "#0984e3" : "var(--bg)",
                                border: `1px solid ${isTagged ? "#0984e3" : "var(--border)"}`,
                                borderRadius: 4,
                                padding: "2px 6px", cursor: "pointer",
                                fontFamily: "inherit",
                              }}
                            >
                              {c.first_name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {lightboxIndex != null && flatItems[lightboxIndex] && (
        <Lightbox
          item={flatItems[lightboxIndex]}
          hasPrev={lightboxIndex > 0}
          hasNext={lightboxIndex < flatItems.length - 1}
          onPrev={() => setLightboxIndex((i) => Math.max(0, i - 1))}
          onNext={() => setLightboxIndex((i) => Math.min(flatItems.length - 1, i + 1))}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  );
}

function FilterChip({ active, onClick, label, color }) {
  const accent = color || "var(--border)";
  return (
    <button
      onClick={onClick}
      style={{
        padding: "5px 12px",
        borderRadius: 8,
        border: `1px solid ${active ? accent : "var(--border)"}`,
        background: active ? (color ? `${color}18` : "var(--border)") : "none",
        color: active ? (color || "var(--text)") : "var(--text-muted)",
        fontSize: 12,
        fontWeight: 500,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      {label}
    </button>
  );
}

function Lightbox({ item, hasPrev, hasNext, onPrev, onNext, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && hasPrev) onPrev();
      else if (e.key === "ArrowRight" && hasNext) onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasPrev, hasNext, onPrev, onNext, onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.92)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Close"
        style={{
          position: "absolute", top: 16, right: 16,
          background: "rgba(255,255,255,0.15)", color: "white",
          border: "none", borderRadius: "50%",
          width: 40, height: 40, fontSize: 22,
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        ×
      </button>

      {hasPrev && (
        <button
          onClick={(e) => { e.stopPropagation(); onPrev(); }}
          aria-label="Previous"
          style={{
            position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)",
            background: "rgba(255,255,255,0.15)", color: "white",
            border: "none", borderRadius: "50%",
            width: 48, height: 48, fontSize: 24,
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          ‹
        </button>
      )}

      {hasNext && (
        <button
          onClick={(e) => { e.stopPropagation(); onNext(); }}
          aria-label="Next"
          style={{
            position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)",
            background: "rgba(255,255,255,0.15)", color: "white",
            border: "none", borderRadius: "50%",
            width: 48, height: 48, fontSize: 24,
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          ›
        </button>
      )}

      <img
        src={`./api/media/photos/${item.photo}`}
        alt={item.label}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "92vw",
          maxHeight: "88vh",
          objectFit: "contain",
          borderRadius: 8,
          boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
        }}
      />

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: "rgba(0,0,0,0.6)", color: "white",
          padding: "8px 16px", borderRadius: 8,
          fontSize: 13, textAlign: "center", maxWidth: "80vw",
        }}
      >
        <div style={{ fontWeight: 600 }}>{item.label}</div>
        {item.detail && <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>{item.detail}</div>}
        <div style={{ fontSize: 10, opacity: 0.6, marginTop: 2 }}>
          {new Date(item.date + "T00:00:00").toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
        </div>
      </div>
    </div>
  );
}
