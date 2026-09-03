import type { Connector } from './types.js';

/** A bookmark for a course site that has no connector yet. Shows up on the Courses hub. */
export const linkConnector: Connector = {
  id: 'link',
  label: 'Link only',
  description: 'Just a bookmark on the course hub. Use for sites that have nothing to sync (yet).',
  needsBrowser: false,
  configFields: [
    { key: 'url', label: 'Site URL', type: 'url', required: true },
  ],
  async sync(ctx) {
    const url = String(ctx.config.url || '');
    if (!url || ctx.source.courseId == null) return {};
    return { courses: [{ key: 'link', name: ctx.source.name, url }] };
  },
};
