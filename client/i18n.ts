import { ZH_CREATURE, ZH_ELEMENT, ZH_HOUSE, zhPlace, zhSpell } from '../src/shared/zh';
import { UI_CHARM_INFO } from '../src/shared/reveal';
import type { UiCharm } from '../src/shared/constants';

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

/** Where the full word list lives (the spellbook's Grimoire). */
const GRIM = '打开咒语书下方的「魔法书（Grimoire）」查看全部能用的词';
const PRIM_ZH: Record<string, string> = { bolt: '魔弹 bolt', heal: '治疗 heal', shield: '护盾 shield', push: '击退 push', root: '定身 root', nova: '爆发 nova', summon: '召唤 summon', glamour: '变形术 glamour', regen: '持续治疗 regen', mend: '群疗 mend', haste: '加速 haste', chain: '连锁闪电 chain', storm: '风暴 storm', disarm: '缴械 disarm', revive: '复苏 revive', cleanse: '咒立停 cleanse' };
const ARG_ZH: Record<string, string> = { power: '威力', amount: '量', secs: '秒数', radius: '半径', force: '力度', mult: '倍率', rate: '速率', jumps: '跳数', range: '距离' };
/** "bolt power" → "魔弹 bolt 威力". */
const primZh = (w: string) => w.split(' ').map((x, i) => (i === 0 ? PRIM_ZH[x] ?? x : ARG_ZH[x] ?? x)).join(' ');
const TYPE_ZH: Record<string, string> = { place: '一个位置（目标或地点）', ent: '一个目标（巫师或魔物）', num: '一个数字', vec: '一个地点', str: '一段文字', elem: '一个元素', list: '一个列表', any: '一个值' };

/**
 * The kernel speaks English in errors; translate every one a browser player can meet (test/controls.test.ts and
 * test/play.test.ts run the real messages through here), with a hint where one helps. A trailing
 * "(line L, col C)" is translated by tr() itself.
 */
