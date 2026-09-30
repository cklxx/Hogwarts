import type { WebSocket } from 'ws';

/**
 * Per-socket network hygiene for the 3D-client WebSocket:
 *  - rate limits per message kind (token buckets), applied BEFORE handleClient runs (admit());
 *    movement input is never dropped (see LIMITS);
 *  - back-pressure: snapshots are skipped for a socket whose send buffer is backing up, and a socket
 *    that stops reading altogether is dropped (snapshots are idempotent state, so skipping is safe);
 *  - bookkeeping for the private 'me' message, which is sent only when it changed, at most 5 Hz;
 *  - batching: queued events + snapshot + 'me' leave in one corked socket write per broadcast.
 */

/**
 * [refill per second, burst] per message type. `all` is a shared budget for every kind except input.
 *
 * Movement input: a browser sends one on every animation frame in which its (dx, dz, facing) changed —
 * i.e. at the display's frame rate (60-240 Hz, more on some monitors) while you walk and turn the
 * camera — plus a 4 Hz heartbeat. Input is state, not an action, so it is never dropped: inputs within
 * the budget (above any common frame rate) are applied at once, exactly as before; beyond it they are
 * merged into one pending input per socket, applied before the socket's next other message (so a
 * socket's messages take effect in the order it sent them) and before every world tick and broadcast
 * (the world reads input only in the tick). The merge leaves exactly the state applying each of them
 * in turn would: the last direction, the last facing given, and a walk-to goal cancelled if any of them
 * moved (World#setInput). Input never spends the shared `all` budget, so no amount of it can starve
 * casts or chat.
 *
 * Other kinds are dropped when over budget: casts are gated by a 0.25 s cooldown in the kernel anyway;
 * chat and the expensive ones (they run the Runes checker/interpreter or pathfinding, or build the
 * grimoire) are tight. A message type not listed here shares 'other'; give a new high-rate type its own
 * entry.
 */
export const LIMITS: Record<string, [number, number]> = {
  input: [250, 300],
  cast: [10, 15],
  chat: [1, 5],
  goto: [10, 20],
  simulate: [4, 8],
  forge: [2, 5],
  unlearn: [2, 5],
  book: [4, 8],
  hotbar: [4, 8],
  seals: [4, 8],
  readpage: [2, 5],
  breakseal: [2, 5],
  equip: [4, 8],
  unequip: [4, 8],
  destroy: [2, 5],
  // the browser shop (shop.ts): each buy is a forge, so it is as tight as forging
  buy: [1, 4],
  // Owl Post (docs/AGENT_LINK.md §C.5). The kernel also caps owls at OWL_PER_MIN a minute per side.
  owl: [1, 5],
  answer: [2, 5],
  paircode: [0.2, 3],
  rotate: [0.05, 2],
  pause: [1, 5],
  familiar: [0.5, 3],
  // O.W.L. exams: a sitting runs a sandbox World per test case (the kernel also caps sittings per minute)
  exams: [2, 5],
  sit: [0.2, 3],
  examboard: [2, 5],
  // 今日课表 (kernel/quests.ts): the slip polls every 20 s; 飞路网 / broom (kernel/travel.ts) have kernel cooldowns too
  quests: [0.5, 3],
  travel: [2, 5],
  // 不公平，但好玩 (README): Dumbledore's Army status/join/leave/veto, and studying a spell that hit you
  da: [1, 5],
  study: [1, 3],
  // 咒语集市 (kernel/market.ts): browsing / reading a listing, and publish / unpublish / copy / fork (each forges or lists)
  market: [3, 8],
  marketop: [0.5, 4],
  // 隐藏宝箱 (F at a chest) and the school's news / the album panel (both cheap reads or one-shot actions)
  chest: [1, 4],
  school: [2, 5],
  other: [30, 60],
  all: [80, 120],
};

/**
 * Told (at most once a second) to a socket whose message was dropped. English, like every other server
 * error: the client translates the ones players meet (client/i18n.ts tr()).
 */
export const SLOW_DOWN = 'Slow down: too many messages.';

/** Skip snapshots while more than this is queued for the socket. */
export const SLOW_BYTES = Number(process.env.WS_SLOW_BYTES ?? 1 << 20);
/** Drop the connection when this much is queued (it is not reading at all). */
export const DEAD_BYTES = Number(process.env.WS_DEAD_BYTES ?? 16 << 20);

interface Bucket { tokens: number; at: number }
/** Inputs held back (over the input budget), merged: see LIMITS. */
interface PendingInput { dx: number; dz: number; f: number | undefined; moved: { dx: number; dz: number } | null }
export interface NetState {
  buckets: Map<string, Bucket>;
  /** Last private state sent. */
  lastMe: string;
  /** Events waiting for the next broadcast. */
  outbox: Buffer[];
  /** Stagger the 5 Hz private-state updates across sockets. */
  phase: number;
  /** Does this socket get area-of-interest snapshots? (main.ts decides at connect; fanout.ts.) */
  aoi: boolean;
  /** The AOI cell this socket's payload is anchored to (fanout.ts hysteresis). */
  anchor: { cell: number };
  pending: PendingInput | null;
  skipped: number;
  dropped: number;
  deferred: number;
  warnedAt: number;
}

