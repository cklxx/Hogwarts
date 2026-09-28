import { createHash } from 'node:crypto';

/**
 * The Restricted Section: four seals guarding the upper reaches of magic.
 *
 * Each seal is a program in "Old Runes" — a small register machine over 32-bit words — generated
 * per wizard from the server's secret. A seal accepts exactly one input (its rounds are bijections),
 * so the only way through is to understand the program and invert it. The source of this generator is
 * public; the secret is not, and the answer is only ever checked server-side, a few tries at a time.
 *
 * The *generated* programs deliberately contain decoys: unreachable blocks, opaque predicates that
 * look input-dependent but never branch, and margin notes that lie. Players are warned about this.
 */

export type Op =
  | 'FEHU' | 'TIWAZ' | 'URUZ' | 'ANSUZ' | 'THURS' | 'NAUDIZ' | 'ISA' | 'KAUNA' | 'WUNJO' | 'RAIDO' | 'HAGAL'
  | 'GEBO' | 'MANNAZ' | 'LAGUZ' | 'BERKANA' | 'JERA' | 'EIHWAZ' | 'PERTHRO' | 'ALGIZ' | 'SOWILO' | 'OTHALA';

export interface Instr { op: Op; a?: number; b?: number; c?: number; note?: string }

export const CODEX: Record<Op, string> = {
  FEHU: 'FEHU rA, imm       rA ← imm',
  TIWAZ: 'TIWAZ rA, i        rA ← input word i',
  URUZ: 'URUZ rA, rB        rA ← rA + rB        (mod 2³²)',
  ANSUZ: 'ANSUZ rA, rB       rA ← rA − rB        (mod 2³²)',
  THURS: 'THURS rA, rB       rA ← rA ⊕ rB',
  NAUDIZ: 'NAUDIZ rA, imm     rA ← rA ⊕ imm',
  ISA: 'ISA rA, imm        rA ← rA + imm       (mod 2³²)',
  KAUNA: 'KAUNA rA, imm      rA ← rA × imm       (mod 2³²)',
  WUNJO: 'WUNJO rA, rB       rA ← rA × rB        (mod 2³²)',
  RAIDO: 'RAIDO rA, n        rA ← rotl(rA, n)',
  HAGAL: 'HAGAL rA, rB       rA ← rotl(rA, rB & 31)',
  GEBO: 'GEBO rA, rB        swap rA, rB',
  MANNAZ: 'MANNAZ rA, rB      rA ← rB',
  LAGUZ: 'LAGUZ rA, rB       rA ← rA & rB',
  BERKANA: 'BERKANA rA         rA ← rA − 1',
  JERA: 'JERA rA, @addr     if rA ≠ 0 goto addr',
  EIHWAZ: 'EIHWAZ @addr       goto addr',
  PERTHRO: 'PERTHRO rA, imm, @addr   if rA ≠ imm goto addr',
  ALGIZ: 'ALGIZ              the seal opens',
  SOWILO: 'SOWILO             the seal holds (and bites)',
  OTHALA: 'OTHALA             nothing (the rune of inheritance, and of wasted time)',
};

export const SEAL_TIERS = [
  { tier: 1, name: 'The First Seal — Hand of Glory', zh: '第一道封印·光荣之手', year: 2, words: 1, pages: ['courtyard', 'great_hall'] },
  { tier: 2, name: 'The Second Seal — Moste Potente Potions', zh: '第二道封印·强力药剂', year: 4, words: 2, pages: ['greenhouses', 'hagrid', 'willow'] },
  { tier: 3, name: 'The Third Seal — Secrets of the Darkest Art', zh: '第三道封印·尖端黑魔法揭秘', year: 5, words: 3, pages: ['tomb', 'pitch', 'dungeons', 'seventh_floor'] },
  { tier: 4, name: 'The Fourth Seal — The Tale of the Three Brothers', zh: '第四道封印·三兄弟的传说', year: 7, words: 4, pages: ['forest', 'hogsmeade', 'shack', 'erised', 'lake'] },
] as const;

export const SEAL_REWARDS_ZH = [
  '',
  '所有威力上限 +20%，每次施法效果 +1',
  '上限 +40%，效果 +2，并解锁 chain（在敌人之间跳跃的闪电）',
  '上限 +60%，效果 +3',
  '上限 +80%，效果 +4，并解锁 storm（在指定地点延迟爆发的风暴）',
];

