const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

for (const [name, callback, message] of [
    ["explicit abort", "t => { t.abort(); }", "Transaction aborted"],
    ["synchronous callback failure", '() => { throw Error("sync failure"); }', "sync failure"],
    [
        "asynchronous callback failure",
        'async () => { await Promise.resolve(); throw Error("async failure"); }',
        "async failure",
    ],
]) {
    test(`IndexedDB helper rejects on ${name}`, async () => {
        const transaction = {
            error: null,
            abort() {
                queueMicrotask(() => transaction.onabort?.());
            },
        };
        const c = vm.createContext({ DOMException, db: { transaction: () => transaction } });
        vm.runInContext(fs.readFileSync(path.join(__dirname, "../lib/idbp.js"), "utf8"), c);
        const work = vm.runInContext(`idbTransaction(db,'readwrite',[],${callback})`, c);
        let timer;
        try {
            await assert.rejects(
                Promise.race([
                    work,
                    new Promise((_, reject) => {
                        timer = setTimeout(() => reject(Error("transaction never settled")), 200);
                    }),
                ]),
                new RegExp(message),
            );
        } finally {
            clearTimeout(timer);
        }
    });
}
