import { World } from '/workspace/Hogwarts/src/kernel/world.ts';
import { broom } from '/workspace/Hogwarts/src/kernel/travel.ts';
import { findPath, walkableAt, clearLine } from '/workspace/Hogwarts/src/kernel/pathfind.ts';
import { sceneAt } from '/workspace/Hogwarts/src/shared/scenes.ts';
import { writeFileSync } from 'node:fs';
function trial(riding:boolean){const w=new World({seed:41,secret:'pitch-hall-offline'});w.rules.creatures.spawnMultiplier=0;w.rules.events.pool=[];w.term.endsAt=1e12;const a=w.enroll('Offline Navigator','Hufflepuff').wizard;a.connections=1;a.createdAt=-1e6;a.year=4;a.hp=w.derivedOf(a).maxHp;a.pos={x:38.6,z:-134.3};w.moved(a);if(riding)broom(w,a.id,true);w.setGoal(a.id,{x:0,z:-52},'agent');const snapshots:any[]=[];let lastScene=sceneAt(a.pos.x,a.pos.z)?.id;const rows:any[]=[];
 const state=(tag:string)=>({tag,t:w.now,pos:{...a.pos},scene:sceneAt(a.pos.x,a.pos.z)?.id,goal:a.goal,route:a.route.map(p=>({...p})),via:!!w.via.get(a.id),walkableCell:walkableAt(a.pos,w.solids),clearFirst:!!a.route[0]&&clearLine(a.pos,a.route[0],w.solids),stuck:(w as any).stuck.get(a.id),riding:w.travel.riding.has(a.id)});
 snapshots.push(state('issued'));
 for(let i=0;i<30*20;i++){const old={...a.pos};w.tick();const sid=sceneAt(a.pos.x,a.pos.z)?.id;if(sid!==lastScene){snapshots.push(state('crossed'));lastScene=sid;}if(i%60===59)snapshots.push(state('3s interval'));if(i>100&&i<130)rows.push({t:w.now,x:a.pos.x,z:a.pos.z,step:Math.hypot(a.pos.x-old.x,a.pos.z-old.z),stuck:(w as any).stuck.get(a.id)?.t??0});}
 const stoppedPos={...a.pos};w.setGoal(a.id,null,'agent');w.setGoal(a.id,{x:0,z:-52},'agent');snapshots.push(state('reissued'));for(let i=0;i<15*20;i++)w.tick();snapshots.push(state('after reissue 15s'));
 return{riding,snapshots,rows,stoppedPos};}
const result=[trial(true),trial(false)];writeFileSync('/workspace/scratch/playtest-hour-2026-10-04/repro/pitch-hall-nav-repro.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result.map(x=>({riding:x.riding,snapshots:x.snapshots})),null,2));
