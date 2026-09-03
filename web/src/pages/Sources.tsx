import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Api } from '../api/client';
import { CourseSelect, Empty, ErrorBox, Field, Modal } from '../components/ui';
import type { ConnectorInfo, Course, Source, SourceCourse, SyncRun } from '@nick/shared';
import { formatDistanceToNow, format } from 'date-fns';

const statusLabel: Record<string, string> = { ok: 'Connected', needs_login: 'Needs login', error: 'Error', never: 'Not synced yet' };

function SourceForm({ connectors, courses, initial, onSave, onCancel }: {
  connectors: ConnectorInfo[]; courses: Course[]; initial?: Source;
  onSave: (b: { connector: string; name: string; config: Record<string, unknown>; courseId: number | null }) => void; onCancel: () => void;
}) {
  const [connectorId, setConnectorId] = useState<string>(initial?.connector ?? connectors[0]?.id ?? '');
  const connector = connectors.find((c) => c.id === connectorId);
  const [name, setName] = useState(initial?.name ?? '');
  const [config, setConfig] = useState<Record<string, unknown>>(initial?.config ?? {});
  const [courseId, setCourseId] = useState<number | null>(initial?.courseId ?? null);
  useEffect(() => {
    if (initial) return;
    setName(connector?.label ?? '');
    const defaults: Record<string, unknown> = {};
    for (const f of connector?.configFields ?? []) if (f.default) defaults[f.key] = f.default;
    setConfig(defaults);
  }, [connectorId]);
  const multiCourse = connectorId === 'brightspace' || connectorId === 'gradescope';
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); onSave({ connector: connectorId, name: name.trim(), config, courseId: multiCourse ? null : courseId }); }}>
      {!initial && (
        <Field label="What to connect">
          <select value={connectorId} onChange={(e) => setConnectorId(e.target.value)}>
            {connectors.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          {connector && <span className="field-hint">{connector.description}</span>}
        </Field>
      )}
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
      {connector?.configFields.map((f) => (
        <Field key={f.key} label={f.label} hint={f.help}>
          {f.type === 'select' ? (
            <select value={String(config[f.key] ?? f.default ?? '')} onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })}>
              {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <input type={f.type === 'url' ? 'url' : f.type === 'time' ? 'time' : 'text'} value={String(config[f.key] ?? '')} placeholder={f.placeholder} required={f.required}
              onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })} />
          )}
        </Field>
      ))}
      {!multiCourse && (
        <Field label="Course" hint={connectorId === 'ics' ? 'Leave empty for a work schedule.' : 'Which of your courses this site belongs to.'}>
          <CourseSelect courses={courses} value={courseId} onChange={setCourseId} />
        </Field>
      )}
      {multiCourse && <div className="small muted">Courses are discovered automatically after you log in. You can re-map them below afterwards.</div>}
      <div className="form-actions"><button type="button" onClick={onCancel}>Cancel</button><button className="primary" disabled={!name.trim()}>Save</button></div>
    </form>
  );
}

