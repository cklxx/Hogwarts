/**
 * 隐藏宝箱: where the hidden chests stand (the kernel opens them, the client draws them). Nooks beside the drawn
 * layout (src/shared/layout.ts): behind a courtyard pillar, in a corner of the Great Hall, behind the greenhouse,
 * Hagrid's back garden, the stands, Hogsmeade's back alleys, the Shrieking Shack... test/fun.test.ts checks that
 * each one stands clear of every collider, on dry land, inside the walkable world. They refill every term.
 */
export interface ChestSpot { id: string; x: number; z: number; zh: string; en: string }

export const CHESTS: ChestSpot[] = [
  { id: 'pillar', x: -21, z: -33, zh: '庭院石柱后面', en: 'Behind a courtyard pillar' },
  { id: 'hall', x: -10.4, z: -70.2, zh: '礼堂的角落', en: 'A corner of the Great Hall' },
  { id: 'greenhouse', x: 41, z: -47, zh: '温室背后', en: 'Behind Greenhouse Three' },
  { id: 'tomb', x: -49.5, z: 32.5, zh: '白色大理石墓旁', en: 'Beside the white tomb' },
  { id: 'hagrid', x: 101, z: 37, zh: '海格的菜园', en: "Hagrid's pumpkin patch" },
  { id: 'stands', x: 72, z: -150, zh: '魁地奇看台下', en: 'Under the Quidditch stands' },
  { id: 'honeydukes', x: 21, z: 146, zh: '蜂蜜公爵后巷', en: 'The alley behind Honeydukes' },
  { id: 'shack', x: 64, z: 211, zh: '尖叫棚屋门口', en: 'The Shrieking Shack\'s porch' },
  { id: 'lakeshore', x: -58, z: 4, zh: '黑湖岸边的芦苇丛', en: 'Reeds on the Black Lake shore' },
  { id: 'willow', x: 54, z: 7, zh: '打人柳够不着的地方', en: 'Just out of the Willow\'s reach' },
  { id: 'trail', x: 130, z: 17, zh: '禁林小径', en: 'The Forbidden Forest trail' },
  { id: 'seventh', x: -42, z: -54, zh: '八楼走廊尽头', en: 'The end of the seventh-floor corridor' },
  { id: 'broomsticks', x: -23, z: 165, zh: '三把扫帚酒吧后院', en: 'Behind the Three Broomsticks' },
  { id: 'clock', x: 71, z: -60, zh: '钟楼脚下', en: 'At the foot of the Clock Tower' },
];

export const chestById = (id: string) => CHESTS.find((c) => c.id === id);
