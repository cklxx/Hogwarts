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
  [/There is no way to walk to/, () => '那里走不过去（被墙、湖或树林挡住了）'],
  [/The walls of Azkaban are thick/, () => '阿兹卡班的墙很厚，哪儿也去不了'],
  [/That seal is already broken/, () => '这道封印已经破解了'],
  [/You already hold every page of this seal/, () => '这道封印的书页你已经全部读过了'],
  // ---- Owl Post: keys, pairing codes, the owlbox, the agent (docs/AGENT_LINK.md)
  [/^That pairing code does not work/, () => '这个配对码不能用（不存在、已用过或已过期）。在游戏里打开猫头鹰邮递（Esc）重新生成一个。'],
  [/^Too many wrong pairing codes/, () => '这里一分钟内输错配对码的次数太多了。等一分钟再试。'],
  [/^NPCs do not pair with agents/, () => 'NPC 不能和 Agent 配对'],
  [/^Your human has paused you/, () => '你的主人暂停了你：现在只能观察、和主人说话'],
  [/^Your human is steering right now/, () => '主人正在操控：人的手放在方向键上时，Agent 要让路'],
  [/^Your owlbox is full of owls from your human that you have not read/, () => '信箱里塞满了主人还没被读过的猫头鹰：Agent 得先 listen 收信'],
  [/^Your owlbox is full of questions still waiting/, () => '信箱里塞满了还在等回答的提问'],
  [/^An owl needs a message/, () => '猫头鹰得带上一句话'],
  [/^Too many owls this minute/, () => '这一分钟寄的猫头鹰太多了，猫头鹰棚要歇一歇'],
  [/^Only an agent asks questions/, () => '只有 Agent 能发带选项的提问'],
  [/^An owl is from the player or from their agent/, () => '猫头鹰只能来自你或你的 Agent'],
  [/^There is no such question/, () => '没有这个提问'],
  [/^That question has expired/, () => '这个提问已经过期了'],
  [/^That question was already answered/, () => '这个提问已经回答过了'],
  [/^That is not one of the options/, () => '这不是提问里的选项'],
  [/^Your agent is not connected|^No agent is connected/, () => '你的 Agent 还没有连接'],
  // ---- hostile parcels and jinxes
  [/^Your tongue is stuck to the roof of your mouth/, () => '你的舌头粘在了上颚上（锁舌封喉）！暂时不能施法、不能公开说话。（给 Agent 的猫头鹰照样能飞。）'],
  [/^That cursed item is stuck to you\.[^(]*(?:\((\d+)s\))?/, (m) => `这件被诅咒的物品粘在你身上了${m[1] ? `（还剩 ${m[1]} 秒）` : ''}。对自己念「咒立停 Finite Incantatem」解除粘身，或者等它消退。`],
  [/^The forge won't deliver to that registry number/, () => '锻造炉不肯往这个登记号投递。'],
  [/^A curse cannot also bless/, () => '诅咒不能同时是祝福：恶意包裹上的每项附魔都必须是负面的（不能有正数，也不能附咒语）。'],
  [/^You have not learned the Dark Arts yet/, () => '你还没学过黑魔法。（2 年级再来。）'],
  [/^The forge will not post curses for a wizard who enrolled less than/, () => '入学不满 10 分钟的巫师，锻造炉不替他寄诅咒。'],
  [/^You cursed that wizard recently.*wait (\d+)s/, (m) => `你刚诅咒过这个巫师。锻造炉要你再等 ${m[1]} 秒。`],
  [/^This nastiness costs (\d+) Galleons.*you have (\d+)/, (m) => `这份恶意要 ${m[1]} 加隆（含恶意税），你只有 ${m[2]} 加隆。`],
  [/^Forging this costs (\d+) Galleons; you have (\d+)/, (m) => `锻造这件要 ${m[1]} 加隆，你只有 ${m[2]} 加隆。打败魔物能赚更多。`],
  [/^Too much enchantment: (\d+) points > your budget of (\d+)/, (m) => `附魔太多：${m[1]} 点，超过了你的预算 ${m[2]} 点`],
  [/^(.+)'s trunk is full \((\d+) items\)/, (m) => `${m[1]} 的箱子满了（${m[2]} 件）`],
  [/^No item "(.+)"/, (m) => `箱子里没有「${m[1]}」`],
  [/^The Elder Wand cannot be destroyed/, () => '老魔杖无法被销毁。哈利试过把它放回去。'],
  [/^(.+) has no charm to invoke/, (m) => `${m[1]} 上没有可以唤起的咒语`],
  [/^(.+) is recharging\.$/, (m) => `${m[1]} 冷却中`],
  [/^You cannot do that right now/, () => '你现在做不了这个'],
  [/^Unknown wizard/, () => '找不到这个巫师'],
  [/^Too many (?:requests|messages)/i, () => '操作太频繁了，歇一会儿再试'],
  [/^Slow down: too many messages/, () => '操作太频繁了，歇一会儿再试'],
  [/^The Sorting Hat needs a rest/, () => '分院帽要歇一歇：这里报名的人太多了。过几分钟再试。'],
];
export function tr(msg: string): string {
  if (lang !== 'zh') return msg;
  for (const [re, f] of ERRORS) { const m = msg.match(re); if (m) return f(m); }
  return msg;
}
