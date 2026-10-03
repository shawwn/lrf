const puppeteer=require("puppeteer-core");
(async()=>{const b=await puppeteer.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:"new"});
const p=await b.newPage();await p.setViewport({width:900,height:900});
await p.goto("http://127.0.0.1:8765/laser-range-finder/index.html?q="+Date.now(),{waitUntil:"networkidle2"});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
await p.evaluate(()=>document.getElementById("accumulate").scrollIntoView({block:"center"}));
await sleep(8500); await (await p.$("#accumulate")).screenshot({path:"shots/acc_a.png", clip: undefined});
await sleep(3500); await (await p.$("#accumulate")).screenshot({path:"shots/acc_b.png"});
await b.close();})();
