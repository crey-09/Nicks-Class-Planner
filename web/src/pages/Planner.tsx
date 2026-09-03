import { useCallback, useEffect, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin, { Draggable } from '@fullcalendar/interaction';
import type { EventClickArg, EventChangeArg, EventSourceFuncArg } from '@fullcalendar/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Api } from '../api/client';
import { toFcEvents } from '../lib/calendarEvents';
import { CourseChip, Empty, ErrorBox, Modal } from '../components/ui';
import { fmtDue, fmtRange } from '../lib/dates';
import type { TodoItem } from '@nick/shared';

export default function Planner() {
  const qc = useQueryClient();
  const ref = useRef<FullCalendar>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const courses = useQuery({ queryKey: ["courses"], queryFn: Api.courses });
  const coursesRef = useRef(courses.data ?? []);
  coursesRef.current = courses.data ?? [];
  const todo = useQuery({ queryKey: ['todo', false], queryFn: () => Api.todo() });
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<any>(null);
  const [filter, setFilter] = useState('');

  const refetch = () => { ref.current?.getApi().refetchEvents(); qc.invalidateQueries({ queryKey: ['dashboard'] }); };

  useEffect(() => {
    if (!listRef.current) return;
    const d = new Draggable(listRef.current, {
      itemSelector: '.drag-task',
      eventData: (el) => ({ title: el.getAttribute('data-title')!, duration: '01:00', extendedProps: { taskId: Number(el.getAttribute('data-task-id')) } }),
    });
    return () => d.destroy();
  }, []);

  const fetchEvents = useCallback(async (info: EventSourceFuncArg) => {
    const data = await Api.calendar(info.start.toISOString(), info.end.toISOString());
    return toFcEvents(data, coursesRef.current, { dueAllDay: true, editable: { block: true } });
  }, []);

  const removeBlock = useMutation({ mutationFn: (id: number) => Api.deleteBlock(id), onSuccess: () => { setSelected(null); refetch(); } });

  const items = (todo.data ?? []).filter((t: TodoItem) => !filter || t.title.toLowerCase().includes(filter.toLowerCase()) || (t.course?.code ?? '').toLowerCase().includes(filter.toLowerCase()));

  return (
    <div>
      <div className="page-head">
        <h1>Planner</h1>
        <div className="small muted">Drag a to-do onto the week to block time for it. Drag or resize blocks to adjust.</div>
      </div>
      <ErrorBox error={error} />
      <div className="planner-layout">
        <div className="card" style={{ position: 'sticky', top: 20, maxHeight: 'calc(100vh - 60px)', overflow: 'auto' }}>
          <h2 style={{ marginBottom: 8 }}>To-do</h2>
          <input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ marginBottom: 8 }} />
          <div ref={listRef}>
            {items.length === 0 && <Empty>No open to-dos.</Empty>}
            {items.map((t) => (
              <div className="drag-task" key={t.id} data-task-id={t.id} data-title={t.title}>
                <div>{t.title}</div>
                <div className="sub"><CourseChip course={t.course} /> {fmtDue(t.dueAt)}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <FullCalendar
            ref={ref}
            plugins={[timeGridPlugin, interactionPlugin]}
            initialView="timeGridWeek"
            headerToolbar={{ left: 'prev,next today', center: 'title', right: 'timeGridWeek,timeGridDay' }}
            height="auto"
            nowIndicator
            editable
            droppable
            slotMinTime="06:00:00"
            slotMaxTime="26:00:00"
            scrollTime="08:00:00"
            firstDay={1}
            allDaySlot
            allDayText="Due"
            events={fetchEvents}
            eventReceive={async (info) => {
              const taskId = info.event.extendedProps.taskId as number;
              const start = info.event.start!;
              const end = info.event.end ?? new Date(start.getTime() + 3600_000);
              info.event.remove();
              try { await Api.createBlock({ taskId, startAt: start.toISOString(), endAt: end.toISOString() }); refetch(); }
              catch (e) { setError(e); }
            }}
            eventChange={async (arg: EventChangeArg) => {
              const { type, id } = arg.event.extendedProps as any;
              if (type !== 'block') return arg.revert();
              try { await Api.updateBlock(id, { startAt: arg.event.start!.toISOString(), endAt: arg.event.end!.toISOString() }); }
              catch (e) { setError(e); arg.revert(); }
            }}
            eventClick={(arg: EventClickArg) => {
              arg.jsEvent.preventDefault();
              const { type, data } = arg.event.extendedProps as any;
              if (type === 'block' || type === 'due') setSelected({ type, data });
            }}
          />
        </div>
      </div>
      {selected?.type === 'block' && (
        <Modal title="Planned work" onClose={() => setSelected(null)}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{selected.data.task.title}</div>
          <div className="small muted">{fmtRange(selected.data.startAt, selected.data.endAt)}</div>
          <div className="form-actions">
            <button className="danger" style={{ marginRight: 'auto' }} onClick={() => removeBlock.mutate(selected.data.id)}>Remove block</button>
            <button onClick={async () => { await Api.updateTask(selected.data.task.id, { done: true }); setSelected(null); refetch(); qc.invalidateQueries({ queryKey: ['todo'] }); }}>Mark task done</button>
          </div>
        </Modal>
      )}
      {selected?.type === 'due' && (
        <Modal title="Due" onClose={() => setSelected(null)}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{selected.data.title}</div>
          <div className="small muted">{fmtDue(selected.data.dueAt)}</div>
          {selected.data.assignment?.url && <div style={{ marginTop: 10 }}><a href={selected.data.assignment.url} target="_blank" rel="noreferrer">Open on course site ↗</a></div>}
        </Modal>
      )}
    </div>
  );
}
