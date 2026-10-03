const puppeteer=require("puppeteer-core");
(async()=>{const b=await puppeteer.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:"new"});
const p=await b.newPage();await p.setViewport({width:1000,height:900});const errs=[], bad=[];
p.on("pageerror",e=>errs.push(e.message));p.on("console",m=>{if(m.type()==="error")errs.push(m.text())});
p.on("response",r=>{if(r.status()>=400) bad.push(r.status()+" "+r.url())});
p.on("requestfailed",r=>bad.push("failed "+r.url()));
await p.goto("http://127.0.0.1:8799/",{waitUntil:"networkidle2"});
console.log("landed on", p.url());
const n = await p.evaluate(()=>document.querySelectorAll(".drawer_container canvas").length);
// scroll through so every demo draws
await p.evaluate(async()=>{for(let y=0;y<document.body.scrollHeight;y+=700){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,60));}});
await new Promise(r=>setTimeout(r,500));
console.log("canvases:", n, " errors:", errs.length, " bad requests:", bad.length);
errs.slice(0,3).forEach(e=>console.log("  ", e)); bad.slice(0,5).forEach(e=>console.log("  ", e));
await b.close();})();
