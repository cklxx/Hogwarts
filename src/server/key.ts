/**
 * Where a request carries the player's key: the Authorization header (`Bearer …`), `x-wizard-token`, or — for the
 * browser's WebSocket, which cannot set headers — a `hw-key.<key>` entry in Sec-WebSocket-Protocol next to
 * `hogwarts`. Never the query string: addresses end up in proxy and access logs (CLAUDE.md, docs/AGENT_LINK.md).
 */
import type { IncomingMessage } from 'node:http';
import { WS_KEY_PREFIX, WS_PROTOCOL } from '../shared/constants.js';

export function keyOf(req: IncomingMessage): string | undefined {
  const h = req.headers.authorization;
  if (h?.toLowerCase().startsWith('bearer ')) return h.slice(7).trim() || undefined;
  const x = req.headers['x-wizard-token'];
  if (typeof x === 'string' && x) return x;
  const p = req.headers['sec-websocket-protocol'];
  if (typeof p === 'string') for (const s of p.split(',')) { const t = s.trim(); if (t.startsWith(WS_KEY_PREFIX)) return t.slice(WS_KEY_PREFIX.length) || undefined; }
  return undefined;
}

/** ws `handleProtocols`: answer with `hogwarts` (never echo the key entry back). */
export const pickProtocol = (offered: Set<string>) => (offered.has(WS_PROTOCOL) ? WS_PROTOCOL : false);
