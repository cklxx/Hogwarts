/**
 * 触发式铁甲咒 in the browser (src/kernel/ward.ts): X arms the ward for its full WARD_MAX_S; the reply is a toast.
 * The same kernel mechanic an agent reaches through the MCP `ward` tool — a human can also just time Protego.
 */
import type { ClientFeatureFactory } from '../feature';
import { L } from '../i18n';
import { WARD_MAX_S } from '../../src/shared/constants';

export const wardFeature: ClientFeatureFactory = (d) => ({
  id: 'ward',
  keydown(e: KeyboardEvent): boolean {
    if (e.ctrlKey || e.metaKey || e.altKey || (e.key !== 'x' && e.key !== 'X')) return false;
    if (!e.repeat) d.send({ t: 'ward' });
    return true;
  },
  onMessage(msg: { t: string; r?: { armed?: number; error?: string } }): boolean {
    if (msg.t !== 'ward' || !msg.r) return false;
    d.toast(msg.r.error ?? L(`🛡 铁甲咒待发 ${msg.r.armed ?? WARD_MAX_S} 秒：第一道打来的咒语会被弹回去。`, `🛡 Ward up for ${msg.r.armed ?? WARD_MAX_S}s: the first spell at you goes straight back.`));
    return true;
  },
});
