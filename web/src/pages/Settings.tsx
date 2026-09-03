import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Api } from '../api/client';
import { ErrorBox, Field } from '../components/ui';

export default function Settings() {
  const qc = useQueryClient();
  const s = useQuery({ queryKey: ['settings'], queryFn: Api.settings });
  const [form, setForm] = useState({ syncIntervalMinutes: 30, timezone: '', googleClientId: '', googleClientSecret: '' });
  useEffect(() => {
    if (s.data) setForm({ syncIntervalMinutes: s.data.syncIntervalMinutes, timezone: s.data.timezone, googleClientId: s.data.googleClientId ?? '', googleClientSecret: s.data.googleClientSecret ?? '' });
  }, [s.data]);
  const save = useMutation({
    mutationFn: () => Api.saveSettings({ ...form, googleClientId: form.googleClientId || null, googleClientSecret: form.googleClientSecret || null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
  const google = useQuery({ queryKey: ['google'], queryFn: Api.googleStatus, retry: false });
  const connect = useMutation({ mutationFn: Api.googleConnect, onSuccess: () => setTimeout(() => qc.invalidateQueries({ queryKey: ['google'] }), 1500) });
  const disconnect = useMutation({ mutationFn: Api.googleDisconnect, onSuccess: () => qc.invalidateQueries({ queryKey: ['google'] }) });
  const sync = useMutation({ mutationFn: Api.googleSync, onSuccess: () => qc.invalidateQueries() });
  const update = useQuery({ queryKey: ['update'], queryFn: () => Api.updateStatus(), retry: false });
  const recheck = useMutation({ mutationFn: () => Api.updateStatus(true), onSuccess: (d) => qc.setQueryData(['update'], d) });
  const runUpdate = useMutation({ mutationFn: Api.runUpdate });

  return (
    <div>
      <h1>Settings</h1>
      <div className="grid cols-2">
        <div className="card">
          <h2>General</h2>
          <form className="form" style={{ marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            <Field label="Sync every (minutes)"><input type="number" min={5} value={form.syncIntervalMinutes} onChange={(e) => setForm({ ...form, syncIntervalMinutes: Number(e.target.value) })} /></Field>
            <Field label="Timezone" hint="IANA name. Purdue is America/Indiana/Indianapolis."><input value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} /></Field>
            <h2 style={{ marginTop: 8 }}>Google Calendar</h2>
            <div className="small muted">Create a Desktop OAuth client in Google Cloud Console (APIs &amp; Services → Credentials), enable the Google Calendar API, and paste the client ID and secret here. See the README for a walkthrough.</div>
            <Field label="Client ID"><input value={form.googleClientId} onChange={(e) => setForm({ ...form, googleClientId: e.target.value })} /></Field>
            <Field label="Client secret"><input type="password" value={form.googleClientSecret} onChange={(e) => setForm({ ...form, googleClientSecret: e.target.value })} /></Field>
            <ErrorBox error={save.error} />
            <div className="form-actions"><button className="primary" disabled={save.isPending}>{save.isSuccess ? 'Saved ✓' : 'Save'}</button></div>
          </form>
        </div>
        <div className="card">
          <h2>Updates</h2>
          <div style={{ marginTop: 12 }}>
            {update.data && (
              <>
                <div className="small">Installed: <code>{update.data.local ? update.data.local.slice(0, 7) : 'unknown'}</code>{update.data.remote && <> · Latest: <code>{update.data.remote.slice(0, 7)}</code>{update.data.remoteDate && <span className="muted"> ({new Date(update.data.remoteDate).toLocaleDateString()})</span>}</>}</div>
                {update.data.error && <div className="small" style={{ color: 'var(--warn)', marginTop: 6 }}>Couldn't check: {update.data.error}</div>}
                {update.data.updateAvailable && !update.data.error && (
                  <div className="banner" style={{ marginTop: 10, marginBottom: 10 }}>
                    <span>⬆️ <b>Update available.</b>{update.data.remoteMessage && <> Latest change: {update.data.remoteMessage}</>}</span>
                  </div>
                )}
                {!update.data.updateAvailable && !update.data.error && <div className="small muted" style={{ marginTop: 6 }}>You're up to date.</div>}
              </>
            )}
            {runUpdate.isSuccess ? (
              <div className="small" style={{ marginTop: 10 }}>Updating in a separate window. The app stops, rebuilds and restarts itself. Reload this page in a minute or two.</div>
            ) : (
              <div className="toolbar" style={{ marginTop: 10 }}>
                {update.data?.updateAvailable && <button className="primary" onClick={() => runUpdate.mutate()} disabled={runUpdate.isPending}>Update now</button>}
                <button onClick={() => recheck.mutate()} disabled={recheck.isPending}>{recheck.isPending ? 'Checking…' : 'Check again'}</button>
              </div>
            )}
            <ErrorBox error={runUpdate.error} />
          </div>
        </div>
        <div className="card">
          <h2>Google account</h2>
          <ErrorBox error={connect.error ?? sync.error} />
          {google.data?.connected ? (
            <div style={{ marginTop: 12 }}>
              <div>Connected{google.data.email ? ` as ${google.data.email}` : ''}.</div>
              <div className="small muted" style={{ margin: '6px 0 12px' }}>Assignments, shifts, and plan blocks are pushed to a "Nick Manager" calendar. Events on your primary calendar are pulled into the planner.</div>
              <div className="toolbar">
                <button onClick={() => sync.mutate()} disabled={sync.isPending}>{sync.isPending ? 'Syncing…' : 'Sync now'}</button>
                <button className="danger" onClick={() => disconnect.mutate()}>Disconnect</button>
              </div>
              {sync.data && <div className="small muted" style={{ marginTop: 8 }}>Pushed {sync.data.pushed}, pulled {sync.data.pulled}.</div>}
            </div>
          ) : (
            <div style={{ marginTop: 12 }}>
              <div className="small muted" style={{ marginBottom: 12 }}>Save a client ID and secret first, then connect. A browser window opens for you to approve access.</div>
              <button className="primary" disabled={!s.data?.googleClientId || connect.isPending} onClick={() => connect.mutate()}>Connect Google Calendar</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
