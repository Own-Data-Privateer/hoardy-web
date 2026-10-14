// Run with: node --test extension/tests/archival.test.cjs
// Executes the actual extension sources; only browser/network boundaries are mocked.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

function fixture(options = {}) {
    const events = [];
    const db = {};
    let live = 0;
    let peak = 0;
    let payload = 0;
    let peakPayload = 0;
    let requests = 0;
    let removeCalls = 0;
    let failRemove = options.failRemove;
    const acknowledged = new Set();
    const count = options.count || 24;
    const size = options.size || 100;
    for (const name of ["dump", "stash", "save"]) {
        db[`lsmeta-${name}`] = { first: 0, next: name === "save" ? 0 : count };
    }
    for (let i = 0; i < count; i++) {
        db[`lsdata-dump-${i}`] = { dump: Uint8Array.of(i) };
        db[`lsdata-stash-${i}`] = { dumpId: i, stashId: i, inLS: true, dumpSize: size, tabId: i };
    }
    const c = vm.createContext({
        URL,
        Uint8Array,
        setTimeout,
        clearTimeout,
        performance,
        console: { log() {}, warn() {}, error() {}, trace() {}, debug() {} },
        browser: {
            storage: {
                local: {
                    async get(keys) {
                        return Object.fromEntries(
                            keys
                                .filter((k) => k in db)
                                .map((k) => [
                                    k,
                                    db[k].dump instanceof Uint8Array
                                        ? structuredClone(db[k])
                                        : vm.runInContext("(" + JSON.stringify(db[k]) + ")", c),
                                ]),
                        );
                    },
                    async set(values) {
                        if (options.beforeSet) await options.beforeSet(c, values);
                        Object.assign(db, structuredClone(values));
                        if (options.afterSet) await options.afterSet(c, values);
                    },
                    async remove(keys) {
                        removeCalls++;
                        if (options.beforeRemove) await options.beforeRemove(c, keys);
                        if (failRemove) {
                            failRemove = false;
                            throw new Error("simulated disk failure");
                        }
                        for (const k of keys) {
                            const match = /^lsdata-(?:dump|stash)-(\d+)$/.exec(k);
                            if (match)
                                assert(
                                    acknowledged.has(Number(match[1])),
                                    `unacknowledged deletion ${k}`,
                                );
                        }
                        for (const k of keys) {
                            events.push(["delete", k]);
                            delete db[k];
                        }
                    },
                },
            },
        },
        async fetch(url, request) {
            const id = request.body[0];
            live++;
            payload += size;
            requests++;
            peak = Math.max(peak, live);
            peakPayload = Math.max(peakPayload, payload);
            events.push(["start", id, url]);
            await new Promise((resolve) =>
                setTimeout(resolve, options.latency ? options.latency(id) : id % 3),
            );
            if (options.onFetch) options.onFetch(c, id);
            live--;
            payload -= size;
            if (options.networkFailure === id) throw new Error("offline");
            const status = options.httpFailure === id ? 500 : 200;
            if (status === 200) {
                acknowledged.add(id);
                events.push(["ack", id]);
            }
            return {
                status,
                statusText: status === 200 ? "OK" : "failure",
                async text() {
                    return "";
                },
            };
        },
    });
    const run = (text) => vm.runInContext(text, c);
    const load = (name) =>
        run(
            fs.readFileSync(
                path.join(options.sourceRoot || path.join(__dirname, ".."), name),
                "utf8",
            ),
        );
    load("lib/base.js");
    load("lib/lslot.js");
    load("background/issue-acc.js");
    run(`
        var dbStateDefaults = {number:0,size:0};
        var config = {archive:true, archiveSubmitHTTP:true, archiveExportAs:false, archiveSaveLS:false,
            submitHTTPConcurrency:${options.concurrency || 4}, submitHTTPMemory:${options.memory || 32},
            submitHTTPParanoid:false, persistLSParanoid:false, preferIndexedDB:false, gzipLSDumps:false,
            submitHTTPURLBase:'http://127.0.0.1:3210/', root:{bucket:'default'}};
        var serverConfig={alive:true,canDump:true,baseURL:config.submitHTTPURLBase,info:{dump_wrr:'/pwebarc/dump'}};
        var state={dumpedUndo:0,stashedUndo:0,savedUndo:0,stashedRedo:0,stashedTotal:0,savedTotal:0,savedRedo:0,
            submittedHTTPTotal:0,submittedHTTPSize:0,
            stashedLS:{number:${count},size:${count * size}},savedLS:{number:0,size:0},
            stashedIDB:{number:0,size:0},savedIDB:{number:0,size:0}};
        var reqresQueue = Array.from({length:${count}},(_,id)=>[
            {dumpId:id,stashId:id,inLS:true,dumpSize:${size},tabId:id,archived:0},null]);
        var originals=reqresQueue.slice(); var reqresQueueSize=${count * size};
        var synchronousClosuresA=[],synchronousClosuresB=[],reqresAlmostDone=[];
        var archivedViaSubmitHTTP=2,archivedViaExportAs=1,archivedIntoLS=4;
        var gotNewArchivedOrNot=false,gotNewBuggedOut=false,gotNewSyncedOrNot=false;
        var wantArchiveDoneNotify=false,wantRetryAllUnarchived=false,wantSaveState=false,wantBroadcastSaved=false,wantBucketSaveAs=false;
        function updateLoggable(){} function broadcastToState(){} function scheduleUpdateDisplay(){}
        function getGoodEpisodic(){return 100} function getQueued(){return reqresQueue}
        function mergeUpdatedTabIds(a,b){return b} function inflateMaybe(x){return x}
    `);
    load("background/persistence.js");
    return {
        run,
        db,
        events,
        acknowledged,
        counts: () => ({ live, peak, peakPayload, requests, removeCalls }),
    };
}

