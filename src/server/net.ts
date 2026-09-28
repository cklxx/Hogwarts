import type { WebSocket } from 'ws';

/**
 * Per-socket network hygiene for the 3D-client WebSocket:
 *  - token-bucket rate limits per message kind (and overall), applied BEFORE handleClient runs;
 *  - back-pressure: snapshots are skipped for a socket whose send buffer is backing up, and a socket
 *    that stops reading altogether is dropped (snapshots are idempotent state, so skipping is safe);
 *  - bookkeeping for the private 'me' message, which is sent only when it changed, at most 5 Hz;
 *  - batching: queued events + snapshot + 'me' leave in one corked socket write per broadcast.
 */

/** [refill per second, burst] — generous for real browsers (input ≤ 20 Hz, casts gated by a 0.25 s cooldown). */
export const LIMITS: Record<string, [number, number]> = {
  input: [40, 60],
  cast: [10, 15],
  chat: [1, 5],
  simulate: [4, 8],
  forge: [2, 5],
  other: [8, 16],
  all: [80, 120],
};

/** Skip snapshots while more than this is queued for the socket. */
export const SLOW_BYTES = Number(process.env.WS_SLOW_BYTES ?? 1 << 20);
/** Drop the connection when this much is queued (it is not reading at all). */
export const DEAD_BYTES = Number(process.env.WS_DEAD_BYTES ?? 16 << 20);

interface Bucket { tokens: number; at: number }
export interface NetState {
  buckets: Map<string, Bucket>;
  /** Last private state sent. */
  lastMe: string;
  /** Events waiting for the next broadcast. */
  outbox: Buffer[];
  /** Stagger the 5 Hz private-state updates across sockets. */
  phase: number;
  skipped: number;
  dropped: number;
  warnedAt: number;
}

const states = new WeakMap<WebSocket, NetState>();
let seq = 0;

export function netState(ws: WebSocket): NetState {
  let s = states.get(ws);
  if (!s) { s = { buckets: new Map(), lastMe: '', outbox: [], phase: seq++ & 1, skipped: 0, dropped: 0, warnedAt: -1e9 }; states.set(ws, s); }
  return s;
}

function take(s: NetState, kind: string, now: number) {
  const [rate, burst] = LIMITS[kind] ?? LIMITS.other;
  let b = s.buckets.get(kind);
  if (!b) { b = { tokens: burst, at: now }; s.buckets.set(kind, b); }
  b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 1000) * rate);
  b.at = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

/**
 * May this message be handled? Over-limit messages are dropped; the sender of a dropped non-input
 * message is told (at most once a second) so a person typing in chat knows why nothing happened.
 */
export function allowMessage(ws: WebSocket, m: unknown, now = Date.now()): boolean {
  const s = netState(ws);
  const t = m && typeof m === 'object' ? (m as { t?: unknown }).t : undefined;
  const kind = typeof t === 'string' && t in LIMITS && t !== 'all' ? t : 'other';
  if (take(s, 'all', now) && take(s, kind, now)) return true;
  s.dropped++;
  if (kind !== 'input' && now - s.warnedAt > 1000) {
    s.warnedAt = now;
    try { ws.send(JSON.stringify({ t: 'err', error: '慢一点——消息发得太快了。(Slow down: too many messages.)' })); } catch { /* closed */ }
  }
  return false;
}

/** Should this broadcast's snapshot go to the socket? Drops sockets that stopped reading. */
export function readyForSnapshot(ws: WebSocket): boolean {
  if (ws.readyState !== 1) return false;
  const q = ws.bufferedAmount;
  if (q <= SLOW_BYTES) return true;
  netState(ws).skipped++;
  if (q > DEAD_BYTES) ws.terminate();
  return false;
}

/**
 * World events are queued per socket (for exactly the sockets connected when the event happened, in
 * order) and written together with the next snapshot, so a burst of events costs one socket write per
 * client per broadcast instead of one per event per client — and the world tick never waits on sockets.
 * Delivery is at most one broadcast (100 ms) later than before.
 */
export function enqueue(ws: WebSocket, msg: Buffer) {
  const s = netState(ws);
  if (s.outbox.length >= MAX_OUTBOX) s.outbox.shift();
  s.outbox.push(msg);
}
const MAX_OUTBOX = 256;
function flushOutbox(ws: WebSocket) {
  const s = netState(ws);
  if (!s.outbox.length) return;
  const box = s.outbox;
  s.outbox = [];
  if (ws.readyState !== 1) return;
  for (const m of box) ws.send(m, { binary: false });
}

/**
 * Everything a socket gets in one broadcast (queued events, snapshot, private state) goes out as one
 * write: the underlying socket is corked around the sends (ws frames each message itself).
 */
export function corked(ws: WebSocket, fn: () => void) {
  const sock = (ws as unknown as { _socket?: { cork?: () => void; uncork?: () => void } })._socket;
  const cork = typeof sock?.cork === 'function' && typeof sock.uncork === 'function';
  if (cork) sock!.cork!();
  try {
    flushOutbox(ws);
    fn();
  } finally {
    if (cork) sock!.uncork!();
  }
}

/**
 * Private state is recomputed on every other 10 Hz broadcast (5 Hz; sockets alternate so the work is
 * spread evenly) and sent only when it differs from what this socket last received.
 */
export function meDue(ws: WebSocket, broadcastNo: number) {
  return ((broadcastNo + netState(ws).phase) & 1) === 0;
}
export function sendMeIfChanged(ws: WebSocket, msg: string) {
  const s = netState(ws);
  if (msg === s.lastMe) return false;
  s.lastMe = msg;
  ws.send(msg);
  return true;
}