function RunsTable({ sourceId }: { sourceId: number }) {
  const runs = useQuery({ queryKey: ['runs', sourceId], queryFn: () => Api.sourceRuns(sourceId), refetchInterval: 5000 });
  if (!runs.data?.length) return <Empty>No sync runs yet.</Empty>;
  return (
    <table className="runs">
      <thead><tr><th>When</th><th>Result</th><th>Items</th><th>Details</th></tr></thead>
      <tbody>
        {runs.data.map((r: SyncRun) => (
          <tr key={r.id}>
            <td style={{ whiteSpace: 'nowrap' }}>{format(new Date(r.startedAt), 'MMM d h:mm a')}</td>
            <td>{r.ok == null ? 'Running…' : r.ok ? '✅ ok' : '❌ failed'}</td>
            <td>{r.itemsSeen}</td>
            <td style={{ whiteSpace: 'pre-wrap', color: r.ok === false ? 'var(--danger)' : 'var(--muted)' }}>{r.error}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CourseMap({ sourceId, courses }: { sourceId: number; courses: Course[] }) {
  const qc = useQueryClient();
  const rows = useQuery({ queryKey: ['source-courses', sourceId], queryFn: () => Api.sourceCourses(sourceId) });
  const patch = useMutation({ mutationFn: ({ id, b }: { id: number; b: Partial<SourceCourse> }) => Api.updateSourceCourse(id, b), onSuccess: () => { qc.invalidateQueries({ queryKey: ['source-courses'] }); qc.invalidateQueries({ queryKey: ['todo'] }); qc.invalidateQueries({ queryKey: ['courses'] }); } });
  if (!rows.data?.length) return <Empty>No courses discovered yet. Sync first.</Empty>;
  return (
    <table className="runs">
      <thead><tr><th>On the site</th><th>Maps to</th><th>Ignore</th></tr></thead>
      <tbody>
        {rows.data.map((r: SourceCourse) => (
          <tr key={r.id} style={{ opacity: r.ignored ? 0.5 : 1 }}>
            <td>{r.name}{r.code && <span className="muted"> · {r.code}</span>}</td>
            <td><CourseSelect courses={courses} value={r.courseId} onChange={(courseId) => patch.mutate({ id: r.id, b: { courseId } })} /></td>
            <td><input type="checkbox" checked={r.ignored} onChange={(e) => patch.mutate({ id: r.id, b: { ignored: e.target.checked } })} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function Sources() {
  const qc = useQueryClient();
  const connectors = useQuery({ queryKey: ['connectors'], queryFn: Api.connectors });
  const sources = useQuery({ queryKey: ['sources'], queryFn: Api.sources, refetchInterval: 5000 });
  const courses = useQuery({ queryKey: ['courses'], queryFn: Api.courses });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Source | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [loginFor, setLoginFor] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const inv = () => { qc.invalidateQueries({ queryKey: ['sources'] }); qc.invalidateQueries({ queryKey: ['todo'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); qc.invalidateQueries({ queryKey: ['courses'] }); qc.invalidateQueries({ queryKey: ['runs'] }); };

  const create = useMutation({ mutationFn: Api.createSource, onSuccess: () => { setAdding(false); inv(); }, onError: setError });
  const update = useMutation({ mutationFn: ({ id, b }: { id: number; b: Partial<Source> }) => Api.updateSource(id, b), onSuccess: () => { setEditing(null); inv(); }, onError: setError });
  const remove = useMutation({ mutationFn: Api.deleteSource, onSuccess: inv, onError: setError });
  const sync = useMutation({ mutationFn: Api.syncSource, onSuccess: (r) => { inv(); if (!r.ok && r.error) setError(new Error(r.error)); }, onError: setError });
  const syncAll = useMutation({ mutationFn: Api.syncAll, onSuccess: () => setTimeout(inv, 2000) });
  const connect = useMutation({ mutationFn: Api.connectSource, onSuccess: (_r, id) => setLoginFor(id), onError: setError });
  const connectDone = useMutation({ mutationFn: Api.connectDone, onSuccess: (r) => { setLoginFor(null); inv(); if (!r.loggedIn) setError(new Error('Login not detected. Open Connect again and make sure you get all the way to the site home page before clicking Done.')); }, onError: setError });

  const connectorOf = (s: Source) => connectors.data?.find((c) => c.id === s.connector);

  return (
    <div>
      <div className="page-head">
        <h1>Sources</h1>
        <div className="toolbar">
          <button onClick={() => syncAll.mutate()} disabled={syncAll.isPending}>Sync all</button>
          <button className="primary" onClick={() => setAdding(true)}>+ Add source</button>
        </div>
      </div>
      <ErrorBox error={error} />
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="small muted">
          <b>How logins work:</b> for Brightspace and Gradescope, Connect opens a separate browser window. Sign in there like normal (Purdue SSO + Duo), then come back and click <b>Done</b>. Only the session cookie is kept, on this computer. Passwords are never seen by this app.
        </div>
      </div>
      {sources.data?.length === 0 && <div className="card"><Empty>No sources yet. Add Brightspace, Gradescope, the ENGR 131 site, and your work schedule feed.</Empty></div>}
      <div className="list" style={{ gap: 12 }}>
        {sources.data?.map((s) => {
          const c = connectorOf(s);
          const open = expanded === s.id;
          return (
            <div className="card" key={s.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontWeight: 600 }}>{s.name} <span className="muted small">· {c?.label ?? s.connector}</span></div>
                  <div className="sub small muted">
                    <span className={`chip status-${s.status}`}>{statusLabel[s.status] ?? s.status}</span>
                    {s.lastSyncAt && <span> Synced {formatDistanceToNow(new Date(s.lastSyncAt), { addSuffix: true })}</span>}
                    {s.courseId != null && <span> · {courses.data?.find((x) => x.id === s.courseId)?.code ?? 'course'}</span>}
                    {!s.enabled && <span> · paused</span>}
                  </div>
                  {s.lastError && s.status !== 'ok' && <div className="small" style={{ color: 'var(--danger)', marginTop: 4 }}>{s.lastError}</div>}
                </div>
                <div className="toolbar">
                  {c?.needsBrowser && loginFor !== s.id && <button className={s.status === 'needs_login' || s.status === 'never' ? 'primary' : ''} onClick={() => connect.mutate(s.id)} disabled={connect.isPending}>{s.status === 'ok' ? 'Reconnect' : 'Connect'}</button>}
                  {loginFor === s.id && <button className="primary" onClick={() => connectDone.mutate(s.id)} disabled={connectDone.isPending}>{connectDone.isPending ? 'Checking…' : "Done, I'm logged in"}</button>}
                  <button onClick={() => sync.mutate(s.id)} disabled={sync.isPending && sync.variables === s.id}>{sync.isPending && sync.variables === s.id ? 'Syncing…' : 'Sync now'}</button>
                  <button onClick={() => setEditing(s)}>Edit</button>
                  <button onClick={() => setExpanded(open ? null : s.id)}>{open ? 'Hide log' : 'Log'}</button>
                </div>
              </div>
              {loginFor === s.id && <div className="banner" style={{ marginTop: 12 }}>A browser window is open. Log in to {s.name} there, wait until you see the site's home page, then click "Done, I'm logged in".</div>}
              {open && (
                <div style={{ marginTop: 12 }}>
                  {(s.connector === 'brightspace' || s.connector === 'gradescope') && (<><h3>Courses</h3><CourseMap sourceId={s.id} courses={courses.data ?? []} /></>)}
                  <h3>Sync log</h3>
                  <RunsTable sourceId={s.id} />
                  <div className="toolbar" style={{ marginTop: 12 }}>
                    <button className="small" onClick={() => update.mutate({ id: s.id, b: { enabled: !s.enabled } })}>{s.enabled ? 'Pause syncing' : 'Resume syncing'}</button>
                    <button className="small danger" onClick={() => { if (confirm(`Remove ${s.name} and everything it synced?`)) remove.mutate(s.id); }}>Remove source</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {adding && connectors.data && (
        <Modal title="Add source" onClose={() => setAdding(false)}>
          <SourceForm connectors={connectors.data} courses={courses.data ?? []} onSave={(b) => create.mutate(b)} onCancel={() => setAdding(false)} />
        </Modal>
      )}
      {editing && connectors.data && (
        <Modal title="Edit source" onClose={() => setEditing(null)}>
          <SourceForm connectors={connectors.data} courses={courses.data ?? []} initial={editing} onSave={(b) => update.mutate({ id: editing.id, b: { name: b.name, config: b.config, courseId: b.courseId } })} onCancel={() => setEditing(null)} />
        </Modal>
      )}
    </div>
  );
}
