const puppeteer=require("puppeteer-core");
(async()=>{const b=await puppeteer.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:"new"});
const errs=[];
for (const W of [1000, 400]) {
  const p=await b.newPage();await p.setViewport({width:W,height:1000});
  p.on("pageerror",e=>errs.push(e.message));p.on("console",m=>{if(m.type()==="error")errs.push(m.text())});
  await p.goto("http://127.0.0.1:8765/laser-range-finder/index.html?q="+Date.now(),{waitUntil:"networkidle2"});
  for (const id of ["smear","smear_optimum","crossing"]) {
    await p.evaluate(id=>document.getElementById(id).scrollIntoView({block:"center"}),id);
    await new Promise(r=>setTimeout(r,300));
    if (id==="smear") await p.evaluate(()=>lrf_set("smear",[25,0.025]));
    await new Promise(r=>setTimeout(r,200));
    // the demo plus its slider rows
    const box = await p.evaluate(id=>{const e=document.getElementById(id).closest(".padding_wrapper")||document.getElementById(id);
      const r=e.getBoundingClientRect(); let bottom=r.bottom; let n=e.nextElementSibling;
      while(n && n.tagName==="DIV"){bottom=n.getBoundingClientRect().bottom; n=n.nextElementSibling;}
      return {x:0,y:r.top+window.scrollY-10,width:document.documentElement.clientWidth,height:bottom-r.top+20};},id);
    await p.screenshot({path:`shots/hz_${id}_${W}.png`, clip:box, captureBeyondViewport:true});
  }
  const overflow = await p.evaluate(()=>document.documentElement.scrollWidth > document.documentElement.clientWidth);
  console.log("width", W, "page scrolls sideways:", overflow);
  await p.close();
}
console.log("errors", errs.length); await b.close();})();
