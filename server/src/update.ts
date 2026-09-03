import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { REPO_ROOT } from './config.js';

export const UPDATE_REPO = 'crey-09/Nicks-Class-Planner';
export const UPDATE_BRANCH = 'main';

export interface UpdateStatus {
  local: string | null;
  remote: string | null;
  remoteDate: string | null;
  remoteMessage: string | null;
  updateAvailable: boolean;
  checkedAt: string;
  error: string | null;
}

/** The commit this install came from: VERSION file (zip installs) or .git (cloned installs). */
export function localVersion(): string | null {
  try {
    const v = fs.readFileSync(path.join(REPO_ROOT, 'VERSION'), 'utf8').trim();
    if (/^[0-9a-f]{7,40}$/i.test(v)) return v;
  } catch { /* no VERSION file */ }
  try {
    const gitDir = path.join(REPO_ROOT, '.git');
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    if (/^[0-9a-f]{40}$/i.test(head)) return head;
    const ref = head.replace(/^ref:\s*/, '');
    try { return fs.readFileSync(path.join(gitDir, ref), 'utf8').trim(); } catch { /* packed */ }
    const packed = fs.readFileSync(path.join(gitDir, 'packed-refs'), 'utf8');
    const line = packed.split('\n').find((l) => l.endsWith(' ' + ref));
    return line ? line.split(' ')[0] : null;
  } catch { return null; }
}

let cache: { at: number; status: UpdateStatus } | null = null;

export async function checkForUpdate(force = false): Promise<UpdateStatus> {
  if (!force && cache && Date.now() - cache.at < 60 * 60_000) return cache.status;
  const local = localVersion();
  const status: UpdateStatus = { local, remote: null, remoteDate: null, remoteMessage: null, updateAvailable: false, checkedAt: new Date().toISOString(), error: null };
  try {
    const res = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/commits/${UPDATE_BRANCH}`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'nick-manager' } });
    if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
    const data = (await res.json()) as { sha: string; commit: { message: string; committer: { date: string } } };
    status.remote = data.sha;
    status.remoteDate = data.commit.committer.date;
    status.remoteMessage = data.commit.message.split('\n')[0];
    status.updateAvailable = !!status.remote && (local == null || !status.remote.startsWith(local) && !local.startsWith(status.remote));
  } catch (err) {
    status.error = (err as Error).message;
  }
  cache = { at: Date.now(), status };
  return status;
}

/** Launch the update script detached; it stops this server, pulls, builds and restarts. */
export function runUpdater(): { started: boolean; script: string } {
  const isWin = process.platform === 'win32';
  const script = path.join(REPO_ROOT, 'scripts', isWin ? 'update-windows.cmd' : 'update-unix.sh');
  if (!fs.existsSync(script)) throw new Error(`Updater not found at ${script}`);
  const child = isWin
    ? spawn('cmd.exe', ['/c', 'start', '"Nick Manager update"', script], { detached: true, stdio: 'ignore', cwd: REPO_ROOT, windowsHide: false })
    : spawn('bash', [script], { detached: true, stdio: 'ignore', cwd: REPO_ROOT });
  child.unref();
  return { started: true, script };
}
