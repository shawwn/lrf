const puppeteer = require("puppeteer-core");
(async () => {
    const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await page.setViewport({ width: 760, height: 900 });
    const errors = [];
    page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", e => errors.push("pageerror: " + e.message));
    await page.goto("http://127.0.0.1:8765/laser-range-finder/index.html?" + Date.now(), { waitUntil: "networkidle2" });
    const ids = await page.evaluate(() => Array.from(document.querySelectorAll(".drawer_container, .calculator")).map(e => e.id));
    for (const id of ids) {
        await page.evaluate(id => document.getElementById(id).scrollIntoView({ block: "center" }), id);
        await new Promise(r => setTimeout(r, 250));
    }
    await page.evaluate(() => { const b = document.querySelector(".calc_buttons button"); if (b) b.click(); });
    await page.evaluate(() => { lrf_set("smear", [null, null, "match"]); lrf_set("beam_fill", [null], [2]); });
    await new Promise(r => setTimeout(r, 300));
    console.log(ids.length + " demos; " + (errors.length ? "ERRORS:\n" + errors.join("\n") : "no errors"));
    await browser.close();
})();
