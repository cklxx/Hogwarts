// Pure DOM reuse of round11's real tutorial / rune feature / fonts; no world or WebGL.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.env.FIXTURE_ROOT || '/workspace/hogwarts-rune-labels';
const out=process.env.FIXTURE_OUT || '/tmp/hogwarts-rune-labels';
const mode=process.env.FIXTURE_MODE || 'after';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_CORE || '/tmp/hogwarts-browser/node_modules/playwright-core/index.mjs').href);
const {default:ts}=await import(pathToFileURL(path.join(root,'node_modules/typescript/lib/typescript.js')).href);
await fs.mkdir(out,{recursive:true});
const transpile=s=>ts.transpile(s.replace(/^import .*;\n/gm,'').replace(/\bexport /g,''),{target:ts.ScriptTarget.ES2022});
const controls=await fs.readFile(root+'/client/controls.ts','utf8');
const tutorial=transpile(controls.slice(controls.indexOf('const HALL =')));
const runes=transpile(await fs.readFile(root+'/src/shared/runes.ts','utf8'))+transpile(await fs.readFile(root+'/client/panels/runes.ts','utf8'));
const zh=transpile(await fs.readFile(root+'/src/shared/zh.ts','utf8'));
const html=(await fs.readFile(root+'/client/index.html','utf8')).replace(/<script type="module" src="\.\/main\.ts"><\/script>/,'').replace('</head>','<link rel="stylesheet" href="/phone.css"></head>');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM || '/usr/bin/chromium',args:['--no-sandbox']});
const results=[];
for(const [width,height] of (process.env.FIXTURE_DESKTOP?[[900,600]]:[[320,568],[320,640],[320,844],[360,740],[390,844]]))for(const lang of ['zh','en']){
 const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1,isMobile:true,hasTouch:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://rune.fixture/**',async route=>{const p=new URL(route.request().url()).pathname;if(p==='/')return route.fulfill({contentType:'text/html',body:html});try{return route.fulfill({body:await fs.readFile(path.join(root,'client',p.startsWith('/fonts/')||p.startsWith('/ui/')?'public':'',p)),contentType:p.endsWith('.css')?'text/css':p.endsWith('.woff2')?'font/woff2':p.endsWith('.svg')?'image/svg+xml':'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}});
 await page.goto('http://rune.fixture/');await page.addStyleTag({content:'* { animation:none !important; transition:none !important; }'});
 await page.evaluate(({lang,tutorial,runes,zh})=>{
  window.lang=lang;document.documentElement.lang=lang;if(innerWidth<820)document.body.classList.add('phone','touch');document.querySelector('#veil').hidden=true;document.querySelector('#hud').hidden=false;
  document.querySelector('#clock').innerHTML='<button class="phone-time">12:30</button>';document.querySelector('#bars').style.height='142px';
  (0,eval)(`const $=s=>document.querySelector(s);const L=(zh,en)=>window.lang==='zh'?zh:en;const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');${zh}\nconst spellName=s=>L(zhSpell(s),s);const now=()=>performance.now()/1000;const inZoneId=()=>false;const LOOK_ZH='',LOOK_EN='';${tutorial}\n${runes}\nwindow.makeTutorial=createTutorial;window.makeRunes=runesFeature;`);
  window.sent=[];window.fixtureMe={runes:{bag:['split'],on:{}},hotbar:[]};
  window.deps={touch:true,myPos:()=>({x:300,z:300}),creatures:()=>[],creaturePos:()=>null,yaw:()=>0,slotOf:()=>0,agent:()=>null,panelOpen:()=>false,me:()=>({ui:[]}),openMenu:()=>{},closeMenu:()=>{},openBook:()=>{},walkTo:()=>{},tempus:()=>{},pair:()=>{},openOwl:()=>{},report:()=>{}};
  const ctx={el:(tag,id,init)=>{const e=document.createElement(tag);e.id=id;init(e);return e},keep:()=>{},effect:fn=>fn()};
  window.runeFeature=makeRunes({me:()=>fixtureMe,send:m=>sent.push(m)},ctx);
  window.update=()=>{const t=document.querySelector('#tutorial'),r=t.getBoundingClientRect(),st=document.documentElement.style;st.setProperty('--bars-h','142px');st.setProperty('--tut-h',`${!t.hidden&&t.dataset.at!=='bottom'?Math.round(r.height):0}px`);st.setProperty('--tut-b',`${!t.hidden&&t.dataset.at==='bottom'?Math.round(r.height):0}px`);};
  window.ro=new ResizeObserver(update);
 },{lang,tutorial,runes,zh});
 await page.evaluate(()=>document.fonts.ready);
 for(const names of (process.env.FIXTURE_DESKTOP?['standard']:['standard','long']))for(const code of (process.env.FIXTURE_DESKTOP?[false]:[false,true]))for(const guide of (process.env.FIXTURE_DESKTOP?['none']:['none','bottom'])){
  await page.evaluate(({names,code,guide})=>{
   const spells=names==='standard'?['Stupefy','Incendio','Aguamenti']:lang==='zh'?['超级连锁冰霜火焰追踪爆裂魔法'.repeat(3).slice(0,40),'Wingardium Leviosa','我的多重闪电飞弹']:['SupercalifragilisticLightningBoltLongNameX'.slice(0,40),'Wingardium Leviosa','My many bouncing bolts'];
   fixtureMe.hotbar=spells.map((name,i)=>({id:names+'-'+i,name,kind:'harm'}));runeFeature.hud();document.querySelector('#runecard').scrollTop=0;
   document.querySelectorAll('#runecard button').forEach(b=>b.disabled=false);sent.length=0;
   const toggle=document.querySelector('#runecard [data-code]');if((toggle.getAttribute('aria-expanded')==='true')!==code)toggle.click();
   localStorage.setItem('hogwarts.tutorial',guide==='top'?'5':'2');ro.disconnect();document.querySelector('#tutorial').replaceWith(Object.assign(document.createElement('div'),{id:'tutorial'}));window.tut=makeTutorial(deps);tut.tick();document.querySelector('#tutorial').hidden=guide==='none';ro.observe(document.querySelector('#tutorial'));update();
  },{names,code,guide});
  await page.waitForTimeout(60);await page.evaluate(()=>update());await page.waitForTimeout(40);
  const metrics=await page.evaluate(async()=>{
   const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
   const card=document.querySelector('#runecard'),tutorial=document.querySelector('#tutorial'),box=rect(card);
   const overlaps=(a,b)=>a.x<b.right&&a.right>b.x&&a.y<b.bottom&&a.bottom>b.y;
   const buttons=[...card.querySelectorAll('[data-spell]')];
   // Range per character: unlike a span overflow check, this sees glyphs painted behind ellipsis.
   const readButton=b=>{const span=b.querySelector(document.body.classList.contains('phone')?'.rc-short':'.rc-full'),s=rect(span),r=rect(b),chars=[];const walker=document.createTreeWalker(span,NodeFilter.SHOW_TEXT);let index=0;
    for(let n=walker.nextNode();n;n=walker.nextNode())for(let i=0;i<n.length;i++){const range=document.createRange();range.setStart(n,i);range.setEnd(n,i+1);const q=range.getBoundingClientRect();if(!n.textContent[i].trim()||q.width===0)continue;const inside=(a,z)=>a.x>=z.x-.6&&a.right<=z.right+.6&&a.y>=z.y-.6&&a.bottom<=z.bottom+.6;chars.push({index:index++,char:n.textContent[i],rect:{x:q.x,y:q.y,right:q.right,bottom:q.bottom},withinLabel:inside(q,s)&&inside(q,r),inCard:inside(q,box)});}
    return{id:b.dataset.spell,text:span.textContent,button:r,label:s,chars,aria:b.getAttribute('aria-label')};};
   const initial=buttons.map(readButton),visible=initial.map(()=>new Set());
   const max=card.scrollHeight-card.clientHeight;
   for(const y of [...Array.from({length:Math.ceil(max/24)},(_,i)=>i*24),max]){card.scrollTop=y;await new Promise(requestAnimationFrame);buttons.map(readButton).forEach((b,i)=>b.chars.forEach(c=>{if(c.withinLabel&&c.inCard)visible[i].add(c.index);}));}
   const labels=initial.map((b,i)=>({...b,clippedCharacters:b.chars.filter(c=>!c.withinLabel).map(c=>c.char).join(''),readableByScrolling:visible[i].size===b.chars.length,visibleCharacterCount:visible[i].size}));
   const sizes=[];for(let i=0;i<5;i++){await new Promise(requestAnimationFrame);sizes.push(`${card.offsetHeight},${tutorial.offsetHeight}`);}
   return{card:box,scrollHeight:card.scrollHeight,clientHeight:card.clientHeight,tutorial:tutorial.hidden?null:rect(tutorial),labels,columns:getComputedStyle(card.querySelector('.rc-row')).gridTemplateColumns,coreOverlap:['#clock','#stick','#touchbar','#tb-roll'].filter(s=>overlaps(box,rect(document.querySelector(s)))||(!tutorial.hidden&&overlaps(rect(tutorial),rect(document.querySelector(s))))),tutorialOverlap:!tutorial.hidden&&overlaps(box,rect(tutorial)),stable:new Set(sizes.slice(-3)).size===1};
  });
  const taps=[];for(let i=0;i<3;i++){const b=page.locator(`#runecard [data-spell="${names}-${i}"]`);await b.scrollIntoViewIfNeeded();await b.tap();taps.push(await page.evaluate(()=>({sent:sent.at(-1),scrollTop:document.querySelector('#runecard').scrollTop,visible:!document.querySelector('#runecard').hidden})));}
  if(width===320&&lang==='en'&&guide==='bottom')await page.screenshot({path:path.join(out,`${mode}-${width}x${height}-${lang}-${names}-${code?'code':'compact'}.png`)});
  results.push({width,height,lang,names,code,guide,...metrics,taps,errors:[...errors]});
 }
 await page.close();
}
await browser.close();
for(const r of results)for(const b of r.labels){if(!(b.clippedCharacters && !r.code && r.guide==='none'))delete b.chars;}
await fs.writeFile(path.join(out,mode+'.json'),JSON.stringify(results,null,2));
const summary={cases:results.length,clippedLabels:results.flatMap(r=>r.labels).filter(b=>b.clippedCharacters).length,scrollUnreadableLabels:results.flatMap(r=>r.labels).filter(b=>!b.readableByScrolling).length,smallButtons:results.flatMap(r=>r.labels).filter(b=>b.button.width<43.99||b.button.height<43.99).length,overlaps:results.filter(r=>r.tutorialOverlap||r.coreOverlap.length).length,unstable:results.filter(r=>!r.stable).length,badTaps:results.filter(r=>r.taps.some((t,i)=>t.sent?.spell!==r.names+'-'+i||!t.visible)).length,errors:results.flatMap(r=>r.errors)};
await fs.writeFile(path.join(out,mode+'-summary.json'),JSON.stringify(summary,null,2));console.log(summary);
