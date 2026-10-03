// Production game regression: UI enrolment/language selection, legal MCP movement, real F/mouse/Cancel/Esc.
// PRIVATE_STATE contains credentials: keep it outside the repository; never archive it.
import fs from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_CORE || 'playwright-core');
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const mode=process.env.MODE||'before', lang=process.env.LANG0||'zh';
const out=process.env.SCREEN_OUT || `/tmp/desktop-game-${mode}-${lang}`, state=process.env.PRIVATE_STATE || `/tmp/desktop-private-${lang}.json`;
const origin=process.env.GAME_URL || 'http://127.0.0.1:7777';
await fs.mkdir(out,{recursive:true});
const reuse=mode==='after' && await fs.access(state).then(()=>true,()=>false);
const browser=await chromium.launch({executablePath:process.env.CHROMIUM || '/usr/bin/chromium',args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
let client,transport;
try {
 const context=await browser.newContext({viewport:{width:900,height:600},locale:lang==='zh'?'zh-CN':'en-GB',deviceScaleFactor:1,...(reuse?{storageState:state}:{})});
 const page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
 if(!reuse){
  await page.locator('#gate-name').waitFor({state:'visible',timeout:120000});
  await page.locator('#gate-name').fill(process.env.CHARACTER || (lang==='zh'?'DesktopBirchFourteen':'DesktopRowanFourteen'));
  await page.locator('#gate-go').click();
 }
 await page.locator('#veil').waitFor({state:'hidden',timeout:120000});
 await page.locator('#gate').waitFor({state:'hidden',timeout:120000});
 if(lang==='en' && await page.locator('html').getAttribute('lang')!=='en'){
  await page.keyboard.press('Escape');
  await page.locator('#lang-en').click();
  await page.locator('#veil').waitFor({state:'hidden',timeout:120000});
  await page.locator('html[lang=en]').waitFor();
 }
 if(await page.locator('.tut-skip').isVisible())await page.locator('.tut-skip').click();
 const token=await page.evaluate(()=>localStorage.getItem('hogwarts.token'));
 if(!token)throw Error('No browser login');
 client=new Client({name:'desktop-prompt-regression',version:'1'});
 transport=new StreamableHTTPClientTransport(new URL('/mcp',origin),{requestInit:{headers:{Authorization:`Bearer ${token}`}}});
 await client.connect(transport);
 const call=async(name,args)=>{
  const r=await client.callTool({name,arguments:args});
  if(r.isError)throw Error(`Game action failed: ${name}`);
  return JSON.parse(r.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'));
 };
 const steps=[];
 const move=async(x,z)=>{await call('move_to',{x,z});const r=await call('wait',{until:'arrived',seconds:20});steps.push({action:'move_to',target:{x,z},reason:r.reason});};
 await move(0,-46);
 await page.locator('#prompt').waitFor({state:'visible',timeout:60000});
 await page.waitForTimeout(1500);
 const measure=()=>page.evaluate(()=>{const p=document.querySelector('#prompt'),r=p.getBoundingClientRect(),s=getComputedStyle(p);return{text:p.textContent,hidden:p.hidden,rect:{x:r.x,y:r.y,width:r.width,height:r.height},borderImageSource:s.borderImageSource,borderWidth:s.borderTopWidth,borderColor:s.borderTopColor,background:s.backgroundImage,animation:s.animationName,transform:s.transform};});
 const initial=await measure();
 if(lang==='en' && !initial.text.includes('Floo Network'))throw Error('English preference not applied');
 if(mode==='after' && initial.borderImageSource!=='none')throw Error('Production border override missing');
 await page.screenshot({path:out+'/initial.png'});
 await page.keyboard.press('f');
 await page.locator('#floo').waitFor({state:'visible'});
 const destinations=await page.locator('#floo [data-to]:not([data-to=""])').count();
 await page.locator('#floo [data-to=""]').click();
 await page.locator('#floo').waitFor({state:'detached'});
 await move(0,-39);
 await page.locator('#prompt').waitFor({state:'hidden',timeout:10000});
 steps.push({action:'leave',promptHidden:true});
 await move(0,-46);
 await page.locator('#prompt').waitFor({state:'visible',timeout:60000});
 await page.waitForTimeout(1500);
 const returned=await measure();
 await page.screenshot({path:out+'/returned.png'});
 const r=await page.locator('#prompt').boundingBox();
 await page.mouse.click(r.x+r.width/2,r.y+r.height/2);
 await page.locator('#floo').waitFor({state:'visible'});
 await page.keyboard.press('Escape');
 await page.locator('#floo').waitFor({state:'detached'});
 await context.storageState({path:state});await fs.chmod(state,0o600);
 const result={mode,lang,viewport:[900,600],initial,returned,destinations,keyboardOpen:true,cancelClose:true,mouseOpen:true,escapeClose:true,steps,errors};
 await fs.writeFile(out+'/result.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify({mode,lang,destinations,initialText:initial.text,borderImageSource:initial.borderImageSource,steps,errors}));
}finally{
 await transport?.terminateSession().catch(()=>{});await client?.close().catch(()=>{});await browser.close();
}
