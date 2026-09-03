import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';
import type { Connector, RawAssignment, RawCourse } from './types.js';
import { NeedsLoginError } from './types.js';
import { DATA_DIR } from '../config.js';

const BASE = 'https://www.gradescope.com';

/** Gradescope has no API; we read the dashboard and each course's assignment table. */
async function assertLoggedIn(page: Page) {
  await page.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' });
  if (/\/login/.test(page.url()) || (await page.locator('form[action="/login"]').count()) > 0) throw new NeedsLoginError();
}

function saveDebug(name: string, html: string) {
  try {
    const dir = path.join(DATA_DIR, 'debug');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), html);
  } catch { /* best effort */ }
}

interface CourseCard { id: string; shortname: string; name: string; term: string }

async function readCourses(page: Page): Promise<CourseCard[]> {
  // Current term is listed first. Cards: a.courseBox[href="/courses/123"] with .courseBox--shortname / --name.
  const cards = await page.$$eval('.courseList--coursesForTerm', (terms) =>
    terms.map((termEl) => {
      const term = termEl.previousElementSibling?.textContent?.trim() ?? '';
      return Array.from(termEl.querySelectorAll('a.courseBox')).map((a) => ({
        id: (a.getAttribute('href') ?? '').split('/').pop() ?? '',
        shortname: a.querySelector('.courseBox--shortname')?.textContent?.trim() ?? '',
        name: a.querySelector('.courseBox--name')?.textContent?.trim() ?? '',
        term,
      }));
    }),
  ).catch(() => [] as CourseCard[][]);
  if (cards.length === 0) return [];
  // Students usually only see the current term; if several are shown, take the first group.
  return cards[0].filter((c) => c.id);
}

interface Row { name: string; href: string | null; due: string | null; lateDue: string | null; status: string; score: string | null }

async function readAssignments(page: Page, courseId: string): Promise<Row[]> {
  await page.goto(`${BASE}/courses/${courseId}`, { waitUntil: 'domcontentloaded' });
  if (/\/login/.test(page.url())) throw new NeedsLoginError();
  await page.waitForSelector('#assignments-student-table, table', { timeout: 15000 }).catch(() => {});
  return page.$$eval('#assignments-student-table tbody tr, table tbody tr', (rows) =>
    rows.map((tr) => {
      const th = tr.querySelector('th');
      const link = th?.querySelector('a') ?? tr.querySelector('a[href*="/assignments/"]');
      const times = Array.from(tr.querySelectorAll('time.submissionTimeChart--dueDate, time')).map((t) => t.getAttribute('datetime'));
      const status = tr.querySelector('.submissionStatus--text, .submissionStatus')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      const score = tr.querySelector('.submissionStatus--score')?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
      return {
        name: th?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        href: link?.getAttribute('href') ?? null,
        due: times[0] ?? null,
        lateDue: times[1] ?? null,
        status,
        score,
      };
    }).filter((r) => r.name),
  );
}

function toIso(s: string | null): string | null {
  if (!s) return null;
  // Gradescope emits "2026-09-04 23:59:00 -0400"; normalise to something Date can parse.
  const d = new Date(s.replace(' ', 'T').replace(/ ([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export const gradescope: Connector = {
  id: 'gradescope',
  label: 'Gradescope',
  description: 'Assignments, due dates, submission status and scores for each course.',
  needsBrowser: true,
  loginUrl: `${BASE}/login`,
  configFields: [],
  async isLoggedIn(page) {
    try { await assertLoggedIn(page); return true; } catch { return false; }
  },
  async sync(ctx) {
    if (!ctx.withPage) throw new Error('Browser required');
    return ctx.withPage(async (page) => {
      await assertLoggedIn(page);
      const cards = await readCourses(page);
      if (cards.length === 0) {
        saveDebug('gradescope-account.html', await page.content());
        throw new Error('No courses found on the Gradescope dashboard (saved data/debug/gradescope-account.html for inspection)');
      }
      ctx.log(`Gradescope: ${cards.length} courses in "${cards[0].term || 'current term'}"`);
      const courses: RawCourse[] = [];
      const assignments: RawAssignment[] = [];
      for (const c of cards) {
        courses.push({ key: c.id, name: c.name || c.shortname, code: c.shortname, url: `${BASE}/courses/${c.id}` });
        const rows = await readAssignments(page, c.id);
        if (rows.length === 0) saveDebug(`gradescope-course-${c.id}.html`, await page.content());
        for (const r of rows) {
          const submitted = /submitted|graded|late/i.test(r.status) && !/no submission/i.test(r.status);
          const aid = r.href?.match(/assignments\/(\d+)/)?.[1];
          assignments.push({
            externalId: `${c.id}:${aid ?? r.name}`,
            courseKey: c.id,
            title: r.name,
            dueAt: toIso(r.due),
            url: r.href ? (r.href.startsWith('http') ? r.href : BASE + r.href) : `${BASE}/courses/${c.id}`,
            kind: /quiz/i.test(r.name) ? 'quiz' : /exam|midterm|final/i.test(r.name) ? 'exam' : /lab/i.test(r.name) ? 'lab' : 'homework',
            status: submitted ? 'submitted' : 'todo',
            grade: r.score && /\d/.test(r.score) ? r.score : null,
          });
        }
        ctx.log(`  ${c.shortname || c.name}: ${rows.length} assignments`);
      }
      return { courses, assignments };
    });
  },
};
