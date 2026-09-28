import { ZH_CREATURE, ZH_HOUSE, zhPlace, zhSpell } from '../src/shared/zh';

/** 中文 is the default; English is one click away (Esc menu). */
export type Lang = 'zh' | 'en';
const KEY = 'hogwarts.lang';
export const lang: Lang = (() => { try { return (localStorage.getItem(KEY) as Lang) || 'zh'; } catch { return 'zh'; } })();
export function setLang(l: Lang) { try { localStorage.setItem(KEY, l); } catch { /* private mode */ } location.reload(); }

/** Pick the string for the current language. */
export const L = (zh: string, en: string) => (lang === 'zh' ? zh : en);

export const houseName = (h: string) => L(ZH_HOUSE[h] ?? h, h);
export const creatureName = (k: string, en: string) => L(ZH_CREATURE[k] ?? en, en);
export const spellName = (en: string) => L(zhSpell(en), en);
export const placeName = (en: string) => L(zhPlace(en), en);

/** Static markup: elements carry data-zh (text/HTML) and data-zh-ph (placeholder) / data-zh-title. */
export function applyStatic(root: ParentNode = document) {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  if (lang !== 'zh') return;
  root.querySelectorAll<HTMLElement>('[data-zh]').forEach((e) => { e.innerHTML = e.dataset.zh!; });
  root.querySelectorAll<HTMLInputElement>('[data-zh-ph]').forEach((e) => { e.placeholder = e.dataset.zhPh!; });
  root.querySelectorAll<HTMLElement>('[data-zh-title]').forEach((e) => { e.title = e.dataset.zhTitle!; });
  document.title = '霍格沃茨 —— 咒语即代码的魔法世界';
}

/** The kernel speaks English in errors; translate the ones players meet most. */
const ERRORS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^not enough mana: needs ([\d.]+), you have ([\d.]+)/, (m) => `法力不足：需要 ${m[1]}，你只有 ${m[2]}`],
  [/^(.+) is recharging \(([\d.]+)s\)/, (m) => `${spellName(m[1])} 冷却中（${m[2]} 秒）`],
  [/^Too fast/, () => '太快了 —— 持杖的手需要缓一缓'],
  [/^You are stunned/, () => '你被击晕了'],
  [/^You have been disarmed/, () => '你被缴械了！'],
  [/^Your wand was confiscated/, () => '你的魔杖被没收了，你在阿兹卡班'],
  [/^You do not know "(.+)"/, (m) => `你还不会「${m[1]}」`],
  [/too many effects in one cast \(max (\d+)/, (m) => `一次施法的效果太多（你的年级上限 ${m[1]} 个）`],
  [/out of gas/, () => '咒语耗尽了魔力流转（gas），崩解了'],
  [/is out of range|out of range/, () => '目标超出射程'],
  [/needs year (\d) magic/, (m) => `这是 ${m[1]} 年级的魔法`],
  [/lies behind seal (\d)/, (m) => `这需要禁书区第 ${m[1]} 道封印`],
  [/You cannot Apparate or Disapparate inside Hogwarts grounds/, () => '在霍格沃茨场地内不能幻影显形或幻影移形。你没读过《霍格沃茨：一段校史》吗？'],
  [/It's Levi-O-sa/, () => '是羽加迪姆勒维-奥-萨，不是勒维奥-萨！'],
  [/^([^:]+?) is not a wizard in play/, () => '目标不是在场的巫师'],
  [/revive needs a stunned wizard/, () => '「快快复苏」需要一个被击晕的巫师'],
  [/forbidden by Ministry decree/, () => '魔法部法令禁止召唤'],
  [/The seal is still smouldering.*Wait (\d+)s/, (m) => `封印还在冒烟，再等 ${m[1]} 秒`],
  [/No page of this seal is here. Missing pages rest at: (.+)\./, (m) => `这里没有这道封印的书页。缺失的书页在：${m[1].split(', ').map(placeName).join('、')}`],
  [/You have not read every page/, () => '你还没读完这道封印的所有书页'],
  [/will not even speak to a wizard below year (\d)/, (m) => `这道封印不会理睬 ${m[1]} 年级以下的巫师`],
];
export function tr(msg: string): string {
  if (lang !== 'zh') return msg;
  for (const [re, f] of ERRORS) { const m = msg.match(re); if (m) return f(m); }
  return msg;
}
