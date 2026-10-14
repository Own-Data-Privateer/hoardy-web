// Linux isolated Firefox integration audit. Requires web-ext and a Firefox binary.
// WEB_EXT_MODULE=/path/to/web-ext/bin/web-ext.js FIREFOX_PATH=/path/to/firefox node ...
// Creates a throwaway extension/profile/server; never accesses the installed extension.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "hoardy-safety-"));
const addon = path.join(work, "addon"),
    profile = path.join(work, "profile"),
    receipts = path.join(work, "receipts");
for (const p of [addon, profile, receipts]) fs.mkdirSync(p);
const results = [];
const durable = new Map();
let child,
    phase = 0,
    resolveDone,
    startupRetries = 0;
const done = new Promise((resolve) => (resolveDone = resolve));
function stop() {
    if (child) {
        try {
            process.kill(-child.pid, "SIGKILL");
        } catch {}
        child = null;
    }
}
function launch() {
    const args = [
        process.env.WEB_EXT_MODULE,
        "run",
        ...(process.env.VERBOSE ? ["--verbose"] : []),
        "--source-dir",
        addon,
        "--firefox",
        process.env.FIREFOX_PATH,
        "--firefox-profile",
        profile,
        "--keep-profile-changes",
        "--no-input",
        "--no-reload",
        "--no-config-discovery",
        "--args=-headless",
        "--pref=extensions.autoDisableScopes=0",
    ];
    child = spawn(process.execPath, args, {
        detached: true,
        env: { ...process.env, MOZ_DISABLE_CONTENT_SANDBOX: "1" },
        stdio: ["ignore", "pipe", "pipe"],
    });
    for (const [stream, name] of [
        [child.stdout, "stdout"],
        [child.stderr, "stderr"],
    ])
        stream.on("data", (chunk) => {
            fs.appendFileSync(path.join(work, "browser.log"), chunk);
            process.stderr.write(`[web-ext ${name}] ${chunk}`);
        });
    child.on("error", (e) => {
        results.push({ fatal: String(e) });
        resolveDone();
    });
    child.on("exit", (code, signal) => {
        if (code) {
            if (startupRetries++ < 2) {
                console.error("Retrying failed browser startup");
                stop();
                setTimeout(launch, 2000);
            } else {
                results.push({ fatal: `web-ext exited ${code} ${signal}` });
                resolveDone();
            }
        }
    });
}
const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, "http://localhost");
        if (process.env.VERBOSE) console.log("HTTP", req.method, req.url);
        if (url.pathname === "/report") {
            let text = "";
            for await (const chunk of req) text += chunk;
            const value = JSON.parse(text);
            results.push(value);
            console.log(JSON.stringify(value));
            res.end("OK");
            if (value.restart && phase < 3) {
                phase++;
                setTimeout(() => {
                    stop();
                    setTimeout(launch, 1000);
                }, 100);
            }
            if (value.done || value.fatal) resolveDone();
            return;
        }
        const name = url.searchParams.get("profile") || url.searchParams.get("case");
        if (url.pathname === "/receipts") {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify([...(durable.get(name) || [])]));
            return;
        }
        if (url.pathname === "/upload" || url.pathname === "/upload-new") {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const payload = Buffer.concat(chunks);
            const id = payload[0];
            if (
                payload.length !== 32 ||
                !payload.every((byte, index) => byte === (index === 31 ? 255 : id))
            ) {
                res.writeHead(400);
                res.end("bad synthetic payload");
                return;
            }
            if (name.endsWith("http-failure") && (id === 2 || id === 5)) {
                res.writeHead(500);
                res.end("injected failure");
                return;
            }
            const filename = path.join(receipts, name + "-" + id + ".bin");
            const fd = fs.openSync(filename, "w");
            fs.writeFileSync(fd, payload);
            fs.fsyncSync(fd);
            fs.closeSync(fd);
            if (!durable.has(name)) durable.set(name, new Set());
            durable.get(name).add(id);
            res.writeHead(200);
            res.end("");
            return;
        }
        res.writeHead(404);
        res.end();
    } catch (e) {
        console.error("SERVER", e);
        res.writeHead(500);
        res.end(String(e));
    }
});
(async () => {
    if (process.platform !== "linux")
        throw Error("Runner uses Linux process groups to isolate crash tests.");
    if (!process.env.WEB_EXT_MODULE || !process.env.FIREFOX_PATH)
        throw Error("Set WEB_EXT_MODULE and FIREFOX_PATH");
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = "http://127.0.0.1:" + server.address().port;
    fs.writeFileSync(path.join(addon, "config.js"), `const AUDIT_URL=${JSON.stringify(url)};`);
    const scripts = ["config.js"];
    for (const file of [
        "lib/base.js",
        "lib/lslot.js",
        "lib/idbp.js",
        "background/issue-acc.js",
        "background/persistence.js",
        "tests/browser-safety-background.js",
    ]) {
        const dest = file.replaceAll("/", "-");
        fs.copyFileSync(path.join(root, file), path.join(addon, dest));
        scripts.push(dest);
    }
    fs.writeFileSync(
        path.join(addon, "manifest.json"),
        JSON.stringify(
            {
                manifest_version: 2,
                name: "Hoardy isolated safety tests",
                version: "1.0",
                browser_specific_settings: { gecko: { id: "hoardy-safety-test@example.invalid" } },
                permissions: ["storage", "unlimitedStorage", "http://127.0.0.1/*"],
                background: { scripts },
            },
            null,
            2,
        ),
    );
    console.log("Disposable test files: " + work);
    launch();
    await Promise.race([
        done,
        new Promise((_, reject) =>
            setTimeout(() => reject(Error("audit timed out")), 90000).unref(),
        ),
    ]);
    if (!results.some((r) => r.done)) throw Error("audit did not finish");
})()
    .catch((error) => {
        results.push({ fatal: String(error) });
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => {
        stop();
        server.closeAllConnections();
        server.close();
        const output = process.env.RESULT_FILE || path.join(work, "results.json");
        fs.writeFileSync(output, JSON.stringify({ work, results }, null, 2));
        console.log("Results: " + output);
        if (results.some((r) => r.passed === false || r.fatal)) process.exitCode = 1;
    });
