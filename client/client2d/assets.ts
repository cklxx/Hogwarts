/**
 * 素材加载层：唯一素材来源 = 精灵工厂预渲染产出（client/assets2d/prerendered/，
 * 见 client/assets2d/ASSETS.md 与 client/client2d/size-design.md）。
 *
 * 启动时加载 sprites.json + 全部 PNG + palette.json。世界纹理只烘焙一次，
 * 工厂精灵必须在烘焙前就绪或明确失败，故 assetsSettled() 等预渲染加载线
 * 落定（成功或失败）。精灵缺失时 preSprite() 返回 null，渲染器按统一口径
 * 不绘制该实体并打 console 警告——素材缺失要暴露，不再有手绘回退。
 * Kenney 2D 像素包（Tiny Town / Roguelike RPG）已于 2026-10-21 退役下线；
 * Kenney 3D 模型源保留在 models3d/ 供工厂使用。
 */
let preSettled = false;
export const assetsSettled = (): boolean => preSettled;

function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('asset load failed: ' + url));
    img.src = url;
  });
}

// ------------------------------------------------------------------ 3转2 预渲染精灵
// tools/sprite-factory 产出：3D 模型在固定相机+灯光下渲染的透明底 PNG +
// sprites.json（锚点/占地），全部过像素化管线（14 px/米 + 主调色板 + 描边）。
export interface PreSprite {
  img: HTMLImageElement;
  w: number; h: number;           // PNG 像素尺寸
  anchorX: number; anchorY: number; // 地面原点（占地中心、y=0）在图内的像素位置
  footW: number; footD: number;     // 3D 占地（米）
  ppm: number;                      // 渲染密度（px/米）
  /** 脚底（alpha 包围盒底行）与占地南缘中心行的偏差（精灵 px，负 = 脚在
   *  南缘以北）。仅 |偏差| > 2 的地面生物在 sprites.json 里登记，绘制时
   *  按 -footOffset × k 纵向补偿，使脚底落回占地南缘。审计见
   *  size-design.md「脚锚点审计」。飞行/漂浮生物悬空是设定，不登记。 */
  footOffset?: number;
}
const preMap = new Map<string, PreSprite>();
let preReady = false;
export const preSprite = (name: string): PreSprite | null =>
  preReady ? (preMap.get(name) ?? null) : null;
/** 精灵表是否已加载完成：未就绪时 preSprite 的 null 只表示「还在加载」，
 *  不构成素材缺失，渲染器据此抑制加载窗口的假警报。 */
export const preSpritesReady = (): boolean => preReady;

// 工厂主调色板（palette.json 与 sprites.json 同批产出）：地面贴图生成与
// 地面量化共用这一块板，保证精灵与地面同一色系。缺失时渲染器用内置回退板。
let paletteHex: string[] | null = null;
export const masterPalette = (): string[] | null => paletteHex;

fetch('/assets2d/prerendered/sprites.json')
  .then((r) => { if (!r.ok) throw new Error('sprites.json ' + r.status); return r.json(); })
  .then(async (meta: Record<string, Omit<PreSprite, 'img'>>) => {
    await Promise.all(Object.entries(meta).map(async ([name, m]) => {
      const img = await loadImg('/assets2d/prerendered/' + name + '.png');
      preMap.set(name, { img, ...m });
    }));
    preReady = true;
  })
  .catch((e) => console.warn('[2d] prerendered sprites unavailable:', e))
  .finally(() => {
    fetch('/assets2d/prerendered/palette.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((info: { palette?: string[] } | null) => {
        if (info?.palette?.length) paletteHex = info.palette;
      })
      .catch(() => { /* 调色板缺失：渲染器用内置回退板 */ })
      .finally(() => { preSettled = true; });
  });
