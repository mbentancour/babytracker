import { useI18n } from "../../utils/i18n";
import { Glyph } from "./icons";
import { iconOf, toneOf } from "./kinds";

const pct = (value) => `${(value * 100).toFixed(2)}%`;

// Overview is what sits beside the story on a wide screen (and behind the
// chart button on a phone): today against a usual day, the week's sleep, and
// the way to the pages that look further back.
export default function Overview({ today, week, links, onPage }) {
  const { t } = useI18n();
  return (
    <div className="tl-overview">
      {today.length > 0 && (
        <section className="tl-card">
          <h2>{t("timeline.todaySoFar")}</h2>
          <ul className="tl-today">
            {today.map((item) => {
              const Icon = iconOf(item.kind);
              return (
                <li key={item.kind} style={{ "--tone": toneOf(item.kind) }}>
                  <span className="tl-badge"><Icon /></span>
                  <span className="tl-today-text">
                    <span className="tl-today-value">{item.value}</span>
                    {item.usual && <span className="tl-today-usual">{item.usual}</span>}
                  </span>
                  <span className="tl-meter" aria-hidden="true">
                    <i style={{ width: pct(item.fill) }} />
                    {item.mark !== null && <b style={{ left: pct(item.mark) }} />}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {week && (
        <section className="tl-card">
          <h2>{t("timeline.sleepWeek")}</h2>
          <ul className="tl-week">
            {week.map((day) => (
              <li key={day.key} className={day.today ? "is-today" : undefined}>
                <span className="tl-week-day">{day.label}</span>
                <span className="tl-week-track" role="img" aria-label={`${day.label}: ${day.total}`}>
                  {day.spans.map((s, i) => <i key={i} style={{ left: pct(s.left), width: pct(s.width) }} />)}
                </span>
                <span className="tl-week-total">{day.total}</span>
              </li>
            ))}
          </ul>
          <div className="tl-week-axis" aria-hidden="true">
            <span />
            <span className="tl-week-hours">
              <Glyph.Moon />
              <span>6</span>
              <Glyph.Sun />
              <span>18</span>
              <Glyph.Moon />
            </span>
            <span />
          </div>
        </section>
      )}

      {links.length > 0 && (
        <nav className="tl-card tl-links" aria-label={t("timeline.lookBack")}>
          <h2>{t("timeline.lookBack")}</h2>
          {links.map((link) => (
            <button key={link.id} type="button" onClick={() => onPage(link.id)}>
              <span className="tl-links-icon"><link.icon /></span>
              {link.label}
              <Glyph.ChevronRight />
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
