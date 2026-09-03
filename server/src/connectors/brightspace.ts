import type { Page, APIResponse } from 'playwright';
import type { Connector, RawAssignment, RawCourse } from './types.js';
import { NeedsLoginError } from './types.js';

/**
 * Brightspace (D2L). Instead of scraping pages we call the REST API the web UI itself uses, with the
 * session cookie from the persistent browser profile. Every call goes through page.request so the
 * cookies ride along.
 */
const DEFAULT_BASE = 'https://purdue.brightspace.com';

interface Versions { lp: string; le: string }

async function json<T>(res: APIResponse, what: string): Promise<T> {
  const ct = res.headers()['content-type'] ?? '';
  if (res.status() === 401 || res.status() === 403) throw new NeedsLoginError();
  if (!res.ok()) throw new Error(`${what}: HTTP ${res.status()}`);
  if (!ct.includes('json')) throw new NeedsLoginError(); // login page HTML came back
  return (await res.json()) as T;
}

async function getVersions(page: Page, base: string): Promise<Versions> {
  const res = await page.request.get(`${base}/d2l/api/versions/`, { headers: { accept: 'application/json' } });
  const list = await json<{ ProductCode: string; LatestVersion: string }[]>(res, 'versions');
  const pick = (code: string, fallback: string) => list.find((v) => v.ProductCode === code)?.LatestVersion ?? fallback;
  return { lp: pick('lp', '1.40'), le: pick('le', '1.70') };
}

async function apiGet<T>(page: Page, url: string, what: string): Promise<T> {
  const res = await page.request.get(url, { headers: { accept: 'application/json' } });
  return json<T>(res, what);
}

interface Enrollment { OrgUnit: { Id: number; Name: string; Code: string | null; Type: { Id: number } }; Access: { IsActive: boolean; StartDate: string | null; EndDate: string | null } }
interface DropboxFolder { Id: number; Name: string; DueDate: string | null; Availability: { StartDate: string | null; EndDate: string | null } | null; Assessment: { ScoreDenominator: number | null } | null }
interface Quiz { QuizId: number; Name: string; DueDate: string | null; StartDate: string | null; EndDate: string | null; IsActive: boolean }
interface TocTopic { TopicId: number; Title: string; Url: string | null; DueDate: string | null; StartDate: string | null; IsHidden: boolean }
interface TocModule { ModuleId: number; Title: string; Topics: TocTopic[]; Modules: TocModule[] }
interface GradeValue { GradeObjectName: string; DisplayedGrade: string | null; PointsNumerator: number | null; PointsDenominator: number | null }

function isCurrent(e: Enrollment): boolean {
  if (!e.Access.IsActive) return false;
  const now = Date.now();
  const grace = 21 * 86400_000;
  if (e.Access.EndDate && new Date(e.Access.EndDate).getTime() + grace < now) return false;
  if (e.Access.StartDate && new Date(e.Access.StartDate).getTime() - grace > now) return false;
  return true;
}

function flattenTopics(mods: TocModule[]): TocTopic[] {
  const out: TocTopic[] = [];
  for (const m of mods ?? []) { out.push(...(m.Topics ?? [])); out.push(...flattenTopics(m.Modules ?? [])); }
  return out;
}

