import { afterEach, beforeEach, describe, expect, it } from '/workspace/Hogwarts/node_modules/vitest/dist/index.js';
import { World, DODGE_DIST } from '/workspace/Hogwarts/src/kernel/world.ts';
import { DUEL_FEATURE, duelJoin, DUEL_LEASH, DUEL_STAGE } from '/workspace/Hogwarts/src/kernel/duelclub.ts';
import { setReflexes } from '/workspace/Hogwarts/src/kernel/reflexes.ts';
import { candidateStageRoll } from './stage-roll-candidate.ts';
const original=DUEL_FEATURE.dodgeDir;
beforeEach(()=>{if(process.env.CANDIDATE==='1')DUEL_FEATURE.dodgeDir=candidateStageRoll;});
afterEach(()=>{DUEL_FEATURE.dodgeDir=original;});
function fixture(duel=true){const w=new World({seed:10,secret:'offline-regression'});w.rules.creatures.spawnMultiplier=0;w.rules.events.pool=[];w.term.endsAt=1e12;const a=w.enroll('Defender','Ravenclaw').wizard,b=w.enroll('Opponent','Slytherin').wizard;for(const x of[a,b]){x.connections=1;x.createdAt=-1e6;}if(duel){duelJoin(w,a.id);duelJoin(w,b.id);for(let i=0;i<105;i++)w.tick();}return{w,a,b};}
function remain(w:World,a:any,n=15){for(let i=0;i<n;i++){w.tick();expect(w.inSafe(a.pos)).toBe(false);expect(w.duel.match).not.toBeNull();}}
describe('existing duel roll invariant: collision-resolved paths',()=>{
 it('manual diagonal roll near east jamb stays outside the Great Hall',()=>{const{w,a}=fixture();a.pos={x:.7,z:-40.2};w.moved(a);expect(w.dodge(a.id,1,-.17,'agent').ok).toBe(true);remain(w,a);});
 it('incoming reflex automatically chooses a safe direction near the same jamb',()=>{const{w,a,b}=fixture();a.pos={x:.7,z:-40.2};b.pos={x:1.72,z:-34.2};w.moved(a);w.moved(b);setReflexes(w,a.id,[{when:'incoming',do:'dodge'}]);expect(w.cast(b.id,'Stupefy',{target:a.handle}).ok).toBe(true);remain(w,a);expect(w.reflexes.stat.get(a.id)?.[0].n).toBe(1);});
 it('rejects a segment crossing the Hall corner even if its ideal endpoint is outside',()=>{const{w,a}=fixture();a.pos={x:11.7,z:-39.5};w.moved(a);const l=Math.hypot(.1,-1),dx=.1/l,dz=-1/l;expect(w.inSafe(a.pos)).toBe(false);expect(w.inSafe({x:a.pos.x+dx*DODGE_DIST,z:a.pos.z+dz*DODGE_DIST})).toBe(false);expect(w.inSafe({x:11.9,z:-41.5})).toBe(true);w.dodge(a.id,dx,dz,'agent');expect([a.st.dashDx,a.st.dashDz]).not.toEqual([dx,dz]);remain(w,a);});
 it('keeps the existing stage edge redirect',()=>{const{w,a}=fixture();a.pos={x:DUEL_STAGE.x+DUEL_LEASH-2,z:DUEL_STAGE.z};w.moved(a);w.dodge(a.id,1,0,'agent');remain(w,a);expect(a.pos.x).toBeLessThan(DUEL_STAGE.x+DUEL_LEASH-2);});
 it('leaves ordinary rolls outside a duel unchanged',()=>{const{w,a}=fixture(false);a.pos={x:0,z:0};w.moved(a);w.dodge(a.id,0,1);for(let i=0;i<20;i++)w.tick();expect(a.pos.z).toBeGreaterThan(DODGE_DIST*.75);expect(a.st.dashDx).toBe(0);expect(a.st.dashDz).toBe(1);});
});
