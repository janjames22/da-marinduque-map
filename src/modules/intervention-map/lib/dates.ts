// Dates here are Philippine calendar dates, wherever the device's clock is set.
export function manilaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function manilaYear(now: Date = new Date()): number {
  return Number(manilaToday(now).slice(0, 4));
}

// The first and last moments of a Philippine calendar day, whatever the device's clock says.
export const manilaDayStart = (day: string) => `${day}T00:00:00.000+08:00`;
export const manilaDayEnd = (day: string) => `${day}T23:59:59.999+08:00`;

export function isValidDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}