const states = new WeakMap<WebSocket, NetState>();
let seq = 0;

export function netState(ws: WebSocket): NetState {
  let s = states.get(ws);
  if (!s) {
    s = { buckets: new Map(), lastMe: '', outbox: [], phase: seq++ & 1, aoi: false, anchor: { cell: -1 }, pending: null, skipped: 0, dropped: 0, deferred: 0, warnedAt: -1e9 };
    states.set(ws, s);
  }
  return s;
}

function bucket(s: NetState, kind: string, now: number) {
  const [rate, burst] = LIMITS[kind] ?? LIMITS.other;
  let b = s.buckets.get(kind);
  if (!b) { b = { tokens: burst, at: now }; s.buckets.set(kind, b); }
  b.tokens = Math.min(burst, b.tokens + (Math.max(0, now - b.at) / 1000) * rate);
  b.at = now;
  return b;
}

const kindOf = (m: unknown) => {
  const t = m && typeof m === 'object' ? (m as { t?: unknown }).t : undefined;
  return typeof t === 'string' && Object.hasOwn(LIMITS, t) && t !== 'all' ? t : 'other';
};
/** The numbers handleClient / World#setInput use (non-finite → 0; a non-finite facing is ignored). */
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const moves = (dx: number, dz: number) => Math.hypot(dx, dz) > 0.01;

type Handle = (m: unknown) => void;
/** Sockets holding a pending (merged) input, with the handler that applies it. */
const pendingInputs = new Map<WebSocket, Handle>();

/**
 * Handle one client message under the socket's limits: `handle` (handleClient) runs now, later (an
 * input over its budget, merged — see LIMITS), or not at all (a non-input message over budget; its
 * sender is told at most once a second, so a person typing in chat knows why nothing happened).
 */
export function admit(ws: WebSocket, m: unknown, handle: Handle, now = Date.now()): 'handled' | 'deferred' | 'dropped' {
  const s = netState(ws);
  const kind = kindOf(m);
  if (kind === 'input') {
    const b = bucket(s, 'input', now);
    if (b.tokens >= 1) {
      b.tokens -= 1;
      flushInput(ws);
      handle(m);
      return 'handled';
    }
    const i = m as { dx?: unknown; dz?: unknown; f?: unknown };
    const dx = num(i.dx), dz = num(i.dz);
    const f = typeof i.f === 'number' && Number.isFinite(i.f) ? i.f : undefined;
    const p = s.pending;
    s.pending = { dx, dz, f: f ?? p?.f, moved: moves(dx, dz) ? { dx, dz } : p?.moved ?? null };
    pendingInputs.set(ws, handle);
    s.deferred++;
    return 'deferred';
  }
  flushInput(ws); // this socket's earlier input takes effect before anything it sent after it
  // Both budgets are checked before either is spent.
  const b = bucket(s, kind, now), all = bucket(s, 'all', now);
  if (b.tokens >= 1 && all.tokens >= 1) {
    b.tokens -= 1;
    all.tokens -= 1;
    handle(m);
    return 'handled';
  }
  s.dropped++;
  if (now - s.warnedAt > 1000) {
    s.warnedAt = now;
    try { ws.send(JSON.stringify({ t: 'err', error: SLOW_DOWN })); } catch { /* closed */ }
  }
  return 'dropped';
}

/** Apply a socket's pending input now (no-op if none; discarded if the socket has closed). */
function flushInput(ws: WebSocket) {
  const handle = pendingInputs.get(ws);
  if (!handle) return;
  pendingInputs.delete(ws);
  const s = netState(ws);
  const p = s.pending;
  s.pending = null;
  if (!p || ws.readyState !== 1) return;
  // The end state of applying the merged inputs one by one: a walk-to goal cancelled by one that moved,
  // then the last direction and the last facing given.
  if (p.moved && !moves(p.dx, p.dz)) handle({ t: 'input', dx: p.moved.dx, dz: p.moved.dz });
  handle(p.f === undefined ? { t: 'input', dx: p.dx, dz: p.dz } : { t: 'input', dx: p.dx, dz: p.dz, f: p.f });
}

/** Apply every pending input. main.ts calls this before each world tick and each broadcast. */
export function flushInputs() {
  if (!pendingInputs.size) return;
  for (const ws of [...pendingInputs.keys()]) flushInput(ws);
}

/** A socket closed: its pending input (if any) must never be applied after its close handler ran. */
export function forget(ws: WebSocket) {
  pendingInputs.delete(ws);
  const s = states.get(ws);
  if (s) s.pending = null;
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
