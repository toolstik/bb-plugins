const HOUR_MS = 60 * 60 * 1_000;
const WINDOW_MS = new Map([
  ["five-hour", 5 * HOUR_MS],
  ["daily", 24 * HOUR_MS],
  ["weekly", 7 * 24 * HOUR_MS],
]);

interface ForecastWindow {
  kind?: string;
  usedPercent: number;
  resetsAt: string | null;
}

/** Extrapolate the measurement's average pace over a known quota period. */
export function projectedUsage(window: ForecastWindow, observedAt: number | null, now: number): number | null {
  const duration = WINDOW_MS.get(window.kind ?? "");
  const end = window.resetsAt === null ? NaN : Date.parse(window.resetsAt);
  if (duration === undefined || observedAt === null || !Number.isFinite(observedAt) || observedAt > now
    || !Number.isFinite(end) || end <= now || !Number.isFinite(window.usedPercent) || window.usedPercent < 0) return null;
  const elapsed = observedAt - (end - duration);
  if (elapsed <= 0 || elapsed > duration) return null;
  const projected = window.usedPercent * duration / elapsed;
  return Number.isFinite(projected) ? projected : null;
}

export function forecastDetails(projected: number): string {
  // Round upward so a real overage never appears as a forecast of exactly 100%.
  const percent = Math.ceil(projected * 10) / 10;
  const overage = Math.ceil(Math.max(0, projected - 100) * 10) / 10;
  const forecast = `Forecast at reset: ~${percent}% used (average pace since this period started).`;
  return overage > 0 ? `${forecast}\nExpected excess: ~${overage}% of the allowance.` : forecast;
}
