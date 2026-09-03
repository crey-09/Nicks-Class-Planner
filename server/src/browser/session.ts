import { chromium, type BrowserContext, type Page } from 'playwright';
import { BROWSER_PROFILE_DIR } from '../config.js';

/**
 * One persistent Chromium profile on disk holds every course-site session. Two ways in:
 *  - openLoginWindow(): a visible window the user logs into (SSO + Duo). No credentials touch this app.
 *  - withPage(): headless, serialized, for scheduled syncs. Reuses whatever cookies the login left behind.
 * A profile can only be open once, so the login window and the headless context never coexist.
 */
let headed: BrowserContext | null = null;
let queue: Promise<unknown> = Promise.resolve();

const launchArgs = { viewport: { width: 1280, height: 900 }, ignoreDefaultArgs: ['--enable-automation'] };

export async function openLoginWindow(url: string): Promise<void> {
  await closeLoginWindow();
  // Wait for any headless sync in flight to finish before taking the profile.
  await queue.catch(() => {});
  headed = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, { headless: false, ...launchArgs });
  const page = headed.pages()[0] ?? (await headed.newPage());
  await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
  headed.on('close', () => { headed = null; });
}

export function isLoginWindowOpen(): boolean { return headed !== null; }

export async function closeLoginWindow(): Promise<void> {
  if (!headed) return;
  const ctx = headed;
  headed = null;
  await ctx.close().catch(() => {});
}

export function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    if (headed) throw new Error('A login window is open. Finish logging in first.');
    const ctx = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, { headless: true, ...launchArgs });
    try {
      const page = await ctx.newPage();
      return await fn(page);
    } finally {
      await ctx.close().catch(() => {});
    }
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}
