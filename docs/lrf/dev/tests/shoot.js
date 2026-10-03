// Usage: node shoot.js [id1,id2,...] [width]
// Screenshots each demo container and reports console errors.
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");

(async () => {
    const only = process.argv[2] && process.argv[2] !== "all" ? process.argv[2].split(",") : null;
    const width = +(process.argv[3] || 760);
    const out = path.join(__dirname, "shots");
    fs.mkdirSync(out, { recursive: true });
    const browser = await puppeteer.launch({
        executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        headless: "new",
        args: ["--no-sandbox"],
    });
    const page = await browser.newPage();
    await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
    const errors = [];
    page.on("console", m => { if (m.type() === "error" || m.type() === "warning") errors.push(m.type() + ": " + m.text()); });
    page.on("pageerror", e => errors.push("pageerror: " + e.message));
    await page.goto("http://127.0.0.1:8765/laser-range-finder/index.html", { waitUntil: "networkidle2", timeout: 30000 });
    const ids = await page.evaluate(() => Array.from(document.querySelectorAll(".drawer_container, .calculator")).map(e => e.id));
    for (const id of ids) {
        if (only && !only.includes(id)) continue;
        const el = await page.$("#" + id);
        await el.evaluate(e => e.scrollIntoView({ block: "center" }));
        await new Promise(r => setTimeout(r, id === "accumulate" || id === "apriltag_sweep" ? 3500 : 700));
        // include sliders / segmented controls just below/above
        const box = await page.evaluate((id) => {
            const e = document.getElementById(id);
            let r = e.getBoundingClientRect();
            let top = r.top, bottom = r.bottom;
            let n = e.parentElement.classList.contains("padding_wrapper") ? e.parentElement : e;
            let prev = n.previousElementSibling;
            if (prev && prev.classList.contains("segmented_container")) top = prev.getBoundingClientRect().top;
            let s = n.nextElementSibling;
            while (s && /(^| )sl_/.test(s.className)) { bottom = s.getBoundingClientRect().bottom; s = s.nextElementSibling; }
            return { x: 0, y: top + window.scrollY - 6, width: document.documentElement.clientWidth, height: bottom - top + 12 };
        }, id);
        await page.screenshot({ path: path.join(out, id + ".png"), clip: box, captureBeyondViewport: true });
    }
    console.log("demos:", ids.length);
    console.log(errors.length ? errors.join("\n") : "no console errors");
    await browser.close();
})();
