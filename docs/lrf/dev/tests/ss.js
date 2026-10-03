const puppeteer=require("puppeteer-core");
(async()=>{const b=await puppeteer.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:"new"});
const p=await b.newPage();await p.setViewport({width:900,height:900});const errs=[];
p.on("pageerror",e=>errs.push(e.message));p.on("console",m=>{if(m.type()==="error")errs.push(m.text())});
await p.goto("http://127.0.0.1:8765/laser-range-finder/index.html?q="+Date.now(),{waitUntil:"networkidle2"});
await p.evaluate(()=>document.getElementById("single_shot").scrollIntoView({block:"center"}));
for (const [R,t] of [[150,5.1],[150,2.5],[400,3],[150,8]]) { await p.evaluate((R,t)=>lrf_set("single_shot",[R,t]),R,t); await new Promise(r=>setTimeout(r,250));
  await (await p.$("#single_shot")).screenshot({path:`shots/ss_${R}_${t}.png`}); }
console.log("errors", errs.length); await b.close();})();
