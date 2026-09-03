import type { ConnectorId, ConnectorInfo } from '@nick/shared';
import type { Connector } from './types.js';
import { engr131 } from './engr131.js';
import { icsConnector } from './ics.js';
import { linkConnector } from './link.js';
import { brightspace } from './brightspace.js';
import { gradescope } from './gradescope.js';
import { googleConnector } from './google.js';

const all: Connector[] = [brightspace, gradescope, engr131, icsConnector, linkConnector, googleConnector];
const byId = new Map(all.map((c) => [c.id, c]));

export function getConnector(id: string): Connector {
  const c = byId.get(id as ConnectorId);
  if (!c) throw new Error(`Unknown connector: ${id}`);
  return c;
}

export function listConnectors(): ConnectorInfo[] {
  return all.filter((c) => c.id !== 'google').map(({ id, label, description, needsBrowser, configFields }) => ({ id, label, description, needsBrowser, configFields }));
}
