const puppeteer=require("puppeteer-core");
(async()=>{const b=await puppeteer.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:"new"});
const p=await b.newPage();
await p.setViewport({width:390,height:800,isMobile:true,hasTouch:true,deviceScaleFactor:2});
await p.goto("http://127.0.0.1:8765/laser-range-finder/index.html?q="+Date.now(),{waitUntil:"networkidle2"});
await p.evaluate(()=>{document.getElementById("spectrum").scrollIntoView({block:"center"}); window.__ev=[];
  const c=document.querySelector("#spectrum canvas");
  for (const t of ["pointerdown","pointermove","pointerup","pointercancel","mousemove","mousedown","mouseup","mouseleave","mouseout","touchstart","touchend","click"])
    c.addEventListener(t, e=>window.__ev.push(t+(e.pointerType?"("+e.pointerType+")":"")+" x="+Math.round(e.clientX ?? (e.changedTouches&&e.changedTouches[0].clientX))));});
await new Promise(r=>setTimeout(r,300));
const box = await (await p.$("#spectrum")).boundingBox();
await p.touchscreen.tap(box.x + box.width * 0.35, box.y + box.height * 0.5);
await new Promise(r=>setTimeout(r,500));
console.log((await p.evaluate(()=>window.__ev)).join("\n"));
await b.close();})();
