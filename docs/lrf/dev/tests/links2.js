const puppeteer=require("puppeteer-core");
(async()=>{const b=await puppeteer.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:"new"});
const p=await b.newPage(); await p.setViewport({width:1000,height:900}); const errs=[];
p.on("pageerror",e=>errs.push(e.message));
await p.goto("http://127.0.0.1:8765/laser-range-finder/index.html?q="+Date.now(),{waitUntil:"networkidle2"});
await p.evaluate(()=>document.getElementById("tracking_latency").scrollIntoView({block:"center"}));
const links = await p.$$("a[onclick*=tracking_latency]");
for (const [i, a] of links.entries()) {
  await a.click(); await new Promise(r=>setTimeout(r,300));
  const sel = await p.evaluate(()=>document.querySelector("#tracking_latency_seg0 .segmented_control_on").textContent);
  console.log(await (await a.getProperty("textContent")).jsonValue(), "->", sel);
}
console.log("errors", errs.length); await b.close();})();
