import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Api } from '../api/client';
import { CourseChip, Empty, ErrorBox } from '../components/ui';
import { fmtDue, fmtTime, fmtRange } from '../lib/dates';
import type { TodoItem } from '@nick/shared';

function TodoRow({ item, onToggle }: { item: TodoItem; onToggle: (done: boolean) => void }) {
  const overdue = item.dueAt && new Date(item.dueAt) < new Date();
  return (
    <div className="row">
      <input type="checkbox" checked={item.done} onChange={(e) => onToggle(e.target.checked)} />
      <div className="grow">
        <div className={'title' + (item.done ? ' done' : '')}>
          {item.assignment?.url ? <a href={item.assignment.url} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>{item.title}</a> : item.title}
        </div>
        <div className="sub"><CourseChip course={item.course} />{item.assignment && <span className="chip kind">{item.assignment.kind}</span>}</div>
      </div>
      <div className={'due' + (overdue ? ' overdue' : '')}>{fmtDue(item.dueAt)}</div>
    </div>
  );
}

export default function Dashboard() {
  const qc = useQueryClient();
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: Api.dashboard, refetchInterval: 60_000 });
  const [quick, setQuick] = useState('');
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['dashboard'] }); qc.invalidateQueries({ queryKey: ['todo'] }); };
  const toggle = useMutation({ mutationFn: ({ id, done }: { id: number; done: boolean }) => Api.updateTask(id, { done }), onSuccess: invalidate });
  const add = useMutation({ mutationFn: (title: string) => Api.createTask({ title }), onSuccess: () => { setQuick(''); invalidate(); } });

  const d = dash.data;
  const today = new Date();
  return (
    <div>
      <div className="page-head">
        <h1>{today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h1>
        <form className="inline-form" style={{ minWidth: 360 }} onSubmit={(e) => { e.preventDefault(); if (quick.trim()) add.mutate(quick.trim()); }}>
          <input placeholder="Quick add a to-do…" value={quick} onChange={(e) => setQuick(e.target.value)} />
          <button className="primary" disabled={!quick.trim() || add.isPending}>Add</button>
        </form>
      </div>
      <ErrorBox error={dash.error} />
      {d?.needsLogin.map((s) => (
        <div className="banner" key={s.id}>
          <span>⚠️ <b>{s.name}</b> needs you to log in again before it can sync.</span>
          <Link to="/sources"><button className="small">Go to Sources</button></Link>
        </div>
      ))}
      {d?.setup.map((n) => (
        <div className="banner" key={'setup' + n.sourceId} style={{ background: 'var(--accent-soft)', borderColor: 'var(--accent)' }}>
          <span>🎓 {n.message}</span>
          <Link to="/sources"><button className="small">Set it up</button></Link>
        </div>
      ))}
      <div className="grid cols-3">
        <div className="card">
          <div className="stat" style={{ color: d?.overdue.length ? 'var(--danger)' : undefined }}>{d?.overdue.length ?? '–'}</div>
          <div className="stat-label">Overdue</div>
        </div>
        <div className="card">
          <div className="stat">{d?.dueSoon.length ?? '–'}</div>
          <div className="stat-label">Due in the next 7 days</div>
        </div>
        <div className="card">
          <div className="stat">{d ? d.todayShifts.length + d.todayEvents.length : '–'}</div>
          <div className="stat-label">Shifts and events today</div>
        </div>
      </div>
      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div>
          {d && d.overdue.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <h2 style={{ color: 'var(--danger)' }}>Overdue</h2>
              <div className="list">{d.overdue.map((t) => <TodoRow key={t.id} item={t} onToggle={(done) => toggle.mutate({ id: t.id, done })} />)}</div>
            </div>
          )}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h2>Due this week</h2><Link to="/todo" className="small">Full list →</Link></div>
            <div className="list">
              {d?.dueSoon.length === 0 && <Empty>Nothing due in the next 7 days. 🎉</Empty>}
              {d?.dueSoon.map((t) => <TodoRow key={t.id} item={t} onToggle={(done) => toggle.mutate({ id: t.id, done })} />)}
            </div>
          </div>
        </div>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h2>Today</h2><Link to="/planner" className="small">Planner →</Link></div>
          {d && d.todayShifts.length + d.todayEvents.length + d.todayBlocks.length === 0 && <Empty>Nothing scheduled today.</Empty>}
          {d?.todayShifts.map((s) => (
            <div className="row" key={'s' + s.id}>
              <span className="chip" style={{ color: 'var(--shift)', borderColor: 'var(--shift)' }}>Work</span>
              <div className="grow"><div className="title">{s.location ?? 'Shift'}</div></div>
              <div className="due">{fmtTime(s.startAt)} – {fmtTime(s.endAt)}</div>
            </div>
          ))}
          {d?.todayEvents.map((e) => (
            <div className="row" key={'e' + e.id}>
              <span className="chip" style={{ color: 'var(--event)', borderColor: 'var(--event)' }}>{e.kind}</span>
              <div className="grow"><div className="title">{e.title}</div>{e.location && <div className="sub">{e.location}</div>}</div>
              <div className="due">{e.allDay ? 'All day' : `${fmtTime(e.startAt)} – ${fmtTime(e.endAt)}`}</div>
            </div>
          ))}
          {d?.todayBlocks.map((b) => (
            <div className="row" key={'b' + b.id}>
              <span className="chip" style={{ color: 'var(--block)', borderColor: 'var(--block)' }}>Plan</span>
              <div className="grow"><div className="title">{b.task.title}</div></div>
              <div className="due">{fmtRange(b.startAt, b.endAt).split(' · ')[1]}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
