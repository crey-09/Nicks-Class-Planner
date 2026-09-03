import { useCallback, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventClickArg, EventChangeArg, DateSelectArg, EventSourceFuncArg } from '@fullcalendar/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Api } from '../api/client';
import { toFcEvents, colors } from '../lib/calendarEvents';
import { ErrorBox, Field, Modal } from '../components/ui';
import { fmtDue, fmtRange, fromLocalInput, toLocalInput } from '../lib/dates';
import type { CalendarEvent, Shift, TodoItem } from '@nick/shared';

type Selected = { type: 'shift'; data: Shift } | { type: 'event'; data: CalendarEvent } | { type: 'due'; data: TodoItem } | { type: 'block'; data: any } | null;

function ItemForm({ initial, onSave, onCancel, onDelete, googleConnected }: {
  initial: { type: 'shift' | 'event'; title?: string; startAt: string; endAt: string; location?: string | null; allDay?: boolean; kind?: string; notes?: string | null; attendees?: string[] };
  onSave: (b: any) => void; onCancel: () => void; onDelete?: () => void; googleConnected?: boolean;
}) {
  const [type, setType] = useState(initial.type);
  const [title, setTitle] = useState(initial.title ?? '');
  const [start, setStart] = useState(toLocalInput(initial.startAt));
  const [end, setEnd] = useState(toLocalInput(initial.endAt));
  const [location, setLocation] = useState(initial.location ?? '');
  const [allDay, setAllDay] = useState(initial.allDay ?? false);
  const [kind, setKind] = useState(initial.kind ?? 'other');
  const [notes, setNotes] = useState(initial.notes ?? '');
  const [attendees, setAttendees] = useState((initial.attendees ?? []).join(', '));
  const [sendInvite, setSendInvite] = useState(false);
  const [meet, setMeet] = useState(false);
  const isNew = !onDelete;
  return (
    <form className="form" onSubmit={(e) => {
      e.preventDefault();
      const base = { startAt: fromLocalInput(start), endAt: fromLocalInput(end), location: location || null, notes: notes || null };
      onSave(type === 'shift' ? { type, ...base } : { type, ...base, title: title.trim(), allDay, kind, attendees: attendees.split(',').map((s) => s.trim()).filter(Boolean), sendInvite: isNew && sendInvite, meet });
    }}>
      {isNew && (
        <Field label="What is it?">
          <select value={type} onChange={(e) => setType(e.target.value as any)}><option value="event">Event / class / meeting</option><option value="shift">Work shift</option></select>
        </Field>
      )}
      {type === 'event' && <Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus /></Field>}
      <div className="form-row">
        <Field label="Starts"><input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required /></Field>
        <Field label="Ends"><input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required /></Field>
      </div>
      <div className="form-row">
        <Field label={type === 'shift' ? 'Where (job / location)' : 'Location'}><input value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
        {type === 'event' && <Field label="Type"><select value={kind} onChange={(e) => setKind(e.target.value)}><option value="class">Class</option><option value="meeting">Meeting</option><option value="other">Other</option></select></Field>}
      </div>
      {type === 'event' && <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> All day</label>}
      {type === 'event' && <Field label="Attendees (emails, comma separated)"><input value={attendees} onChange={(e) => setAttendees(e.target.value)} /></Field>}
      {type === 'event' && isNew && googleConnected && (
        <div className="form-row">
          <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={sendInvite} onChange={(e) => setSendInvite(e.target.checked)} /> Put on Google Calendar and email invites</label>
          {sendInvite && <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={meet} onChange={(e) => setMeet(e.target.checked)} /> Add a Google Meet link</label>}
        </div>
      )}
      <Field label="Notes"><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <div className="form-actions">
        {onDelete && <button type="button" className="danger" style={{ marginRight: 'auto' }} onClick={onDelete}>Delete</button>}
        <button type="button" onClick={onCancel}>Cancel</button>
        <button className="primary">Save</button>
      </div>
    </form>
  );
}

