const puppeteer=require("puppeteer-core");
(async()=>{const b=await puppeteer.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:"new"});
const p=await b.newPage();
await p.setViewport({width:390,height:800,isMobile:true,hasTouch:true,deviceScaleFactor:2});
await p.goto("http://127.0.0.1:8765/laser-range-finder/index.html?q="+Date.now(),{waitUntil:"networkidle2"});
await p.evaluate(()=>document.getElementById("spectrum").scrollIntoView({block:"center"}));
await new Promise(r=>setTimeout(r,400));
const box = await (await p.$("#spectrum")).boundingBox();
for (const f of [0.35, 0.6]) {
  await p.touchscreen.tap(box.x + box.width * f, box.y + box.height * 0.5);
  await new Promise(r=>setTimeout(r,500));
  await p.screenshot({path:`shots/tap_${f}.png`, clip: box});
}
await b.close();})();
