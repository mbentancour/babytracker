/**
 * Read-only display of an entity's tags as small colored chips. Used in
 * list views (Journal, Overview, Notes tab) to show at a glance what's
 * been tagged. Accepts either a tag-object array or, more commonly, a tag-
 * ID list plus a `tagsById` map loaded once by the parent tab.
 */
export default function TagChips({ tags, tagIds, tagsById, size = "sm" }) {
  // Normalise inputs. Prefer explicit `tags` prop; fall back to ID list.
  const resolved = tags ?? (tagIds || []).map((id) => tagsById?.[id]).filter(Boolean);
  if (!resolved.length) return null;

  const fontSize = size === "sm" ? 10 : 12;
  const padding = size === "sm" ? "1px 6px" : "3px 10px";

  return (
    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap", marginLeft: 6 }}>
      {resolved.map((tag) => (
        <span
          key={tag.id}
          style={{
            display: "inline-block",
            padding,
            borderRadius: 8,
            background: `${tag.color}22`,
            color: tag.color,
            fontSize,
            fontWeight: 500,
            lineHeight: 1.3,
          }}
        >
          {tag.name}
        </span>
      ))}
    </span>
  );
}
