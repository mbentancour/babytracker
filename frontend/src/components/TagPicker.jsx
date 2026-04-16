import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useI18n } from "../utils/i18n";

// Palette for newly-created tags. Users can change the color in Settings →
// Data → Tags afterwards. Kept small on purpose — decision fatigue otherwise.
const TAG_COLORS = [
  "#e67e22", "#e74c3c", "#6C5CE7", "#3498db",
  "#1abc9c", "#00b894", "#f1c40f", "#95a5a6",
];

/**
 * Multi-select tag picker. Shows currently-selected tags as colored chips,
 * with an "+ Add tag" dropdown that lists existing tags and offers inline
 * creation of a new one.
 *
 * Uncontrolled from the integration point of view: parent passes `value` (a
 * list of tag IDs) and `onChange` which receives the new list. Tag CRUD goes
 * straight to the API — the picker re-fetches the global list whenever a tag
 * is created.
 */
export default function TagPicker({ value = [], onChange, disabled = false }) {
  const { t } = useI18n();
  const [allTags, setAllTags] = useState([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[0]);

  useEffect(() => {
    api.getTags().then((r) => setAllTags(r.results || [])).catch(() => {});
  }, []);

  const tagsById = useMemo(() => {
    const m = {};
    for (const t of allTags) m[t.id] = t;
    return m;
  }, [allTags]);

  const selected = value.map((id) => tagsById[id]).filter(Boolean);
  const selectedSet = new Set(value);

  // Existing tags matching the query, excluding already-selected ones.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allTags
      .filter((t) => !selectedSet.has(t.id))
      .filter((t) => !q || t.name.toLowerCase().includes(q));
  }, [allTags, query, selectedSet]);

  // Exact-name match is what decides whether the "Create" affordance shows.
  const canCreate =
    query.trim().length > 0 &&
    !allTags.some((t) => t.name.toLowerCase() === query.trim().toLowerCase());

  const addExisting = (tag) => {
    onChange([...value, tag.id]);
    setQuery("");
  };

  const createAndAdd = async () => {
    const name = query.trim();
    if (!name) return;
    try {
      const created = await api.createTag({ name, color: newTagColor });
      setAllTags((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      onChange([...value, created.id]);
      setQuery("");
    } catch {
      // Silent — the backend returns 409 on duplicate name, which shouldn't
      // happen given the canCreate guard, but don't want to crash the form.
    }
  };

  const remove = (id) => {
    onChange(value.filter((x) => x !== id));
  };

  return (
    <div>
      {/* Selected tags as chips */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, minHeight: 28 }}>
        {selected.map((tag) => (
          <span
            key={tag.id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "3px 10px",
              borderRadius: 12,
              background: `${tag.color}20`,
              color: tag.color,
              fontSize: 12,
              fontWeight: 500,
              border: `1px solid ${tag.color}40`,
            }}
          >
            {tag.name}
            {!disabled && (
              <button
                type="button"
                onClick={() => remove(tag.id)}
                aria-label="Remove tag"
                style={{
                  background: "none",
                  border: "none",
                  color: tag.color,
                  cursor: "pointer",
                  fontSize: 14,
                  padding: 0,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {!disabled && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            style={{
              padding: "3px 10px",
              borderRadius: 12,
              background: "var(--bg)",
              color: "var(--text-dim)",
              fontSize: 12,
              border: "1px dashed var(--border)",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {open ? "−" : "+"} {t("tags.addTag")}
          </button>
        )}
      </div>

      {/* Expandable picker panel */}
      {open && !disabled && (
        <div
          style={{
            marginTop: 8,
            padding: 10,
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--card-bg)",
          }}
        >
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("tags.searchOrCreate")}
            autoFocus
            style={{
              width: "100%",
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text)",
              fontSize: 13,
              fontFamily: "inherit",
            }}
          />

          {/* Existing matches */}
          {matches.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {matches.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => addExisting(tag)}
                  style={{
                    padding: "3px 10px",
                    borderRadius: 12,
                    background: `${tag.color}20`,
                    color: tag.color,
                    fontSize: 12,
                    fontWeight: 500,
                    border: `1px solid ${tag.color}40`,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  + {tag.name}
                </button>
              ))}
            </div>
          )}

          {/* Create new tag affordance — shown ONLY on an exact-name miss to
              nudge users toward reusing existing tags rather than spawning
              near-duplicates ("Teething" vs "teething"). */}
          {canCreate && (
            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
                {t("tags.createNew")}
              </span>
              <div style={{ display: "flex", gap: 4 }}>
                {TAG_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setNewTagColor(c)}
                    aria-label={`Pick color ${c}`}
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      background: c,
                      border: newTagColor === c ? "2px solid var(--text)" : "2px solid transparent",
                      cursor: "pointer",
                      padding: 0,
                    }}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={createAndAdd}
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  background: newTagColor,
                  color: "white",
                  fontSize: 12,
                  fontWeight: 500,
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  marginLeft: "auto",
                }}
              >
                {t("tags.create")} "{query.trim()}"
              </button>
            </div>
          )}

          {/* Empty state — query is empty, everything is already picked */}
          {!canCreate && matches.length === 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-dim)", textAlign: "center" }}>
              {query ? t("tags.noMatches") : t("tags.allUsed")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
