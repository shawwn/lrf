const puppeteer=require("puppeteer-core");
(async()=>{const b=await puppeteer.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:"new"});
const p=await b.newPage();
await p.setViewport({width:390,height:800,isMobile:true,hasTouch:true,deviceScaleFactor:2});
await p.goto("http://127.0.0.1:8765/laser-range-finder/index.html?q="+Date.now(),{waitUntil:"networkidle2"});
p.on("console",m=>console.log("console:",m.type(),m.text().slice(0,300)));
const el = await p.$("#spectrum");
await p.evaluate(()=>document.getElementById("spectrum").scrollIntoView({block:"center"}));   // a real scroll
await new Promise(r=>setTimeout(r,800));
await el.screenshot({path:"shots/t_before.png"});
for (const f of [0.35, 0.6]) {
  const box = await el.boundingBox();
  await p.touchscreen.tap(box.x + box.width * f, box.y + box.height * 0.5);
  await new Promise(r=>setTimeout(r,400));
  await el.screenshot({path:`shots/t_${f}.png`});
}
await b.close();})();
