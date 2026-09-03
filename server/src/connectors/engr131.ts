import * as cheerio from 'cheerio';
import { fromZonedTime } from 'date-fns-tz';
import type { AssignmentKind } from '@nick/shared';
import type { Connector, RawAssignment } from './types.js';
import { getTimezone } from '../db/settings.js';

export const ENGR131_SITE = 'https://purdue-fye.github.io/engr-13100-2026-fall/';
export const ENGR131_SCHEDULE = ENGR131_SITE + 'Part_00_Course_Resources/course_schedule.html';

const DAY_INDEX: Record<string, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };

export interface ParseOpts {
  /** Days of the week the section meets, in order; session A is the first, B the second. */
  meetingDays: string[];
  /** Local time (HH:mm) a class starts; "Due: Class 2A" resolves to this time on that day. */
  classTime: string;
  timezone: string;
  /** Fallback year when the page only shows M/D. */
  year?: number;
  url?: string;
}

export interface ParsedSchedule {
  semester: string | null;
  weeks: { n: number; monday: string }[]; // monday as yyyy-MM-dd
  assignments: RawAssignment[];
  /** Rows whose due text could not be resolved to a date, for diagnostics. */
  unresolved: string[];
}

function parseMeetingDays(s: string | string[] | undefined): string[] {
  const list = Array.isArray(s) ? s : (s ?? 'Mon,Wed').split(/[,\s/]+/);
  return list.map((d) => d.trim().slice(0, 3).toLowerCase()).filter((d) => d in DAY_INDEX);
}

