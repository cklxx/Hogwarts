/**
 * The shapes the browser panels read (docs/UNFAIR.md "For the client", README 普通巫师等级考试 and 使魔). They mirror
 * World.privateState() (the features' fields), unfair.ts daState, listExams / sitExam / examLeaderboard and FamiliarState structurally,
 * so nothing from the server is imported into the client bundle.
 */

/** Snapshot top-level `dl`: the Dark Lord's whereabouts for everyone, or null. */
export interface DarkLordPin { h: string; n: string; x: number; z: number; p: string }

export interface VetoView {
  perTerm: number; usedThisTerm: boolean; windowSeconds: number;
  decree: { minister: string; changes: string[]; secondsLeft: number } | null;
  votes: number; needed: number; voted: boolean;
}
export interface DaView {
  member: boolean; eligible: boolean; size: number; online: number; quorum: number;
  members?: { handle: string; name: string; online: boolean }[];
  veto: VetoView;
  /** Only in the {t:'da'} reply (World.daState): why you may not join, the size cap, who is admitted, the joint spell. */
  why?: string; whyZh?: string; max?: number;
  admits?: { belowReputation: number; orBelowMedian: number };
  joint?: { members: number; withinSeconds: number; damagePct: number };
}
export interface StudyEntry { spell: string; from: string; handle: string; readyAt: number }
export interface FocusView { on: boolean; cur: number; max: number; regen: number }
/** What the features put in your private state (src/kernel/unfair.ts views: me.darkLord, me.da, me.studyable), and the kernel's me.focus / me.lawless. */
export interface UnfairMe {
  darkLord: boolean;
  da: DaView & { /** Seconds the joint-Patronus badge still shows for you. */ jointBadge: number };
  studyable: StudyEntry[];
  focus: FocusView;
  lawless: boolean;
}

/** src/server/familiar.ts FamiliarState (me.agent.familiar, welcome.familiar, the {t:'familiar'} reply). */
export type FamiliarKind = 'owl' | 'cat' | 'toad';
export interface FamiliarState { on: boolean; kind: FamiliarKind; name: string; dormant: boolean; busy: boolean; queued: number; left: number; daily: number }

export type Grade = 'O' | 'E' | 'A' | 'P' | 'D' | 'T';
export interface Line { zh: string; en: string }
export interface ExamBest { grade: Grade; gradeName: Line; points: number | null; nodes: number; gas: number; mana: number; passed: string }
export interface BoardRow { rank: number; name: string; house: string; grade: Grade; points: number; nodes: number; gas: number; mana: number; week: string; you?: boolean }
export interface ExamInfo {
  id: string; year: number; subject: Line; title: Line; brief: Line;
  par: { nodes: number; gas: number; mana: number }; limits?: { nodes?: number; gas?: number }; cases: number;
  reward: { xp: number; galleons: number; reputation: number; note: string };
  locked?: string; yourBest: ExamBest | null; top: BoardRow[];
}
/** listExams (the {t:'exams'} reply). */
export interface ExamList {
  title: Line; week: string; resetsAt: string; grading: Line;
  progress: { passed: number; outstanding: number; of: number };
  exams: ExamInfo[];
}
/** sitExam (the {t:'sat'} reply). */
export interface SitReport {
  exam: string; title: Line; verdict: 'PASS' | 'FAIL'; grade: Grade; gradeName: Line; passed: string;
  score: { points: number | null; nodes: number; gas: number; mana: number }; par: { nodes: number; gas: number; mana: number };
  log: string;
  cases: { case: number; name: string; ok: boolean; why?: string; gas: number; mana: number; effects: string[]; notes?: string[] }[];
  compileError?: string; hint?: string; toReachO?: string;
  best: ExamBest | null; improved: boolean; rank: number | null;
  rewards: { xp: number; galleons: number; reputation: number } | null;
  achievements: string[]; meme?: string;
}
/** examLeaderboard for one exam (the {t:'examboard'} reply). */
export interface ExamBoard { id: string; title: Line; year: number; par: { nodes: number; gas: number; mana: number }; top: BoardRow[] }