const ERRORS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^not enough mana: needs ([\d.]+), you have ([\d.]+)/, (m) => `法力不足：需要 ${m[1]}，你只有 ${m[2]}。等一会儿法力会回来，或者把威力调低一点。`],
  [/^(.+) is recharging \(([\d.]+)s\)/, (m) => `${spellName(m[1])} 冷却中（${m[2]} 秒）`],
  [/^Too fast/, () => '太快了 —— 持杖的手需要缓一缓'],
  [/^You are stunned/, () => '你被击晕了'],
  [/^You have been disarmed/, () => '你被缴械了！'],
  [/^Your wand was confiscated/, () => '你的魔杖被没收了，你在阿兹卡班'],
  [/^You are not in the world/, () => '你不在游戏世界里：打开游戏页面，或让 Agent 调用任意 MCP 工具'],
  [/^You do not know "(.+)"/, (m) => `你还不会「${spellName(m[1])}」`],
  [/^The spell found nothing to act on/, () => '咒语没有找到可以作用的对象（射程内没有目标？）。没有消耗法力。走近一点，或者先点一下目标再施放。'],
  [/too many effects in one cast \(max (\d+)/, (m) => `一次施法的效果太多（你的年级上限 ${m[1]} 个）。少打几个目标，或者升年级。`],
  [/^out of gas \((\d+)\)/, (m) => `咒语耗尽了魔力流转（gas 上限 ${m[1]}），崩解了。循环少一点，或者升年级提高上限。`],
  [/out of gas/, () => '咒语耗尽了魔力流转（gas），崩解了'],
  // ---- the Runes parser and checker
  [/^spell source too long \((\d+) > (\d+) chars\)/, (m) => `咒语太长了（${m[1]} 字符，上限 ${m[2]}）`],
  [/^unexpected end of spell/, () => '咒语意外结束了：是不是少了一个「)」？'],
  [/^nesting deeper than (\d+)/, (m) => `括号嵌套超过了 ${m[1]} 层`],
  [/^unclosed '\('/, () => '有一个「(」没有闭合：数一数括号，每个「(」都要配一个「)」'],
  [/^unclosed '\['/, () => '有一个「[」没有闭合'],
  [/^mismatched '(.)'/, (m) => `括号不匹配：这里的「${m[1]}」和前面的括号对不上`],
  [/^unexpected '(.)'/, (m) => `多了一个「${m[1]}」：删掉它，或者在前面补一个「(」`],
  [/^unclosed string/, () => '文字缺少结尾的引号「"」'],
  [/^empty spell/, () => '咒语是空的。写点什么吧，例如 (bolt (or target aim) 14)，或者点「从模板开始」'],
  [/^unknown name '([^']+)' — did you mean \(\1 \.\.\.\)\?/, (m) => `「${m[1]}」是一个咒语词，要放在括号开头：(${m[1]} ...)`],
  [/^unknown name '([^']+)'/, (m) => `不认识的名字「${m[1]}」：先用 (let ${m[1]} ...) 定义它，或者检查拼写。${GRIM}`],
  [/^unknown spell word '([^']+)'/, (m) => `不认识的咒语词「${m[1]}」：检查拼写。${GRIM}`],
  [/^no such word '([^']+)'/, (m) => `没有「${m[1]}」这个词。${GRIM}`],
  [/^empty form \(\)/, () => '空括号 () 什么也不做：括号里要以一个词开头，例如 (heal self 16)'],
  [/^a form must start with a name/, () => '括号里的第一个必须是词，例如 (heal self 16)'],
  [/^\((let|set!|if|repeat|each|min-by|max-by|after|when|unless|do) ([^)]*)\)$/, (m) => `写法不对，应该是 (${m[1]} ${m[2]})`],
  [/^set! cannot change '([^']+)': it is built in/, (m) => `set! 不能改「${m[1]}」：它是内置的。用 (let 新名字 ...) 起一个你自己的名字`],
  [/^set! needs an existing binding: '([^']+)' is unbound/, (m) => `set! 只能改已有的名字：「${m[1]}」还没定义，先写 (let ${m[1]} ...)`],
  [/^\(([^ )]+) ([^)]*)\) takes (at least )?([\d-]+) argument\(s\), got (\d+)/, (m) => `「${primZh(m[1])}」要 ${m[3] ? '至少 ' : ''}${m[4]} 个参数，你给了 ${m[5]} 个。写法：(${m[1]} ${m[2]})`],
  [/^this spell needs year (\d+) magic \(([^)]*)\); you are year (\d+)/, (m) => `这个咒语用到了 ${m[1]} 年级的魔法（${m[2]}），你现在是 ${m[3]} 年级。换掉这些词，或者先升级。`],
  [/needs year (\d) magic/, (m) => `这是 ${m[1]} 年级的魔法`],
  [/^:(\w+) lies behind seal (\d) of the Restricted Section; you have broken (\d)/, (m) => `布料「:${m[1]}」需要禁书区第 ${m[2]} 道封印（你已破解 ${m[3]} 道）`],
  [/^(.+) lies behind seal (\d) of the Restricted Section; you have broken (\d)/, (m) => `${m[1]} 需要禁书区第 ${m[2]} 道封印（你已破解 ${m[3]} 道）`],
  [/lies behind seal (\d)/, (m) => `这需要禁书区第 ${m[1]} 道封印`],
  [/^spell too complex: (\d+) nodes > your limit (\d+)/, (m) => `咒语太复杂：${m[1]} 个节点，超过了你的上限 ${m[2]}。精简一下，或者升年级提高上限。`],
  [/^banned by Ministry decree: (.+)/, (m) => `魔法部法令禁止了：${m[1]}`],
  [/^'(.+)' is banned by Ministry decree/, (m) => `魔法部法令禁止了「${m[1]}」`],
  // ---- the interpreter: what a running spell stumbles over
  [/^([^:]+): expected place, got nil from target\b/, (m) => `${primZh(m[1].split(' ')[0])}：没有选中目标（target 是空的 nil）。改成 (or target aim) —— 没目标时就打向你瞄准的地方`],
  [/^([^:]+): expected ent, got nil from (.+)$/, (m) => `${primZh(m[1].split(' ')[0])}：需要一个目标，但 ${m[2]} 是空的（nil）。先用 (when … ) 检查一下，或者先选中目标`],
  [/^([^:]+): expected (\w+), got (.+?) from (.+)$/, (m) => `${primZh(m[1].split(' ')[0])}：这里需要${TYPE_ZH[m[2]] ?? m[2]}，但 ${m[4]} 给的是 ${m[3]}`],
  [/^([^:]+): element must be one of (.+)/, (m) => `${primZh(m[1].split(' ')[0])}：元素只能是 ${m[2]}`],
  [/^expected a number, got (.+)/, (m) => `这里需要一个数字，得到的是 ${m[1]}`],
  [/^each needs a list, got (.+)/, (m) => `each 需要一个列表，得到的是 ${m[1]}。例如 (each e (enemies 10) ...)`],
  [/^expected an entity or point, got (.+)/, (m) => `这里需要一个目标或地点，得到的是 ${m[1]}。试试 (or target aim)`],
  [/^(.+) is gone$/, (m) => `${m[1]} 已经不在了`],
  [/^([^:]+?) is not a wizard in play/, () => '目标不是在场的巫师'],
  [/^(.+) is out of range \(([\d.]+)m > (\d+)m\)/, (m) => `${m[1]} 超出射程（${m[2]} 米 > ${m[3]} 米）：走近一点`],
  [/^target out of range \(([\d.]+)m > (\d+)m\)/, (m) => `目标超出射程（${m[1]} 米 > ${m[2]} 米）：走近一点`],
  [/^too far to revive \((\d+)m\)/, (m) => `太远了，扶不起来（要在 ${m[1]} 米以内）`],
  [/^too far to Apparate \(([\d.]+)m > (\d+)m\)/, (m) => `幻影移形太远了（${m[1]} 米 > ${m[2]} 米）`],
  [/^out of range \((\d+)m\)/, (m) => `超出范围（${m[1]} 米）`],
  [/is out of range|out of range/, () => '目标超出射程'],
  [/^unknown query (.+)/, (m) => `不认识的查询词 ${m[1]}`],
  [/^you cannot push (.+) here/, (m) => `这里不能击退 ${m[1]}（安全区，或者对方是友方）`],
  [/^you cannot harm (.+) here/, (m) => `这里不能伤害 ${m[1]}（安全区，或者对方是友方）`],
  [/^the storm must gather within (\d+)m/, (m) => `风暴只能在 ${m[1]} 米以内聚集`],
  [/^cleanse a wizard in play or one of your own summons/, () => '咒立停只能作用于在场的巫师或你自己的召唤物'],
  [/^reveal what\? one of (.+)/, (m) => `reveal 要揭示什么？只能是 ${m[1]}`],
  [/^reveal :([\w-]+) → (look\.\w+)/, (m) => `显形 :${m[1]} 点亮了${UI_CHARM_INFO[m[1] as UiCharm]?.zh ?? '一角'}（Agent 看 ${m[2]}）`],
  [/^:(tempus|revelio|point-me|homenum) is year-(\d) magic/, (m) => `「:${m[1]}」是 ${m[2]} 年级的魔法`],
  [/^summon what\? one of (.+)/, (m) => `召唤什么？只能是 ${m[1]}`],
  [/^:(\w+) is year-(\d) conjuration/, (m) => `召唤「:${m[1]}」要 ${m[2]} 年级`],
  [/^conjuration is forbidden by Ministry decree/, () => '魔法部法令禁止召唤'],
  [/^laws cannot schedule/, () => '法律里不能用 (after ...)'],
  [/^a delayed block cannot schedule another/, () => '延迟块里不能再套一个 (after ...)'],
  [/^too many \(after \.\.\.\) blocks \(max (\d+)\)/, (m) => `(after ...) 太多了（最多 ${m[1]} 个）`],
  [/You cannot Apparate or Disapparate inside Hogwarts grounds/, () => '在霍格沃茨场地内不能幻影显形或幻影移形。你没读过《霍格沃茨：一段校史》吗？'],
  [/^It's Levi-O-sa/, () => '是羽加迪姆勒维-奥-萨，不是勒维奥-萨！（这个咒语会失效。）'],
  [/revive needs a stunned wizard/, () => '「快快复苏」需要一个被击晕的巫师'],
  [/forbidden by Ministry decree/, () => '魔法部法令禁止召唤'],
  // ---- notes on a cast or a simulation
  [/^(.+?) ([\d.]+) clamped to your cap ([\d.]+)/, (m) => `${primZh(m[1])} ${m[2]} 超过了你的年级上限，按 ${m[3]} 施放（升年级上限会提高）`],
  [/^after ([\d.]+)s clamped to (\d+)s/, (m) => `after ${m[1]} 秒超过上限，按 ${m[2]} 秒`],
  [/^Delayed blocks are planned against the world as it is now/, () => '延时块是按现在的世界推演的；等它们生效时，目标可能已经走开了'],
  [/^glamour :secs only times a jinx on someone else/, () => 'glamour :secs 只对别人（变色恶咒）有用；你自己的新造型会一直保持，直到你再换'],
  [/^The (.+) Curse is Unforgivable/, (m) => `${m[1]} 是不可饶恕咒。施放它会被送进阿兹卡班。`],
  [/^Cost (\d+) Galleons for ([\d.]+)\/(\d+) enchantment points/, (m) => `花了 ${m[1]} 加隆（附魔 ${m[2]}/${m[3]} 点）`],
  [/^🎉 Mischief managed! You found the Weasley Loophole/, () => '🎉 恶作剧完毕！你发现了「韦斯莱漏洞」：锻造炉会把物品寄给包裹上写的任何登记号。'],
  // ---- transfiguration (glamour)
  [/^:(\w+) is year-(\d) transfiguration \(you are year (\d)\)/, (m) => `布料「:${m[1]}」是 ${m[2]} 年级的变形术（你现在 ${m[3]} 年级）`],
  [/^glamour :on someone else is year-(\d) magic/, (m) => `对别人用变形术（变色恶咒）是 ${m[1]} 年级的魔法`],
  [/^glamour :reset only works on yourself/, () => 'glamour :reset 只能用在自己身上；别人身上的变色恶咒用咒立停解除'],
  [/^glamour :on needs a wizard/, () => 'glamour :on 需要一个巫师（只有巫师穿长袍），例如 :on target'],
  [/^you cannot jinx (.+)'s robes here/, (m) => `这里不能给 ${m[1]} 的长袍下恶咒：只能对可以决斗的对手（安全区外、允许决斗时）`],
  [/^\(glamour :key value \.\.\.\) needs at least one key: (.+)/, (m) => `glamour 至少要一个键：${m[1]}`],
  [/^glamour takes at most (\d+) words/, (m) => `glamour 最多 ${m[1]} 个词`],
  [/^glamour: unknown key :(\S+) — use (.+)/, (m) => `glamour 不认识「:${m[1]}」，可用的键：${m[2]}`],
  [/^glamour: :(\S+) needs a value/, (m) => `glamour 的「:${m[1]}」后面要跟一个值`],
  [/^glamour: expected a key like :robe at word (\d+)/, (m) => `glamour 第 ${m[1]} 个词应该是一个键，例如 :robe`],
  [/^glamour: no such material :(\S+) — one of (.+)/, (m) => `没有「:${m[1]}」这种布料，可选：${m[2]}`],
  [/^glamour :material: expected one of (.+)/, (m) => `布料只能是 ${m[1]}`],
  [/^glamour(?: :(\w+))?: "([^"]*)" is not a colour/, (m) => `「${m[2]}」不是颜色：用 "#rrggbb"、"#rgb" 或颜色名，例如 :gold :crimson :emerald`],
  [/^glamour :(\w+): expected a colour/, (m) => `glamour :${m[1]} 需要一个颜色，例如 "#7a1f2b" 或 :gold`],
  [/^glamour :secs needs a number/, () => 'glamour :secs 后面要跟一个数字'],
  // ---- enrolment and the spellbook
  [/^A name must be 2-24 letters/, () => '名字要 2–24 个字符：字母、汉字、数字、空格或 _ \' . -'],
  [/^There is already a (\w+) called (.+)\./, (m) => `已经有一位${houseName(m[1])}的同学叫 ${m[2]} 了，换个名字吧`],
  [/^The owl got lost/, () => '猫头鹰迷路了，再试一次。'],
  [/^Spell names must be 1-40 characters/, () => '咒语名要 1–40 个字符'],
  [/^"(.+)" is part of the standard curriculum; pick another name/, (m) => `「${spellName(m[1])}」是标准课程里的咒语，换个名字吧（比如「${m[1]} II」）。祖传代码，不要动。`],
  [/^Your spellbook holds (\d+) original spells at year (\d+)/, (m) => `${m[2]} 年级的咒语书只能放 ${m[1]} 个自创咒语。先遗忘一个。`],
  [/^No spell "(.+)" in your book/, (m) => `咒语书里没有「${m[1]}」`],
  [/^You cannot unlearn the standard curriculum/, () => '标准课程的咒语不能遗忘'],
  [/^(Avada Kedavra|Crucio|Imperio)! Ministry Hit Wizards Apparate around you/, (m) => `${m[1]}！魔法部打击手在你身边幻影显形。阿兹卡班欢迎你。`],
  [/^The shop does not sell that/, () => '商店不卖这个'],
  // ---- the Restricted Section
  [/The seal is still smouldering.*Wait (\d+)s/, (m) => `封印还在冒烟，再等 ${m[1]} 秒`],
  [/No page of this seal is here. Missing pages rest at: (.+)\./, (m) => `这里没有这道封印的书页。缺失的书页在：${m[1].split(', ').map(placeName).join('、')}`],
  [/You have not read every page/, () => '你还没读完这道封印的所有书页'],
  [/will not even speak to a wizard below year (\d)/, (m) => `这道封印不会理睬 ${m[1]} 年级以下的巫师`],
  [/^There are four seals/, () => '一共只有四道封印'],
  [/^The seals must be broken in order/, () => '封印必须按顺序破解'],
  [/^This seal takes exactly (\d+) 32-bit word/, (m) => `这道封印要恰好 ${m[1]} 个 32 位答案字，例如 0x1a2b3c4d`],
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
  [/^A question needs 2 to 4 different options/, () => '提问要有 2 到 4 个不同的选项'],
  [/^An owl is from the player or from their agent/, () => '猫头鹰只能来自你或你的 Agent'],
  [/^There is no such question/, () => '没有这个提问'],
  [/^That question has expired/, () => '这个提问已经过期了'],
  [/^That question was already answered/, () => '这个提问已经回答过了'],
  [/^That is not one of the options/, () => '这不是提问里的选项'],
  [/^Your agent is not connected|^No agent is connected/, () => '你的 Agent 还没有连接'],
  // ---- hostile parcels, jinxes and the forge
  [/^Your tongue is stuck to the roof of your mouth/, () => '你的舌头粘在了上颚上（锁舌封喉）！暂时不能施法、不能公开说话。（给 Agent 的猫头鹰照样能飞。）'],
  [/^That cursed item is stuck to you\.[^(]*(?:\((\d+)s\))?/, (m) => `这件被诅咒的物品粘在你身上了${m[1] ? `（还剩 ${m[1]} 秒）` : ''}。对自己念「咒立停 Finite Incantatem」解除粘身，或者等它消退。`],
  [/^The forge won't deliver to that registry number/, () => '锻造炉不肯往这个登记号投递。'],
  [/^A curse cannot also bless/, () => '诅咒不能同时是祝福：恶意包裹上的每项附魔都必须是负面的（不能有正数，也不能附咒语）。'],
  [/^You have not learned the Dark Arts yet/, () => '你还没学过黑魔法。（2 年级再来。）'],
  [/^The forge will not post curses for a wizard who enrolled less than/, () => '入学不满 10 分钟的巫师，锻造炉不替他寄诅咒。'],
  [/^You cursed that wizard recently.*wait (\d+)s/, (m) => `你刚诅咒过这个巫师。锻造炉要你再等 ${m[1]} 秒。`],
  [/^This nastiness costs (\d+) Galleons.*you have (\d+)/, (m) => `这份恶意要 ${m[1]} 加隆（含恶意税），你只有 ${m[2]} 加隆。`],
  [/^Forging this costs (\d+) Galleons; you have (\d+)/, (m) => `这件要 ${m[1]} 加隆，你只有 ${m[2]} 加隆。打败魔物能赚更多。`],
  [/^Too much enchantment: ([\d.]+) points > your budget of (\d+)/, (m) => `附魔太多：${m[1]} 点，超过了你的预算 ${m[2]} 点（升年级预算会提高）`],
  [/^(.+)'s trunk is full \((\d+) items\)/, (m) => `${m[1]} 的箱子满了（${m[2]} 件）。先销毁一件。`],
  [/^No item "(.+)"/, (m) => `箱子里没有「${m[1]}」`],
  [/^An item needs a name/, () => '物品得有个名字'],
  [/^Every Time-Turner in Ministry stock was smashed/, () => '魔法部库存的时间转换器在 1996 年神秘事务司之战中全砸碎了。锻造炉拒绝。'],
  [/^There is only one Elder Wand/, () => '老魔杖只有一根。它和邓布利多在一起 —— 或者在打败它上一任主人的人手里。'],
  [/^The Deathly Hallows cannot be forged/, () => '死亡圣器是锻造不出来的。这正是它们的意义所在。'],
  [/^slot must be one of (.+)/, (m) => `部位只能是 ${m[1]}`],
  [/^unknown mod '(\w+)'/, (m) => `不认识的附魔「${m[1]}」`],
  [/^(\w+) must be a non-negative number/, (m) => `${m[1]} 必须是非负数`],
  [/^(\w+) ([\d.-]+) exceeds the cap of ([\d.]+)/, (m) => `${m[1]} ${m[2]} 超过了上限 ${m[3]}`],
  [/^(\w+) ([\d.-]+) is below the floor of ([\d.-]+)/, (m) => `${m[1]} ${m[2]} 低于下限 ${m[3]}`],
  [/^The Elder Wand cannot be destroyed/, () => '老魔杖无法被销毁。哈利试过把它放回去。'],
  [/^(.+) has no charm to invoke/, (m) => `${m[1]} 上没有可以唤起的咒语`],
  [/^(.+) is recharging\.$/, (m) => `${m[1]} 冷却中`],
  [/^You cannot do that right now/, () => '你现在做不了这个'],
  [/^Unknown wizard/, () => '找不到这个巫师'],
  [/^Too many (?:requests|messages)/i, () => '操作太频繁了，歇一会儿再试'],
  [/^Slow down: too many messages/, () => '操作太频繁了，歇一会儿再试'],
  [/^The Sorting Hat needs a rest/, () => '分院帽要歇一歇：这里报名的人太多了。过几分钟再试。'],
  // ---- titles: how to earn the next one (me.title.next.how)
  [/^Earn (\d+) XP\.$/, (m) => `获得 ${m[1]} 点经验（打魔物就有）`],
  [/^Reach year (\d)\.$/, (m) => `升到 ${m[1]} 年级`],
  [/^Year (\d) and the First Seal broken\.$/, (m) => `${m[1]} 年级，并破解禁书区第一道封印`],
  [/^Year (\d) and (two|three) seals broken\.$/, (m) => `${m[1]} 年级，并破解${m[2] === 'two' ? '两' : '三'}道封印`],
  [/^Year (\d)\.$/, (m) => `升到 ${m[1]} 年级`],
  [/^All four seals of the Restricted Section broken\.$/, () => '破解禁书区全部四道封印'],
  [/^All four seals, and you have served as Minister for Magic\.$/, () => '破解全部四道封印，并当过魔法部长'],
  [/^You have just stepped off the Hogwarts Express\.$/, () => '你刚走下霍格沃茨特快列车'],
];

const CJK = /[㐀-鿿]/;
/**
 * A line the kernel already wrote in both languages (a fizzle quip, a forge note: "中文… English…", or a lore
 * refusal: "English… 中文…"): the two halves, or null when the line is not one.
 */
export function splitBi(line: string): { zh: string; en: string } | null {
  if (!CJK.test(line)) return null;
  // "中文… English…": cut after the last CJK character (or closing mark) that is followed by an English sentence
  const zf = /^(.*[\u3000-\u303f\u3400-\u9fff\uff00-\uffef」』）])\s+((?:\p{Extended_Pictographic}\s*)?(?=(?:[^\u3400-\u9fff]*?[A-Za-z]{2,}[^A-Za-z]){2})[A-Za-z0-9"'(][^\u3400-\u9fff]*)$/su.exec(line);
  if (zf) return { zh: zf[1], en: zf[2] };
  // "English… 中文…": the Chinese half has no Latin words in it
  const ef = /^(.*?[.!?)])\s+([^A-Za-z]*[\u3400-\u9fff][^A-Za-z]*)$/s.exec(line);
  return ef ? { en: ef[1], zh: ef[2] } : null;
}
/** A dry run's delayed-block line (kernel/magic.ts planLater): "t+1.5s: rest" → ["1.5 秒后：", "rest"]. */
const later = (line: string): [string, string] => { const m = /^t\+([\d.]+)s: (.*)$/s.exec(line); return m ? [`${m[1]} 秒后：`, m[2]] : ['', line]; };
function trLine(line: string): string {
  const [when, rest] = later(line);
  if (when) return when + trLine(rest);
  const pos = /^(.*) \(line (\d+), col (\d+)\)$/s.exec(line);
  const core = pos ? pos[1] : line;
  let out: string | null = null;
  for (const [re, f] of ERRORS) { const m = core.match(re); if (m) { out = f(m); break; } }
  if (out === null) { const bi = splitBi(core); out = bi ? bi.zh : core; }
  return pos ? `${out}（第 ${pos[2]} 行，第 ${pos[3]} 列）` : out;
}
/** A kernel message in the player's language (each line on its own; a bilingual line keeps its own half). */
export function tr(msg: string): string {
  // `retry_after=N` is for agents; a person reads the seconds in the sentence itself
  const s = String(msg ?? '').replace(/\s*retry_after=\d+/g, '');
  if (lang !== 'zh') return s.split('\n').map((l) => splitBi(l)?.en ?? l).join('\n');
  return s.split('\n').map(trLine).join('\n');
}

const el = (e: string) => ZH_ELEMENT[e] ?? e;
const SUMMON_ZH: Record<string, string> = { serpent: '大蛇', birds: '飞鸟' };
/** A simulate / cast effect line (kernel/magic.ts `desc` + " (n mana)") in Chinese; unknown shapes pass through. */
export function simEffectZh(line: string): string {
  const [when, rest] = later(line);
  if (when) return when + (rest.startsWith('fizzles: ') ? `失败：${trLine(rest.slice(9))}` : rest === 'nothing to act on' ? '没有可以作用的对象（按现在的世界）' : simEffectZh(rest));
  const m = /^(.*?)(?: \(([\d.]+) mana\))?$/.exec(line)!;
  const d = m[1], mana = m[2] ? `（${m[2]} 法力）` : '';
  const R: [RegExp, (...g: string[]) => string][] = [
    [/^bolt ([\d.]+) (\w+)$/, (p, e) => `魔弹 ${p} 点${el(e)}伤害`],
    [/^disarm (.+)$/, (t) => `缴械 ${t}`],
    [/^root (.+) ([\d.]+)s$/, (t, s) => `定身 ${t} ${s} 秒`],
    [/^heal (.+) ([\d.]+)$/, (t, a) => `治疗 ${t} ${a} 点`],
    [/^shield (.+) ([\d.]+) for ([\d.]+)s$/, (t, a, s) => `护盾 ${t} ${a} 点，${s} 秒`],
    [/^haste (.+) x([\d.]+) ([\d.]+)s$/, (t, x, s) => `加速 ${t} ×${x}，${s} 秒`],
    [/^push (.+) ([\d.]+)m$/, (t, f) => `击退 ${t} ${f} 米`],
    [/^nova r([\d.]+) ([\d.]+) (\w+)$/, (r, p, e) => `爆发 半径 ${r} 米，${p} 点${el(e)}伤害`],
    [/^patronus ([\d.]+)s$/, (s) => `守护神 ${s} 秒`],
    [/^apparate ([\d.]+)m$/, (d2) => `幻影移形 ${d2} 米`],
    [/^reveal (.+)$/, (k) => `显形 ${k}`],
    [/^chain (.+) ([\d.]+) (\w+)$/, (t, p, e) => `连锁闪电 ${t} ${p} 点${el(e)}伤害`],
    [/^storm r([\d.]+) ([\d.]+) (\w+)$/, (r, p, e) => `风暴 半径 ${r} 米，${p} 点${el(e)}伤害`],
    [/^say "(.*)"$/s, (t) => `说「${t}」`],
    [/^regen (.+) ([\d.]+)\/s for ([\d.]+)s$/, (t, r, s) => `持续治疗 ${t} 每秒 ${r}，${s} 秒`],
    [/^cleanse (.+)$/, (t) => `咒立停 ${t}`],
    [/^revive (.+)$/, (t) => `复苏 ${t}`],
    [/^mend r([\d.]+) ([\d.]+)$/, (r, a) => `群疗 半径 ${r} 米，${a} 点`],
    [/^summon (\w+) for ([\d.]+)s$/, (k, s) => `召唤${SUMMON_ZH[k] ?? k} ${s} 秒`],
    [/^glamour self: (.*)$/s, (x) => `变形术 自己：${x}`],
    [/^glamour (.+) for ([\d.]+)s: (.*)$/s, (t, s, x) => `变形术 ${t} ${s} 秒：${x}`],
    [/^lumos$/, () => '荧光闪烁'],
    [/^(\d+) delayed block\(s\)$/, (n) => `${n} 个延时块`],
  ];
  for (const [re, f] of R) { const g = re.exec(d); if (g) return f(...g.slice(1)) + mana; }
  return line;
}
/** The same, in the player's language. */
export const simEffect = (line: string) => (lang === 'zh' ? simEffectZh(line) : line);
const PRIM_NAME_ZH: Record<string, string> = {
  bolt: '魔弹', disarm: '缴械', root: '定身', heal: '治疗', shield: '护盾', haste: '加速', push: '击退', nova: '爆发', patronus: '守护神',
  apparate: '幻影移形', reveal: '显形', chain: '连锁闪电', storm: '风暴', say: '说话', regen: '持续治疗', cleanse: '咒立停', revive: '复苏', mend: '群疗',
  summon: '召唤', glamour: '变形术', light: '照明',
};
/** An effect primitive's name (Spell.effects) in the player's language. */
export const primName = (p: string) => L(PRIM_NAME_ZH[p] ?? p, p);
