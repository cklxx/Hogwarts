// ------------------------------------------------------------------
// asset-data.ts — 2D 素材派生数据的唯一运行时入口。
//
// 数据源：client/assets2d/prerendered/derived.json，由
// tools/sprite-factory/derive.py 从 manifest.json（唯一手写源）+ 工厂
// 3D 几何派生生成，提交在 repo 内。运行时（服务器/客户端/测试）只读
// 本文件，禁止在任何消费方再手抄尺寸/占地/脚偏移数值。
// 改素材参数：改 manifest.json → 重跑 derive.py → 本文件自动更新。
// ------------------------------------------------------------------
import derivedJson from '../../client/assets2d/prerendered/derived.json' with { type: 'json' };

export interface SpriteDerived {
  cat: string | null;
  model: { w: number; d: number; h: number };
  stance: { w: number | null; d: number | null; s: number | null; n: number | null; contactS: number | null };
  footOffsetPx: number | null;
  drawW: number | null;
  flag: string | null;
}

export interface AssetDerived {
  version: number;
  constants: { G: number; V: number; D: number; cos40: number; sin40: number; U_LIVE: number; U_STRUCT: number };
  sprites: Record<string, SpriteDerived>;
  creatures: Record<string, { sprite: string; wM: number }>;
  figures: Record<string, { w: number; dh: number; variant: string | null }>;
  layoutKinds: Record<string, {
    sprite: string; drawW: number; foot: [number, number]; footMode: string;
    variants?: Record<string, string>;
  }>;
}

export const ASSET = derivedJson as unknown as AssetDerived;

export const spriteDerived = (name: string): SpriteDerived | undefined => ASSET.sprites[name];
