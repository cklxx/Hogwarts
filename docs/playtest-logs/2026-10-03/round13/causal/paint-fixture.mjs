import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_CORE || '/tmp/hogwarts-browser/node_modules/playwright-core/index.mjs').href);
import fs from 'node:fs/promises';
import path from 'node:path';
const root=process.env.FIXTURE_ROOT||process.cwd(),out=process.env.FIXTURE_OUT||('/tmp/hogwarts-floo-paint-'+(process.env.PROFILE||'swiftshader'));await fs.mkdir(out,{recursive:true});
const html=(await fs.readFile(root+'/client/index.html','utf8')).replace(/<script type="module" src="\.\/main\.ts"><\/script>/,'').replace('</head>','<link rel="stylesheet" href="/phone.css"></head>');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/usr/bin/chromium',args:process.env.PROFILE==='default'?['--no-sandbox']:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const results=[];
for(const width of [320,390])for(const variant of ['image-border-shadow','image-border-flat','image-plain-shadow','image-plain-flat','solid-border-shadow','solid-border-flat','solid-plain-shadow','solid-plain-flat']){
 const page=await browser.newPage({viewport:{width,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1,locale:'en-GB'});
 await page.route('http://floo.fixture/**',async route=>{const p=new URL(route.request().url()).pathname;if(p==='/')return route.fulfill({contentType:'text/html',body:html});try{return route.fulfill({body:await fs.readFile(path.join(root,'client',p.startsWith('/fonts/')||p.startsWith('/ui/')?'public':'',p)),contentType:p.endsWith('.css')?'text/css':p.endsWith('.woff2')?'font/woff2':p.endsWith('.svg')?'image/svg+xml':'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}});
 await page.goto('http://floo.fixture/');
 await page.evaluate(variant=>{
  document.documentElement.lang='en';document.body.classList.add('phone','touch','topview','cup');document.body.style.background='#281008';
  [...document.body.children].forEach(e=>{if(!['hud','ink','view'].includes(e.id))e.hidden=true;});const hud=document.querySelector('#hud');hud.hidden=false;[...hud.children].forEach(e=>e.hidden=e.id!=='prompt');
  const p=document.querySelector('#prompt');window.long='<kbd>F</kbd> the Floo Network (the Great Hall)';p.innerHTML=variant==='long-first'?window.long:'<kbd>F</kbd> Read a page';p.style.top='378px';
  p.hidden=false;if(variant.includes('-plain-'))p.style.borderImage='none';if(variant.endsWith('-flat'))p.style.boxShadow='none';if(variant.startsWith('solid-')){p.style.backgroundImage='none';p.style.backgroundColor='var(--paper)';}
  if(variant==='canvas2d-expand'){const c=document.querySelector('#view');c.width=innerWidth;c.height=innerHeight;const ctx=c.getContext('2d');let frame=0;window.paint=()=>{ctx.fillStyle=frame++%2?'#281008':'#291109';ctx.fillRect(0,0,c.width,c.height);requestAnimationFrame(paint);};paint();}
 },variant);
 await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(650);
 const old=await page.locator('#prompt').boundingBox();
 await page.evaluate(async variant=>{
  const p=document.querySelector('#prompt');
  const position=(x,y)=>{const w=p.offsetWidth||240,hw=Math.min(innerWidth/2,w/2+8);p.style.left=`${Math.round(Math.max(hw,Math.min(innerWidth-hw,x)))}px`;p.style.top=`${Math.round(y)}px`;};
  if(variant==='moving-expand')for(let i=0;i<30;i++){position(innerWidth*(.2+.6*i/30),378+Math.sin(i/4)*20);await new Promise(requestAnimationFrame);}
  p.hidden=false;p.innerHTML=window.long;position(innerWidth/2,378);
  if(variant==='moving-expand')for(let i=0;i<30;i++){position(innerWidth/2+Math.sin(i/4)*20,378+Math.cos(i/4)*8);await new Promise(requestAnimationFrame);}position(innerWidth/2,378);
 },variant);
 await page.waitForTimeout(450);
 const metrics=await page.evaluate(()=>{const p=document.querySelector('#prompt'),r=p.getBoundingClientRect(),s=getComputedStyle(p);return{rect:{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom},left:s.left,top:s.top,borderImage:s.borderImage,boxShadow:s.boxShadow,backgroundColor:s.backgroundColor,backgroundSize:s.backgroundSize,backgroundOrigin:s.backgroundOrigin,backgroundClip:s.backgroundClip,backgroundRepeat:s.backgroundRepeat,backgroundAttachment:s.backgroundAttachment,backgroundImage:s.backgroundImage,transform:s.transform,translate:s.translate,vars:Object.fromEntries(['--paper','--paper2','--paper3','--u','--t'].map(k=>[k,s.getPropertyValue(k)]))};});
 await page.screenshot({path:path.join(out,`${width}-${variant}.png`)});results.push({width,variant,old,metrics});await page.close();
}
await browser.close();await fs.writeFile(path.join(out,'metrics.json'),JSON.stringify(results,null,2));console.log(results.map(r=>({width:r.width,variant:r.variant,oldWidth:r.old?.width,newWidth:r.metrics.rect.width,left:r.metrics.left})));
