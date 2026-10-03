const puppeteer=require("puppeteer-core");
(async()=>{const b=await puppeteer.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:"new"});
const p=await b.newPage();
await p.setViewport({width:390,height:800,isMobile:true,hasTouch:true,deviceScaleFactor:2});
const errs=[]; p.on("pageerror",e=>errs.push(e.message));
await p.goto("http://127.0.0.1:8765/laser-range-finder/index.html?q="+Date.now(),{waitUntil:"networkidle2"});
await p.evaluate(()=>document.getElementById("spectrum").scrollIntoView({block:"center"}));
await new Promise(r=>setTimeout(r,400));
const el = await p.$("#spectrum"); const box = await el.boundingBox();
await el.screenshot({path:"shots/spec_0.png"});
// tap a third of the way across, then drag sideways with a finger
await p.touchscreen.tap(box.x + box.width * 0.35, box.y + box.height * 0.5);
await new Promise(r=>setTimeout(r,300)); await el.screenshot({path:"shots/spec_tap.png"});
await p.touchscreen.touchStart(box.x + box.width * 0.35, box.y + box.height * 0.5);
for (let i = 1; i <= 10; i++) { await p.touchscreen.touchMove(box.x + box.width * (0.35 + 0.05 * i), box.y + box.height * 0.5); await new Promise(r=>setTimeout(r,30)); }
await p.touchscreen.touchEnd();
await new Promise(r=>setTimeout(r,300)); await el.screenshot({path:"shots/spec_drag.png"});
console.log("errors", errs.length); await b.close();})();
