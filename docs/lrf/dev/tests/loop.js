const puppeteer=require("puppeteer-core");
(async()=>{const b=await puppeteer.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:"new"});
const p=await b.newPage();await p.setViewport({width:900,height:900});const errs=[];
p.on("pageerror",e=>errs.push(e.message));p.on("console",m=>{if(m.type()==="error")errs.push(m.text())});
await p.goto("http://127.0.0.1:8765/laser-range-finder/index.html?q="+Date.now(),{waitUntil:"networkidle2"});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const playing = id => p.evaluate(id=>document.querySelector("#"+id+" .play_pause_button").classList.contains("playing"),id);
for (const id of ["accumulate","apriltag_sweep"]) {
  await p.evaluate(id=>document.getElementById(id).scrollIntoView({block:"center"}),id);
  let log=[];
  for (let i=0;i<14;i++){ await sleep(1000); log.push(await playing(id) ? "▶" : "■"); }
  console.log(id, "untouched, 14 s:", log.join(""), "(▶ playing, ■ stopped)");
  // touch it: press restart, then watch it play once and stop
  await p.click("#"+id+" .restart_button");
  log=[]; for (let i=0;i<14;i++){ await sleep(1000); log.push(await playing(id) ? "▶" : "■"); }
  console.log(id, "after restart:    ", log.join(""));
}
console.log("errors", errs.length); await b.close();})();