export const brightspace: Connector = {
  id: 'brightspace',
  label: 'Brightspace',
  description: 'Assignments, quizzes and dated content from every course you are enrolled in.',
  needsBrowser: true,
  loginUrl: `${DEFAULT_BASE}/d2l/home`,
  configFields: [
    { key: 'baseUrl', label: 'Brightspace URL', type: 'url', default: DEFAULT_BASE, required: true },
  ],
  async isLoggedIn(page, config) {
    const base = String(config.baseUrl || DEFAULT_BASE).replace(/\/$/, '');
    try {
      const v = await getVersions(page, base);
      const res = await page.request.get(`${base}/d2l/api/lp/${v.lp}/users/whoami`, { headers: { accept: 'application/json' } });
      return res.ok() && (res.headers()['content-type'] ?? '').includes('json');
    } catch { return false; }
  },
  async sync(ctx) {
    if (!ctx.withPage) throw new Error('Browser required');
    const base = String(ctx.config.baseUrl || DEFAULT_BASE).replace(/\/$/, '');
    return ctx.withPage(async (page) => {
      const v = await getVersions(page, base);
      const whoami = await page.request.get(`${base}/d2l/api/lp/${v.lp}/users/whoami`, { headers: { accept: 'application/json' } });
      await json(whoami, 'whoami');

      // Enrollments are paged with a bookmark.
      const enrollments: Enrollment[] = [];
      let bookmark: string | null = null;
      for (let i = 0; i < 10; i++) {
        const url: string = `${base}/d2l/api/lp/${v.lp}/enrollments/myenrollments/?orgUnitTypeId=3${bookmark ? `&bookmark=${encodeURIComponent(bookmark)}` : ''}`;
        const pageData: { PagingInfo: { HasMoreItems: boolean; Bookmark: string }; Items: Enrollment[] } = await apiGet(page, url, 'enrollments');
        enrollments.push(...pageData.Items);
        if (!pageData.PagingInfo?.HasMoreItems) break;
        bookmark = pageData.PagingInfo.Bookmark;
      }
      const current = enrollments.filter(isCurrent);
      ctx.log(`Brightspace: ${current.length} active courses of ${enrollments.length}`);

      const courses: RawCourse[] = [];
      const assignments: RawAssignment[] = [];
      for (const e of current) {
        const ou = e.OrgUnit.Id;
        const key = String(ou);
        courses.push({ key, name: e.OrgUnit.Name, code: e.OrgUnit.Code, url: `${base}/d2l/home/${ou}` });

        const grades = new Map<string, string>();
        try {
          const gv = await apiGet<GradeValue[]>(page, `${base}/d2l/api/le/${v.le}/${ou}/grades/values/myGradeValues/`, 'grades');
          for (const g of gv) if (g.DisplayedGrade) grades.set(g.GradeObjectName.trim().toLowerCase(), g.DisplayedGrade);
        } catch (err) { ctx.log(`  ${e.OrgUnit.Name}: grades unavailable (${(err as Error).message})`); }

        try {
          const folders = await apiGet<DropboxFolder[]>(page, `${base}/d2l/api/le/${v.le}/${ou}/dropbox/folders/`, 'dropbox');
          for (const f of folders) {
            const due = f.DueDate ?? f.Availability?.EndDate ?? null;
            assignments.push({
              externalId: `${ou}:dropbox:${f.Id}`, courseKey: key, title: f.Name.trim(), dueAt: due,
              url: `${base}/d2l/lms/dropbox/user/folder_submit_files.d2l?ou=${ou}&db=${f.Id}`,
              kind: 'homework', points: f.Assessment?.ScoreDenominator ?? null, grade: grades.get(f.Name.trim().toLowerCase()) ?? null,
            });
          }
        } catch (err) { if (err instanceof NeedsLoginError) throw err; ctx.log(`  ${e.OrgUnit.Name}: dropbox failed (${(err as Error).message})`); }

        try {
          let next: string | null = `${base}/d2l/api/le/${v.le}/${ou}/quizzes/`;
          for (let i = 0; next && i < 10; i++) {
            const pageData: { Objects: Quiz[]; Next: string | null } = await apiGet(page, next, 'quizzes');
            for (const q of pageData.Objects ?? []) {
              if (q.IsActive === false) continue;
              assignments.push({
                externalId: `${ou}:quiz:${q.QuizId}`, courseKey: key, title: q.Name.trim(), dueAt: q.DueDate ?? q.EndDate ?? null,
                url: `${base}/d2l/lms/quizzing/user/quiz_summary.d2l?ou=${ou}&qi=${q.QuizId}`, kind: 'quiz',
                grade: grades.get(q.Name.trim().toLowerCase()) ?? null,
              });
            }
            next = pageData.Next ? (pageData.Next.startsWith('http') ? pageData.Next : base + pageData.Next) : null;
          }
        } catch (err) { if (err instanceof NeedsLoginError) throw err; ctx.log(`  ${e.OrgUnit.Name}: quizzes failed (${(err as Error).message})`); }

        try {
          const toc = await apiGet<{ Modules: TocModule[] }>(page, `${base}/d2l/api/le/${v.le}/${ou}/content/toc`, 'toc');
          for (const t of flattenTopics(toc.Modules)) {
            if (!t.DueDate || t.IsHidden) continue;
            assignments.push({
              externalId: `${ou}:topic:${t.TopicId}`, courseKey: key, title: t.Title.trim(), dueAt: t.DueDate,
              url: `${base}/d2l/le/content/${ou}/viewContent/${t.TopicId}/View`, kind: 'reading',
            });
          }
        } catch (err) { if (err instanceof NeedsLoginError) throw err; ctx.log(`  ${e.OrgUnit.Name}: content failed (${(err as Error).message})`); }
      }
      ctx.log(`Brightspace: ${assignments.length} dated items`);
      return { courses, assignments };
    });
  },
};
