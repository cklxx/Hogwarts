// Actual DOM/CSS/fonts, no world/WebGL. Compare product CSS; no candidate style injection.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.env.FIXTURE_ROOT||process.cwd(),out=process.env.FIXTURE_OUT||'/tmp/hogwarts-floo-readability',mode=process.env.FIXTURE_MODE||'after';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_CORE||'/tmp/hogwarts-browser/node_modules/playwright-core/index.mjs').href);
await fs.mkdir(out,{recursive:true});
const built=process.env.FIXTURE_BUILT==='1';
const html=built?(await fs.readFile(root+'/dist/index.html','utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<link[^>]+rel="modulepreload"[^>]*>/g,''):(await fs.readFile(root+'/client/index.html','utf8')).replace(/<script type="module" src="\.\/main\.ts"><\/script>/,'').replace('</head>','<link rel="stylesheet" href="/phone.css"></head>');
const results=[];
for(const profile of (process.env.FIXTURE_PROFILES||'swiftshader,default').split(',')){
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/usr/bin/chromium',args:profile==='default'?['--no-sandbox']:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
 for(const width of (process.env.FIXTURE_WIDTHS||'320,390,900').split(',').map(Number))for(const lang of (process.env.FIXTURE_LANGS||'zh,en').split(',')){
  const height=width===900?600:844;
  const page=await browser.newPage({viewport:{width,height},isMobile:width<820,hasTouch:true,deviceScaleFactor:1,locale:lang==='zh'?'zh-CN':'en-GB'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('http://floo.fixture/**',async route=>{const p=new URL(route.request().url()).pathname;if(p==='/')return route.fulfill({contentType:'text/html',body:html});try{return route.fulfill({body:await fs.readFile(built?(p.endsWith('.css')&&process.env.FIXTURE_CSS?process.env.FIXTURE_CSS:path.join(root,'dist',p)):path.join(root,'client',p.startsWith('/fonts/')||p.startsWith('/ui/')?'public':'',p)),contentType:p.endsWith('.css')?'text/css':p.endsWith('.woff2')?'font/woff2':p.endsWith('.svg')?'image/svg+xml':'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}});
  await page.goto('http://floo.fixture/');
  if(process.env.FIXTURE_THEME){if(!built)await page.addStyleTag({url:'/ui.css'});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,process.env.FIXTURE_THEME);}
  await page.evaluate(lang=>{
   document.documentElement.lang=lang;if(innerWidth<820)document.body.classList.add('phone','touch');document.body.style.background='#281008';
   [...document.body.children].forEach(e=>{if(!['hud','ink'].includes(e.id))e.hidden=true;});const hud=document.querySelector('#hud');hud.hidden=false;[...hud.children].forEach(e=>e.hidden=e.id!=='prompt');
   const p=document.querySelector('#prompt');p.innerHTML='<kbd>F</kbd> '+(lang==='zh'?'阅读书页':'Read a page');p.style.top='378px';window.promptClicks=0;p.onclick=()=>window.promptClicks++;
  },lang);
  await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(450);
  const measure=()=>page.evaluate(()=>{const p=document.querySelector('#prompt'),r=p.getBoundingClientRect(),s=getComputedStyle(p),rect=r=>({x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom});const ranges=[...p.childNodes].flatMap(n=>{const range=document.createRange();range.selectNodeContents(n);return [...range.getClientRects()].map(rect);});return{rect:rect(r),text:p.textContent,ranges,clipped:ranges.some(t=>t.x<r.x||t.right>r.right||t.y<r.y||t.bottom>r.bottom),borderImage:s.borderImage,borderImageSource:s.borderImageSource,borderColor:s.borderTopColor,borderWidth:s.borderTopWidth,background:s.backgroundImage,paper2:s.getPropertyValue('--paper2').trim(),ink:s.color,animation:s.animationName,transform:s.transform};});
  const short=await measure();
  await page.evaluate(lang=>{const p=document.querySelector('#prompt');p.innerHTML='<kbd>F</kbd> '+(lang==='zh'?'使用飞路网 ·「大礼堂」':'the Floo Network (the Great Hall)');const w=p.offsetWidth||240,hw=Math.min(innerWidth/2,w/2+8);p.style.left=`${Math.round(Math.max(hw,Math.min(innerWidth-hw,innerWidth/2)))}px`;},lang);
  await page.waitForTimeout(450);const long=await measure();
  await page.screenshot({path:path.join(out,`${mode}-${profile}-${width}-${lang}-long.png`)});
  await page.evaluate(async()=>{const p=document.querySelector('#prompt');p.hidden=true;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);p.hidden=false;});await page.waitForTimeout(450);const revealed=await measure();
  await page.screenshot({path:path.join(out,`${mode}-${profile}-${width}-${lang}-revealed.png`)});
  await page.touchscreen.tap(revealed.rect.x+revealed.rect.width/2,revealed.rect.y+revealed.rect.height/2);const clicked=await page.evaluate(()=>promptClicks===1);
  results.push({profile,width,height,lang,short,long,revealed,clicked,errors});await page.close();
 }
 await browser.close();
}
await fs.writeFile(path.join(out,mode+'.json'),JSON.stringify(results,null,2));console.log({mode,cases:results.length,clipped:results.filter(r=>r.long.clipped||r.revealed.clipped).length,failedClicks:results.filter(r=>!r.clicked).length,errors:results.flatMap(r=>r.errors)});