export const SEAL_REWARDS = [
  '',
  '+20% to every power cap, +1 effect per cast',
  '+40% caps, +2 effects, and the `chain` primitive (lightning that leaps between foes)',
  '+60% caps, +3 effects',
  '+80% caps, +4 effects, and the `storm` primitive (a delayed tempest at a point)',
];

const M32 = 0xffffffff;
const u32 = (x: number) => x >>> 0;
const rotl = (x: number, n: number) => u32((x << (n & 31)) | (x >>> ((32 - (n & 31)) & 31)));
const mul = (a: number, b: number) => u32(Math.imul(a, b));

/** Deterministic stream from sha256(secret | wizard | tier | counter). */
function stream(seed: string) {
  let counter = 0;
  let buf: Buffer = Buffer.alloc(0);
  let off = 0;
  return () => {
    if (off + 4 > buf.length) {
      buf = createHash('sha256').update(`${seed}|${counter++}`).digest();
      off = 0;
    }
    const v = buf.readUInt32LE(off);
    off += 4;
    return v;
  };
}

export interface Seal { tier: number; words: number; code: Instr[]; pages: [number, number][]; key: number[] }

/** Emit the program for a tier. Registers r0..r7; inputs arrive via TIWAZ. */
export function generateSeal(secret: string, wizardId: string, tier: number): Seal {
  const R = stream(`${secret}|${wizardId}|seal${tier}`);
  const odd = () => u32(R() | 1);
  const words = SEAL_TIERS[tier - 1].words;
  const key = Array.from({ length: words }, () => R());
  const code: Instr[] = [];
  const I = (op: Op, a?: number, b?: number, c?: number, note?: string) => { code.push({ op, a, b, c, note }); return code.length - 1; };
  const fixups: { at: number; label: string; field: 'b' | 'a' | 'c' }[] = [];
  const labels: Record<string, number> = {};
  const jump = (op: 'JERA' | 'EIHWAZ' | 'PERTHRO', label: string, a?: number, b?: number, note?: string) => {
    const at = op === 'EIHWAZ' ? I(op, undefined, undefined, undefined, note) : op === 'JERA' ? I(op, a, undefined, undefined, note) : I(op, a, b, undefined, note);
    fixups.push({ at, label, field: op === 'EIHWAZ' ? 'a' : op === 'JERA' ? 'b' : 'c' });
  };
  const label = (name: string) => { labels[name] = code.length; };
  const lies = [
    'the true key begins here', 'checksum of the key — must match', 'Dumbledore\'s override', 'NB: input is little-endian here',
    'this branch is the real test', 'copied from the Half-Blood Prince\'s notes', 'constant is the answer XOR 0xDEADBEEF', 'unused — probably',
  ];
  const lie = () => lies[R() % lies.length];

  // opaque predicate: v*(v+1) is always even, whatever v is (so the branch is never taken)
  let decoys = 0;
  const opaque = (src: number) => {
    const d = `decoy${decoys++}`;
    I('MANNAZ', 5, src);
    I('MANNAZ', 4, src);
    I('ISA', 4, 1);
    I('WUNJO', 5, 4);
    I('FEHU', 4, 1);
    I('LAGUZ', 5, 4);
    jump('PERTHRO', d, 5, 0, R() % 2 ? lie() : undefined);
    return d;
  };
  const decoyBlocks: string[] = [];

  // forward simulation to learn the targets while emitting code
  const regs = new Array(8).fill(0);
  const load = () => { for (let i = 0; i < words; i++) { I('TIWAZ', i, i); regs[i] = key[i]; } };
  load();

  const F = (dst: number, src: number, k1: number, k2: number, n: number) => {
    // dst ^= rotl((src * k1) ^ k2, n)
    I('MANNAZ', 6, src);
    I('KAUNA', 6, k1);
    I('NAUDIZ', 6, k2);
    I('RAIDO', 6, n);
    I('THURS', dst, 6);
    regs[dst] = u32(regs[dst] ^ rotl(u32(mul(regs[src], k1) ^ k2), n));
  };

  if (tier === 1) {
    const a = R(), b = R(), n = 1 + (R() % 31), k = odd();
    I('NAUDIZ', 0, a); regs[0] = u32(regs[0] ^ a);
    decoyBlocks.push(opaque(0));
    I('ISA', 0, b); regs[0] = u32(regs[0] + b);
    I('RAIDO', 0, n); regs[0] = rotl(regs[0], n);
    I('KAUNA', 0, k); regs[0] = mul(regs[0], k);
  } else if (tier === 2) {
    for (let round = 0; round < 3; round++) {
      F(0, 1, odd(), R(), 1 + (R() % 31));
      if (round === 1) decoyBlocks.push(opaque(1));
      I('GEBO', 0, 1); [regs[0], regs[1]] = [regs[1], regs[0]];
    }
  } else if (tier === 3) {
    // 4 rounds in a loop, round constant r4 from an in-program key schedule; then fold r2
    const K1 = odd(), n = 1 + (R() % 31), mulK = odd(), addK = R();
    let rc = R();
    I('FEHU', 7, 4); I('FEHU', 5, rc);
    label('loop3');
    // t = rotl((r1 * K1) ^ rc, n) + rotl(r1, r1 & 31); r0 ^= t; swap
    I('MANNAZ', 6, 1); I('KAUNA', 6, K1); I('THURS', 6, 5); I('RAIDO', 6, n);
    I('MANNAZ', 3, 1); I('HAGAL', 3, 1); I('URUZ', 6, 3);
    I('THURS', 0, 6); I('GEBO', 0, 1);
    I('KAUNA', 5, mulK); I('ISA', 5, addK);
    I('BERKANA', 7);
    jump('JERA', 'loop3', 7, undefined, R() % 2 ? lie() : undefined);
    for (let round = 0; round < 4; round++) {
      const t = u32(rotl(u32(mul(regs[1], K1) ^ rc), n) + rotl(regs[1], regs[1] & 31));
      regs[0] = u32(regs[0] ^ t);
      [regs[0], regs[1]] = [regs[1], regs[0]];
      rc = u32(mul(rc, mulK) + addK);
    }
    decoyBlocks.push(opaque(2));
    I('MANNAZ', 3, 0); I('URUZ', 3, 1); I('THURS', 2, 3);
    regs[2] = u32(regs[2] ^ u32(regs[0] + regs[1]));
  } else {
    // generalised Type-2 Feistel on (r0,r1,r2,r3), 6 rounds in a loop with a key schedule and data-dependent rotation
    const Ka = odd(), Kb = odd(), na = 1 + (R() % 31), nb = 1 + (R() % 31), mulK = odd(), addK = R();
    let rc = R();
    I('FEHU', 5, 6); I('FEHU', 4, rc);
    label('loop4');
    // r1 ^= rotl((r0*Ka) ^ rc, na) + rotl(r0, r0&31)
    I('MANNAZ', 6, 0); I('KAUNA', 6, Ka); I('THURS', 6, 4); I('RAIDO', 6, na); I('MANNAZ', 7, 0); I('HAGAL', 7, 0); I('URUZ', 6, 7); I('THURS', 1, 6);
    // r3 ^= rotl((r2*Kb) + rc, nb)
    I('MANNAZ', 6, 2); I('KAUNA', 6, Kb); I('URUZ', 6, 4); I('RAIDO', 6, nb); I('THURS', 3, 6);
    // rotate words left: (r0,r1,r2,r3) <- (r1,r2,r3,r0)
    I('GEBO', 0, 1); I('GEBO', 1, 2); I('GEBO', 2, 3);
    I('KAUNA', 4, mulK); I('ISA', 4, addK);
    // an opaque predicate inside the loop, on a live register
    I('MANNAZ', 7, 3); I('MANNAZ', 6, 3); I('ISA', 6, 1); I('WUNJO', 7, 6); I('FEHU', 6, 1); I('LAGUZ', 7, 6);
    const d = `decoy${decoys++}`;
    jump('PERTHRO', d, 7, 0, lie());
    decoyBlocks.push(d);
    I('BERKANA', 5);
    jump('JERA', 'loop4', 5);
    for (let round = 0; round < 6; round++) {
      const t1 = u32(rotl(u32(mul(regs[0], Ka) ^ rc), na) + rotl(regs[0], regs[0] & 31));
      regs[1] = u32(regs[1] ^ t1);
      const t3 = rotl(u32(mul(regs[2], Kb) + rc), nb);
      regs[3] = u32(regs[3] ^ t3);
      [regs[0], regs[1], regs[2], regs[3]] = [regs[1], regs[2], regs[3], regs[0]];
      rc = u32(mul(rc, mulK) + addK);
    }
  }

  // the real comparisons
  for (let i = 0; i < words; i++) jump('PERTHRO', 'fail', i, regs[i], i === 0 && tier > 1 ? lie() : undefined);
  I('ALGIZ');
  label('fail');
  I('SOWILO');
  // decoy blocks: unreachable, but they look like alternative ways in
  for (const d of decoyBlocks) {
    label(d);
    I('OTHALA', undefined, undefined, undefined, lie());
    I('FEHU', 0, R(), undefined, lie());
    I('TIWAZ', 1, 0);
    I('THURS', 0, 1);
    jump('PERTHRO', 'fail', 0, R());
    I('ALGIZ', undefined, undefined, undefined, 'master key accepted');
  }
  for (const f of fixups) code[f.at][f.field] = labels[f.label];

  // split into pages
  const nPages = SEAL_TIERS[tier - 1].pages.length;
  const per = Math.ceil(code.length / nPages);
  const pages: [number, number][] = Array.from({ length: nPages }, (_, p) => [p * per, Math.min(code.length, (p + 1) * per)]);
  return { tier, words, code, pages, key };
}

