const puppeteer=require("puppeteer-core");
(async()=>{const b=await puppeteer.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:"new"});
const out=[];
for (const f of [0.2, 0.35, 0.5, 0.75]) {
  const p=await b.newPage();
  await p.setViewport({width:390,height:800,isMobile:true,hasTouch:true,deviceScaleFactor:2});
  await p.goto("http://127.0.0.1:8765/laser-range-finder/index.html?q="+Date.now(),{waitUntil:"networkidle2"});
  await p.evaluate(()=>document.getElementById("spectrum").scrollIntoView({block:"center"}));
  await new Promise(r=>setTimeout(r,800));
  const el = await p.$("#spectrum"); const box = await el.boundingBox();
  await p.touchscreen.tap(box.x + box.width * f, box.y + box.height * 0.5);
  await new Promise(r=>setTimeout(r,400));
  await el.screenshot({path:`shots/u_${f}.png`});
  out.push(`shots/u_${f}.png`);
  await p.close();
}
console.log(out.join(" ")); await b.close();})();
