/**
 * 简体中文名 — shared by the server (bilingual events) and the client (UI).
 * Spell and creature names follow the 人民文学出版社 translations of the Harry Potter books.
 */
export const ZH_HOUSE: Record<string, string> = { Gryffindor: '格兰芬多', Hufflepuff: '赫奇帕奇', Ravenclaw: '拉文克劳', Slytherin: '斯莱特林' };

export const ZH_CREATURE: Record<string, string> = {
  pixie: '康沃尔郡小精灵', snare: '魔鬼网', spider: '八眼巨蛛', troll: '巨怪', dementor: '摄魂怪', inferius: '阴尸',
  unicorn: '独角兽', phoenix: '福克斯', serpent: '召唤出的蛇', birds: '召唤出的鸟群',
};

export const ZH_SPELL: Record<string, string> = {
  Stupefy: '昏昏倒地', Incendio: '火焰熊熊', Aguamenti: '清水如泉', Protego: '盔甲护身', Episkey: '愈合如初', Lumos: '荧光闪烁',
  Tempus: '时间显现', Revelio: '原形立现', Expelliarmus: '除你武器', Glacius: '冰冻三尺', Depulso: '退散消失',
  Ferula: '绷带缠绕', 'Finite Incantatem': '咒立停', Serpensortia: '乌龙出洞', 'Point Me': '给我指路',
  'Expecto Patronum': '呼神护卫', 'Petrificus Totalus': '统统石化', Bombarda: '霹雳爆炸', Rennervate: '快快复苏',
  Avis: '飞鸟群群', 'Homenum Revelio': '人形显身', 'Lumos Solem': '日光闪耀', Reducto: '粉身碎骨',
  'Vulnera Sanentur': '伤口愈合', Apparition: '幻影显形', Confringo: '烈火爆裂', 'Wingardium Leviosa': '羽加迪姆勒维奥萨',
  Vestimentum: '衣装变幻', Reparifarge: '恢复原形',
};

export const ZH_PLACE: Record<string, string> = {
  'The Courtyard': '庭院', 'The Great Hall': '礼堂', 'Seventh-Floor Corridor': '八楼走廊', 'The Mirror of Erised': '厄里斯魔镜',
  'A disused classroom': '一间废弃的教室', Greenhouses: '温室', 'Greenhouse Three': '三号温室', 'Dungeon Stair': '地下教室楼梯',
  "Dumbledore's Tomb": '邓布利多之墓', 'Whomping Willow': '打人柳', "Hagrid's Hut": '海格小屋', 'The Forbidden Forest': '禁林', 'The Deep Forest': '禁林深处',
  'The Black Lake': '黑湖', 'Black Lake Shore': '黑湖岸边', 'Quidditch Pitch': '魁地奇球场', Hogsmeade: '霍格莫德',
  'Shrieking Shack': '尖叫棚屋', 'Hogwarts Grounds': '霍格沃茨场地', Azkaban: '阿兹卡班', 'The Highlands': '苏格兰高地',
};

export const ZH_ELEMENT: Record<string, string> = { arcane: '奥术', fire: '火', ice: '冰', lightning: '雷', light: '光' };

export const zhSpell = (name: string) => ZH_SPELL[name] ?? name;
export const zhPlace = (name: string) => ZH_PLACE[name] ?? name;
export const zhHouse = (h: string) => ZH_HOUSE[h] ?? h;
export const zhCreature = (k: string) => ZH_CREATURE[k] ?? k;
