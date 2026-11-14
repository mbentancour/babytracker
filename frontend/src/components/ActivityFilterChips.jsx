import { useI18n } from "../utils/i18n";

// Toggle chips for choosing which activity types a view shows. A chip that is
// on means the type is visible. The caller owns the persisted hidden list.
export default function ActivityFilterChips({ activities, hidden, onToggle, label }) {
  const { t } = useI18n();
  return (
    <div className="routine-filters" role="group" aria-label={label}>
      {activities.map((a) => {
        const on = !hidden.includes(a.id);
        return (
          <button
            key={a.id}
            className={`routine-filter${on ? " routine-filter-on" : ""}`}
            style={on ? { "--routine-accent": a.color } : undefined}
            onClick={() => onToggle(a.id)}
            aria-pressed={on}
          >
            {a.icon}
            {t(a.labelKey)}
          </button>
        );
      })}
    </div>
  );
}
