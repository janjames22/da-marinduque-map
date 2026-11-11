// Dates here are Philippine calendar dates, wherever the device's clock is set.
export function manilaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// The Philippine date a saved time fell on. The database keeps times in UTC, so cutting the date off
// the text would give the day before for anything from midnight to 8 a.m.
export function manilaDate(timestamp: string): string {
  const time = new Date(timestamp);
  return Number.isNaN(time.getTime()) ? timestamp.slice(0, 10) : manilaToday(time);
}

// The Philippine date and time to the minute, for file names: 2026-11-08-1942. Add the seconds when
// two files could start in the same minute.
export function manilaStamp(now: Date = new Date(), withSeconds = false): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '00';
  return `${manilaToday(now)}-${part('hour')}${part('minute')}${withSeconds ? part('second') : ''}`;
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
