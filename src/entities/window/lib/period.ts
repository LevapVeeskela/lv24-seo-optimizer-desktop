export interface ActivePeriod {
  start: string;
  end: string;
}

function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Preview of the window the engine will request. `lagDays` moves the end of
 * the window back so the last days a provider has not finalised are excluded;
 * the engine recomputes the authoritative period from the same arguments.
 */
export function activePeriod(
  days: number,
  lagDays: number,
  now: Date = new Date(),
): ActivePeriod {
  const safeDays = Number.isFinite(days) ? Math.max(1, Math.round(days)) : 1;
  const safeLag = Number.isFinite(lagDays) ? Math.max(0, Math.round(lagDays)) : 0;
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  end.setDate(end.getDate() - safeLag);
  const start = new Date(end);
  start.setDate(start.getDate() - safeDays + 1);
  return { start: isoDate(start), end: isoDate(end) };
}
