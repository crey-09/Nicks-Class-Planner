import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Api } from '../api/client';
import { Empty, ErrorBox, Field, Modal } from '../components/ui';
import { fmtDue } from '../lib/dates';
import type { Course } from '@nick/shared';

const palette = ['#4f46e5', '#0ea5e9', '#16a34a', '#d97706', '#dc2626', '#db2777', '#7c3aed', '#0d9488'];

function CourseForm({ initial, onSave, onCancel }: { initial: Partial<Course>; onSave: (b: Partial<Course>) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial.name ?? '');
  const [code, setCode] = useState(initial.code ?? '');
  const [color, setColor] = useState(initial.color ?? palette[Math.floor(Math.random() * palette.length)]);
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); onSave({ name: name.trim(), code: code.trim() || null, color }); }}>
      <div className="form-row">
        <Field label="Code"><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ENGR 131" /></Field>
        <Field label="Color"><input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></Field>
      </div>
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Transforming Ideas to Innovation I" required autoFocus /></Field>
      <div className="form-actions"><button type="button" onClick={onCancel}>Cancel</button><button className="primary" disabled={!name.trim()}>Save</button></div>
    </form>
  );
}

export default function Courses() {
  const qc = useQueryClient();
  const courses = useQuery({ queryKey: ['courses'], queryFn: Api.courses });
  const links = useQuery({ queryKey: ['links'], queryFn: Api.links });
  const todo = useQuery({ queryKey: ['todo', false], queryFn: () => Api.todo() });
  const [editing, setEditing] = useState<Course | null>(null);
  const [adding, setAdding] = useState(false);
  const [linkFor, setLinkFor] = useState<number | null>(null);
  const [linkLabel, setLinkLabel] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const inv = () => { qc.invalidateQueries({ queryKey: ['courses'] }); qc.invalidateQueries({ queryKey: ['links'] }); qc.invalidateQueries({ queryKey: ['todo'] }); };

  const save = useMutation({ mutationFn: (b: Partial<Course>) => editing ? Api.updateCourse(editing.id, b) : Api.createCourse(b), onSuccess: () => { setEditing(null); setAdding(false); inv(); } });
  const del = useMutation({ mutationFn: Api.deleteCourse, onSuccess: () => { setEditing(null); inv(); } });
  const addLink = useMutation({ mutationFn: Api.createLink, onSuccess: () => { setLinkFor(null); setLinkLabel(''); setLinkUrl(''); inv(); } });
  const delLink = useMutation({ mutationFn: Api.deleteLink, onSuccess: inv });

  return (
    <div>
      <div className="page-head"><h1>Courses</h1><button className="primary" onClick={() => setAdding(true)}>+ Add course</button></div>
      <ErrorBox error={save.error ?? addLink.error} />
      {courses.data?.length === 0 && <div className="card"><Empty>Add each of your classes here. Each one gets a hub of links so you only have to remember one place.</Empty></div>}
      <div className="grid cols-2">
        {courses.data?.map((c) => {
          const cl = (links.data ?? []).filter((l) => l.courseId === c.id);
          const upcoming = (todo.data ?? []).filter((t) => t.courseId === c.id).slice(0, 4);
          return (
            <div className="card course-card" key={c.id} style={{ borderTopColor: c.color }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div><h2>{c.code ?? c.name}</h2>{c.code && <div className="small muted">{c.name}</div>}</div>
                <div className="toolbar">
                  {cl.length > 0 && <button className="small" onClick={() => cl.forEach((l) => window.open(l.url, '_blank'))}>Open all sites</button>}
                  <button className="small" onClick={() => setEditing(c)}>Edit</button>
                </div>
              </div>
              <h3>Sites</h3>
              <div className="links">
                {cl.length === 0 && <div className="small muted">No links yet.</div>}
                {cl.map((l) => (
                  <div className="row" key={l.id} style={{ padding: '4px 0' }}>
                    <a href={l.url} target="_blank" rel="noreferrer" className="grow">{l.label} ↗</a>
                    <div className="actions"><button className="icon-btn small" onClick={() => delLink.mutate(l.id)} title="Remove link">✕</button></div>
                  </div>
                ))}
                {linkFor === c.id ? (
                  <form className="form" style={{ marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); addLink.mutate({ courseId: c.id, label: linkLabel.trim(), url: linkUrl.trim() }); }}>
                    <div className="form-row">
                      <input placeholder="Label (Brightspace, Gradescope…)" value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} autoFocus required />
                      <input placeholder="https://…" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} required type="url" />
                    </div>
                    <div className="form-actions"><button type="button" className="small" onClick={() => setLinkFor(null)}>Cancel</button><button className="primary small">Add</button></div>
                  </form>
                ) : <button className="small" style={{ marginTop: 6 }} onClick={() => setLinkFor(c.id)}>+ Add link</button>}
              </div>
              <h3>Upcoming</h3>
              {upcoming.length === 0 && <div className="small muted">Nothing due.</div>}
              {upcoming.map((t) => (
                <div className="row" key={t.id} style={{ padding: '4px 0' }}>
                  <div className="grow title">{t.title}</div>
                  <div className="due">{fmtDue(t.dueAt)}</div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {(adding || editing) && (
        <Modal title={editing ? 'Edit course' : 'Add course'} onClose={() => { setAdding(false); setEditing(null); }}>
          <CourseForm initial={editing ?? {}} onSave={(b) => save.mutate(b)} onCancel={() => { setAdding(false); setEditing(null); }} />
          {editing && <button className="danger small" style={{ marginTop: 12 }} onClick={() => { if (confirm(`Delete ${editing.code ?? editing.name}? Its links and tasks lose their course.`)) del.mutate(editing.id); }}>Delete course</button>}
        </Modal>
      )}
    </div>
  );
}
