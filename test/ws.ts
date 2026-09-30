/**
 * What a test reads off a game socket, as messages: binary snapshot frames decoded ({t:'snap', s}, one decoder
 * per socket, as the browser has) and each batched event on its own ({t:'event', e}); every other message as sent.
 */
import type WebSocket from 'ws';
import { SnapDecoder } from '../src/shared/snapwire.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Msg = any;
const hubs = new WeakMap<WebSocket, Set<(m: Msg) => void>>();

/** Call `cb` with every message from now on; returns the function that stops it. */
export function onMsg(ws: WebSocket, cb: (m: Msg) => void): () => void {
  let subs = hubs.get(ws);
  if (!subs) {
    const set = new Set<(m: Msg) => void>(), dec = new SnapDecoder();
    subs = set;
    hubs.set(ws, set);
    ws.on('message', (raw, binary) => {
      const out: Msg[] = [];
      if (binary) { const s = dec.decode(new Uint8Array(raw as Buffer)); if (s) out.push({ t: 'snap', s }); }
      else {
        const m = JSON.parse(String(raw));
        if (m.t === 'evs') for (const e of m.es) out.push({ t: 'event', e });
        else out.push(m);
      }
      for (const m of out) for (const f of [...set]) f(m);
    });
  }
  subs.add(cb);
  return () => { subs!.delete(cb); };
}
