/**
 * The O.W.L. exams (kernel/exams.ts) as a Feature: the week's boards and bests (persisted) and the three MCP tools.
 * A module of its own: exams.ts builds sandbox Worlds, so the registry must reach it only through closures.
 */
import { z } from 'zod';
import type { Feature } from './feature.js';
import { RANKED_SITS, examLeaderboard, listExams, sitExam, type OwlBook } from './exams.js';

declare module './world.js' {
  interface World {
    /** O.W.L. leaderboards and each wizard's best grade per exam (this module's Feature). Persisted. */
    owls: OwlBook;
  }
}

const book = (x: unknown): OwlBook => {
  const o = x as Partial<OwlBook> | undefined;
  return { boards: o?.boards ?? {}, bests: o?.bests ?? {} };
};

export const EXAMS_FEATURE: Feature = {
  id: 'owls',
  init(world) { world.owls = { boards: {}, bests: {} }; },
  save: (world) => world.owls,
  load(world, data, legacy) { world.owls = book(data ?? legacy.owls); },
  tools: [
    {
      name: 'owl_exams', title: 'O.W.L. exams of the week', cost: 0, readOnly: true,
      description: 'This week\'s O.W.L.s (普通巫师等级考试): practical Runes exams, each a fixed sandbox scene with hidden test cases. Lists every exam with its brief, year, par (nodes, gas, mana), your best grade and the top 3. Sit one with sit_exam; nothing you submit touches the live world. Grades O/E/A pass, P/D/T (Troll) fail.',
      input: {},
      run: (world, wid) => listExams(world, wid),
    },
    {
      name: 'sit_exam', title: 'Sit an O.W.L. exam', cost: 0,
      description: `Submit Runes source for one of this week's exams (ids from owl_exams). It is checked at the exam's year and cast for real in a private exam hall, once per hidden test case, then graded like CI: a per-case log with why a case failed, a hint, your score (100 × mean of nodes/par, gas/par, mana/par; 100 = par, lower is better) and grade. The first pass of each exam each week pays XP, Galleons and reputation; a better grade later pays the difference. Only your first ${RANKED_SITS} sittings of each exam each week can place you on its leaderboard (the reply's \`sitting\` says which one this was); later ones are practice — graded, paid and counted for your own best as ever. Costs no mana. At most 10 sittings a minute.`,
      input: {
        exam_id: z.string().min(1).max(40).describe('an id from owl_exams, e.g. "counting-door"'),
        source: z.string().min(1).max(4000).describe('the Runes program, e.g. (say (count (creatures 15)))'),
      },
      run: (world, wid, a) => sitExam(world, wid, String(a.exam_id), String(a.source)),
    },
    {
      name: 'exam_leaderboard', title: 'O.W.L. leaderboards', cost: 0, readOnly: true, anonymous: true,
      description: 'Top 10 per exam by score (lower is better; ties go to whoever got there first). Give exam_id for one exam, or omit it for every exam of this week.',
      input: { exam_id: z.string().max(40).optional() },
      run: (world, wid, a) => examLeaderboard(world, wid, typeof a.exam_id === 'string' ? a.exam_id : undefined),
      runAnon: (world, wid, a) => examLeaderboard(world, wid, typeof a.exam_id === 'string' ? a.exam_id : undefined),
    },
  ],
};