/** Execute a seal program. Returns true iff it reaches ALGIZ. */
export function runSeal(code: Instr[], input: number[], maxSteps = 100_000): boolean {
  const r = new Array(8).fill(0);
  let pc = 0;
  for (let steps = 0; steps < maxSteps; steps++) {
    const ins = code[pc];
    if (!ins) return false;
    const a = ins.a ?? 0, b = ins.b ?? 0;
    pc++;
    switch (ins.op) {
      case 'FEHU': r[a] = u32(b); break;
      case 'TIWAZ': r[a] = u32(input[b] ?? 0); break;
      case 'URUZ': r[a] = u32(r[a] + r[b]); break;
      case 'ANSUZ': r[a] = u32(r[a] - r[b]); break;
      case 'THURS': r[a] = u32(r[a] ^ r[b]); break;
      case 'NAUDIZ': r[a] = u32(r[a] ^ b); break;
      case 'ISA': r[a] = u32(r[a] + b); break;
      case 'KAUNA': r[a] = mul(r[a], b); break;
      case 'WUNJO': r[a] = mul(r[a], r[b]); break;
      case 'RAIDO': r[a] = rotl(r[a], b); break;
      case 'HAGAL': r[a] = rotl(r[a], r[b] & 31); break;
      case 'GEBO': [r[a], r[b]] = [r[b], r[a]]; break;
      case 'MANNAZ': r[a] = r[b]; break;
      case 'LAGUZ': r[a] = u32(r[a] & r[b]); break;
      case 'BERKANA': r[a] = u32(r[a] - 1); break;
      case 'JERA': if (r[a] !== 0) pc = b; break;
      case 'EIHWAZ': pc = a; break;
      case 'PERTHRO': if (r[a] !== u32(b)) pc = ins.c ?? 0; break;
      case 'ALGIZ': return true;
      case 'SOWILO': return false;
      case 'OTHALA': break;
    }
  }
  return false;
}

