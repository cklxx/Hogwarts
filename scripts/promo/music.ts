/**
 * The promo's score: an original waltz, synthesised here from nothing but arithmetic (no samples, no sound
 * fonts, no one else's melody), so its licence is this repository's. docs/promo/CREDITS.md says so.
 *
 * - 3/4 at BPM (scripts/promo/story.ts), in G major with an E-minor night, one chord a bar (PLAN below).
 * - Voices: a music-box / celesta melody (a sine with two inharmonic partials, bell decay), pizzicato bass on the
 *   downbeat and harp on beats two and three (Karplus–Strong plucked strings), a string pad (three detuned saws
 *   through a one-pole low-pass), timpani on phrase starts, and at every cut a quick harp sweep up into it with a
 *   soft cymbal on the beat.
 * - A small Schroeder reverb (four combs, two all-passes) over everything; loudness is normalised when encoding.
 *
 *   npx tsx scripts/promo/music.ts out.wav 57.3 0,5.45,9.55,…     (length in seconds, cut times)
 */
import { writeFileSync } from 'node:fs';
import { BEAT } from './story.js';

const SR = 48000;
/** The harmony, one chord a bar (roots as MIDI notes, then the chord's quality), by section of the film. */
const PLAN: [string, number][] = [
  // castle (4 bars): the title
  ['G', 4], ['Em', 4], ['C', 4], ['D', 4],
  // cast (3)
  ['G', 3], ['Bm', 3], ['C', 3],
  // code (4)
  ['Am', 4], ['D', 4], ['G', 4], ['G', 4],
  // owls (4)
  ['C', 4], ['D', 4], ['Bm', 4], ['Em', 4],
  // agent (4)
  ['Am', 4], ['D', 4], ['G', 4], ['G', 4],
  // glamour (4)
  ['C', 4], ['Am', 4], ['D', 4], ['D', 4],
  // duel (4)
  ['Em', 4], ['C', 4], ['Am', 4], ['D', 4],
  // quidditch (5): brighter, eighth notes, timpani on every downbeat
  ['G', 5], ['C', 5], ['D', 5], ['G', 5], ['D', 5],
  // night (6): E minor
  ['Em', 6], ['C', 6], ['Am', 6], ['B', 6], ['Em', 6], ['D', 6],
  // the end card (4): the cadence, and a long G
  ['C', 7], ['D', 7], ['G', 7], ['G', 7],
];
const ROOT: Record<string, number> = { C: 48, D: 50, E: 52, G: 55, A: 57, B: 59 };
function chord(name: string): number[] {
  const minor = name.endsWith('m'), r = ROOT[name[0]];
  return [r, r + (minor ? 3 : 4), r + 7];
}
const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

// ------------------------------------------------------------------ voices (each adds into the buffer)
function add(buf: Float32Array, at: number, fn: (i: number, t: number) => number, dur: number, gain: number) {
  const s0 = Math.floor(at * SR), n = Math.floor(dur * SR);
  for (let i = 0; i < n && s0 + i < buf.length; i++) if (s0 + i >= 0) buf[s0 + i] += gain * fn(i, i / SR);
}
const TAU = Math.PI * 2;
function bell(buf: Float32Array, at: number, m: number, gain: number) {
  const f = hz(m);
  add(buf, at, (_i, t) => {
    const a = Math.min(1, t / 0.003);
    return a * (Math.sin(TAU * f * t) * Math.exp(-t / 0.9) + 0.32 * Math.sin(TAU * f * 2.756 * t) * Math.exp(-t / 0.28) + 0.12 * Math.sin(TAU * f * 5.404 * t) * Math.exp(-t / 0.12));
  }, 2.6, gain);
}
/** Karplus–Strong: a noise burst in a delay line with a two-tap average (deterministic noise). */
function pluck(buf: Float32Array, at: number, m: number, gain: number, decay = 0.996, dur = 1.8, soft = 6) {
  const period = Math.max(2, Math.round(SR / hz(m)));
  const line = new Float32Array(period);
  let seed = (m * 7919 + Math.round(at * 1000)) >>> 0;
  // a soft excitation (noise smoothed `soft` times: a finger, not a plectrum), else every onset is a full-band click
  for (let i = 0; i < period; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; line[i] = seed / 2 ** 32 - 0.5; }
  for (let k = 0; k < soft; k++) { let prev = line[period - 1]; for (let i = 0; i < period; i++) { const v = (line[i] + prev) * 0.5; prev = line[i]; line[i] = v; } }
  let p = 0, y = 0;
  const lp = 1 - Math.exp(-TAU * Math.min(6000, hz(m) * 8) / SR);
  add(buf, at, (_i, t) => { const a = line[p], b = line[(p + 1) % period]; const v = (a + b) * 0.5 * decay; line[p] = v; p = (p + 1) % period; y += lp * (a - y); return y * Math.min(1, t / 0.004) * 2; }, dur, gain);
}
function pad(buf: Float32Array, at: number, notes: number[], dur: number, gain: number) {
  for (const m of notes) {
    const fs = [0.997, 1, 1.003].map((d) => hz(m) * d);
    let y = 0, y2 = 0;
    const k = 1 - Math.exp(-TAU * 700 / SR);
    add(buf, at, (_i, t) => {
      let x = 0;
      for (const f of fs) x += ((f * t) % 1) * 2 - 1;
      y += k * (x / 3 - y);
      y2 += k * (y - y2);
      const out = y2;
      const env = Math.min(1, t / 0.45) * Math.min(1, Math.max(0, (dur - t) / 0.6));
      return out * env * 1.6;
    }, dur + 0.05, gain);
  }
}
function timpani(buf: Float32Array, at: number, m: number, gain: number) {
  const f = hz(m);
  let ph = 0, seed = 12345;
  add(buf, at, (_i, t) => {
    ph += TAU * f * (1 + 0.03 * Math.exp(-t / 0.08)) / SR;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const noise = (seed / 2 ** 32 - 0.5) * Math.exp(-t / 0.03);
    return (Math.sin(ph) * Math.exp(-t / 0.9) + 0.4 * noise) * Math.min(1, t / 0.002);
  }, 2.2, gain);
}
function cymbal(buf: Float32Array, at: number, gain: number) {
  let seed = 777, prev = 0;
  add(buf, at, (_i, t) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const x = seed / 2 ** 32 - 0.5, hp = x - prev; prev = x;
    return hp * Math.exp(-t / 0.5) * Math.min(1, t / 0.03) * 0.5;
  }, 2.4, gain);
}

