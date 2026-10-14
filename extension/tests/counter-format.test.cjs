const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const root = path.join(__dirname, "..");

function fixture() {
    const nodes = new Map();
    let rendered;
    const context = vm.createContext({
        document: {
            getElementById(id) {
                if (!nodes.has(id)) nodes.set(id, {});
                return nodes.get(id);
            },
        },
        setUI(_document, _name, values) {
            rendered = values;
        },
    });
    const run = (source) => vm.runInContext(source, context);
    run(fs.readFileSync(path.join(root, "lib/base.js"), "utf8"));
    const popup = fs.readFileSync(path.join(root, "page/popup.js"), "utf8");
    // Exercise the actual formatting/update functions without starting the UI.
    run(
        popup.slice(popup.indexOf("function present("), popup.indexOf("async function popupMain(")),
    );
    run(
        popup.slice(
            popup.indexOf("async function updateSt("),
            popup.indexOf("async function updateStats("),
        ),
    );
    return { run, nodes, rendered: () => rendered };
}

test("compact counter formatting preserves the original numeric values", () => {
    const f = fixture();
    f.run("var stats = {queued:1234567, queued_size:1234567, running_actions:'stash'}");
    assert.equal(f.run("present(stats).queued === countToString(stats.queued)"), true);
    assert.equal(
        f.run("present(stats).queued_size === byteLengthToString(stats.queued_size)"),
        true,
    );
    assert.equal(f.run("stats.queued"), 1234567);
    assert.equal(f.run("stats.queued_size"), 1234567);
    assert.equal(f.run("present(stats).running_actions"), "stash");
});

test("counter tooltips show exact values with the appropriate size units", async () => {
    const f = fixture();
    f.run("var stats = {queued:1234567, queued_size:1234567, dumped_real_size:98765}");
    await f.run("updateSt(stats, 'stats')");
    assert.equal(f.nodes.get("stats.queued").title, (1234567).toLocaleString());
    assert.equal(
        f.nodes.get("stats.queued_size").title,
        (1234567).toLocaleString() + " bytes before compression",
    );
    assert.equal(
        f.nodes.get("stats.dumped_real_size").title,
        (98765).toLocaleString() + " bytes stored",
    );
    assert.equal(f.rendered().queued, f.run("countToString(1234567)"));
    assert.equal(f.run("stats.queued"), 1234567);
});
