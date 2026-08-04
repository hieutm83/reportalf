import type { ReportKind, ReportPeriod } from './types';

export function parseDate(value: unknown): string {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('Ngày báo cáo không hợp lệ.');
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) throw new Error('Ngày báo cáo không hợp lệ.');
  return text;
}

export function shiftDate(date: string, days: number): string {
  const value = new Date(`${parseDate(date)}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function localDate(timezone = 'Asia/Bangkok', now = new Date()): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dateLabel(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
}

export function isoWeek(date: string): { week: number; year: number } {
  const value = new Date(`${parseDate(date)}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 4 - (value.getUTCDay() || 7));
  const year = value.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil((((value.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { week, year };
}

export function reportPeriod(kind: ReportKind, anchorDate: string): ReportPeriod {
  const anchor = parseDate(anchorDate);
  if (kind === 'week') {
    // Saturday is the report anchor. The reported window is Saturday-Friday.
    const startDate = shiftDate(anchor, -7);
    const endDate = shiftDate(anchor, -1);
    const { week } = isoWeek(endDate);
    return { kind, anchorDate: anchor, startDate, endDate, title: `Tuần ${week} ∙ ${dateLabel(startDate)} - ${dateLabel(endDate)}` };
  }
  const firstDay = `${anchor.slice(0, 7)}-01`;
  const previousDay = shiftDate(firstDay, -1);
  const startDate = `${previousDay.slice(0, 7)}-01`;
  return { kind, anchorDate: firstDay, startDate, endDate: previousDay, title: `Tháng ${startDate.slice(5, 7)}/${startDate.slice(0, 4)}` };
}

export function latestWeekAnchor(timezone = 'Asia/Bangkok', now = new Date()): string {
  const today = localDate(timezone, now);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  return shiftDate(today, -((weekday + 1) % 7));
}

export function latestMonthAnchor(timezone = 'Asia/Bangkok', now = new Date()): string {
  const today = localDate(timezone, now);
  return `${today.slice(0, 7)}-01`;
}
