import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root=path.resolve(process.env.FIXTURE_ROOT || process.cwd());
const { chromium }=await import(pathToFileURL(process.env.PLAYWRIGHT_CORE || '/tmp/hogwarts-browser/node_modules/playwright-core/index.mjs').href);
const { default: ts }=await import(pathToFileURL(path.join(root,'node_modules/typescript/lib/typescript.js')).href);
const out=process.env.FIXTURE_OUT || '/tmp';
await fs.mkdir(out,{recursive:true});
const mode=process.env.FIXTURE_MODE || 'after';
const transpile=s=>ts.transpile(s.replace(/^import .*;\n/gm,'').replace(/\bexport /g,''),{target:ts.ScriptTarget.ES2022});
const controls=await fs.readFile(root+'/client/controls.ts','utf8');
const tutorial=transpile(controls.slice(controls.indexOf('const HALL =')));
const runes=transpile(await fs.readFile(root+'/src/shared/runes.ts','utf8'))+transpile(await fs.readFile(root+'/client/panels/runes.ts','utf8'));
const main=await fs.readFile(root+'/client/main.ts','utf8');
const ms=main.indexOf("$('#menu').innerHTML = ")+"$('#menu').innerHTML = ".length;
const template=main.slice(ms,main.indexOf(";\n  $('#lang-zh')",ms));
const menu=ts.transpile(`function menuHTML(L, ic, esc, pn, feats, invite, shell, switchKey, bridge, header, account, lang, uiSize) { return ${template}; }`,{target:ts.ScriptTarget.ES2022});
const html=(await fs.readFile(root+'/client/index.html','utf8')).replace(/<script type="module" src="\.\/main\.ts"><\/script>/,'').replace('</head>','<link rel="stylesheet" href="/phone.css"></head>');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM || '/usr/bin/chromium',args:['--no-sandbox']});
const results=[];
for(const [width,height] of [[320,568],[320,640],[360,740],[390,844]])for(const lang of ['zh','en']){
 const page=await browser.newPage({viewport:{width,height},isMobile:true,hasTouch:true});
 await page.route('http://tutorial.fixture/**',async route=>{const p=new URL(route.request().url()).pathname;if(p==='/')return route.fulfill({contentType:'text/html',body:html});const file=path.join(root,'client',p.startsWith('/fonts/')||p.startsWith('/ui/')?'public':'',p);try{return route.fulfill({body:await fs.readFile(file),contentType:p.endsWith('.css')?'text/css':p.endsWith('.woff2')?'font/woff2':p.endsWith('.svg')?'image/svg+xml':'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}});
 await page.goto('http://tutorial.fixture/');await page.addStyleTag({content:'* { animation: none !important; transition: none !important; }'});
 await page.evaluate(({lang,tutorial,runes,menu})=>{
  window.lang=lang;document.documentElement.lang=lang;document.body.classList.add('phone','touch');document.querySelector('#veil').hidden=true;document.querySelector('#hud').hidden=false;
  document.querySelector('#clock').innerHTML='<button class="phone-time">12:30</button>';document.querySelector('#bars').style.height='142px';
  const boot=`const $=s=>document.querySelector(s);const L=(zh,en)=>window.lang==='zh'?zh:en;const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');const spellName=s=>s;const now=()=>performance.now()/1000;const inZoneId=()=>false;const LOOK_ZH='',LOOK_EN='';${tutorial}\n${runes}\n${menu}\nwindow.makeTutorial=createTutorial;window.makeRunes=runesFeature;window.menuHTML=menuHTML;window.L=L;window.esc=esc;`;
  (0,eval)(boot);
  window.fixture={over:false,step:0,pixie:true};
  window.deps={touch:true,myPos:()=>({x:300,z:300}),creatures:()=>fixture.pixie?[{k:'pixie',i:'pixie'}]:[],creaturePos:()=>({x:0,z:0}),yaw:()=>0,slotOf:()=>0,agent:()=>fixture.step===6?{connected:true,client:'fixture'}:null,panelOpen:()=>fixture.over,me:()=>({ui:[]}),openMenu:()=>{},closeMenu:()=>{},openBook:()=>{},walkTo:()=>{},tempus:()=>{},pair:()=>{},openOwl:()=>{},report:()=>{}};
  const ctx={el:(tag,id,init)=>{const e=document.createElement(tag);e.id=id;init(e);return e},keep:()=>{},effect:fn=>fn()};
  window.runes=makeRunes({me:()=>({runes:{bag:['split'],on:{}},hotbar:[{id:'a',name:'Stupefy',kind:'harm'},{id:'b',name:'Incendio',kind:'harm'},{id:'c',name:'Aguamenti',kind:'harm'}]}),send:m=>window.sent.push(m)},ctx);window.sent=[];window.runes.hud();
  document.querySelector('#menu').innerHTML=menuHTML(L,n=>'<svg class="ic"></svg>',esc,{menuHtml:()=>'',menuLinks:()=>''},[],'https://example.invalid',undefined,'Ctrl+Shift+S','fixture bridge','fixture command',{registry:'fixture'},lang,'m');
  const update=()=>{const t=document.querySelector('#tutorial'),r=t.getBoundingClientRect(),st=document.documentElement.style;st.setProperty('--bars-h','142px');st.setProperty('--tut-h',`${!t.hidden&&!t.dataset.over&&t.dataset.at!=='bottom'?Math.round(r.height):0}px`);st.setProperty('--tut-b',`${!t.hidden&&!t.dataset.over&&t.dataset.at==='bottom'?Math.round(r.height):0}px`);st.setProperty('--tut-over',`${t.dataset.over?Math.round(r.bottom):0}px`);};
  new ResizeObserver(update).observe(document.querySelector('#tutorial'));new MutationObserver(update).observe(document.querySelector('#tutorial'),{attributes:true});window.update=update;window.observeTutorial=()=>new ResizeObserver(update).observe(document.querySelector('#tutorial'));
 },{lang,tutorial,runes,menu});
 await page.evaluate(()=>document.fonts.ready);
 for(const step of [0,1,2,3,4,5,6,7,8])for(const state of ['plain','rune','code','menu',...(step===1?['no-pixie']:[])]){
  await page.evaluate(({step,state})=>{fixture.step=step;fixture.over=state==='menu';fixture.pixie=state!=='no-pixie';localStorage.setItem('hogwarts.tutorial',String(Math.min(7,step)));document.querySelector('#tutorial').replaceWith(Object.assign(document.createElement('div'),{id:'tutorial'}));window.tut=makeTutorial(deps);observeTutorial();tut.tick();if(step===8)document.querySelector('#tutorial [data-act="later"]').click();document.querySelector('#runecard').hidden=!['rune','code'].includes(state);document.querySelector('#runecard-code').hidden=state!=='code';document.querySelector('#runecard').scrollTop=0;document.querySelectorAll('#runecard button').forEach(b=>b.disabled=false);document.querySelector('#menu').hidden=state!=='menu';update();}, {step,state});
  // Replacing the tutorial keeps click listeners isolated between steps; reflect trackBars after layout.
  await page.waitForTimeout(40);await page.evaluate(()=>update());await page.waitForTimeout(40);
  const result=await page.evaluate(()=>{
   const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
   const t=document.querySelector('#tutorial'),line=t.querySelector('.tut-line'),r=rect(t),card=document.querySelector('#runecard'),menu=document.querySelector('#menu');
   const overlap=(a,b)=>a.x<b.right&&a.right>b.x&&a.y<b.bottom&&a.bottom>b.y;
   const buttons=[...t.querySelectorAll('button')].map(b=>{const r=rect(b);return {...r,label:b.textContent||b.getAttribute('aria-label'),hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===b}});
   return{tutorial:r,line:rect(line),text:line.textContent,clipped:([...function*(){const walker=document.createTreeWalker(line,NodeFilter.SHOW_TEXT);for(let n=walker.nextNode();n;n=walker.nextNode()){const range=document.createRange();range.selectNodeContents(n);yield*range.getClientRects();}}()].some(x=>x.left<r.x||x.right>r.right||x.top<r.y||x.bottom>r.bottom)) || (getComputedStyle(line).overflow==='hidden' && (line.scrollWidth>line.clientWidth+1||line.scrollHeight>line.clientHeight+1)),buttons,coreOverlap:['#clock','#stick','#touchbar','#tb-roll'].filter(s=>overlap(r,rect(document.querySelector(s)))),card:card.hidden?null:{...rect(card),scrollHeight:card.scrollHeight,clientHeight:card.clientHeight},cardOverlap:!card.hidden&&overlap(r,rect(card)),menu:menu.hidden?null:rect(menu),menuOverlap:!menu.hidden&&overlap(r,rect(menu))};
  });
  const stable=await page.evaluate(async()=>{const sizes=[];for(let i=0;i<5;i++){await new Promise(requestAnimationFrame);sizes.push(['#tutorial','#runecard'].map(s=>document.querySelector(s).getBoundingClientRect().height).join(','));}return new Set(sizes.slice(-3)).size===1;});
  let equip=null;if(state==='code'){await page.locator('#runecard [data-spell="c"]').scrollIntoViewIfNeeded();await page.locator('#runecard [data-spell="c"]').tap();equip=await page.evaluate(()=>({sent:sent.at(-1),scrollTop:document.querySelector('#runecard').scrollTop,stillVisible:!document.querySelector('#runecard').hidden}));}
  let doneClosed=null;if(step===8){await page.locator('#tutorial [data-act="close"]').tap();doneClosed=await page.locator('#tutorial').isHidden();}
  results.push({width,height,lang,step:step===8?'done':step+1,state,stable,equip,doneClosed,...result});
  if(width===320&&lang==='en'&&step===2&&state==='code')await page.screenshot({path:path.join(out,`tutorial-${mode}-${width}x${height}-en-code.png`)});
 }
 await page.close();
}
await browser.close();await fs.writeFile(path.join(out,`tutorial-${mode}.json`),JSON.stringify(results,null,2));
console.log(JSON.stringify({cases:results.length,unstable:results.filter(r=>!r.stable).length,failedClose:results.filter(r=>r.doneClosed===false).length,failedEquip:results.filter(r=>r.equip&&r.equip.sent?.spell!=='c').length,clipped:results.filter(r=>r.clipped).length,coreOverlap:results.filter(r=>r.coreOverlap.length).map(r=>({width:r.width,lang:r.lang,step:r.step,state:r.state,core:r.coreOverlap})),cardOverlap:results.filter(r=>r.cardOverlap).length,menuOverlap:results.filter(r=>r.menuOverlap).length,offscreen:results.filter(r=>r.tutorial.y<0).length,smallButtons:results.filter(r=>r.buttons.some(b=>b.width<43.99||b.height<43.99)).length},null,2));
