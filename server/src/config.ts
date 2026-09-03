import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// src/config.ts (dev, via tsx) or dist/server/src/config.ts (build): walk up to the repo root.
function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'server'))) return dir;
    dir = path.dirname(dir);
  }
  return path.resolve(start, '../..');
}

export const REPO_ROOT = findRepoRoot(here);
export const DATA_DIR = process.env.NICK_DATA_DIR ?? path.join(REPO_ROOT, 'data');
export const DB_PATH = path.join(DATA_DIR, 'nick.db');
export const BROWSER_PROFILE_DIR = path.join(DATA_DIR, 'browser-profile');
export const GOOGLE_TOKEN_PATH = path.join(DATA_DIR, 'google-tokens.json');
export const WEB_DIST = path.join(REPO_ROOT, 'web', 'dist');
export const MIGRATIONS_DIR = path.join(REPO_ROOT, 'server', 'drizzle');
export const PORT = Number(process.env.NICK_PORT ?? 3000);
export const HOST = process.env.HOST ?? '127.0.0.1';
export const DEFAULT_TIMEZONE = 'America/Indiana/Indianapolis';

fs.mkdirSync(DATA_DIR, { recursive: true });
