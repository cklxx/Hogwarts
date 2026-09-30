/**
 * Dynamic resolution: render fewer pixels when frames run long, more again when they have room.
 *
 * Browsers do not report GPU time, so the frame interval is the signal. Every second: frames averaging over
 * `slowMs` step the pixel ratio down by 15 %; a steady `fastMs` (60 Hz vsync) for `settle` seconds steps it
 * back up by 10 %, toward `max`. A step up that makes frames slow again within 3 s is undone and the next
 * attempt waits four times longer (up to 2 minutes), so it cannot hunt back and forth. Hitches (a frame over
 * 250 ms, a hidden tab) are ignored. Slow still at `min` for `floorS` seconds running: `onFloor` (main.ts then drops to
 * the lighter pipeline — decided on frames of real play, not on the loading's first hitches). Each change reallocates the render targets, so changes are rare by design.
 */
export function createDynRes(o: { min: number; max: number; apply: (ratio: number) => void; slowMs?: number; fastMs?: number; settle?: number; onFloor?: () => void; floorS?: number }) {
  const slowMs = o.slowMs ?? 1000 / 50, fastMs = o.fastMs ?? 1000 / 57;
  let min = o.min, max = o.max, ratio = o.max;
  let sum = 0, n = 0, t = 0;
  let fastFor = 0, wait = o.settle ?? 8, lastUp = -1e9, clock = 0, floorFor = 0;
  const set = (r: number) => {
    r = Math.max(min, Math.min(max, Math.round(r * 100) / 100));
    if (r !== ratio) { ratio = r; o.apply(r); }
  };
  return {
    get ratio() { return ratio; },
    /** New bounds (a quality change): start again from the top. */
    range(lo: number, hi: number) { min = lo; max = hi; fastFor = floorFor = 0; set(hi); o.apply(ratio); },
    frame(dtMs: number) {
      if (dtMs <= 0 || dtMs > 250 || document.hidden) return;
      clock += dtMs / 1000;
      sum += dtMs; n++; t += dtMs;
      if (t < 1000) return;
      const avg = sum / n;
      sum = n = t = 0;
      // slow at the floor for floorS seconds running (4): the caller may lighten the pipeline itself
      floorFor = avg > slowMs && ratio <= min ? floorFor + 1 : 0;
      if (floorFor >= (o.floorS ?? 4)) { floorFor = 0; o.onFloor?.(); }
      if (avg > slowMs && ratio > min) {
        if (clock - lastUp < 3) wait = Math.min(120, wait * 4); // that step up was too much
        fastFor = 0;
        set(ratio * 0.85);
      } else if (avg < fastMs && ratio < max) {
        if (++fastFor >= wait) { fastFor = 0; lastUp = clock; set(ratio * 1.1); }
      } else fastFor = 0;
    },
  };
}
