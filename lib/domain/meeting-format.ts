/** Display helpers for class meeting times, shared by the Schedule Builder and the dashboard. */

export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

/** Minutes after midnight as "9:30AM". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")}${h >= 12 ? "PM" : "AM"}`;
}

export function formatRange(s: { start: number; end: number }): string {
  return `${formatMinutes(s.start)}–${formatMinutes(s.end)}`;
}

/** Weekday indexes as "MoWe". */
export function formatDays(days: number[]): string {
  return days.map((d) => DAY_LABELS[d].slice(0, 2)).join("");
}
