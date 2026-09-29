/**
 * 巧克力蛙画片 — Chocolate Frog cards (README 巧克力蛙画片). Famous witches and wizards (the cards Ron collects: "I've
 * got about five hundred"), Hogwarts' ghosts and portraits, and a handful of Chinese-fan meme specials. Every card is
 * bilingual, Chinese first. Cards are never sold: they drop from creatures (rarely), come with event rewards and wait
 * in hidden chests. A duplicate turns into Galleons (CARD_DUP_GALLEONS). Completing a set earns its title.
 *
 * Shared by the kernel (kernel/cards.ts: drops, the album, set bonuses) and the browser (the album panel, the reveal).
 */
import type { CardRarity } from '../shared/constants.js';

export interface Card {
  id: string;
  zh: string;
  en: string;
  rarity: CardRarity;
  set?: CardSetId;
  /** The back of the card. */
  flavour: { zh: string; en: string };
}

export type CardSetId = 'founders' | 'marauders' | 'ghosts' | 'headmasters' | 'memes';

export interface CardSet { id: CardSetId; zh: string; en: string; title: { zh: string; en: string }; blurb: { zh: string; en: string } }

export const CARD_SETS: CardSet[] = [
  { id: 'founders', zh: '四巨头', en: 'The Four Founders', title: { zh: '四巨头的继承人', en: 'Heir of the Four Founders' }, blurb: { zh: '集齐四位创始人：称号「四巨头的继承人」', en: 'All four founders: the title "Heir of the Four Founders"' } },
  { id: 'marauders', zh: '掠夺者', en: 'The Marauders', title: { zh: '我庄严宣誓我不怀好意', en: 'Solemnly Up to No Good' }, blurb: { zh: '月亮脸、虫尾巴、大脚板、尖头叉子：称号「我庄严宣誓我不怀好意」', en: 'Moony, Wormtail, Padfoot and Prongs: the title "Solemnly Up to No Good"' } },
  { id: 'ghosts', zh: '学院幽灵', en: 'The House Ghosts', title: { zh: '差点没头的朋友', en: 'Friend of the Nearly Headless' }, blurb: { zh: '四位学院幽灵：称号「差点没头的朋友」', en: 'The four house ghosts: the title "Friend of the Nearly Headless"' } },
  { id: 'headmasters', zh: '校长室的肖像', en: "The Headmasters' Portraits", title: { zh: '校长室的常客', en: "Regular in the Head's Office" }, blurb: { zh: '五位校长：称号「校长室的常客」', en: 'Five heads of Hogwarts: the title "Regular in the Head\'s Office"' } },
  { id: 'memes', zh: '梗王特辑', en: 'Meme Specials', title: { zh: '梗王', en: 'Meme Lord' }, blurb: { zh: '八张梗卡：称号「梗王」', en: 'All eight meme cards: the title "Meme Lord"' } },
];

const c = (id: string, zh: string, en: string, rarity: CardRarity, fzh: string, fen: string, set?: CardSetId): Card => ({ id, zh, en, rarity, ...(set ? { set } : {}), flavour: { zh: fzh, en: fen } });

