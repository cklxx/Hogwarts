import { World } from '/workspace/Hogwarts/src/kernel/world.ts';
import { sceneAt } from '/workspace/Hogwarts/src/shared/scenes.ts';
// Isolated deterministic reproduction, not part of the hour's real-time world.
const w=new World({seed:41,secret:'isolated-nav-reproduction'});
w.rules.creatures.spawnMultiplier=0;w.rules.events.pool=[];w.term.endsAt=1e12;
const a=w.enroll('Navigation Fixture').wizard;a.connections=1;
a.pos={x:130,z:38};a.hp=0;a.st.stunnedUntil=w.now+2;
const goal={x:95,z:34};
const route=w.setGoal(a.id,goal,'agent');
const observations:any[]=[{phase:'queued-while-down',pos:{...a.pos},goal:route,scene:sceneAt(a.pos.x,a.pos.z)?.id,via:!!w.via.get(a.id)}];
for(let i=0;i<45*20;i++)w.tick();
observations.push({phase:'after-respawn-and-walk',pos:{...a.pos},goal:a.goal,scene:sceneAt(a.pos.x,a.pos.z)?.id,via:!!w.via.get(a.id)});
w.setGoal(a.id,goal,'agent');for(let i=0;i<45*20;i++)w.tick();
observations.push({phase:'new-route-after-respawn',pos:{...a.pos},goal:a.goal,scene:sceneAt(a.pos.x,a.pos.z)?.id,via:!!w.via.get(a.id)});
console.log(JSON.stringify({kind:'isolated-fixture',observations},null,2));
