// Check the screenshots and measurements emitted by round13/layout/prompt-fixture.mjs.
// npm install --prefix /tmp/hogwarts-browser pngjs playwright-core
// PNGJS=/tmp/hogwarts-browser/node_modules/pngjs/lib/png.js node verify-paint.mjs OUT MODE [THEME]
import fs from 'node:fs/promises';
import path from 'node:path';
const {PNG}=await import(process.env.PNGJS || 'pngjs');
const [out,mode,theme]=process.argv.slice(2);
if(!out || !mode)throw Error('Usage: verify-paint.mjs OUT MODE [THEME]');
const rows=JSON.parse(await fs.readFile(path.join(out,mode+'.json'),'utf8'));
const summary=rows.map(row=>{
 const states={};
 for(const state of ['long','revealed']){
  const rect=row[state].rect;
  const png=PNG.sync.read(fsSync(path.join(out,`${mode}-${row.profile}-${row.width}-${row.lang}-${state}.png`)));
  const y=Math.round(rect.y+11),left=Math.round(rect.x+14),right=Math.round(rect.right-14);
  let light=0;
  for(let x=left;x<right;x++){const i=4*(y*png.width+x);if(png.data[i]>140&&png.data[i+1]>100)light++;}
  states[state]={light,total:right-left,ratio:light/(right-left),width:rect.width,height:rect.height};
 }
 const paintPass=theme==='night' || Object.values(states).every(s=>s.ratio>=.8);
 const layoutPass=['short','long','revealed'].every(s=>!row[s].clipped);
 const borderPass=['short','long','revealed'].every(s=>row[s].borderImageSource==='none');
 return {profile:row.profile,width:row.width,lang:row.lang,theme:theme||'parchment',states,
  paper2:row.long.paper2,borderColor:row.long.borderColor,ink:row.long.ink,
  paintPass,layoutPass,borderPass,clicked:row.clicked,errors:row.errors,
  pass:paintPass&&layoutPass&&row.clicked&&row.errors.length===0};
});
await fs.writeFile(path.join(out,'paint-summary.json'),JSON.stringify(summary,null,2));
const failures=summary.filter(r=>!r.pass);
console.log(JSON.stringify({cases:summary.length,failed:failures.length,failures:failures.map(r=>({width:r.width,lang:r.lang,profile:r.profile,paintPass:r.paintPass,borderPass:r.borderPass}))}));
if(failures.length)process.exitCode=1;

// Screenshots are small local verification artifacts; synchronous reads keep the map deterministic.
import {readFileSync as fsSync} from 'node:fs';
