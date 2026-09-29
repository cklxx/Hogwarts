// Injected before the game's own scripts by scripts/promo/render.ts (page.addInitScript). It turns the page
// into a deterministic film set: a virtual clock that moves only when the renderer says so (performance.now,
// Date.now, requestAnimationFrame), a seeded Math.random, and a stand-in WebSocket that plays back the
// kernel's recorded snapshots (the "tape") instead of talking to a live server.
(() => {
  let seed = 0x48677761 >>> 0; // mulberry32, the PRNG the kernel uses
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let vt = 1000; // virtual milliseconds
  const epoch = Date.UTC(2026, 8, 1, 12);
  performance.now = () => vt;
  Date.now = () => epoch + vt;
  let queue = [];
  window.requestAnimationFrame = (cb) => { queue.push(cb); return queue.length; };
  window.cancelAnimationFrame = () => {};

  class TapeSocket {
    constructor(url) {
      this.url = url; this.readyState = 0;
      this.onopen = null; this.onmessage = null; this.onclose = null; this.onerror = null;
      window.__socket = this;
      setTimeout(() => { this.readyState = 1; if (this.onopen) this.onopen({}); }, 0);
    }
    send() { /* the tape does not listen */ }
    close() { this.readyState = 3; }
    addEventListener() {}
    removeEventListener() {}
  }
  TapeSocket.CONNECTING = 0; TapeSocket.OPEN = 1; TapeSocket.CLOSING = 2; TapeSocket.CLOSED = 3;
  window.WebSocket = TapeSocket;

  /** Deliver this frame's tape messages, set the shot, advance the clock by dt seconds and run one animation frame. */
  window.__step = (dt, msgs, capture) => {
    const s = window.__socket;
    if (s && s.onmessage) for (const m of msgs) s.onmessage({ data: m });
    window.__capture = capture;
    vt += dt * 1000;
    const q = queue; queue = [];
    for (const cb of q) cb(vt);
    return q.length;
  };
  window.__seed = (x) => { seed = x >>> 0; };
  window.__ready = () => !!(window.__socket && window.__socket.onmessage && window.__socket.readyState === 1);
})();