export default function Calendar() {
  const qc = useQueryClient();
  const ref = useRef<FullCalendar>(null);
  const courses = useQuery({ queryKey: ["courses"], queryFn: Api.courses });
  const google = useQuery({ queryKey: ['google'], queryFn: Api.googleStatus, retry: false });
  const coursesRef = useRef(courses.data ?? []);
  coursesRef.current = courses.data ?? [];
  const [selected, setSelected] = useState<Selected>(null);
  const [creating, setCreating] = useState<{ startAt: string; endAt: string; allDay: boolean } | null>(null);
  const [error, setError] = useState<unknown>(null);

  const refetch = () => { ref.current?.getApi().refetchEvents(); qc.invalidateQueries({ queryKey: ['dashboard'] }); qc.invalidateQueries({ queryKey: ['todo'] }); };
  const fetchEvents = useCallback(async (info: EventSourceFuncArg) => {
    const data = await Api.calendar(info.start.toISOString(), info.end.toISOString());
    return toFcEvents(data, coursesRef.current, { editable: { shift: true, event: true, block: true } });
  }, []);

  const save = useMutation({
    mutationFn: async (b: any) => {
      const { type, sendInvite, meet, ...body } = b;
      if (selected && selected.type === type) return type === 'shift' ? Api.updateShift(selected.data.id, body) : Api.updateEvent(selected.data.id, body);
      if (type === 'event' && sendInvite) return Api.createMeeting({ title: body.title, startAt: body.startAt, endAt: body.endAt, attendees: body.attendees, location: body.location ?? undefined, notes: body.notes ?? undefined, meet });
      return type === 'shift' ? Api.createShift(body) : Api.createEvent(body);
    },
    onSuccess: () => { setSelected(null); setCreating(null); setError(null); refetch(); },
    onError: setError,
  });
  const remove = useMutation({
    mutationFn: async () => {
      if (!selected) return;
      if (selected.type === 'shift') return Api.deleteShift(selected.data.id);
      if (selected.type === 'event') return Api.deleteEvent(selected.data.id);
      if (selected.type === 'block') return Api.deleteBlock(selected.data.id);
    },
    onSuccess: () => { setSelected(null); refetch(); },
    onError: setError,
  });

  const onEventChange = async (arg: EventChangeArg) => {
    const { type, id } = arg.event.extendedProps as { type: string; id: number };
    const startAt = arg.event.start!.toISOString();
    const endAt = (arg.event.end ?? new Date(arg.event.start!.getTime() + 3600_000)).toISOString();
    try {
      if (type === 'shift') await Api.updateShift(id, { startAt, endAt });
      else if (type === 'event') await Api.updateEvent(id, { startAt, endAt, allDay: arg.event.allDay });
      else if (type === 'block') await Api.updateBlock(id, { startAt, endAt });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (e) { setError(e); arg.revert(); }
  };

  const onClick = (arg: EventClickArg) => {
    arg.jsEvent.preventDefault();
    const { type, data } = arg.event.extendedProps as any;
    setSelected({ type, data });
  };

  const onSelect = (arg: DateSelectArg) => {
    setCreating({ startAt: arg.start.toISOString(), endAt: arg.end.toISOString(), allDay: arg.allDay });
    ref.current?.getApi().unselect();
  };

  return (
    <div>
      <div className="page-head">
        <h1>Calendar</h1>
        <div className="legend" style={{ ['--c' as any]: '' }}>
          <span style={{ ['--c' as any]: colors.due }}>Due</span>
          <span style={{ ['--c' as any]: colors.shift }}>Work</span>
          <span style={{ ['--c' as any]: colors.event }}>Events</span>
          <span style={{ ['--c' as any]: colors.block }}>Planned work</span>
        </div>
        <button className="primary" onClick={() => { const s = new Date(); s.setMinutes(0, 0, 0); s.setHours(s.getHours() + 1); setCreating({ startAt: s.toISOString(), endAt: new Date(s.getTime() + 3600_000).toISOString(), allDay: false }); }}>+ Add</button>
      </div>
      <ErrorBox error={error} />
      <div className="card">
        <FullCalendar
          ref={ref}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek' }}
          height="auto"
          nowIndicator
          selectable
          selectMirror
          editable
          eventStartEditable
          eventDurationEditable
          slotMinTime="06:00:00"
          slotMaxTime="26:00:00"
          scrollTime="08:00:00"
          events={fetchEvents}
          eventClick={onClick}
          eventChange={onEventChange}
          select={onSelect}
          firstDay={1}
        />
      </div>

      {creating && (
        <Modal title="Add to calendar" onClose={() => setCreating(null)}>
          <ItemForm initial={{ type: 'event', ...creating }} onSave={(b) => save.mutate(b)} onCancel={() => setCreating(null)} googleConnected={!!google.data?.connected} />
        </Modal>
      )}
      {selected && (selected.type === 'shift' || selected.type === 'event') && (
        <Modal title={selected.type === 'shift' ? 'Work shift' : 'Event'} onClose={() => setSelected(null)}>
          <ItemForm
            initial={{ type: selected.type, ...(selected.data as any) }}
            onSave={(b) => save.mutate(b)}
            onCancel={() => setSelected(null)}
            onDelete={() => remove.mutate()}
          />
        </Modal>
      )}
      {selected && selected.type === 'due' && (
        <Modal title="Due" onClose={() => setSelected(null)}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{selected.data.title}</div>
          <div className="small muted">{fmtDue(selected.data.dueAt)}{selected.data.course ? ` · ${selected.data.course.code ?? selected.data.course.name}` : ''}</div>
          {selected.data.assignment?.url && <div style={{ marginTop: 10 }}><a href={selected.data.assignment.url} target="_blank" rel="noreferrer">Open on course site ↗</a></div>}
          <div className="form-actions">
            <button onClick={async () => { await Api.updateTask(selected.data.id, { done: !selected.data.done }); setSelected(null); refetch(); }}>{selected.data.done ? 'Mark not done' : 'Mark done'}</button>
          </div>
        </Modal>
      )}
      {selected && selected.type === 'block' && (
        <Modal title="Planned work" onClose={() => setSelected(null)}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{selected.data.task.title}</div>
          <div className="small muted">{fmtRange(selected.data.startAt, selected.data.endAt)}</div>
          <div className="form-actions">
            <button className="danger" style={{ marginRight: 'auto' }} onClick={() => remove.mutate()}>Remove block</button>
            <button onClick={async () => { await Api.updateTask(selected.data.task.id, { done: true }); setSelected(null); refetch(); }}>Mark task done</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
