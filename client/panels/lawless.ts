/**
 * 无规则区 in the browser (me.lawless; src/kernel/unfair.ts LAWLESS_FEATURE says so in the feed): while you stand in
 * the deep forest, a label in the top stack, a red vignette at the screen's edge, and body.lawless for the HUD.
 */
import type { ClientFeatureFactory } from '../feature';
import { ic } from '../ink';
import { LAWLESS_LABEL, esc } from './logic';

export const lawlessFeature: ClientFeatureFactory = (d) => {
  const inside = () => !!d.me()?.lawless;
  let vignette: HTMLElement | null = null;
  return {
    id: 'lawless',
    top: () => (inside() ? `<div class="lawless-label">${ic('arcane')}<span>${esc(LAWLESS_LABEL())}</span></div>` : ''),
    hud() {
      if (!vignette) {
        vignette = document.getElementById('lawless');
        if (!vignette) { vignette = document.createElement('div'); vignette.id = 'lawless'; vignette.setAttribute('aria-hidden', 'true'); document.getElementById('hud')!.prepend(vignette); }
      }
      const on = inside();
      vignette.hidden = !on;
      document.body.classList.toggle('lawless', on);
    },
  };
};