module.exports = { fixture };

test("bounded HTTP-only batches acknowledge before cleanup, preserve counters and metadata", async () => {
    const f = fixture();
    await f.run("processArchiving()");
    assert.equal(f.run("reqresQueue.length"), 0);
    assert.equal(f.run("reqresQueueSize"), 0);
    assert.equal(f.run("state.submittedHTTPTotal"), 24);
    assert.equal(f.run("state.stashedLS.number"), 0);
    assert.equal(f.run("state.stashedLS.size"), 0);
    assert.equal(f.run("state.dumpedUndo"), 24);
    assert.equal(f.db["lsmeta-dump"].first, 24);
    assert.equal(f.db["lsmeta-stash"].first, 24);
    assert.equal(f.counts().peak, 4);
    assert.equal(f.counts().removeCalls, 6);
    assert.equal(f.run("originals.every(([l])=>l.dumpId===undefined)"), true);
});

test("serial opt-out retains one request and one cleanup at a time", async () => {
    const f = fixture({ concurrency: 1 });
    await f.run("processArchiving()");
    assert.equal(f.counts().peak, 1);
    assert.equal(f.counts().removeCalls, 24);
});

test("payload budget bounds batches; an oversized first record still progresses alone", async () => {
    for (const size of [600000, 2000000]) {
        const f = fixture({ memory: 1, size, count: 8 });
        await f.run("processArchiving()");
        assert.equal(f.counts().peak, 1);
        assert.equal(f.counts().peakPayload, size);
        assert.equal(f.run("state.submittedHTTPTotal"), 8);
    }
});

test("HTTP errors and network errors retain every unacknowledged capture", async () => {
    for (const option of ["httpFailure", "networkFailure"]) {
        const f = fixture({ [option]: 3, count: 8 });
        await f.run("processArchiving()");
        assert(f.db["lsdata-dump-3"]);
        assert(f.db["lsdata-stash-3"]);
        assert.equal(f.run("originals[3][0].archived & archivedViaSubmitHTTP"), 0);
        assert(f.run("reqresUnarchivedIssueAcc[0].size") > 0);
        assert.equal(f.counts().live, 0);
    }
});

test("pause during preparation retains queue and disk records, releases prefetched payloads", async () => {
    const f = fixture({
        onFetch(c) {
            vm.runInContext("config.archive=false", c);
        },
    });
    await f.run("processArchiving()");
    assert.equal(f.run("reqresQueue.length"), 24);
    assert.equal(f.run("reqresQueue.every(a=>a[1]===null)"), true);
    assert.equal(f.counts().removeCalls, 0);
    assert.equal(f.counts().live, 0);
    // At-least-once retry after pause is deliberate, never an unacknowledged delete.
    f.run("config.archive=true");
});

