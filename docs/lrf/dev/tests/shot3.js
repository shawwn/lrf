const puppeteer=require("puppeteer-core");
(async()=>{const b=await puppeteer.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:"new"});
const p=await b.newPage();await p.setViewport({width:760,height:900});const errs=[];
p.on("pageerror",e=>errs.push(e.message));p.on("console",m=>{if(m.type()==="error")errs.push(m.text())});
await p.goto("http://127.0.0.1:8765/laser-range-finder/index.html?q="+Date.now(),{waitUntil:"networkidle2"});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function shot(id, vals, name, extra){ await p.evaluate(id=>document.getElementById(id).scrollIntoView({block:"center"}),id); await sleep(200);
  await p.evaluate((id,v)=>lrf_set(id,v),id,vals); if (extra) await p.evaluate(extra); await sleep(250);
  await (await p.$("#"+id)).screenshot({path:"shots/"+name+".png"}); }
for (const R of [10,60,1000]) await shot("parallax_image",[R],"pi_"+R);
for (const R of [5.14,12,20,80]) await shot("apriltag_pose",[R,-2],"tag_"+R);
await shot("mount_3d",[72,4],"m3d_head");
await shot("mount_3d",[-5,36],"m3d_side");
console.log("errors:",errs.length, errs.slice(0,3).join(" | "));await b.close();})();
