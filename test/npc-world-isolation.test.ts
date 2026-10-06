import { test } from 'vitest';
import assert from 'node:assert/strict';
import { World } from '../src/kernel/world.js';
import { ensureNpcs } from '../src/kernel/npc.js';
import { duelJoin } from '../src/kernel/duelclub.js';
import { gradeExam, EXAM_BY_ID } from '../src/kernel/exams.js';
function fixture(){const w=new World({seed:21,secret:'npc-world-test'});w.rules.creatures.spawnMultiplier=0;w.rules.events.pool=[];w.term.endsAt=1e12;ensureNpcs(w,1);const npc=[...w.wizards.values()].find(x=>x.npc)!;const a=w.enroll('Sparring Player','Ravenclaw').wizard;a.connections=1;a.createdAt=-1e6;const trace:any[]=[];const cast=w.cast.bind(w);w.cast=(wid,k,o)=>{const r=cast(wid,k,o);if(wid===npc.id)trace.push({at:w.now,spell:k,ok:r.ok,mana:r.mana});return r;};return{w,a,npc,trace};}
const run=(w:World,s:number)=>{for(let i=0;i<s*20;i++)w.tick();};
const exam=()=>gradeExam(EXAM_BY_ID.get('counting-door')!,'(say 3)');
test('an empty second World tick cannot erase the live world sparring brain',()=>{const{w,a,npc}=fixture();const other=new World({seed:7,secret:'empty-other'});other.tick();duelJoin(w,a.id);run(w,37);assert.ok((w.duel.match?.stats[npc.id].dealt??0)>0,'NPC must still cast and hurt its opponent');});
test('real gradeExam sandboxes cannot stop live NPC sparring',()=>{const{w,a,npc,trace}=fixture();exam();duelJoin(w,a.id);run(w,37);assert.ok(trace.length>0,'the live NPC must retain its brain after grading');assert.ok((w.duel.match?.stats[npc.id].dealt??0)>0);});
test('two worlds can alternate ticks while both retain their own NPC brains',()=>{const one=fixture(),two=fixture();duelJoin(one.w,one.a.id);duelJoin(two.w,two.a.id);for(let i=0;i<37*20;i++){one.w.tick();two.w.tick();}assert.ok((one.w.duel.match?.stats[one.npc.id].dealt??0)>0,'first world NPC still fights');assert.ok((two.w.duel.match?.stats[two.npc.id].dealt??0)>0,'second world NPC still fights');});
test('grading mid-match preserves spellbook and the existing AI action schedule',()=>{
 function trial(grade:boolean){const{w,a,npc,trace}=fixture();duelJoin(w,a.id);run(w,35.4);const before=npc.spells.map(({name,source,minYear,builtin})=>({name,source,minYear,builtin}));const count=trace.length;if(grade)exam();assert.deepEqual(npc.spells.map(({name,source,minYear,builtin})=>({name,source,minYear,builtin})),before);assert.equal(trace.length,count,'grading must not advance live NPC actions');run(w,1.6);return trace;}
 const expected=trial(false),actual=trial(true);assert.ok(expected.length>2);assert.deepEqual(actual,expected,'retained brain preserves prior next-think time and action progress');
});
