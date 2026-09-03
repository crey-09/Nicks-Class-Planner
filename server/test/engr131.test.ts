import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseEngr131Schedule } from '../src/connectors/engr131.js';

const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'engr131_schedule.html'), 'utf8');
const opts = { meetingDays: ['Mon', 'Wed'], classTime: '08:30', timezone: 'America/Indiana/Indianapolis' };

describe('ENGR 131 schedule parser', () => {
  const parsed = parseEngr131Schedule(html, opts);

  it('reads the semester and week dates', () => {
    expect(parsed.semester).toMatch(/Fall 2026/);
    expect(parsed.weeks[0]).toEqual({ n: 1, monday: '2026-08-24' });
    expect(parsed.weeks.length).toBeGreaterThan(10);
  });

  it('resolves explicit due dates in Indiana time', () => {
    const tm = parsed.assignments.find((a) => a.externalId === 'TM 2.1.0')!;
    expect(tm.title).toContain('CATME');
    expect(tm.dueAt).toBe('2026-08-29T03:59:00.000Z'); // 8/28/26 11:59 PM EDT
    expect(tm.points).toBe(5);
  });

  it('resolves "Class 1B" to the second meeting of week 1 at class time', () => {
    const ex = parsed.assignments.find((a) => a.externalId === 'EX 3.1.2')!;
    expect(ex.dueText).toBe('Class 1B');
    expect(ex.dueAt).toBe('2026-08-26T12:30:00.000Z'); // Wed 8/26 08:30 EDT
    expect(ex.kind).toBe('homework');
    const pcm = parsed.assignments.find((a) => a.externalId === 'EX 3.1.1')!;
    expect(pcm.points).toBeNull();
    expect(pcm.kind).toBe('reading');
  });

  it('uses the section meeting days', () => {
    const tr = parseEngr131Schedule(html, { ...opts, meetingDays: ['Tue', 'Thu'] });
    expect(tr.assignments.find((a) => a.externalId === 'EX 3.1.2')!.dueAt).toBe('2026-08-27T12:30:00.000Z');
  });

  it('includes exams and leaves nothing unresolved', () => {
    const exam = parsed.assignments.find((a) => a.externalId === 'EXAM 1')!;
    expect(exam.kind).toBe('exam');
    expect(exam.dueAt).not.toBeNull();
    expect(parsed.unresolved).toEqual([]);
    expect(parsed.assignments.length).toBeGreaterThan(40);
  });
});