test("server URL change cannot consume a response from the old server", async () => {
    let changed = false;
    const f = fixture({
        count: 4,
        onFetch(c) {
            if (!changed) {
                changed = true;
                vm.runInContext("serverConfig.baseURL='http://127.0.0.1:9999/'", c);
            }
        },
    });
    await f.run("processArchiving()");
    assert.equal(f.counts().requests, 8);
    assert.equal(f.run("state.submittedHTTPTotal"), 4);
});

test("failed cleanup retains IDs in the recovery set and does not decrement counters", async () => {
    const f = fixture({ failRemove: true, count: 4 });
    await f.run("processArchiving()");
    assert.equal(f.run("state.stashedLS.number"), 4);
    assert.equal(f.run("state.dumpedUndo"), 0);
    assert.equal(f.run("reqresBuggedOutIssueAcc[0].size"), 4);
    assert.equal(f.run("originals.every(([l])=>l.dumpId!==undefined)"), true);
    for (let i = 0; i < 4; i++) assert(f.db[`lsdata-dump-${i}`]);
});

test("mixed HTTP and local archival keeps serial execution and local copies", async () => {
    const f = fixture({ count: 8 });
    f.run("config.archiveSaveLS=true");
    await f.run("processArchiving()");
    assert.equal(f.counts().peak, 1);
    assert.equal(f.run("state.savedLS.number"), 8);
    assert.equal(f.run("state.stashedLS.number"), 0);
    for (let i = 0; i < 8; i++) assert(f.db[`lsdata-dump-${i}`]);
});

test("paranoid mode stops new parallel batches after the first failed batch", async () => {
    const f = fixture({ count: 8, httpFailure: 3 });
    f.run("config.submitHTTPParanoid=true");
    await f.run("processArchiving()");
    assert.equal(f.counts().requests, 4);
    assert.equal(f.run("state.submittedHTTPTotal"), 3);
    for (let i = 3; i < 8; i++) assert(f.db[`lsdata-dump-${i}`]);
});

test("higher-priority scheduler work runs after the bounded batch", async () => {
    const f = fixture({
        count: 8,
        onFetch(c) {
            vm.runInContext("synchronousClosuresB.push(['stash',()=>{}])", c);
        },
    });
    await f.run("processArchiving()");
    assert.equal(f.counts().requests, 4);
    assert.equal(f.run("reqresQueue.length"), 4);
    assert.equal(f.counts().live, 0);
});

test("failure permutations conserve every capture and keep local counters consistent", async () => {
    for (let seed = 0; seed < 32; seed++) {
        let failedSet = false;
        const f = fixture({
            count: 8,
            concurrency: 1 + (seed % 4),
            httpFailure: seed % 2 === 0 ? seed % 8 : undefined,
            networkFailure: seed % 5 === 0 ? (seed + 1) % 8 : undefined,
            failRemove: seed % 3 === 0,
            latency: (id) => (seed * 17 + id * 7) % 4,
            beforeSet() {
                if (seed % 7 === 0 && !failedSet) {
                    failedSet = true;
                    throw Error("injected metadata-write failure");
                }
            },
        });
        await f.run("processArchiving()");
        const discovered = await f.run(`(async()=>{
            const ids=[];
            await forEachInStorage('stash',l=>{ids.push(l.dumpId);return true;});
            return ids;
        })()`);
        for (let id = 0; id < 8; id++) {
            assert(
                f.acknowledged.has(id) || (f.db[`lsdata-dump-${id}`] && discovered.includes(id)),
                `seed ${seed}: capture ${id} unavailable locally and remotely`,
            );
        }
        const localCount = Object.keys(f.db).filter((k) => k.startsWith("lsdata-stash-")).length;
        assert.equal(f.run("state.stashedLS.number"), localCount, `seed ${seed}: stash counter`);
        assert.equal(f.counts().live, 0, `seed ${seed}: outstanding upload`);
    }
});

test("local storage transaction reads its writes and allocates distinct slots in a batch", async () => {
    const f = fixture();
    await f.run(`lslotTransaction(browser.storage.local,'readwrite',['save'],async(t,store)=>{
        let a=await store.put({test:1});let b=await store.put({test:2});
        if(a===b)throw Error('slot collision');
        if((await store.get(a)).test!==1)throw Error('read-own-write failed');
        await store.delete(a);await store.delete(b);
    })`);
    assert.equal(f.db["lsmeta-save"].first, 2);
    assert.equal(f.db["lsmeta-save"].next, 2);
});
