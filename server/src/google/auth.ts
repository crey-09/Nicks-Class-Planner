import fs from 'node:fs';
import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import type { Db } from '../db/index.js';
import { getSetting, setSetting } from '../db/settings.js';
import { GOOGLE_TOKEN_PATH, PORT, HOST } from '../config.js';

export const SCOPES = ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/userinfo.email'];

export function redirectUri() { return `http://${HOST}:${PORT}/api/google/callback`; }

export function hasClient(db: Db): boolean {
  return !!getSetting(db, 'googleClientId') && !!getSetting(db, 'googleClientSecret');
}

export function makeClient(db: Db): OAuth2Client {
  const id = getSetting(db, 'googleClientId');
  const secret = getSetting(db, 'googleClientSecret');
  if (!id || !secret) throw new Error('Add a Google client ID and secret in Settings first.');
  const client = new google.auth.OAuth2(id, secret, redirectUri());
  client.on('tokens', (tokens) => {
    // Refreshed access tokens come through here; keep the refresh token we already have.
    const existing = loadTokens();
    saveTokens({ ...existing, ...tokens, refresh_token: tokens.refresh_token ?? existing?.refresh_token });
  });
  return client;
}

export function loadTokens(): Record<string, unknown> | null {
  try { return JSON.parse(fs.readFileSync(GOOGLE_TOKEN_PATH, 'utf8')); } catch { return null; }
}

export function saveTokens(tokens: Record<string, unknown>) {
  fs.writeFileSync(GOOGLE_TOKEN_PATH, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

export function clearTokens(db: Db) {
  try { fs.unlinkSync(GOOGLE_TOKEN_PATH); } catch { /* none */ }
  setSetting(db, 'googleConnected', null);
  setSetting(db, 'googleCalendarId', null);
  setSetting(db, 'googleEmail', null);
}

/** An authorized client, or null when Google isn't connected. */
export function authorizedClient(db: Db): OAuth2Client | null {
  const tokens = loadTokens();
  if (!tokens?.refresh_token || !hasClient(db)) return null;
  const client = makeClient(db);
  client.setCredentials(tokens);
  return client;
}

export function authUrl(db: Db): string {
  return makeClient(db).generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES });
}

export async function exchangeCode(db: Db, code: string): Promise<string | null> {
  const client = makeClient(db);
  const { tokens } = await client.getToken(code);
  saveTokens(tokens as Record<string, unknown>);
  client.setCredentials(tokens);
  let email: string | null = null;
  try {
    const info = await google.oauth2({ version: 'v2', auth: client }).userinfo.get();
    email = info.data.email ?? null;
  } catch { /* email is cosmetic */ }
  setSetting(db, 'googleConnected', '1');
  setSetting(db, 'googleEmail', email);
  return email;
}
