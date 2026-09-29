/**
 * The storyboard: who is in the film, what happens in each shot (kernel syscalls at shot times), where the
 * camera flies, and the captions drawn over the canvas. Times are seconds from the start of the shot;
 * negative cue times happen in the pre-roll, before the first frame is drawn.
 */
import type { Actor, Cam, Cue, ShotDef, Stage, V3 } from './sim.js';

export interface Shot extends ShotDef {
  /** HTML drawn over the canvas at shot time t (styles computed from t: CSS animations do not run on the virtual clock). */
  overlay?: (t: number) => string;
  /** Shot time of the poster frame (the first shot that has one wins). */
  poster?: number;
}

/** Seconds each shot dissolves into the next. */
export const XFADE = 0.5;

/** Display faces (Google Fonts; local CJK fonts are the fallback). */
export const FONTS = 'https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&family=Noto+Serif+SC:wght@500;700;900&family=Cinzel:wght@500;700&display=block';

const GOLD = '#e2c27a';
export const CSS = `
body > *:not(#view):not(#promo):not(#promo-glyphs) { display: none !important; }
#promo { position: fixed; left: 0; top: 0; }
.promo { position: fixed; left: 0; top: 0; width: 1280px; height: 720px; transform-origin: 0 0; pointer-events: none; z-index: 99;
  font-family: 'Noto Serif SC', 'WenQuanYi Zen Hei', serif; color: #f4ecd9; letter-spacing: .04em; }
.promo .abs { position: absolute; }
.promo .brush { font-family: 'Ma Shan Zheng', 'Noto Serif SC', 'WenQuanYi Zen Hei', serif; font-weight: 400; }
.promo .latin { font-family: 'Cinzel', 'Noto Serif SC', serif; }
.promo .mono { font-family: 'DejaVu Sans Mono', 'WenQuanYi Zen Hei Mono', monospace; letter-spacing: 0; }
.promo .gold { background: linear-gradient(180deg, #fff3cf 0%, ${GOLD} 45%, #a8803a 100%); -webkit-background-clip: text; background-clip: text; color: transparent; text-shadow: none; }
.promo .halo { text-shadow: 0 2px 3px rgba(0,0,0,.9), 0 0 24px rgba(0,0,0,.6); }
.promo .glow { filter: drop-shadow(0 0 1px rgba(40,24,6,.9)) drop-shadow(0 2px 3px rgba(0,0,0,.85)) drop-shadow(0 0 22px rgba(226,194,122,.35)); }
.promo .band { left: 0; right: 0; bottom: 0; height: 230px; background: linear-gradient(to top, rgba(6,5,12,.72), rgba(6,5,12,.38) 55%, transparent); }
.promo .bandtop { left: 0; right: 0; top: 0; height: 220px; background: linear-gradient(to bottom, rgba(6,5,12,.6), rgba(6,5,12,.3) 55%, transparent); }
.promo .glass { background: rgba(13,11,21,.74); border: 1px solid rgba(226,194,122,.42); border-radius: 14px; box-shadow: 0 10px 40px rgba(0,0,0,.5), inset 0 0 0 1px rgba(255,255,255,.03); }
.promo .rule { height: 1px; background: linear-gradient(90deg, transparent, rgba(226,194,122,.8), transparent); }
.promo .cap { left: 0; right: 0; text-align: center; }
.promo .k { color: ${GOLD}; } .promo .p { color: #8a7f6c; } .promo .n { color: #9fc4ff; } .promo .e { color: #ff9a5c; } .promo .c { color: #8f9a86; } .promo .s { color: #b6e3a0; }
.promo .cursor { display: inline-block; width: .55em; height: 1.05em; vertical-align: -.15em; background: ${GOLD}; margin-left: 1px; }
`;

