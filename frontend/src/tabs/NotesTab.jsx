import { useState } from "react";
import SectionCard from "../components/SectionCard";
import AddButton from "../components/AddButton";
import TimelineItem from "../components/TimelineItem";
import { Icons } from "../components/Icons";
import { colors } from "../utils/colors";
import { toNoteTimeline } from "../utils/formatters";
import { usePreferences } from "../utils/preferences";
import { useI18n } from "../utils/i18n";

const COLLAPSED_COUNT = 5;

const MILESTONE_COLORS = {
  motor: "#e74c3c",
  cognitive: "#3498db",
  social: "#e67e22",
  language: "#9b59b6",
  other: "#95a5a6",
};

export default function NotesTab({ notes, milestones = [], medications = [], onEditEntry, onDeleteEntry, canWrite = () => true }) {
  const [expandedNotes, setExpandedNotes] = useState(false);
  const [expandedMilestones, setExpandedMilestones] = useState(false);
  const [expandedMeds, setExpandedMeds] = useState(false);
  const { t } = useI18n();
  const { isFeatureEnabled } = usePreferences();
  const noteTimeline = toNoteTimeline(notes || []);

  return (
    <>
      {/* Milestones */}
      {isFeatureEnabled("milestone") && <div className="fade-in fade-in-1" style={{ marginBottom: 16 }}>
        <SectionCard
          title={t("journal.milestones")}
          icon={<Icons.TrendUp />}
          color="#00b894"
          action={canWrite("milestone") ? <AddButton onClick={() => onEditEntry?.("milestone")} color="#00b894" label={t("action.milestone")} /> : null}
        >
          {milestones.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(expandedMilestones ? milestones : milestones.slice(0, COLLAPSED_COUNT)).map((m) => (
                <div
                  key={m.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    padding: "10px 12px",
                    borderRadius: 10,
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <div
                    style={{ cursor: "pointer", flex: 1 }}
                    onClick={() => onEditEntry?.("milestone", m)}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          color: MILESTONE_COLORS[m.category] || "#95a5a6",
                          background: `${MILESTONE_COLORS[m.category] || "#95a5a6"}18`,
                          padding: "2px 8px",
                          borderRadius: 4,
                        }}
                      >
                        {m.category}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                        {new Date(m.date).toLocaleDateString()}
                      </span>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
                      {m.title}
                    </div>
                    {m.description && (
                      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                        {m.description}
                      </div>
                    )}
                  </div>
                  {canWrite("milestone") && (
                    <button
                      className="delete-entry-btn"
                      onClick={() => onDeleteEntry?.("milestone", m.id)}
                      title="Delete"
                    >x</button>
                  )}
                </div>
              ))}
              {milestones.length > COLLAPSED_COUNT && (
                <button
                  className="expand-toggle"
                  onClick={() => setExpandedMilestones(!expandedMilestones)}
                >
                  {expandedMilestones ? t("overview.showLess") : t("overview.showMore", { count: milestones.length - COLLAPSED_COUNT })}
                </button>
              )}
            </div>
          ) : (
            <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: 40 }}>
              {t("journal.noMilestones")}
            </div>
          )}
        </SectionCard>
      </div>}

      {/* Medications */}
      {isFeatureEnabled("medication") && <div className="fade-in fade-in-2" style={{ marginBottom: 16 }}>
        <SectionCard
          title={t("journal.medications")}
          icon={<Icons.Temp />}
          color="#e67e22"
          action={canWrite("medication") ? <AddButton onClick={() => onEditEntry?.("medication")} color="#e67e22" label={t("action.medication")} /> : null}
        >
          {medications.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(expandedMeds ? medications : medications.slice(0, COLLAPSED_COUNT)).map((m) => (
                <div
                  key={m.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "10px 12px",
                    borderRadius: 10,
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <div
                    style={{ cursor: "pointer", flex: 1 }}
                    onClick={() => onEditEntry?.("medication", m)}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: "#e67e22" }}>
                        {m.name}
                      </span>
                      {m.dosage && (
                        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                          {m.dosage} {m.dosage_unit}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
                      {new Date(m.time).toLocaleString([], {
                        month: "short", day: "numeric",
                        hour: "2-digit", minute: "2-digit",
                      })}
                      {m.notes ? ` — ${m.notes}` : ""}
                    </div>
                  </div>
                  {canWrite("medication") && (
                    <button
                      className="delete-entry-btn"
                      onClick={() => onDeleteEntry?.("medication", m.id)}
                      title="Delete"
                    >x</button>
                  )}
                </div>
              ))}
              {medications.length > COLLAPSED_COUNT && (
                <button
                  className="expand-toggle"
                  onClick={() => setExpandedMeds(!expandedMeds)}
                >
                  {expandedMeds ? t("overview.showLess") : t("overview.showMore", { count: medications.length - COLLAPSED_COUNT })}
                </button>
              )}
            </div>
          ) : (
            <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: 40 }}>
              {t("journal.noMedications")}
            </div>
          )}
        </SectionCard>
      </div>}

      {/* Notes */}
      {isFeatureEnabled("note") && <div className="fade-in fade-in-3">
        <SectionCard
          title={t("journal.notes")}
          icon={<Icons.StickyNote />}
          color={colors.note}
          action={canWrite("note") ? <AddButton onClick={() => onEditEntry?.("note")} color={colors.note} label={t("action.note")} /> : null}
        >
          {noteTimeline.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {(expandedNotes ? noteTimeline : noteTimeline.slice(0, COLLAPSED_COUNT)).map((n, i, arr) => (
                <div
                  key={i}
                  style={{ display: "flex", alignItems: "center" }}
                >
                  <div
                    className="entry-clickable"
                    style={{ flex: 1 }}
                    onClick={() => onEditEntry?.("note", n.entry)}
                  >
                    <TimelineItem
                      time={n.time}
                      label={n.text}
                      detail={n.ago}
                      color={colors.note}
                      isLast={i === arr.length - 1}
                    />
                  </div>
                  {canWrite("note") && (
                    <button
                      className="delete-entry-btn"
                      onClick={() => onDeleteEntry?.("note", n.entry?.id)}
                      title="Delete"
                    >x</button>
                  )}
                </div>
              ))}
              {noteTimeline.length > COLLAPSED_COUNT && (
                <button
                  className="expand-toggle"
                  onClick={() => setExpandedNotes(!expandedNotes)}
                >
                  {expandedNotes ? t("overview.showLess") : t("overview.showMore", { count: noteTimeline.length - COLLAPSED_COUNT })}
                </button>
              )}
            </div>
          ) : (
            <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: 40 }}>
              {t("journal.noNotes")}
            </div>
          )}
        </SectionCard>
      </div>}
    </>
  );
}
