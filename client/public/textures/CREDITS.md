# Texture & HDRI credits

The default **storybook** look paints every surface, the sky, the clouds and the moon procedurally
at startup (`client/textures.ts`, `client/render.ts`) and loads **none** of the files below. They are
used only by the photographic look, `?style=real` (plus the lens-flare sprites, also `?style=real`
only). `moss_color.webp` (Poly Haven coast_sand_rocks_02) was loaded but never applied to anything
and has been removed.

All files here were resized/re-encoded to WebP; no other changes.

| File | Source | Original | License |
|---|---|---|---|
| stone_color / stone_normal / stone_rough / stone_ao | ambientCG, via the PlayCanvas engine examples (`examples/assets/textures/bricks076a`) | Bricks076A | CC0 1.0 |
| sand_color | ambientCG, via PlayCanvas engine examples (`ground092c`) | Ground092C | CC0 1.0 |
| gravel_color | Poly Haven, via PlayCanvas engine examples | rocky_trail | CC0 1.0 |
| rock_color | Poly Haven, via PlayCanvas engine examples | aerial_rocks_02 | CC0 1.0 |
| grass_color | three.js examples (`examples/textures/terrain/grasslight-big.jpg`) | grasslight-big | MIT (three.js authors) |
| wood_color / wood_bump / wood_rough | three.js examples (`hardwood2_*`) | hardwood2 | MIT (three.js authors) |
| water_normal | three.js examples (`waternormals.jpg`) | waternormals | MIT (three.js authors) |
| cloud | pmndrs/assets (drei cloud texture) | cloud | CC0 1.0 |
| lensflare0 / lensflare3 | three.js examples (`examples/textures/lensflare`) | lensflare | MIT (three.js authors) |
| ../hdri/quarry_01_1k.hdr | Poly Haven, via three.js examples | quarry_01 | CC0 1.0 |
| ../hdri/moonless_golf_1k.hdr | Poly Haven, via three.js examples | moonless_golf | CC0 1.0 |

three.js is Copyright © 2010–2026 three.js authors, MIT License (https://github.com/mrdoob/three.js/blob/dev/LICENSE).
Poly Haven assets: https://polyhaven.com/license · ambientCG assets: https://docs.ambientcg.com/license/
