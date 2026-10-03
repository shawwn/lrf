const puppeteer=require("puppeteer-core");
(async()=>{const b=await puppeteer.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:"new"});
const errs=[];
for (const [W, mob] of [[360,true],[760,false]]) {
  const p=await b.newPage();
  await p.setViewport({width:W,height:800,isMobile:mob,hasTouch:mob,deviceScaleFactor:2});
  p.on("console",m=>{if(m.type()==="error")errs.push(m.text())});
  await p.goto("http://127.0.0.1:8765/laser-range-finder/index.html?q="+Date.now(),{waitUntil:"networkidle2"});
  await p.evaluate(()=>document.getElementById("prf_ambiguity").scrollIntoView({block:"center"}));
  await new Promise(r=>setTimeout(r,500));
  for (const prf of [10000, 60000]) {
    await p.evaluate(v=>lrf_set("prf_ambiguity",[v]),prf); await new Promise(r=>setTimeout(r,300));
    await (await p.$("#prf_ambiguity")).screenshot({path:`shots/prf_${W}_${prf}.png`});
  }
  await p.close();
}
console.log("errors", errs.length); await b.close();})();
