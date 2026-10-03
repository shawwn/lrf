const puppeteer=require("puppeteer-core");
(async()=>{const b=await puppeteer.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:"new"});
const p=await b.newPage();await p.goto("http://127.0.0.1:8765/laser-range-finder/index.html?q="+Date.now(),{waitUntil:"networkidle2"});
await new Promise(r=>setTimeout(r,500));
const vals=await p.evaluate(()=>[...document.querySelectorAll(".lrfv")].map(e=>[e.dataset.k,e.textContent]));
console.log(JSON.stringify(vals));await b.close();})();
