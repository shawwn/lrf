const puppeteer=require("puppeteer-core");
(async()=>{const b=await puppeteer.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:"new"});
const p=await b.newPage();await p.setViewport({width:760,height:900});const errs=[];
p.on("pageerror",e=>errs.push(e.message));p.on("console",m=>{if(m.type()==="error")errs.push(m.text())});
await p.goto("http://127.0.0.1:8765/laser-range-finder/index.html?q="+Date.now(),{waitUntil:"networkidle2"});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
await p.evaluate(()=>document.getElementById("mount_3d").scrollIntoView({block:"center"})); await sleep(200);
for (const [pan,tilt,yaw,pitch] of JSON.parse(process.argv[2])) {
  await p.evaluate((a,b,c,d)=>lrf_set("mount_3d",[a,b],null,{yaw:c,pitch:d}),pan,tilt,yaw,pitch); await sleep(200);
  await (await p.$("#mount_3d")).screenshot({path:`shots/m3d_${pan}_${tilt}_${yaw}_${pitch}.png`}); }
console.log("errors:",errs.length, errs.slice(0,3).join(" | "));await b.close();})();
