import type { Connector } from './types.js';
import { pushToGoogle, pullFromGoogle } from '../google/calendar.js';

/** Google Calendar as a source: pull the primary calendar in, push our items out. Connected via OAuth in Settings. */
export const googleConnector: Connector = {
  id: 'google',
  label: 'Google Calendar',
  description: 'Two-way sync with your Google Calendar. Connect it from Settings.',
  needsBrowser: false,
  configFields: [],
  async sync(ctx) {
    const pulled = await pullFromGoogle(ctx.db);
    const pushed = await pushToGoogle(ctx.db);
    ctx.log(`Google: pulled ${pulled.length} events, ${pushed} changes pushed`);
    return { events: pulled };
  },
};
