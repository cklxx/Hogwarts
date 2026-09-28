/**
 * The rank ladder. Everyone starts as a Muggle; the top rung is Merlin.
 * A title requires a school year, a number of broken Restricted-Section seals, and (at the very top)
 * having served as Minister for Magic. titleIndex is monotone in all three (verified in formal/lean).
 */
export interface Title { key: string; zh: string; en: string; year: number; seals: number; minister?: boolean; xp?: number; how: string }

export const TITLES: Title[] = [
  { key: 'muggle', zh: '麻瓜', en: 'Muggle', year: 1, seals: 0, how: 'You have just stepped off the Hogwarts Express.' },
  { key: 'squib', zh: '哑炮', en: 'Squib', year: 1, seals: 0, xp: 30, how: 'Earn 30 XP.' },
  { key: 'apprentice', zh: '学徒', en: 'Apprentice', year: 2, seals: 0, how: 'Reach year 2.' },
  { key: 'wizard', zh: '巫师', en: 'Wizard', year: 3, seals: 0, how: 'Reach year 3.' },
  { key: 'prefect', zh: '级长', en: 'Prefect', year: 4, seals: 1, how: 'Year 4 and the First Seal broken.' },
  { key: 'auror-trainee', zh: '见习傲罗', en: 'Auror Trainee', year: 5, seals: 1, how: 'Year 5.' },
  { key: 'auror', zh: '傲罗', en: 'Auror', year: 6, seals: 2, how: 'Year 6 and two seals broken.' },
  { key: 'warlock', zh: '大巫师', en: 'Warlock', year: 7, seals: 3, how: 'Year 7 and three seals broken.' },
  { key: 'chief-warlock', zh: '威森加摩首席', en: 'Chief Warlock', year: 7, seals: 4, how: 'All four seals of the Restricted Section broken.' },
  { key: 'merlin', zh: '梅林', en: 'Merlin', year: 7, seals: 4, minister: true, how: 'All four seals, and you have served as Minister for Magic.' },
];

export function titleIndex(p: { year: number; xp: number; seals: number; wasMinister: boolean }): number {
  let best = 0;
  TITLES.forEach((t, i) => {
    if (p.year >= t.year && p.seals >= t.seals && (!t.minister || p.wasMinister) && p.xp >= (t.xp ?? 0)) best = i;
  });
  return best;
}
