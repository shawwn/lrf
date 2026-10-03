const puppeteer=require("puppeteer-core");
(async()=>{const b=await puppeteer.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:"new"});
for (const [W,H,m] of [[1000,800,false],[390,780,true]]) {
  const p=await b.newPage(); await p.setViewport({width:W,height:H,isMobile:m,hasTouch:m}); const errs=[];
  p.on("pageerror",e=>errs.push(e.message));
  await p.goto("http://127.0.0.1:8765/laser-range-finder/index.html?q="+Date.now(),{waitUntil:"networkidle2"});
  const n = await p.evaluate(()=>document.querySelectorAll('a[onclick^="lrf_link("]').length);
  let bad=[], scrolled=0;
  for (let i=0;i<n;i++) {
    const info = await p.evaluate(i=>{const a=document.querySelectorAll('a[onclick^="lrf_link("]')[i]; a.scrollIntoView({block:"center"});
      return {text:a.textContent, id:a.getAttribute("onclick").match(/lrf_link\('([^']+)'/)[1]};}, i);
    await new Promise(r=>setTimeout(r,250));
    const y0 = await p.evaluate(()=>window.scrollY);
    await p.evaluate(i=>document.querySelectorAll('a[onclick^="lrf_link("]')[i].click(), i);
    await new Promise(r=>setTimeout(r,1200));
    const r = await p.evaluate(id=>{const e=document.getElementById(id).getBoundingClientRect(); return {top:e.top,bottom:e.bottom,vh:innerHeight,y:scrollY};}, info.id);
    if (r.y !== y0) scrolled++;
    if (r.top < 0 || r.bottom > r.vh) bad.push(`${info.text} -> ${info.id} [${Math.round(r.top)}, ${Math.round(r.bottom)}] of ${r.vh}`);
  }
  console.log(`${W}x${H}: ${n} links, ${scrolled} scrolled to their demo, ${bad.length} left it off screen, errors ${errs.length}`);
  bad.forEach(x=>console.log("   ", x));
  await p.close();
}
await b.close();})();