const hex = (n: number) => '0x' + u32(n).toString(16).padStart(8, '0');
export function disassemble(code: Instr[], from: number, to: number): string {
  const lines: string[] = [];
  for (let i = from; i < to; i++) {
    const x = code[i];
    let args = '';
    switch (x.op) {
      case 'FEHU': case 'NAUDIZ': case 'ISA': case 'KAUNA': args = `r${x.a}, ${hex(x.b!)}`; break;
      case 'TIWAZ': args = `r${x.a}, ${x.b}`; break;
      case 'RAIDO': args = `r${x.a}, ${x.b}`; break;
      case 'BERKANA': args = `r${x.a}`; break;
      case 'JERA': args = `r${x.a}, @${x.b}`; break;
      case 'EIHWAZ': args = `@${x.a}`; break;
      case 'PERTHRO': args = `r${x.a}, ${hex(x.b!)}, @${x.c}`; break;
      case 'ALGIZ': case 'SOWILO': case 'OTHALA': args = ''; break;
      default: args = `r${x.a}, r${x.b}`;
    }
    lines.push(`${String(i).padStart(4, '0')}:  ${x.op.padEnd(8)}${args.padEnd(30)}${x.note ? `; ${x.note}` : ''}`);
  }
  return lines.join('\n');
}

export const parseWord = (s: string | number): number | null => {
  if (typeof s === 'number') return Number.isInteger(s) && s >= 0 && s <= M32 ? s : null;
  const t = s.trim().toLowerCase();
  const v = t.startsWith('0x') ? parseInt(t.slice(2), 16) : /^\d+$/.test(t) ? Number(t) : NaN;
  return Number.isInteger(v) && v >= 0 && v <= M32 ? v : null;
};