export const CARDS: Card[] = [
  // ---- legendary
  c('dumbledore', '阿不思·邓布利多', 'Albus Dumbledore', 'legendary', '现任霍格沃茨校长。被公认为当代最伟大的巫师。喜欢室内乐和十柱滚木球。（还有柠檬雪宝。）', 'Currently Headmaster of Hogwarts. Considered the greatest wizard of modern times. Enjoys chamber music and tenpin bowling. (And sherbet lemons.)', 'headmasters'),
  c('merlin', '梅林', 'Merlin', 'legendary', '中世纪最著名的巫师，斯莱特林出身。「梅林的胡子！」——每天被念叨一万遍。', 'The most famous wizard of the Middle Ages, a Slytherin. "Merlin\'s beard!" — invoked ten thousand times a day.'),
  c('morgana', '莫佳娜', 'Morgan le Fay', 'legendary', '黑女巫，梅林的宿敌，阿瓦隆的女王。会变形成鸟。卡片上的她永远在瞪梅林那张。', 'Dark sorceress, Merlin\'s great enemy, Queen of Avalon. An Animagus who became a bird. On the card she is always glaring at Merlin\'s.'),
  c('flamel', '尼可·勒梅', 'Nicolas Flamel', 'legendary', '魔法石唯一已知的制造者，665 岁。喜欢歌剧。晚年主动放弃了长生，这是最难的魔法。', 'The only known maker of the Philosopher\'s Stone, aged 665. Enjoys opera. He chose to stop living forever: the hardest magic of all.'),
  c('unnamed', '那个连名字都不能提的人', 'He-Who-Must-Not-Be-Named', 'legendary', '此卡没有画像：画师拒绝落笔。背面只有一行小字：「神秘人没有鼻子，所以卡片也省了。」', 'This card has no portrait: the artist refused. On the back, one small line: "He has no nose, so the card saved on ink."', 'memes'),
  // ---- the four founders
  c('gryffindor', '戈德里克·格兰芬多', 'Godric Gryffindor', 'epic', '霍格沃茨四位创始人之一，来自沼泽地的勇士。分院帽原来是他的帽子，宝剑只会出现在真正的格兰芬多面前。', 'One of the four founders, a warrior from the wild moor. The Sorting Hat was his hat; his sword appears only to a true Gryffindor.', 'founders'),
  c('hufflepuff', '赫尔加·赫奇帕奇', 'Helga Hufflepuff', 'epic', '来自山谷的创始人，「我会一视同仁地教他们」。厨房里的家养小精灵都是她请来的。', 'The founder from the valley: "I\'ll teach the lot and treat them just the same." She brought the house-elves to the kitchens.', 'founders'),
  c('ravenclaw', '罗伊纳·拉文克劳', 'Rowena Ravenclaw', 'epic', '来自峡谷的创始人。「过人的聪明才智是人类最大的财富。」冠冕后来被她女儿偷走了。', 'The founder from the glen. "Wit beyond measure is man\'s greatest treasure." Her daughter stole the diadem.', 'founders'),
  c('slytherin', '萨拉查·斯莱特林', 'Salazar Slytherin', 'epic', '来自沼泽的创始人，蛇佬腔。在城堡底下留了一间密室和一条蛇——典型的「祖传代码」。', 'The founder from the fen, a Parselmouth. Left a Chamber and a basilisk under the castle: legacy code at its finest.', 'founders'),
  // ---- the marauders
  c('moony', '月亮脸', 'Moony', 'epic', '莱姆斯·卢平。每个月有那么几天身体不舒服。巧克力永远在口袋里——「吃吧，会好一点的。」', 'Remus Lupin. A few days a month he is under the weather. Always has chocolate: "Eat. It\'ll help."', 'marauders'),
  c('wormtail', '虫尾巴', 'Wormtail', 'rare', '彼得·佩蒂鲁。在韦斯莱家当了十二年老鼠。卡片边缘被咬了一个小缺口。', 'Peter Pettigrew. Spent twelve years as the Weasleys\' rat. The card has a small nibble out of one corner.', 'marauders'),
  c('padfoot', '大脚板', 'Padfoot', 'epic', '小天狼星·布莱克。一条大黑狗，骑过飞天摩托，越过狱。「我庄严宣誓我不怀好意。」', 'Sirius Black. A great black dog; rode a flying motorbike; broke out of Azkaban. "I solemnly swear that I am up to no good."', 'marauders'),
  c('prongs', '尖头叉子', 'Prongs', 'epic', '詹姆·波特。一头牡鹿，找球手，眼镜。活点地图的共同作者——你现在读的每一行都是他写的代码。', 'James Potter. A stag, a Seeker, glasses. Co-author of the Map — every line you read on it is his code.', 'marauders'),
  // ---- the house ghosts
  c('nick', '差点没头的尼克', 'Nearly Headless Nick', 'common', '格兰芬多幽灵。脖子上还连着半英寸皮肤，所以进不了无头猎手俱乐部。忌日晚会欢迎你。', 'Gryffindor ghost. Half an inch of skin keeps his head on, and him out of the Headless Hunt. Come to his Deathday Party.', 'ghosts'),
  c('friar', '胖修士', 'The Fat Friar', 'common', '赫奇帕奇幽灵。总想原谅皮皮鬼，「给他一次机会吧」。已经给了几百年。', 'Hufflepuff ghost. Always wants to forgive Peeves: "give him another chance". For several centuries now.', 'ghosts'),
  c('greylady', '格雷女士', 'The Grey Lady', 'rare', '拉文克劳幽灵，海莲娜·拉文克劳。知道冠冕在哪儿，但你得先问对问题。', 'Ravenclaw ghost, Helena Ravenclaw. She knows where the diadem is, if you ask the right question.', 'ghosts'),
  c('baron', '血人巴罗', 'The Bloody Baron', 'rare', '斯莱特林幽灵。唯一能镇住皮皮鬼的人。为什么浑身是血？别问。', 'Slytherin ghost. The only one who can control Peeves. Why the blood? Do not ask.', 'ghosts'),
  // ---- the headmasters (Dumbledore above)
  c('dippet', '阿芒多·迪佩特', 'Armando Dippet', 'rare', '邓布利多的前任校长。当年把密室的事算在了海格头上——这个锅背了五十年。', 'Headmaster before Dumbledore. Pinned the Chamber on Hagrid — a blame that stuck for fifty years.', 'headmasters'),
  c('phineas', '菲尼亚斯·奈杰勒斯·布莱克', 'Phineas Nigellus Black', 'rare', '「霍格沃茨最不受欢迎的校长」，并以此为荣。肖像在两处墙上来回跑，专门传话。', '"The least popular Headmaster Hogwarts ever had", and proud of it. His portrait runs between two walls carrying messages.', 'headmasters'),
  c('dilys', '戴丽丝·德文特', 'Dilys Derwent', 'rare', '先当治疗师，后当校长。肖像挂在圣芒戈和校长室，两头都值班。', 'A Healer, then Headmistress. Her portraits hang at St Mungo\'s and in the Head\'s office: on call at both.', 'headmasters'),
  c('everard', '埃弗拉', 'Everard', 'common', '前任校长。肖像能去魔法部报信。卡片上的他永远在打瞌睡——装的。', 'A former Headmaster whose portrait can carry news to the Ministry. On the card he is always dozing. He is pretending.', 'headmasters'),
  // ---- meme specials (梗王特辑)
  c('leviosa', '是 Levi-O-sa！', "It's Levi-O-sa!", 'epic', '赫敏·格兰杰纠正罗恩的发音，四个字母的重音改变了一只巨怪的命运。「不是 Levi-o-SAR。」羽加迪姆勒维奥萨，yyds。', "Hermione corrects Ron's stress, and a troll's fate turns on one syllable. \"Not Levi-o-SAR.\"", 'memes'),
  c('bbq', '芭比Q了', 'Barbecued', 'rare', '西莫·斐尼甘又把羽毛点着了。卡片边缘有一圈焦痕，闻起来像烤棉花糖。', 'Seamus has set the feather on fire again. The card\'s edge is scorched and smells of toasted marshmallow.', 'memes'),
  c('pofang', '破防了', 'Shield Broken', 'rare', '铁甲咒碎的那一刻。画像里的巫师一直在说「我没事」，但他的盾已经没了。', 'The moment a Protego shatters. The wizard in the picture keeps saying "I\'m fine". His shield is not.', 'memes'),
  c('neijuan', '内卷之王', 'King of the Grind', 'epic', '一个学期修十二门课，一天 26 个小时——时间转换器用户的日常。看卡的时候她在复习。', 'Twelve subjects in one term, 26 hours a day — life with a Time-Turner. She is revising while you read this card.', 'memes'),
  c('tangping', '躺平之神', 'God of Lying Flat', 'rare', '海格的大狗牙牙。一只看起来很凶、实际上只想趴着的猎犬。「躺平中，勿扰。」', 'Fang, Hagrid\'s boarhound. Looks fierce, wants only to lie down. "Lying flat. Do not disturb."', 'memes'),
  c('myfather', '我爸爸会知道的！', 'My Father Will Hear About This!', 'rare', '德拉科·马尔福的招牌台词。卡片会在你拿到它时自动喊一遍。', "Draco Malfoy's signature line. The card shouts it once when you get it.", 'memes'),
  c('whyme', '为什么总是我？', 'Why Is It Always Me?', 'common', '西莫的日常。这张卡在每副卡组里都最先被弄丢。', "Seamus's daily life. In every collection, this is the card that goes missing first.", 'memes'),
  c('legacy', '祖传代码', 'Legacy Code', 'epic', '分院帽：一千年没改过一行代码，依然在线服务。「能跑就别动。」', 'The Sorting Hat: not one line changed in a thousand years, still in production. "If it runs, don\'t touch it."', 'memes'),
  // ---- famous witches and wizards (the rest of the deck)
  c('newt', '纽特·斯卡曼德', 'Newt Scamander', 'epic', '《神奇动物在哪里》的作者。皮箱里装着一整个动物园——还有一只爱偷东西的嗅嗅。', 'Author of Fantastic Beasts and Where to Find Them. His case holds a whole zoo, and a Niffler who steals.'),
  c('lockhart', '吉德罗·洛哈特', 'Gilderoy Lockhart', 'rare', '五次荣获《女巫周刊》最迷人微笑奖。卡片上的他在朝你眨眼，并且会自动签名。（一忘皆空后签名歪了。）', 'Five-time winner of Witch Weekly\'s Most-Charming-Smile Award. He winks at you and signs himself. (Crooked since the Obliviate.)'),
  c('bott', '伯蒂·博特', 'Bertie Bott', 'rare', '比比多味豆的发明者。「每一种口味」的意思是真的每一种：鼻屎味、耳屎味、呕吐味。', 'Inventor of Every-Flavour Beans. "Every flavour" means every flavour: bogey, earwax, vomit.'),
  c('agrippa', '科尼利厄斯·阿格里帕', 'Cornelius Agrippa', 'epic', '因为写魔法书被麻瓜关进监狱。罗恩一直没集到这张。', 'Imprisoned by Muggles for his books on magic. The card Ron never managed to get.'),
  c('ptolemy', '托勒密', 'Ptolemy', 'epic', '天文学家。罗恩也没有这张——「我还缺阿格里帕和托勒密」。', 'Astronomer. Ron is missing this one too: "I haven\'t got Agrippa or Ptolemy."'),
  c('paracelsus', '帕拉塞尔苏斯', 'Paracelsus', 'epic', '炼金术士。他的半身像立在城堡走廊里，皮皮鬼总想把它推下去。', 'Alchemist. His bust stands in a castle corridor; Peeves keeps trying to push it over.'),
  c('circe', '瑟茜', 'Circe', 'epic', '古希腊女巫，把水手变成猪。卡片翻过来，背面有一只小猪在跑。', 'Ancient Greek witch who turned sailors into pigs. Turn the card over: a small pig runs across the back.'),
  c('cliodna', '克丽奥娜', 'Cliodna', 'rare', '爱尔兰德鲁伊女祭司，阿尼马格斯（海鸟）。卡片上的她常常消失——她觉得无聊了。', 'Irish druidess and Animagus (a seabird). She often leaves her card — she gets bored.'),
  c('hengist', '伍德克罗夫特的亨吉斯', 'Hengist of Woodcroft', 'rare', '霍格莫德村的建立者。据说三把扫帚酒吧就是他的家。', 'Founder of Hogsmeade village. The Three Broomsticks is said to have been his house.'),
  c('uric', '怪人尤里克', 'Uric the Oddball', 'rare', '戴着水母当帽子的巫师。他证明了「鸟蛇唱歌会致死」是假的——听了三个月，没死，但疯了。', 'Wore a jellyfish for a hat. Proved the Augurey\'s cry is not fatal: listened for three months, lived, went mad.'),
  c('mungo', '芒戈·波纳姆', 'Mungo Bonham', 'rare', '圣芒戈魔法伤病医院的创建者。第五层的茶室欢迎你。', 'Founder of St Mungo\'s Hospital for Magical Maladies and Injuries. The fifth-floor tearoom welcomes you.'),
  c('bowman', '鲍曼·赖特', 'Bowman Wright', 'epic', '金色飞贼的发明者。从此找球手的命运被一颗核桃大的金球决定。', 'Inventor of the Golden Snitch. Ever since, a Seeker\'s fate rides on a golden ball the size of a walnut.'),
  c('wenlock', '布里奇特·温洛克', 'Bridget Wenlock', 'rare', '13 世纪算术占卜家，第一个发现数字 7 的魔力。', 'Thirteenth-century Arithmancer, first to establish the magical properties of the number seven.'),
  c('peakes', '格兰莫·皮克斯', 'Glanmore Peakes', 'common', '杀死了锡利群岛的海蛇。卡片上他一直在擦剑。', 'Slayer of the Sea Serpent of Cromer. On the card he never stops polishing his sword.'),
  c('ketteridge', '埃拉朵拉·凯特里奇', 'Elladora Ketteridge', 'common', '发现了鳃囊草的妙用——差点把自己淹死在陆地上。', 'Discovered the uses of gillyweed — and nearly drowned on dry land.'),
  c('andros', '无敌的安德鲁斯', 'Andros the Invincible', 'rare', '古希腊巫师，据说能召出巨人大小的守护神。', 'Greek wizard said to have cast a Patronus the size of a giant.'),
  c('muldoon', '伯多克·马尔登', 'Burdock Muldoon', 'common', '巫师议会主席，试图给「生物」下定义，结果开会开成了一场灾难。', 'Chief of the Wizards\' Council who tried to define "being". The meeting became a disaster.'),
  c('oldridge', '昌西·奥德里奇', 'Chauncey Oldridge', 'common', '已知第一位龙痘患者。卡片摸起来有点痒。', 'First known victim of dragon pox. The card feels a little itchy.'),
  c('shimpling', '德文特·辛普林', 'Derwent Shimpling', 'common', '为了打赌吃下一整棵毒触手，从此浑身发紫。', 'Ate an entire Venomous Tentacula for a bet. Has been purple ever since.'),
  c('pokeby', '格列佛·波克比', 'Gulliver Pokeby', 'common', '巫师鸟类学权威。鸟蛇的叫声会不会死人？他说不会，然后换了研究方向。', 'Authority on magical birds. Is the Augurey\'s cry deadly? He said no, then changed his field.'),
  c('herpo', '卑鄙的海尔波', 'Herpo the Foul', 'epic', '古希腊黑巫师，第一个孵出蛇怪的人。也发明了魂器——最烂的一项发明。', 'Greek Dark wizard, first to hatch a basilisk. He also invented the Horcrux, the worst invention ever.'),
  c('plunkett', '米拉贝拉·普伦基特', 'Mirabella Plunkett', 'common', '爱上了湖里的人鱼，于是把自己变成了一条黑线鳕。', 'Fell in love with a merman in Loch Lomond and turned herself into a haddock.'),
  c('wendelin', '古怪的温德林', 'Wendelin the Weird', 'rare', '中世纪女巫，被抓去火刑柱四十七次——她喜欢火焰冻结咒挠痒痒的感觉。', 'Medieval witch who got herself burnt at the stake forty-seven times: she liked the tickle of the Flame-Freezing Charm.'),
  c('starkey', '赫斯珀·斯塔基', 'Hesper Starkey', 'common', '研究月相对魔药的影响。卡片在月圆夜会微微发亮。', 'Studied the phases of the moon in potion-making. The card glows faintly at full moon.'),
  c('marjoribanks', '博蒙特·马卓班克斯', 'Beaumont Marjoribanks', 'common', '草药学先驱，第一个记录下鳃囊草。', 'Pioneer of Herbology, the first to record gillyweed.'),
  c('barkwith', '穆西多拉·巴克沃斯', 'Musidora Barkwith', 'common', '作曲家，《未完成的大号曲》演奏时把镇政府的屋顶吹飞了。', 'Composer whose Unfinished Tuba Suite blew the roof off a town hall.'),
  c('knightley', '蒙塔古·奈特利', 'Montague Knightley', 'common', '巫师棋冠军。卡片上的棋子会自己走，还会骂你。', 'Wizard chess champion. The pieces on his card move by themselves, and heckle you.'),
  c('gunhilda', '戈斯莫的冈希尔达', 'Gunhilda of Gorsemoor', 'rare', '独眼驼背的女巫，发明了龙痘的解药。独眼女巫雕像后面有条密道通往蜂蜜公爵。', 'One-eyed, hump-backed witch who found the cure for dragon pox. Behind her statue, a passage to Honeydukes.'),
  c('stump', '格罗根·斯顿普', 'Grogan Stump', 'common', '最受欢迎的魔法部长之一。他设立了神奇动物管理控制司。', 'One of the most popular Ministers for Magic. He founded the Department for the Regulation and Control of Magical Creatures.'),
  c('bagshot', '巴希达·巴沙特', 'Bathilda Bagshot', 'rare', '《魔法史》的作者。宾斯教授照着她的书念，念了几百年。', 'Author of A History of Magic. Professor Binns has read it aloud, word for word, for centuries.'),
  c('clagg', '埃尔弗里达·克拉格', 'Elfrida Clagg', 'common', '巫师议会首位女主席，把金色飞鸟列为保护动物——所以才有了金色飞贼。', 'First witch to chair the Wizards\' Council; made the Golden Snidget a protected species.'),
  c('dagworth', '赫克托·达格沃斯-格兰杰', 'Hector Dagworth-Granger', 'common', '非凡魔药制造者协会的创始人。赫敏说他是她的远房亲戚，但没有证据。', 'Founder of the Most Extraordinary Society of Potioneers. Hermione suspects a family link; there is no proof.'),
  c('slughorn', '霍拉斯·斯拉格霍恩', 'Horace Slughorn', 'rare', '鼻涕虫俱乐部的主人，收藏学生就像收藏菠萝蜜饯。', 'Host of the Slug Club; collects students like crystallised pineapple.'),
  c('mcgonagall', '米勒娃·麦格', 'Minerva McGonagall', 'epic', '变形术教授，阿尼马格斯（虎斑猫）。「给格兰芬多扣五十分！」', 'Transfiguration professor, Animagus (a tabby). "Fifty points from Gryffindor!"'),
  c('snape', '西弗勒斯·斯内普', 'Severus Snape', 'epic', '魔药课教授，混血王子。卡片背面只有两个字：「一直。」', 'Potions master, the Half-Blood Prince. On the back of the card, one word: "Always."'),
  c('hagrid', '鲁伯·海格', 'Rubeus Hagrid', 'rare', '钥匙保管员，猎场看守。「我不该说这个的。」卡片上的他正在孵一颗龙蛋。', 'Keeper of Keys and Grounds. "I shouldn\'t have said that." On the card he is hatching a dragon egg.'),
  c('sprout', '波莫娜·斯普劳特', 'Pomona Sprout', 'common', '草药学教授，赫奇帕奇院长。耳罩请戴好，曼德拉草要叫了。', 'Herbology professor, Head of Hufflepuff. Earmuffs on: the Mandrakes are about to scream.'),
  c('flitwick', '菲利乌斯·弗立维', 'Filius Flitwick', 'common', '魔咒课教授，前决斗冠军。「一挥，一抖！」', 'Charms professor, a former duelling champion. "Swish and flick!"'),
  c('trelawney', '西比尔·特里劳尼', 'Sybill Trelawney', 'common', '占卜课教授。她在卡片上预言：你下一张抽到的还是她。', 'Divination professor. From her card she predicts your next card will be her again.'),
  c('binns', '宾斯教授', 'Professor Binns', 'common', '唯一由幽灵任教的课。某天他在教工休息室睡着了，第二天起来就把身体忘在了椅子上。', 'The only class taught by a ghost. He fell asleep in the staff room and got up next morning without his body.'),
  c('hooch', '霍琦夫人', 'Madam Hooch', 'common', '飞行课老师，魁地奇裁判。黄色的鹰眼，从不漏看犯规。', 'Flying instructor and Quidditch referee. Yellow hawk eyes; never misses a foul.'),
  c('pomfrey', '庞弗雷夫人', 'Madam Pomfrey', 'common', '校医。长骨头的药水难喝得要命——「你得在这儿躺一晚上。」', 'The school nurse. Skele-Gro tastes foul. "You\'ll be staying the night."'),
  c('filch', '阿格斯·费尔奇', 'Argus Filch', 'common', '管理员，哑炮。办公室里挂着链子，梦想恢复吊刑。宵禁时他就在你身后。', 'Caretaker, a Squib. Chains on his office wall, dreams of bringing back hanging by the ankles. At curfew, he is behind you.'),
  c('norris', '洛丽丝夫人', 'Mrs Norris', 'common', '费尔奇的猫。灯一样的眼睛，看见你就去叫费尔奇。', 'Filch\'s cat. Lamp-like eyes; one look at you and she fetches Filch.'),
  c('fawkes', '福克斯', 'Fawkes', 'epic', '邓布利多的凤凰。眼泪能治伤，歌声能给人勇气。每隔一阵子就在火里重生一次。', 'Dumbledore\'s phoenix. Its tears heal, its song gives courage; now and then it bursts into flame and is reborn.'),
  c('buckbeak', '巴克比克', 'Buckbeak', 'rare', '鹰头马身有翼兽。先鞠躬，等它回礼。马尔福没有等。', 'A hippogriff. Bow first and wait for the bow back. Malfoy did not wait.'),
  c('dobby', '多比', 'Dobby', 'rare', '「多比是个自由的小精灵！」一只袜子改变了他的一生。', '"Dobby is a free elf!" One sock changed his life.'),
  c('peeves', '皮皮鬼', 'Peeves', 'common', '恶作剧精灵。卡片会趁你不注意把墨水泼到隔壁那张上。', 'The poltergeist. When you are not looking, the card splashes ink on its neighbour.'),
  c('fatlady', '胖夫人', 'The Fat Lady', 'common', '格兰芬多塔楼的看门画像。口令错了？她会唱歌给你听，直到玻璃碎掉。', 'The portrait guarding Gryffindor Tower. Wrong password? She will sing until the glass breaks.'),
  c('cadogan', '卡多根爵士', 'Sir Cadogan', 'common', '最勇敢也最不靠谱的骑士画像，口令每天换十次。', 'The bravest and least reliable knight in any portrait. Changes the password ten times a day.'),
  c('myrtle', '哭泣的桃金娘', 'Moaning Myrtle', 'common', '住在二楼女生盥洗室的幽灵。她不是在哭，就是在去哭的路上。', 'Ghost of the second-floor girls\' bathroom. If she is not crying, she is on her way to.'),
  c('sortinghat', '分院帽', 'The Sorting Hat', 'rare', '每年唱一首新歌。它看过你脑子里的每一个念头——包括你想去哪个学院。', 'Sings a new song every year. It has seen every thought in your head, including which house you wanted.'),
  c('grindelwald', '盖勒特·格林德沃', 'Gellert Grindelwald', 'epic', '「为了更伟大的利益。」卡片背面刻着死亡圣器的符号，谁也擦不掉。', '"For the greater good." The sign of the Deathly Hallows is scratched on the back; nobody can rub it off.'),
];

export const CARD_BY_ID: Record<string, Card> = Object.fromEntries(CARDS.map((x) => [x.id, x]));
export const cardsOfSet = (s: CardSetId) => CARDS.filter((x) => x.set === s);
