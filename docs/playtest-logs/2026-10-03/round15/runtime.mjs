// End-to-end software renderer check; observes real outgoing telemetry, never injects a metrics payload.
import fs from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM || '/usr/bin/chromium',args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
try{
 const page=await browser.newPage({viewport:{width:900,height:600}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let complete;const received=new Promise(resolve=>complete=resolve);
 page.on('websocket',ws=>ws.on('framesent',f=>{
  try{const m=JSON.parse(f.payload);if(m.t==='metrics'&&m.fps)complete(m.fps);}catch{}
 }));
 await page.goto(process.env.GAME_URL || 'http://127.0.0.1:7777/',{waitUntil:'domcontentloaded'});
 await page.locator('#gate-name').waitFor({state:'visible',timeout:120000});
 await page.locator('#gate-name').fill(process.env.CHARACTER || 'TelemetryBirchFifteen');
 await page.locator('#gate-go').click();
 let timeout;
 const sample=await Promise.race([received,new Promise((_,reject)=>timeout=setTimeout(()=>reject(Error('No telemetry within 90 seconds')),90000))]);
 clearTimeout(timeout);
 if(sample.samples<2 || sample.seconds<=0 || !/SwiftShader/i.test(sample.gpu))throw Error('Incomplete renderer/sample evidence');
 const result={sample,errors,viewport:[900,600],kind:'production browser WebSocket telemetry; software renderer'};
 await fs.writeFile(process.env.FRAME_EVIDENCE || '/tmp/frame-telemetry-browser.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
}finally{await browser.close();}
