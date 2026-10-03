const puppeteer=require("puppeteer-core");
(async()=>{const b=await puppeteer.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:"new"});
const p=await b.newPage();await p.setViewport({width:760,height:900});const errs=[];
p.on("pageerror",e=>errs.push(e.message));p.on("console",m=>{if(m.type()==="error")errs.push(m.text())});
await p.goto("http://127.0.0.1:8765/laser-range-finder/index.html?q="+Date.now(),{waitUntil:"networkidle2"});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
for (const id of ["accumulate","apriltag_sweep"]) {
  await p.evaluate(id=>document.getElementById(id).scrollIntoView({block:"center"}),id);
  await sleep(id==="accumulate"?9000:7000);
  const before = await p.evaluate(id=>document.querySelector("#"+id+" .play_pause_button").classList.contains("playing"),id);
  await p.click("#"+id+" .play_pause_button"); await sleep(600);
  const after = await p.evaluate(id=>document.querySelector("#"+id+" .play_pause_button").classList.contains("playing"),id);
  await (await p.$("#"+id)).screenshot({path:"shots/rw_"+id+".png"});
  console.log(id, "playing before click:", before, "after click (0.6 s later):", after);
}
// loop-mode slider on tof_basic: drag to the end, then press its play button
await p.evaluate(()=>document.getElementById("tof_basic").scrollIntoView({block:"center"})); await sleep(300);
await p.evaluate(()=>lrf_set("tof_basic",[2.2e-6])); await sleep(300);
const lab0 = await p.evaluate(()=>document.querySelector("#tof_basic_sl0 .slider_value").textContent);
await p.click("#tof_basic_sl0 .slider_play"); await sleep(500);
const lab1 = await p.evaluate(()=>document.querySelector("#tof_basic_sl0 .slider_value").textContent);
console.log("tof slider at end:", lab0, "-> 0.5 s after play:", lab1);
console.log("errors:",errs.length, errs.slice(0,3).join(" | "));await b.close();})();
