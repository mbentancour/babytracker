import {
  WEIGHT_FOR_AGE_BOYS,
  WEIGHT_FOR_AGE_GIRLS,
  HEIGHT_FOR_AGE_BOYS,
  HEIGHT_FOR_AGE_GIRLS,
  HEADCIRC_FOR_AGE_BOYS,
  HEADCIRC_FOR_AGE_GIRLS,
  BMI_FOR_AGE_BOYS,
  BMI_FOR_AGE_GIRLS,
  WHO_PERCENTILES,
} from "./whoGrowthData";

/**
 * Convert a value at a given z-score using LMS method.
 * If L == 0, use exponential form.
 */
function lmsValue(L, M, S, z) {
  if (Math.abs(L) < 1e-6) {
    return M * Math.exp(S * z);
  }
  return M * Math.pow(1 + L * S * z, 1 / L);
}

/**
 * Interpolate LMS parameters at a given age in months from a sorted LMS table.
 * Returns [L, M, S] or null if outside the table range.
 */
function interpolateLMS(table, ageMonths) {
  if (!table.length) return null;
  if (ageMonths < table[0][0] || ageMonths > table[table.length - 1][0]) {
    return null;
  }
  // Find bracket
  for (let i = 0; i < table.length - 1; i++) {
    const [a0, L0, M0, S0] = table[i];
    const [a1, L1, M1, S1] = table[i + 1];
    if (ageMonths >= a0 && ageMonths <= a1) {
      if (a1 === a0) return [L0, M0, S0];
      const f = (ageMonths - a0) / (a1 - a0);
      return [
        L0 + (L1 - L0) * f,
        M0 + (M1 - M0) * f,
        S0 + (S1 - S0) * f,
      ];
    }
  }
  return null;
}

export const METRIC_TABLES = {
  weight: { boys: WEIGHT_FOR_AGE_BOYS, girls: WEIGHT_FOR_AGE_GIRLS },
  height: { boys: HEIGHT_FOR_AGE_BOYS, girls: HEIGHT_FOR_AGE_GIRLS },
  headcirc: { boys: HEADCIRC_FOR_AGE_BOYS, girls: HEADCIRC_FOR_AGE_GIRLS },
  bmi: { boys: BMI_FOR_AGE_BOYS, girls: BMI_FOR_AGE_GIRLS },
};

/**
 * Build percentile curves for a given metric, sex, and age range.
 * Returns an array of data points suitable for Recharts:
 *   [{ ageMonths, p3, p15, p50, p85, p97 }, ...]
 */
export function buildWHOCurves(metric, sex, minAgeMonths, maxAgeMonths, step = 1) {
  const tables = METRIC_TABLES[metric];
  if (!tables || !sex) return [];
  const table = sex === "male" ? tables.boys : tables.girls;
  if (!table) return [];

  const points = [];
  const hi = Math.min(maxAgeMonths, table[table.length - 1][0]);
  const lo = Math.max(minAgeMonths, table[0][0]);
  for (let m = lo; m <= hi; m += step) {
    const lms = interpolateLMS(table, m);
    if (!lms) continue;
    const [L, M, S] = lms;
    const point = { ageMonths: m };
    for (const p of WHO_PERCENTILES) {
      point[`p${p.label.replace(/\D/g, "")}`] = parseFloat(
        lmsValue(L, M, S, p.z).toFixed(3)
      );
    }
    points.push(point);
  }
  return points;
}

/**
 * Compute age in months (float, ~30.4375 days per month) from birth date
 * to a given measurement date (both are ISO 8601 strings or Date objects).
 */
export function ageInMonths(birthDate, measurementDate) {
  const b = birthDate instanceof Date ? birthDate : new Date(birthDate);
  const m = measurementDate instanceof Date ? measurementDate : new Date(measurementDate);
  const diffMs = m - b;
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays / 30.4375;
}

/**
 * Given a list of child measurements ({date, value}) and a birth date,
 * return an array of points with ageMonths added:
 *   [{ ageMonths, value, date, ... }, ...]
 */
export function mapMeasurementsToAge(entries, valueField, birthDate) {
  if (!birthDate) return [];
  return entries
    .filter((e) => e.date && e[valueField] != null)
    .map((e) => ({
      ageMonths: ageInMonths(birthDate, e.date),
      [valueField]: e[valueField],
      date: e.date,
      entry: e,
    }))
    .filter((e) => e.ageMonths >= 0 && e.ageMonths <= 60);
}
