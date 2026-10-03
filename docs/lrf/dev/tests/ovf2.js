const puppeteer=require("puppeteer-core");
(async()=>{const b=await puppeteer.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:"new"});
const p=await b.newPage();await p.setViewport({width:400,height:900});
await p.goto(process.argv[2],{waitUntil:"networkidle2"});
await p.evaluate(async()=>{for(let y=0;y<document.body.scrollHeight;y+=800){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,30));}});
const r = await p.evaluate(()=>{const W=document.documentElement.clientWidth; const out=[];
  const walker=document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n; while((n=walker.nextNode())){ if(!n.textContent.trim()) continue; const rg=document.createRange(); rg.selectNodeContents(n);
    const b=rg.getBoundingClientRect(); if(b.right>W+1) out.push(Math.round(b.right)+" "+n.parentElement.className+": "+n.textContent.trim().slice(0,40)); }
  return {sw: document.documentElement.scrollWidth, out};});
console.log(JSON.stringify(r,null,1)); await b.close();})();