function ymd(y: number, m: number, d: number) { return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function kindFor(code: string, type: string, points: number | null): AssignmentKind {
  const t = type.toLowerCase();
  if (/exam/.test(t) || /^exam/i.test(code)) return 'exam';
  if (/pre-class/.test(t)) return points == null ? 'reading' : 'homework';
  if (/team/.test(t)) return 'project';
  if (/quiz/.test(t)) return 'quiz';
  return 'homework';
}

export function parseEngr131Schedule(html: string, opts: ParseOpts): ParsedSchedule {
  const $ = cheerio.load(html);
  const tz = opts.timezone;
  const meeting = parseMeetingDays(opts.meetingDays);
  const semester = $('.schedule-meta').first().text().replace(/Semester:\s*/i, '').trim() || null;
  const yearFromMeta = semester?.match(/(20\d{2})/)?.[1];
  const year = opts.year ?? (yearFromMeta ? Number(yearFromMeta) : new Date().getFullYear());

  // Weeks: "Week 1 -- 8/24-8/28" → Monday date.
  const weeks = new Map<number, string>();
  $('tr.week-label').each((_, el) => {
    const m = $(el).text().match(/Week\s+(\d+)\s*-+\s*(\d{1,2})\/(\d{1,2})/i);
    if (m) weeks.set(Number(m[1]), ymd(year, Number(m[2]), Number(m[3])));
  });

  const unresolved: string[] = [];
  const resolveClassDue = (text: string): string | null => {
    const m = text.match(/Class\s+(\d+)([A-Z])/i);
    if (!m) return null;
    const monday = weeks.get(Number(m[1]));
    const idx = m[2].toUpperCase().charCodeAt(0) - 65; // A → 0, B → 1
    const day = meeting[idx];
    if (!monday || day === undefined) return null;
    const date = addDays(monday, DAY_INDEX[day]);
    return fromZonedTime(`${date}T${opts.classTime}:00`, tz).toISOString();
  };
  const resolveExplicit = (text: string): string | null => {
    const m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s*@?\s*(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i);
    if (!m) return null;
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    let h = m[4] ? Number(m[4]) : 23, min = m[5] ? Number(m[5]) : 59;
    if (m[6]) { const pm = m[6].toUpperCase() === 'PM'; if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
    return fromZonedTime(`${ymd(y, Number(m[1]), Number(m[2]))}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`, tz).toISOString();
  };
  const resolve = (text: string): string | null => resolveExplicit(text) ?? resolveClassDue(text);

  const assignments: RawAssignment[] = [];
  const seen = new Set<string>();
  $('tr.assignment-body').each((_, el) => {
    const cells = $(el).find('td').map((_, td) => $(td).text().replace(/\s+/g, ' ').trim()).get();
    if (cells.length < 5) return;
    const [code, name, pointsText, type, dueText] = cells;
    if (!code || seen.has(code)) return;
    seen.add(code);
    const points = /^\d+(\.\d+)?$/.test(pointsText) ? Number(pointsText) : null;
    const dueAt = dueText && dueText !== '--' ? resolve(dueText) : null;
    if (dueText && dueText !== '--' && !dueAt) unresolved.push(`${code}: ${dueText}`);
    assignments.push({
      externalId: code,
      title: `${code} · ${name}`,
      dueAt,
      dueText: dueText && dueText !== '--' ? dueText : null,
      url: opts.url ?? ENGR131_SCHEDULE,
      kind: kindFor(code, type, points),
      points,
    });
  });

  // Exams: "Exam 1 | Excel (Class 6A)".
  $('tr.exam-row').each((_, el) => {
    const cells = $(el).find('td').map((_, td) => $(td).text().replace(/\s+/g, ' ').trim()).get();
    if (cells.length < 2) return;
    const [label, desc] = cells;
    const id = `EXAM ${label.replace(/\D/g, '') || label}`;
    if (seen.has(id)) return;
    seen.add(id);
    const dueAt = resolve(desc);
    assignments.push({ externalId: id, title: `${label} · ${desc.replace(/\s*\(Class[^)]*\)/i, '')}`, dueAt, dueText: desc.match(/Class\s+\d+[A-Z]/i)?.[0] ?? null, url: opts.url ?? ENGR131_SCHEDULE, kind: 'exam', points: null });
  });

  return { semester, weeks: [...weeks.entries()].map(([n, monday]) => ({ n, monday })).sort((a, b) => a.n - b.n), assignments, unresolved };
}

export const engr131: Connector = {
  id: 'engr131',
  label: 'ENGR 131 course site',
  description: 'Reads the public course schedule (purdue-fye.github.io). No login needed.',
  needsBrowser: false,
  configFields: [
    { key: 'url', label: 'Schedule page URL', type: 'url', default: ENGR131_SCHEDULE, required: true },
    { key: 'meetingDays', label: 'Your section meets on', type: 'text', placeholder: 'Mon,Wed', default: 'Mon,Wed', required: true, help: 'Two days, in order. "Class 2A" is the first meeting of week 2, "2B" the second.' },
    { key: 'classTime', label: 'Class start time', type: 'time', default: '08:30', required: true, help: 'Assignments due "at class" are set to this time.' },
  ],
  async sync(ctx) {
    const url = String(ctx.config.url || ENGR131_SCHEDULE);
    const res = await fetch(url, { headers: { 'user-agent': 'nick-manager/0.1' } });
    if (!res.ok) throw new Error(`Fetching schedule failed: HTTP ${res.status}`);
    const html = await res.text();
    const parsed = parseEngr131Schedule(html, {
      meetingDays: parseMeetingDays(ctx.config.meetingDays as string | undefined),
      classTime: String(ctx.config.classTime || '08:30'),
      timezone: getTimezone(ctx.db),
      url,
    });
    ctx.log(`ENGR 131: ${parsed.assignments.length} items across ${parsed.weeks.length} weeks${parsed.unresolved.length ? `; unresolved: ${parsed.unresolved.join(', ')}` : ''}`);
    const site = url.replace(/Part_00_Course_Resources\/.*$/, '');
    return {
      courses: [{ key: 'engr131', name: 'Transforming Ideas to Innovation I', code: 'ENGR 131', url: site + 'intro.html', links: [{ label: 'ENGR 131 schedule', url }] }],
      assignments: parsed.assignments.map((a) => ({ ...a, courseKey: 'engr131' })),
    };
  },
};
