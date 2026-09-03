import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Api } from '../api/client';
import { CourseChip, CourseSelect, Empty, ErrorBox, Field, Modal } from '../components/ui';
import { bucketOrder, dueBucket, fmtDue, fromLocalInput, toLocalInput } from '../lib/dates';
import type { Course, TodoItem } from '@nick/shared';

function TaskForm({ initial, courses, onSave, onCancel, onDelete }: {
  initial: Partial<TodoItem>; courses: Course[];
  onSave: (b: { title: string; dueAt: string | null; courseId: number | null; notes: string | null }) => void;
  onCancel: () => void; onDelete?: () => void;
}) {
  const [title, setTitle] = useState(initial.title ?? '');
  const [due, setDue] = useState(toLocalInput(initial.dueAt));
  const [courseId, setCourseId] = useState<number | null>(initial.courseId ?? null);
  const [notes, setNotes] = useState(initial.notes ?? '');
  const synced = !!initial.assignment;
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); onSave({ title: title.trim(), dueAt: fromLocalInput(due), courseId, notes: notes || null }); }}>
      <Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required disabled={synced} /></Field>
      <div className="form-row">
        <Field label="Due"><input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <Field label="Course"><CourseSelect courses={courses} value={courseId} onChange={setCourseId} /></Field>
      </div>
      <Field label="Notes"><textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      {synced && initial.assignment?.url && <div className="small muted">Synced from a course site. <a href={initial.assignment.url} target="_blank" rel="noreferrer">Open assignment ↗</a></div>}
      <div className="form-actions">
        {onDelete && <button type="button" className="danger" onClick={onDelete} style={{ marginRight: 'auto' }}>{synced ? 'Hide' : 'Delete'}</button>}
        <button type="button" onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={!title.trim()}>Save</button>
      </div>
    </form>
  );
}

export default function Todo() {
  const qc = useQueryClient();
  const [showDone, setShowDone] = useState(false);
  const [courseFilter, setCourseFilter] = useState<number | null>(null);
  const [groupBy, setGroupBy] = useState<'due' | 'course'>('due');
  const [editing, setEditing] = useState<TodoItem | null>(null);
  const [adding, setAdding] = useState(false);

  const todo = useQuery({ queryKey: ['todo', showDone], queryFn: () => Api.todo({ includeDone: showDone }) });
  const courses = useQuery({ queryKey: ['courses'], queryFn: Api.courses });
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['todo'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); qc.invalidateQueries({ queryKey: ['calendar'] }); };
  const toggle = useMutation({ mutationFn: ({ id, done }: { id: number; done: boolean }) => Api.updateTask(id, { done }), onSuccess: invalidate });
  const save = useMutation({
    mutationFn: (b: { id?: number } & Parameters<typeof Api.createTask>[0]) => b.id ? Api.updateTask(b.id, b) : Api.createTask(b),
    onSuccess: () => { setEditing(null); setAdding(false); invalidate(); },
  });
  const remove = useMutation({ mutationFn: (id: number) => Api.deleteTask(id), onSuccess: () => { setEditing(null); invalidate(); } });

  const items = useMemo(() => (todo.data ?? []).filter((t) => courseFilter == null || t.courseId === courseFilter), [todo.data, courseFilter]);
  const groups = useMemo(() => {
    const m = new Map<string, TodoItem[]>();
    if (groupBy === 'due') {
      for (const b of bucketOrder) m.set(b, []);
      for (const t of items) m.get(dueBucket(t.dueAt))!.push(t);
    } else {
      for (const t of items) {
        const k = t.course ? (t.course.code ?? t.course.name) : 'No course';
        if (!m.has(k)) m.set(k, []);
        m.get(k)!.push(t);
      }
    }
    return [...m.entries()].filter(([, v]) => v.length);
  }, [items, groupBy]);

  return (
    <div>
      <div className="page-head">
        <h1>To-do</h1>
        <div className="toolbar">
          <select value={courseFilter ?? ''} onChange={(e) => setCourseFilter(e.target.value ? Number(e.target.value) : null)}>
            <option value="">All courses</option>
            {courses.data?.map((c) => <option key={c.id} value={c.id}>{c.code ?? c.name}</option>)}
          </select>
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as any)}>
            <option value="due">Group by due date</option>
            <option value="course">Group by course</option>
          </select>
          <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show done</label>
          <button className="primary" onClick={() => setAdding(true)}>+ New to-do</button>
        </div>
      </div>
      <ErrorBox error={todo.error ?? save.error ?? remove.error} />
      {todo.data?.length === 0 && <div className="card"><Empty>Nothing here yet. Add a to-do, or connect a course site under Sources.</Empty></div>}
      {groups.map(([name, list]) => (
        <div key={name}>
          <h3 style={{ color: name === 'Overdue' ? 'var(--danger)' : undefined }}>{name} <span className="muted" style={{ fontWeight: 400 }}>({list.length})</span></h3>
          <div className="card list" style={{ padding: '4px 12px' }}>
            {list.map((t) => {
              const bucket = dueBucket(t.dueAt);
              return (
                <div className="row" key={t.id}>
                  <input type="checkbox" checked={t.done} onChange={(e) => toggle.mutate({ id: t.id, done: e.target.checked })} />
                  <div className="grow" onClick={() => setEditing(t)} style={{ cursor: 'pointer' }}>
                    <div className={'title' + (t.done ? ' done' : '')}>{t.title}</div>
                    <div className="sub">
                      <CourseChip course={t.course} />
                      {t.assignment && <span className="chip kind">{t.assignment.kind}</span>}
                      {t.assignment?.points != null && <span>{t.assignment.points} pts</span>}
                      {t.assignment?.grade && <span>Grade: {t.assignment.grade}</span>}
                      {t.assignment?.dueText && !t.dueAt && <span>Due: {t.assignment.dueText}</span>}
                      {t.notes && <span>📝</span>}
                    </div>
                  </div>
                  {t.assignment?.url && <a href={t.assignment.url} target="_blank" rel="noreferrer" className="small" title="Open on course site">↗</a>}
                  <div className={'due' + (bucket === 'Overdue' ? ' overdue' : bucket === 'Today' ? ' today' : '')}>{fmtDue(t.dueAt)}</div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {(adding || editing) && (
        <Modal title={editing ? 'Edit to-do' : 'New to-do'} onClose={() => { setEditing(null); setAdding(false); }}>
          <TaskForm
            initial={editing ?? {}}
            courses={courses.data ?? []}
            onSave={(b) => save.mutate({ id: editing?.id, ...b })}
            onCancel={() => { setEditing(null); setAdding(false); }}
            onDelete={editing ? () => remove.mutate(editing.id) : undefined}
          />
        </Modal>
      )}
    </div>
  );
}