// ------------------------------------------------------------------ the arrangement
export function score(total: number, cuts: number[]): Float32Array {
  const bar = BEAT * 3;
  const buf = new Float32Array(Math.ceil((total + 3) * SR));
  PLAN.forEach(([name, section], b) => {
    const t0 = b * bar;
    if (t0 >= total) return;
    const [r, third, fifth] = chord(name);
    const quid = section === 5, night = section === 6, end = section === 7, intro = section === 4 && b < 4;
    // strings under everything; the night sits lower and darker
    pad(buf, t0, [r - 12, r, third, fifth].map((m) => (night ? m - 12 : m)), bar + 0.1, intro ? 0.05 : night ? 0.075 : 0.06);
    // pizzicato root, harp on two and three
    pluck(buf, t0, r - 12, 0.5, 0.995, 1.6);
    if (!intro || b >= 2) for (const k of [1, 2]) pluck(buf, t0 + k * BEAT, (k === 1 ? third : fifth) + 12, 0.22, 0.997, 1.2);
    // the melody: chord tones in the fifth octave, a figure per section
    const top = fifth + 12 + (fifth + 12 < 74 ? 12 : 0), mid = third + 12, low = r + 12;
    const up = (m: number) => (m < 67 ? m + 12 : m);
    const figures: number[][] = quid
      ? [[top, mid, top, up(low), mid, top]] // eighths
      : end && b === PLAN.length - 1 ? [[up(low)]]
        : [[top, mid, up(low)], [mid, top, mid], [up(low), mid, top], [top, top + 2, mid]];
    const fig = figures[b % figures.length];
    const step = quid ? BEAT / 2 : fig.length === 1 ? bar : BEAT;
    fig.forEach((m, i) => bell(buf, t0 + i * step, m, (quid ? 0.16 : 0.2) * (i === 0 ? 1 : 0.8)));
    // timpani: every downbeat of the match, the first beat of other phrases
    if (quid || (b % 4 === 0 && !intro) || end) timpani(buf, t0, r - 24 + (r - 24 < 31 ? 12 : 0), quid ? 0.55 : 0.4);
  });
  // every cut: a harp sweep up into it, a soft cymbal on the beat
  for (const c of cuts) {
    const b = Math.min(PLAN.length - 1, Math.floor(c / bar + 1e-6));
    const [r, third, fifth] = chord(PLAN[b][0]);
    [r, third, fifth, r + 12, third + 12, fifth + 12].forEach((m, i) => pluck(buf, c - 0.36 + i * 0.06, m + 12, 0.12, 0.997, 1.0));
    cymbal(buf, c, 0.05);
  }
  return reverb(buf);
}

function reverb(dry: Float32Array): Float32Array {
  const out = new Float32Array(dry.length);
  const combs = [1557, 1617, 1491, 1422].map((n) => ({ d: new Float32Array(Math.round(n * SR / 44100)), p: 0 }));
  const aps = [225, 556].map((n) => ({ d: new Float32Array(Math.round(n * SR / 44100)), p: 0 }));
  for (let i = 0; i < dry.length; i++) {
    let wet = 0;
    for (const c of combs) { const y = c.d[c.p]; c.d[c.p] = dry[i] + y * 0.8; c.p = (c.p + 1) % c.d.length; wet += y; }
    wet /= combs.length;
    for (const a of aps) { const y = a.d[a.p]; const x = wet + y * 0.5; a.d[a.p] = x; a.p = (a.p + 1) % a.d.length; wet = y - x * 0.5; }
    out[i] = dry[i] * 0.8 + wet * 0.35;
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i] = (out[i] / peak) * 0.89;
  return out;
}

/** 16-bit PCM WAV, stereo (a slight delay on the right channel widens it). */
export function wav(mono: Float32Array): Buffer {
  const n = mono.length, off = Math.round(0.011 * SR);
  const b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, mono[i])), r = Math.max(-1, Math.min(1, mono[i - off] ?? 0));
    b.writeInt16LE(Math.round(l * 32767), 44 + i * 4); b.writeInt16LE(Math.round(r * 32767), 46 + i * 4);
  }
  return b;
}

export function writeScore(path: string, total: number, cuts: number[]) { writeFileSync(path, wav(score(total, cuts))); }

if (import.meta.url === `file://${process.argv[1]}`) {
  const [out = 'score.wav', total = '57.3', cuts = ''] = process.argv.slice(2);
  writeScore(out, Number(total), cuts ? cuts.split(',').map(Number) : []);
  console.log(`wrote ${out}`);
}