// ------------------------------------------------------------------ the cast (enrolled and dressed by sim.stage)
export const ACTORS: Record<string, Actor> = {
  star: { name: '林星河', house: 'Ravenclaw', year: 6, look: '(glamour :robe :midnight :trim :silver :glow :sky :material :starlight)' },
  leo: { name: '陈烈', house: 'Gryffindor', year: 7, seals: 1, look: '(glamour :robe :scarlet :trim :gold :glow :amber :material :flame)' },
  draco: { name: 'Draco Malfoy', house: 'Slytherin', year: 5, look: '(glamour :robe :snape-black :trim :emerald :material :silk)' },
  mo: { name: '墨白', house: 'Slytherin', year: 6, look: '(glamour :robe :mint :trim :silver :material :ghost)' },
  jing: { name: '苏镜', house: 'Ravenclaw', year: 4, look: '(glamour :robe :silver :trim :sapphire :material :mirror)' },
  lin: { name: '程鳞', house: 'Gryffindor', year: 3, look: '(glamour :robe :teal :trim :gold :material :scales)' },
  nuan: { name: '黄小暖', house: 'Hufflepuff', year: 2, look: '(glamour :robe :amber :trim :brown :material :velvet)' },
};

// ------------------------------------------------------------------ camera moves
const lerp = (a: V3, b: V3, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const ease = (k: number) => { const x = Math.max(0, Math.min(1, k)); return x * x * (3 - 2 * x); };
const glide = (k: number) => { const x = Math.max(0, Math.min(1, k)); return 0.5 * x + 0.5 * x * x * (3 - 2 * x); }; // constant drift plus a soft settle
/** A straight move from (p0 looking at l0) to (p1 looking at l1) over dur seconds. */
const dolly = (p0: V3, p1: V3, l0: V3, l1: V3, dur: number, fov = 50, curve = glide) => (t: number): Cam => {
  const k = curve(t / dur);
  return { pos: lerp(p0, p1, k), look: lerp(l0, l1, k), fov };
};
/** Two moves back to back, the second starting at `at`. */
const then = (a: (t: number) => Cam, at: number, b: (t: number) => Cam) => (t: number) => (t < at ? a(t) : b(t - at));

// ------------------------------------------------------------------ captions
/** 0 → 1 over [t0, t0+d]. */
const rise = (t: number, t0: number, d = 0.6) => ease((t - t0) / d);
/** In at t0, out at t1 (fades of d seconds). */
const win = (t: number, t0: number, t1: number, d = 0.5) => Math.min(rise(t, t0, d), 1 - rise(t, t1 - d, d));
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
/** A caption line: fades in and drifts up a little. */
function caption(t: number, t0: number, text: string, sub = '', top = 578, t1 = 99) {
  const o = win(t, t0, t1, 0.55);
  if (o <= 0) return '';
  const band = `<div class="abs ${top < 360 ? 'bandtop' : 'band'}" style="opacity:${o.toFixed(3)}"></div>`;
  return band + `<div class="abs cap" style="top:${top + (1 - rise(t, t0, 0.8)) * 14}px;opacity:${o.toFixed(3)}">
    <div class="halo" style="font-size:40px;font-weight:700;letter-spacing:.12em"><span class="gold glow">${text}</span></div>
    ${sub ? `<div class="halo" style="margin-top:6px;font-size:18px;font-weight:500;color:#e9dfc6;letter-spacing:.18em">${sub}</div>` : ''}
  </div>`;
}

/** Runes source with a little syntax colour (the spellbook's palette). */
function runes(src: string) {
  return src.split('\n').map((line) => {
    if (/^\s*;/.test(line)) return `<span class="c">${esc(line)}</span>`;
    return esc(line)
      .replace(/(:[a-z-]+)/g, '<span class="e">$1</span>')
      .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="n">$1</span>')
      .replace(/\((each|let|when|if|bolt|enemies|first|or|glamour|patronus|shield)\b/g, '(<span class="k">$1</span>')
      .replace(/([()])/g, '<span class="p">$1</span>');
  }).join('\n');
}
/** The first n characters of the source, keeping it valid HTML (colour applied after cutting). */
const typed = (src: string, n: number) => runes(src.slice(0, Math.max(0, Math.floor(n))));

// ------------------------------------------------------------------ the shots
const FIREBALLS = `; 流星火雨：给附近每个敌人一发火球
(each f (enemies 30)
  (bolt f 14 :fire))`;

const FORGED = 2.55, CAST = 2.85;

const LOOKS: [key: string, mat: string, zh: string, src: string][] = [
  ['nuan', 'velvet', '天鹅绒', '(glamour :robe :amber :trim :brown :material :velvet)'],
  ['lin', 'scales', '龙鳞', '(glamour :robe :teal :trim :gold :material :scales)'],
  ['jing', 'mirror', '魔镜', '(glamour :robe :silver :trim :sapphire :material :mirror)'],
  ['leo', 'flame', '火焰', '(glamour :robe :scarlet :trim :gold :material :flame)'],
  ['mo', 'ghost', '幽灵', '(glamour :robe :mint :trim :silver :material :ghost)'],
  ['star', 'starlight', '星光', '(glamour :robe :midnight :trim :silver :material :starlight)'],
];
const LOOK_AT = (i: number) => 0.4 + i * 0.68;

const DECREE = '{"world":{"aesthetics":{"aurora":true,"fireworks":true,"lanterns":true}}}';

export const SHOTS: Shot[] = [
  // 1. the castle at dusk, across the Black Lake → the title
  {
    id: 'castle', dur: 5.4, hour: 17.75, poster: 4.2,
    cast: {},
    camera: dolly([-160, 7, 86], [-128, 13, 50], [-8, 16, -84], [0, 22, -90], 6.1, 48),
    overlay: (t) => {
      const o = rise(t, 1.0, 1.1);
      if (o <= 0) return '';
      const sub = rise(t, 1.9, 0.9);
      return `<div class="abs cap" style="top:${120 - 10 * o}px;opacity:${o.toFixed(3)}">
        <div class="latin halo" style="font-size:15px;letter-spacing:.7em;color:#efdcae;margin-bottom:6px">HOGWARTS</div>
        <div class="brush glow" style="font-size:112px;line-height:1.05"><span class="gold">霍格沃茨</span></div>
        <div style="opacity:${sub.toFixed(3)}">
          <div class="rule" style="width:${(420 * sub).toFixed(0)}px;margin:10px auto 12px"></div>
          <div class="halo" style="font-size:34px;font-weight:700;letter-spacing:.5em;padding-left:.5em;color:#f4ecd9">咒语即代码</div>
          <div class="latin halo" style="margin-top:8px;font-size:14px;letter-spacing:.42em;color:#d8c9a2">WHERE SPELLS ARE CODE</div>
        </div>
      </div>`;
    },
  },
  // 2. a wizard in starlight robes against a swarm of pixies
  {
    id: 'cast', dur: 4.3, hour: 16.7,
    cast: { star: { x: 10, z: 31, f: Math.PI / 2 } },
    creatures: [
      { id: 'px1', kind: 'pixie', x: 20.5, z: 28 }, { id: 'px2', kind: 'pixie', x: 22, z: 32.5 },
      { id: 'px3', kind: 'pixie', x: 19.5, z: 35.5 }, { id: 'px4', kind: 'pixie', x: 23, z: 30 },
    ],
    cues: [
      [0.35, (s) => s.cast('star', 'Glacius', 'px1')],
      [1.25, (s) => s.cast('star', 'Glacius', 'px2')],
      [2.15, (s) => s.cast('star', 'Incendio', 'px3')],
      [3.05, (s) => s.cast('star', 'Glacius', 'px4')],
    ],
    camera: dolly([5.2, 2.2, 35.2], [6.4, 1.75, 36.8], [16.5, 1.5, 30.2], [17.5, 1.4, 31], 4.8, 48),
    overlay: (t) => caption(t, 0.6, '多人同服的 3D 魔法世界', '冰冻咒 · 火焰咒 · 击晕咒 —— 小精灵最怕冰'),
  },
  // 3. a spell written in Runes becomes real
  {
    id: 'code', dur: 5.8, hour: 16.9,
    cast: { leo: { x: -2, z: 31, f: Math.PI / 2 } },
    creatures: [
      { id: 'px5', kind: 'pixie', x: 10, z: 25 }, { id: 'px6', kind: 'pixie', x: 12, z: 31 }, { id: 'px7', kind: 'pixie', x: 9, z: 36.5 },
      { id: 'tr1', kind: 'troll', x: 16, z: 28.5, f: -Math.PI / 2 },
    ],
    cues: [
      [FORGED, (s) => s.forge('leo', '流星火雨', FIREBALLS)],
      [CAST, (s) => s.cast('leo', '流星火雨')],
      [CAST + 1.4, (s) => s.cast('leo', '流星火雨')],
    ],
    camera: dolly([-7.5, 3.2, 46], [-5.5, 2.7, 43.5], [1.2, 1.5, 29.5], [2.2, 1.5, 29.8], 6.3, 50),
    overlay: (t) => {
      const n = (t - 0.35) * 30;
      const done = t >= FORGED, cast = t >= CAST;
      const o = rise(t, 0, 0.45);
      return `<div class="abs glass" style="left:44px;top:170px;width:420px;padding:20px 24px;opacity:${o.toFixed(3)}">
          <div style="display:flex;justify-content:space-between;align-items:baseline">
            <div style="font-size:20px;font-weight:700;color:${GOLD};letter-spacing:.2em">咒语书</div>
            <div class="latin" style="font-size:12px;letter-spacing:.3em;color:#a89d86">RUNES</div>
          </div>
          <div class="rule" style="margin:10px 0 14px"></div>
          <pre class="mono" style="margin:0;font-size:17px;line-height:1.6;white-space:pre;min-height:84px">${typed(FIREBALLS, n)}${!done && Math.floor(t * 2.5) % 2 === 0 ? '<span class="cursor"></span>' : ''}</pre>
          <div style="margin-top:14px;font-size:16px;height:26px;opacity:${rise(t, FORGED, 0.3).toFixed(3)}"><span class="s">✓ 铸造成功</span><span style="color:#cfc3a6">　静态检查通过 · 法力 64</span></div>
          <div style="margin-top:4px;font-size:16px;height:26px;opacity:${(cast ? 1 : 0)}"><span class="k">▶ 施放「流星火雨」</span><span style="color:#cfc3a6">　四发火球，同时出手</span></div>
        </div>` + caption(t, 0.3, '咒语即代码', '用 Runes 写一段程序，铸造成真正的咒语', 60);
    },
  },
  // 4. your AI agent plays for you, over MCP, and talks to you by owl
  {
    id: 'agent', dur: 5.6, hour: 16.4,
    cast: { star: { x: -6, z: 36, f: -2.4 } },
    creatures: [{ id: 'tr2', kind: 'troll', x: -20, z: 19, f: 0.7, hp: 128 }],
    cues: [
      [0.4, (s) => s.walkTo('star', -13.5, 27)],
      [1.4, (s) => s.cast('star', 'Protego')],
      [2.0, (s) => s.cast('star', 'Reducto', 'tr2')],
      [2.7, (s) => s.cast('star', 'Lumos Solem', 'tr2')],
      [3.4, (s) => s.cast('star', 'Reducto', 'tr2')],
      [4.1, (s) => s.cast('star', 'Reducto', 'tr2')],
    ],
    camera: dolly([0.5, 2.9, 41.5], [-5.5, 2.6, 33], [-10.5, 1.5, 30], [-17.5, 1.6, 22], 6.1, 50),
    overlay: (t) => {
      const line = (at: number, html: string) => `<div style="margin-top:9px;opacity:${rise(t, at, 0.3).toFixed(3)};transform:translateY(${((1 - rise(t, at, 0.3)) * 6).toFixed(1)}px)">${html}</div>`;
      const who = (s: string, c: string) => `<span style="display:inline-block;width:62px;color:${c};font-weight:700">${s}</span>`;
      const tool = (s: string, ok = '✓') => `<span class="mono" style="font-size:15px;color:#cfc3a6">→ <span class="k">${s}</span> <span class="s">${ok}</span></span>`;
      return `<div class="abs glass" style="right:56px;top:128px;width:440px;padding:20px 24px;opacity:${rise(t, 0, 0.45).toFixed(3)};font-size:17px">
          <div style="display:flex;justify-content:space-between;align-items:baseline">
            <div style="font-size:20px;font-weight:700;color:${GOLD};letter-spacing:.2em">🦉 猫头鹰邮递</div>
            <div class="latin" style="font-size:12px;letter-spacing:.3em;color:#a89d86">MCP</div>
          </div>
          <div class="rule" style="margin:10px 0 6px"></div>
          ${line(0.15, `${who('你', '#f4ecd9')}帮我收拾那只巨怪，别掉血。`)}
          ${line(0.5, `${who('Agent', '#c3a6ff')}${tool('move_to', '')} <span style="color:#a89d86">A* 寻路</span>`)}
          ${line(1.4, `${who('', '')}${tool('cast 铁甲咒 Protego')}`)}
          ${line(2.0, `${who('', '')}${tool('cast 粉身碎骨 Reducto')}`)}
          ${line(2.7, `${who('', '')}${tool('cast 日光咒 Lumos Solem')}`)}
          ${line(4.6, `${who('Agent', '#c3a6ff')}搞定，巨怪倒了，你满血。✨`)}
        </div>` + caption(t, 0.35, '让你的 AI Agent 替你施法', '它通过 MCP 入学、写咒语、走路、决斗 · 人永远优先');
    },
  },
  // 5. transfiguration of self: one spell, a new look
  {
    id: 'glamour', dur: 5.6, hour: 17.25,
    cast: Object.fromEntries(LOOKS.map(([k], i) => [k, { x: -10 + i * 4, z: -24, f: Math.PI }])),
    cues: [
      ...LOOKS.flatMap(([k, , , src]): Cue[] => [
        [-2.2, (s: Stage) => s.cast(k, 'Reparifarge')],
        [-1.6, (s: Stage) => s.forge(k, '换装', src)],
      ]),
      ...LOOKS.map(([k], i): Cue => [LOOK_AT(i), (s) => s.cast(k, '换装')]),
    ],
    camera: dolly([-8.5, 1.95, -14.2], [7.5, 2.05, -14.6], [-6.5, 1.25, -24], [6.5, 1.35, -24], 6.1, 44, (k) => k),
    overlay: (t) => {
      let i = -1;
      for (let j = 0; j < LOOKS.length; j++) if (t >= LOOK_AT(j)) i = j;
      const chip = i < 0 ? '' : `<div class="abs cap" style="top:92px"><span class="glass mono" style="display:inline-block;padding:9px 20px;font-size:19px;border-radius:999px">${runes(`(glamour :material :${LOOKS[i][1]})`)}<span style="font-family:'Noto Serif SC',serif;color:${GOLD};margin-left:14px;letter-spacing:.2em">${LOOKS[i][2]}</span></span></div>`;
      return chip + caption(t, 0.5, '一句咒语，换一身行头', '天鹅绒 · 龙鳞 · 魔镜 · 火焰 · 幽灵 · 星光 —— 没有换装菜单');
    },
  },
  // 6. a duel, and a Malfoy who will be telling his father
  {
    id: 'duel', dur: 4.7, hour: 17.0,
    cast: { leo: { x: -7, z: 12, f: Math.PI / 2 }, draco: { x: 7, z: 12, f: -Math.PI / 2 } },
    cues: [
      [0.25, (s) => s.cast('draco', 'Stupefy', 'leo')],
      [0.45, (s) => s.cast('leo', 'Protego')],
      [1.2, (s) => s.cast('leo', 'Incendio', 'draco')],
      [1.75, (s) => s.cast('draco', 'Glacius', 'leo')],
      [2.35, (s) => { const d = s.w('draco'); d.hp = 24; d.say = null; s.cast('leo', 'Reducto', 'draco'); }],
    ],
    camera: dolly([-1.2, 3.2, 28.5], [0.9, 2.6, 25], [0, 1.6, 12], [0.8, 1.3, 12], 5.2, 48),
    overlay: (t) => caption(t, 0.4, '决斗攒声望，满世界都是梗', '击晕马尔福，他一定会搬出他爸爸'),
  },
  // 7. night: dementors over the lake, a Patronus, and the Minister redecorates the sky
  {
    id: 'night', dur: 7.4, hour: 22.4,
    cast: { star: { x: -48, z: 30, f: -Math.PI / 2 } },
    creatures: [
      { id: 'dm1', kind: 'dementor', x: -63, z: 26 }, { id: 'dm2', kind: 'dementor', x: -62, z: 35 }, { id: 'dm3', kind: 'dementor', x: -67, z: 31 },
    ],
    cues: [
      [1.5, (s) => s.cast('star', 'Expecto Patronum')],
      [3.3, (s) => s.decree('star', JSON.parse(DECREE), '让霍格沃茨的夜空为所有人而燃')],
    ],
    camera: then(
      dolly([-39, 2.4, 35], [-41, 2.8, 36], [-60, 3, 29], [-61, 3.2, 30], 3.4, 50),
      3.4,
      dolly([-41, 2.8, 36], [-62, 16, 58], [-61, 3.2, 30], [-8, 44, -96], 4.6, 52, ease),
    ),
    overlay: (t) => {
      const chip = t < 3.3 ? '' : `<div class="abs cap" style="top:100px;opacity:${rise(t, 3.3, 0.4).toFixed(3)}"><span class="glass mono" style="display:inline-block;padding:9px 20px;font-size:16px;border-radius:999px"><span class="k">decree</span> <span style="color:#cfc3a6">${esc(DECREE)}</span></span></div>`;
      return caption(t, 0.5, '呼神护卫', '摄魂怪只怕守护神', 578, 3.2) + chip + caption(t, 3.6, '声望第一的人，改写世界规则', '每学期的魔法部长：一道法令，改写规则与天空');
    },
  },
  // 8. the end card over the castle under an aurora
  {
    id: 'end', dur: 5.4, hour: 22.6,
    aesthetics: { aurora: true, fireworks: true, lanterns: true },
    cast: {},
    camera: dolly([-118, 26, 66], [-100, 31, 48], [0, 34, -92], [0, 36, -92], 5.4, 50),
    overlay: (t) => {
      const o = rise(t, 0.3, 0.9), l = rise(t, 1.1, 0.8);
      return `<div class="abs" style="inset:0;background:radial-gradient(ellipse at 50% 55%, rgba(8,7,16,.35) 0%, rgba(8,7,16,.72) 70%);opacity:${o.toFixed(3)}"></div>
        <div class="abs cap" style="top:${175 - 8 * o}px;opacity:${o.toFixed(3)}">
          <div class="brush glow" style="font-size:96px;line-height:1.05"><span class="gold">霍格沃茨</span></div>
          <div class="halo" style="margin-top:4px;font-size:24px;font-weight:700;letter-spacing:.36em;padding-left:.36em">咒语即代码 · 让 AI 替你施法</div>
          <div style="opacity:${l.toFixed(3)}">
            <div class="rule" style="width:420px;margin:22px auto 22px"></div>
            <span class="glass mono" style="display:inline-block;padding:12px 26px;font-size:22px;color:#f4ecd9"><span class="p">$</span> npm install <span class="p">&amp;&amp;</span> npm start</span>
            <div class="latin halo" style="margin-top:22px;font-size:22px;letter-spacing:.14em;color:${GOLD}">github.com/cklxx/Hogwarts</div>
          </div>
        </div>`;
    },
  },
];

/** Every caption string, so the page can fetch the glyphs it needs before the first frame. */
export function allText() {
  const out = new Set<string>();
  for (const s of SHOTS) for (let t = 0; t <= s.dur + 1; t += 0.25) { const h = s.overlay?.(t); if (h) out.add(h); }
  return [...out].join('');
}
