// Build extension first: cd extension && bash build.sh firefox-mv2
// Install Playwright in your test environment; set CHROMIUM_PATH if needed.
// Run: node --test extension/tests/popup-layout.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { test } = require("node:test");
const { chromium, firefox } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.join(__dirname, "..");

async function fixture(width, popup = false) {
    const useFirefox = process.env.BROWSER === "firefox";
    const browser = await (useFirefox ? firefox : chromium).launch({
        executablePath: useFirefox ? undefined : process.env.CHROMIUM_PATH || undefined,
        headless: true,
        args: !useFirefox && process.platform === "linux" ? ["--no-sandbox"] : [],
    });
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    // Exercise the built template and real UI-generation helpers without an
    // installed extension or access to the operator's browser profile.
    await page.route("**/*.js", (route) => route.abort());
    await page.goto(
        pathToFileURL(path.join(root, "dist/Hoardy-Web-firefox-mv2/page/popup.html")).href,
    );
    for (const name of ["lib/base.js", "lib/schedule-timeout.js", "lib/ui.js"]) {
        await page.addScriptTag({ content: fs.readFileSync(path.join(root, name), "utf8") });
    }
    await page.evaluate((popup) => {
        const body = document.getElementById("body");
        makeUI(body);
        addHelp(body, {}, (help) => help);
        body.style.display = "block";
        document.documentElement.classList.add("light");
        if (popup) {
            document.body.classList.add("toolbar-popup");
            document.documentElement.classList.add("toolbar-popup");
        }
        for (const node of document.querySelectorAll(".on-reload,.on-pending"))
            node.classList.add("hidden");
    }, popup);
    return { browser, page };
}

async function geometry(page) {
    return page.evaluate(() => {
        function rect(id) {
            const r = document.getElementById(id).getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
        }
        return {
            body: { width: document.body.offsetWidth, height: document.body.offsetHeight },
            heading: (() => {
                const r = document.querySelector("#content > h1").getBoundingClientRect();
                return { y: r.y, height: r.height };
            })(),
            running: rect("div-stats.running_actions"),
            scheduled: rect("div-stats.scheduled_actions"),
            saved: rect("div-stats.saved"),
            queued: rect("div-stats.queued_failed"),
            failed: rect("div-stats.failed"),
            stashed: rect("div-stats.stashed"),
        };
    });
}

async function stress(page) {
    await page.evaluate(() => {
        for (const id of ["stats.saved", "stats.stashed", "stats.queued", "stats.failed"]) {
            document.getElementById(id).textContent = "999.9M";
        }
        for (const id of [
            "stats.saved_size",
            "stats.stashed_size",
            "stats.queued_size",
            "stats.failed_size",
        ]) {
            document.getElementById(id).textContent = "999.9PiB";
        }
        document.getElementById("stats.running_actions").textContent =
            "rearchiveSaved, stash, retryUnarchived";
        document.getElementById("stats.scheduled_actions").textContent = Array(40)
            .fill("q:retryUnarchived")
            .join(", ");
        document.getElementById("div-reloadSelf").classList.remove("hidden");
        document.getElementById("version").classList.add("attention");
    });
}

test("toolbar popup and statistic rows keep their geometry through live updates", async () => {
    const { browser, page } = await fixture(560, true);
    try {
        const before = await geometry(page);
        await stress(page);
        const after = await geometry(page);
        assert.deepEqual(after, before);
        assert.equal(after.body.width, 560);
        assert.equal(after.body.height, 600);
        if (process.env.SCREENSHOT_DIR) {
            fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
            await page.screenshot({
                path: path.join(process.env.SCREENSHOT_DIR, "popup-live-stats.png"),
            });
        }
    } finally {
        await browser.close();
    }
});

test("mobile and embedded layouts reserve statistic rows across sparse/dense modes", async () => {
    for (const width of [320, 400]) {
        const { browser, page } = await fixture(width);
        try {
            for (const sparse of [false, true]) {
                await page.evaluate(
                    (s) => document.documentElement.classList.toggle("sparse", s),
                    sparse,
                );
                const before = await geometry(page);
                await stress(page);
                const after = await geometry(page);
                assert.deepEqual(after, before);
                assert(after.body.width <= width);
            }
        } finally {
            await browser.close();
        }
    }
});

test("toolbar popup fits a small available viewport and keeps its content scrollable", async () => {
    const { browser, page } = await fixture(560, true);
    try {
        await page.setViewportSize({ width: 360, height: 400 });
        const box = await geometry(page);
        assert(box.body.width <= 360);
        assert(box.body.height <= 400);
        assert(await page.evaluate(() => document.body.scrollHeight > document.body.clientHeight));
    } finally {
        await browser.close();
    }
});

test("highlighting a counter preserves its dimensions and settings tabs remain flexible", async () => {
    const { browser, page } = await fixture(1000);
    try {
        const before = await geometry(page);
        await page.evaluate(() => document.getElementById("stats.queued").classList.add("target"));
        assert.deepEqual(await geometry(page), before);
        assert.equal(before.body.width, 1000);
        assert.notEqual(before.body.height, 600);
    } finally {
        await browser.close();
    }
});
