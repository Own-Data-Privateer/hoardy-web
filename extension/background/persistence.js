/*
 * Copyright (c) 2023-2025 Jan Malakhovski <oxij@oxij.org>
 *
 * This file is a part of `hoardy-web` project.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

/*
 * Persisting reqres in various ways.
 */

"use strict";

// Recording of encountered issues.

// archivables that failed to be processed in some way
// `Map` indexed by error message
function newReqresErroredIssueAcc() {
    return newIssueAcc((recoverable) => {
        gotNewErrored = true;
    });
}
let reqresErroredIssueAcc = newReqresErroredIssueAcc();

// archivables that failed to by stashed to browser's local storage
// `Map` indexed by error message
function newReqresUnstashedIssueAcc() {
    return newIssueAcc((recoverable) => {
        gotNewSyncedOrNot = true;
    });
}
let reqresUnstashedIssueAcc = newReqresUnstashedIssueAcc();

// archivables that failed to be archived with at least one configured archiving method
// `Map` indexed by storeID, then by error message
function newReqresUnarchivedIssueAcc() {
    return newIssueAcc((recoverable) => {
        gotNewArchivedOrNot = true;
        wantArchiveDoneNotify = true;
        if (recoverable)
            wantRetryAllUnarchived = true;
    });
}
let reqresUnarchivedIssueAcc = newReqresUnarchivedIssueAcc();

function markAsErrored(err, archivable) {
    pushToIssueAcc(reqresErroredIssueAcc, errorMessageOf(err), false, archivable);
}

function recordOneUnarchived(accumulator, storeID, reason, recoverable, archivable) {
    let m = cacheSingleton(accumulator[1], storeID, () => new Map());
    pushToIssueAcc([accumulator[0], m], reason, recoverable, archivable);
}

function recordManyUnarchived(accumulator, storeID, reason, recoverable, archivables) {
    let byReasonMap = cacheSingleton(accumulator[1], storeID, () => new Map());
    let v = getByReasonMapRecord(byReasonMap, reason);
    pushManyToSetByReasonRecord(accumulator[0], v, recoverable, archivables);
    if (accumulator[2] !== undefined)
        accumulator[2](recoverable);
}

function recordOneAssumedBroken(accumulator, storeID, reason, archivable, dumpSize) {
    let byReasonMap = accumulator[1].get(storeID);
    if (byReasonMap === undefined)
        return false;
    let recent = Array.from(byReasonMap.entries()).filter(
        (x) => (Date.now() - x[1].when) < 1000 && x[0] != reason
    )[0];
    if (recent === undefined)
        return false;
    // we had recent errors there, fail this reqres immediately
    let recoverable = recent[1].recoverable;
    pushToIssueAcc([accumulator[0], byReasonMap], reason, recoverable, archivable);
    return true;
}

function getUnarchivedLog() {
    return pushFirstTo(reqresUnarchivedIssueAcc[0], []);
}

// Re-queueing from reqresUnarchivedIssueAcc.

function retryStoreUnarchived(accumulator, storeID, unrecoverable) {
    let byReasonMap = accumulator[1].get(storeID);
    if (byReasonMap === undefined)
        return;
    for (let [reason, unarchived] of Array.from(byReasonMap.entries())) {
        if (!unrecoverable && !unarchived.recoverable)
            continue;

        for (let archivable of unarchived.queue) {
            let had = accumulator[0].delete(archivable);
            if (!had)
                // this was queued already
                continue;

            let [loggable, dump] = archivable;
            let dumpSize = loggable.dumpSize;
            reqresQueue.push(archivable);
            reqresQueueSize += dumpSize;
        }

        byReasonMap.delete(reason);
    }
    if (byReasonMap.size === 0)
        accumulator[1].delete(storeID);
}

function retryAllUnarchived(unrecoverable) {
    wantCheckServer = true;

    if (reqresUnarchivedIssueAcc[0].size === 0)
        return;

    for (let archivable of reqresUnarchivedIssueAcc[0]) {
        let [loggable, dump] = archivable;
        let dumpSize = loggable.dumpSize;
        reqresQueue.push(archivable);
        reqresQueueSize += dumpSize;
    }
    reqresUnarchivedIssueAcc = newReqresUnarchivedIssueAcc();

    broadcastToState(null, "resetQueued", getQueuedLog);
    broadcastToState(null, "resetUnarchived", getUnarchivedLog);
}

function scheduleRetryAllUnarchived(timeout) {
    if (config.archive && reqresUnarchivedIssueAcc[0].size > 0
        // and at least one error is recoverable
        && Array.from(reqresUnarchivedIssueAcc[1].values())
                .some((byReasonMap) => Array.from(byReasonMap.values())
                .some((unarchived) => unarchived.recoverable)))
        scheduleActionEndgame(scheduledRetry, "retryAllUnarchived", timeout, () => {
            retryAllUnarchived(false);
            return null;
        });
}

// Archival with exportSaveAs.

// dumps ready for export, indexed by bucket
let reqresBundledAs = new Map();

let exportAsLastEpoch;
let exportAsLastNum = 0;

// export all reqresBundledAs as fake-"Download" with a WRR-bundle of their dumps
function bucketSaveAs(bucket, ifGEQ, bundleBuckets, unarchivedAccumulator) {
    if (bundleBuckets === undefined)
        bundleBuckets = reqresBundledAs;
    if (unarchivedAccumulator === undefined)
        unarchivedAccumulator = reqresUnarchivedIssueAcc;

    let res = bundleBuckets.get(bucket);
    if (res === undefined || res.size < ifGEQ)
        return null;

    try {
        let mime;
        let ext;
        if (res.queue.length === 1) {
            mime = "application/x-wrr";
            ext = "wrr";
        } else {
            mime = "application/x-wrr-bundle";
            ext = "wrrb";
        }

        let now = Date.now();
        let epoch = Math.floor(now / 1000);
        if (exportAsLastEpoch !== epoch)
            exportAsLastNum = 0;
        else
            exportAsLastNum += 1;
        exportAsLastEpoch = epoch;

        let dataChunks;
        if (config.gzipExportAs) {
            dataChunks = deflateChunksMaybe(res.dumps, {
                gzip: true,
                level: 9,
            }, logHandledError);
        } else
            dataChunks = res.dumps;

        let dt;
        if (config.exportAsHumanReadable)
            dt = dateToString(now).replaceAll(":", "-").replaceAll(" ", "_");
        else
            dt = epoch;

        saveAs(dataChunks, mime, `Hoardy-Web-export-${bucket}-${dt}_${exportAsLastNum}.${ext}`);

        globals.exportedAsTotal += res.queue.length;
        globals.exportedAsSize += res.size;

        return true;
    } catch (err) {
        // Yes, it will first save it marked with `archivedViaExportAs`, in
        // `processArchiving`, and then un-mark it here, and then stash it in
        // `scheduleBucketSaveAs`. This is by design, since, ideally, this this
        // `catch` would never be run.
        for (let loggable of res.queue) {
            loggable.archived &= ~archivedViaExportAs;
            loggable.dirty = true;
        }
        recordManyUnarchived(unarchivedAccumulator, "exportAs", errorMessageOf(err), false, res.queue);

        return false;
    } finally {
        bundleBuckets.delete(bucket);
    }
}

// Schedule bucketSaveAs for given buckets.
function scheduleBucketSaveAs(timeout, bucketOrNull) {
    if (reqresBundledAs.size === 0)
        return;

    let buckets;
    if (bucketOrNull === null)
        buckets = Array.from(reqresBundledAs.keys());
    else
        buckets = [ bucketOrNull ];

    for (let bucket of buckets)
        scheduleActionEndgame(scheduledDelayed, `exportAs-${bucket}`, timeout, () => {
            let res = bucketSaveAs(bucket, 0);
            if (res === false)
                runSynchronously("stash", async () => {
                    await stashMany(reqresUnarchivedIssueAcc[0]);
                });
        });
    // NB: This is slightly fragile, consider the following sequence of
    // events for a given archivable:
    //
    //   exportAsOne -> submitHTTPOne -> saveOne
    //   -> ... -> scheduledEndgame -> scheduleBucketSaveAs -> bucketSaveAs, which fails
    //   and does recordManyUnarchived -> evalSynchronousClosures -> stashMany
    //
    // Also note that it will work properly only if the above
    // `runSynchronously` is run after `processArchiving` for the same
    // archivables. (The code is written to always make this true.)
    //
    // Now consider this:
    //
    //   exportAsOne -> submitHTTPOne -> (no saveOne)
    //   -> syncWithStorage(archivable, 0, ...)
    //   -> ... -> scheduleEndgame -> scheduleBucketSaveAs -> bucketSaveAs, which fails
    //   and does recordManyUnarchived -> evalSynchronousClosures -> stashMany
    //
    // Which will only work if that `syncWithStorage` does not elide the
    // dump from memory, which it does not, see (notEliding).

    // NB: needs scheduleUpdateDisplay after
}

async function exportAsOne(archivable, bundleBuckets, unarchivedAccumulator) {
    if (bundleBuckets === undefined)
        bundleBuckets = reqresBundledAs;

    let [loggable, dump] = archivable;
    let dumpSize = loggable.dumpSize;

    if (isArchivedVia(loggable, archivedViaExportAs))
        return null;

    // load the dump
    dump = await loadDumpFromStorage(archivable, true, false);

    let bucket = loggable.bucket;
    let maxSize = config.exportAsBundle ? config.exportAsMaxSize * MEGABYTE : 0;

    // export if this dump will not fit
    let res1 = bucketSaveAs(bucket, maxSize - dumpSize, bundleBuckets, unarchivedAccumulator);
    if (res1 === false)
        return false;

    // record it in the bundle
    let u = cacheSingleton(bundleBuckets, bucket, () => { return {
        queue: [],
        dumps: [],
        size: 0,
    }; });
    u.queue.push(archivable);
    u.dumps.push(dump);
    u.size += dumpSize;

    // remember this being done
    loggable.archived |= archivedViaExportAs;
    loggable.dirty = true;

    // try exporting again
    let res2 = bucketSaveAs(bucket, maxSize, bundleBuckets, unarchivedAccumulator);
    if (res2 === false)
        return false;

    return true;
}

// Archival via submission to an HTTP archiving server.

async function submitHTTPOne(archivable, unarchivedAccumulator) {
    if (unarchivedAccumulator === undefined)
        unarchivedAccumulator = reqresUnarchivedIssueAcc;

    let [loggable, dump] = archivable;
    let dumpSize = loggable.dumpSize;

    if (isArchivedVia(loggable, archivedViaSubmitHTTP))
        return null;

    function broken(storeID, reason, recoverable) {
        logHandledError(reason);
        recordOneUnarchived(unarchivedAccumulator, storeID, reason, recoverable, archivable);
    }

    if (!serverConfig.alive) {
        broken(config.submitHTTPURLBase, "this archiving server is unavailable", true);
        return false;
    } else if (!serverConfig.canDump) {
        broken(config.submitHTTPURLBase, "this archiving server does not support archiving", false);
        return false;
    }

    let serverURL = new URL(serverConfig.baseURL);
    serverURL.pathname = serverConfig.info.dump_wrr;
    serverURL.search = "profile=" + encodeURIComponent(loggable.bucket || config.root.bucket);
    let storeID = serverURL.href;

    if (recordOneAssumedBroken(unarchivedAccumulator, storeID, "this archiving server appears to be defunct", archivable, dumpSize))
        return false;

    if (config.debugPersisence)
        console.info("PERSISTENCE: HTTP: submitting", loggable);

    dump = await loadDumpFromStorage(archivable, true, false);

    let response;
    try {
        response = await fetch(storeID, {
            method: "POST",
            headers: {
                "Content-Type": "application/cbor",
                "Content-Length": dump.byteLength.toString(),
            },
            body: dump,
        });
    } catch (err) {
        // NB: breaking the whole server here, not just `storeID`
        broken(config.submitHTTPURLBase, `\`Hoardy-Web\` can't establish a connection to the archiving server: ${errorMessageOf(err)}`, true);
        serverConfig.alive = false;
        return false;
    }

    let responseText = await response.text();

    if (response.status !== 200) {
        broken(storeID, `request to the archiving server failed with ${response.status} ${response.statusText}: ${responseText}`, false);
        return false;
    }

    retryStoreUnarchived(unarchivedAccumulator, storeID, true);
    globals.submittedHTTPTotal += 1;
    globals.submittedHTTPSize += loggable.dumpSize;
    loggable.archived |= archivedViaSubmitHTTP;
    loggable.dirty = true;

    return true;
}

// Stashing and saving to local storage.

let reqresIDB; // will be set in `main`

// for debugging
async function dumpLS() {
    await lslotDump();

    if (reqresIDB !== undefined)
        await idbDump(reqresIDB);
}

async function loadDumpFromStorage(archivable, unelide, allowNull) {
    let [loggable, dump] = archivable;

    let dumpId = loggable.dumpId;
    if (dump === null && dumpId !== undefined) {
        if (loggable.inLS) {
            let res = await storageGetOne(browser.storage.local, lslotDataIdOf("dump", dumpId));
            dump = res.dump;
        } else if (reqresIDB !== undefined)
            dump = await idbTransaction(reqresIDB, "readonly", ["dump"], async (transaction, dumpStore) => {
                let res = await dumpStore.get(dumpId);
                return res.dump;
            });
        else
            throw new Error("IndexedDB is not available");

        if (dump === undefined)
            throw new Error("reqres dump is missing");

        dump = inflateMaybe(dump, undefined, logHandledError);
    }

    if (dump === null) {
        if (allowNull)
            return dump;

        throw new Error("reqres dump is null");
    }

    if (!(dump instanceof Uint8Array)) {
        console.error("reqres dump is not Uint8Array", dump);
        throw new Error("reqres dump is not Uint8Array");
    }

    if (unelide)
        // remember it
        archivable[1] = dump;

    return dump;
}

function mkIDBTransaction (func) {
    return idbTransaction(reqresIDB, "readwrite", ["dump", "stash", "save"], func);
}

function mkLSlotTransaction (func) {
    return lslotTransaction(browser.storage.local, "readwrite", ["dump", "stash", "save"], func);
}

function selectTSS(inLS) {
    let mkTransaction;
    let stashStats;
    let savedStats;
    if (inLS)
        return [mkLSlotTransaction, globals.stashedLS, globals.savedLS];
    else
        return [mkIDBTransaction, globals.stashedIDB, globals.savedIDB];
}

async function wipeFromStorage(tss, dumpSize, dumpId, stashId, saveId) {
    let [mkTransaction, stashStats, savedStats] = tss;

    await mkTransaction(async (transaction, dumpStore, stashStore, saveStore) => {
        if (dumpId !== undefined)
            await dumpStore.delete(dumpId);
        if (stashId !== undefined)
            await stashStore.delete(stashId);
        if (saveId !== undefined)
            await saveStore.delete(saveId);
    });

    if (stashId !== undefined) {
        stashStats.number -= 1;
        stashStats.size -= dumpSize;
        wantSaveGlobals = true;
    }
    if (saveId !== undefined) {
        savedStats.number -= 1;
        savedStats.size -= dumpSize;
        wantSaveGlobals = true;
    }
}

async function writeToStorage(tss, state, clean, dump, dumpSize, dumpId, stashId, saveId) {
    let [mkTransaction, stashStats, savedStats] = tss;

    await mkTransaction(async (transaction, dumpStore, stashStore, saveStore) => {
        if (dumpId === undefined && dump !== null) {
            if (config.gzipLSDumps)
                dump = deflateMaybe(dump, {
                    gzip: true,
                    level: 9,
                }, logHandledError);
            clean.dumpId = await dumpStore.put({ dump });
        } else if (dumpId !== undefined)
            // reuse the old one
            clean.dumpId = dumpId;

        if (state === 1) {
            clean.stashId = await stashStore.put(clean, stashId);
            if (saveId !== undefined)
                await saveStore.delete(saveId);
        } else if (state === 2) {
            clean.saveId = await saveStore.put(clean, saveId);
            if (stashId !== undefined)
                await stashStore.delete(stashId);
        }
    });

    if (stashId === undefined && clean.stashId !== undefined) {
        stashStats.number += 1;
        stashStats.size += dumpSize;
        wantSaveGlobals = true;
    } else if (stashId !== undefined && clean.stashId === undefined) {
        stashStats.number -= 1;
        stashStats.size -= dumpSize;
        wantSaveGlobals = true;
    }
    if (saveId === undefined && clean.saveId !== undefined) {
        savedStats.number += 1;
        savedStats.size += dumpSize;
        wantSaveGlobals = true;
    } else if (saveId !== undefined && clean.saveId === undefined) {
        savedStats.number -= 1;
        savedStats.size -= dumpSize;
        wantSaveGlobals = true;
    }
}

async function syncWithStorage(archivable, state, elide) {
    let [loggable, dump] = archivable;
    let dumpSize = loggable.dumpSize;

    // Is it in `storage.local` (`true`), in `indexedDB` (`false`), or neither (`undefined`)?
    let inLS = loggable.inLS;
    // Current values.
    let dirty = loggable.dirty === true;
    let dumpId = loggable.dumpId;
    let stashId = loggable.stashId;
    let saveId = loggable.saveId;

    // Do we want it to be stored in `storage.local`?
    let wantInLS = !config.preferIndexedDB || reqresIDB === undefined;

    // Do we even have anything to do?
    if (state === 0 && dumpId === undefined && stashId === undefined && saveId === undefined)
        return null;
    else if ((dumpId !== undefined || dump === null)
             && (
              (state === 1 && stashId !== undefined && saveId === undefined)
           || (state === 2 && stashId === undefined && saveId !== undefined)
             )
             && inLS === wantInLS
             && !dirty)
        return null;

    function scrub(what) {
        delete what["dirty"];
        delete what["inLS"];
        delete what["dumpId"];
        delete what["stashId"];
        delete what["saveId"];
        // NB: but keeping "dumpSize"
    }

    if (state === 0) {
        // delete from the current store
        await wipeFromStorage(selectTSS(inLS !== false), dumpSize, dumpId, stashId, saveId);
        scrub(loggable);
    } else {
        // make a pristine copy that will be saved into local storage
        let clean = assignRec({}, loggable);
        scrub(clean);
        delete clean["status"];
        // for future-proofing
        clean.version = 1;

        if (inLS === undefined || inLS === wantInLS)
            // first write ever, or overwrite to the same store
            await writeToStorage(selectTSS(wantInLS), state, clean, dump, dumpSize, dumpId, stashId, saveId);
        else {
            // we are moving the data from one store to the other
            dump = await loadDumpFromStorage(archivable, true, true);
            await writeToStorage(selectTSS(wantInLS), state, clean, dump, dumpSize);
            await wipeFromStorage(selectTSS(inLS), dumpSize, dumpId, stashId, saveId);
        }

        // update in-memory version
        scrub(loggable);
        loggable.inLS = wantInLS;
        loggable.dumpId = clean.dumpId;
        loggable.stashId = clean.stashId;
        loggable.saveId = clean.saveId;
    }

    if (elide)
        // free memory
        archivable[1] = null;

    if (config.debugPersisence)
        console.info("PERSISTENCE:",
                     state === 0 ? "DELETED" : (state === 1 ? "STASHED" : "SAVED"),
                     "elide", elide,
                     "ids", dumpId, stashId, saveId,
                     "loggable", loggable);

    return true;
}

async function forEachInStorage(storeName, func, limit) {
    if (limit === undefined)
        limit = null;

    let storeStatsLS = assignRec({}, dbstatsDefaults);
    let storeStatsIDB = assignRec({}, dbstatsDefaults);
    let sn = storeName + "Id";
    let loaded = 0;

    function loopBody(loggable, side, key, storeStats) {
        try {
            loggable.inLS = side;
            loggable[sn] = key;

            let dumpSize = loggable.dumpSize;
            storeStats.number += 1;
            storeStats.size += dumpSize;

            return func(loggable);
        } catch (err) {
            if (err instanceof StopIteration)
                throw err;

            logHandledError(err);
            markAsErrored(err, [loggable, null]);
            return false;
        }
    }

    await lslotTransaction(browser.storage.local, "readonly", [storeName], async (transaction, store) => {
        try {
            await store.forEach(async (loggable, slot) => {
                if (limit !== null && loaded >= limit)
                    throw new StopIteration();

                if (loopBody(loggable, true, slot, storeStatsLS))
                    loaded += 1;
            });
        } catch (err) {
            if (!(err instanceof StopIteration))
                throw err;
        }
    });

    if (limit !== null && loaded >= limit)
        return [undefined, undefined];

    if (reqresIDB === undefined)
        return [storeStatsLS, undefined];

    await idbTransaction(reqresIDB, "readonly", ["dump", storeName], async (transaction, dumpStore, store) => {
        let allKeys = await store.getAllKeys();
        try {
            for (let key of allKeys) {
                if (limit !== null && loaded >= limit)
                    throw new StopIteration();

                let loggable = await store.get(key);
                if (loopBody(loggable, false, key, storeStatsIDB))
                    loaded += 1;
            }
        } catch (err) {
            if (!(err instanceof StopIteration))
                throw err;
        }
    });

    if (limit !== null && loaded >= limit)
        return [storeStatsLS, undefined];

    return [storeStatsLS, storeStatsIDB];
}

// Saving
async function stashOne(archivable, unstashedAccumulator) {
    if (unstashedAccumulator === undefined)
        unstashedAccumulator = reqresUnstashedIssueAcc;

    try {
        let [loggable, dump] = archivable;
        updateLoggable(loggable);
    } catch (err) {
        logHandledError(err);
        markAsErrored(err, archivable);
    }

    try {
        await syncWithStorage(archivable, 1, true);
    } catch (err) {
        logHandledError(err);
        pushToIssueAcc(unstashedAccumulator, errorMessageOf(err), false, archivable);
    }

    gotNewSyncedOrNot = true;
}

async function stashMany(archivables, unstashedAccumulator) {
    for (let archivable of archivables)
        await stashOne(archivable, unstashedAccumulator);
}

async function retryAllUnstashed() {
    let newUnstashed = newReqresUnstashedIssueAcc();
    for (let archivable of reqresUnstashedIssueAcc[0])
        await stashOne(archivable, newUnstashed);
    reqresUnstashedIssueAcc = newUnstashed;
}

async function stashAll(alsoLimbo) {
    await retryAllUnstashed();
    await stashMany(reqresQueue);
    if (alsoLimbo)
        await stashMany(reqresLimbo);
    await stashMany(reqresUnarchivedIssueAcc[0]);
}

async function unstashOne(archivable) {
    try {
        await syncWithStorage(archivable, 0, false);
    } catch (err) {
        logHandledError(err);
        markAsErrored(err, archivable);
    }
}

async function unstashMany(archivables) {
    for (let archivable of archivables)
        unstashOne(archivable);
}


async function saveOne(archivable, unarchivedAccumulator) {
    if (unarchivedAccumulator === undefined)
        unarchivedAccumulator = reqresUnarchivedIssueAcc;

    let [loggable, dump] = archivable;
    let dumpSize = loggable.dumpSize;

    if (recordOneAssumedBroken(unarchivedAccumulator, "localStorage", "this archiving method appears to be defunct", archivable, dumpSize))
        return false;

    let res;
    try {
        res = await syncWithStorage(archivable, 2, true);
    } catch (err) {
        logHandledError(err);
        recordOneUnarchived(unarchivedAccumulator, "localStorage", errorMessageOf(err), false, archivable);
        return false;
    }

    return res;
}

// Loading

function loadOneStashed(loggable) {
    deserializeLoggable(loggable);

    let info = getOriginState(loggable.tabId, loggable.fromExtension);
    let dumpId = loggable.dumpId;
    let dumpSize = loggable.dumpSize;

    let archivable = [loggable, null];

    if (loggable.problematic) {
        reqresProblematic.push(archivable);
        info.problematicTotal += 1;
        gotNewProblematic = true;
    }

    if (loggable.in_limbo || loggable.collected) {
        if (dumpId === undefined)
            throw new Error("dumpId is not specified");

        if (loggable.in_limbo) {
            reqresLimbo.push(archivable);
            reqresLimboSize += dumpSize;
            if (loggable.sessionId === sessionId) {
                info.inLimboTotal += 1;
                info.inLimboSize += dumpSize;
            }
            gotNewLimbo = true;
        } else if (loggable.collected) {
            reqresQueue.push(archivable);
            reqresQueueSize += dumpSize;
            gotNewQueued = true;
        }
    } else
        throw new Error("unknown reqres state");

    return true;
}

async function loadStashed() {
    let [newStashedLS, newStashedIDB] = await forEachInStorage("stash", loadOneStashed);

    // recover from wrong counts
    if (newStashedLS !== undefined && !equalRec(globals.stashedLS, newStashedLS)) {
        globals.stashedLS = newStashedLS;
        wantSaveGlobals = true;
    }
    if (newStashedIDB !== undefined && !equalRec(globals.stashedIDB, newStashedIDB)) {
        globals.stashedIDB = newStashedIDB;
        wantSaveGlobals = true;
    }
}

async function loadSaved(rrfilter, wantStop) {
    let res = [];
    let [newSavedLS, newSavedIDB] = await forEachInStorage("save", (loggable) => {
        if (wantStop !== undefined && wantStop())
            throw new StopIteration();
        deserializeLoggable(loggable);
        if (!isAcceptedLoggable(null, rrfilter, loggable))
            return false;
        res.push(loggable);
        return true;
    }, rrfilter !== undefined && rrfilter !== null ? rrfilter.limit : null);

    // recover from wrong counts
    if (newSavedLS !== undefined && !equalRec(globals.savedLS, newSavedLS)) {
        globals.savedLS = newSavedLS;
        wantSaveGlobals = true;
    }
    if (newSavedIDB !== undefined && !equalRec(globals.savedIDB, newSavedIDB)) {
        globals.savedIDB = newSavedIDB;
        wantSaveGlobals = true;
    }

    return res;
}

// The main thing.

function syncDeleteAllErrored() {
    runSynchronouslyWhen(reqresErroredIssueAcc[0].size > 0, "deleteAllErrored", async () => {
        await unstashMany(reqresErroredIssueAcc[0]);
        reqresErroredIssueAcc = newReqresErroredIssueAcc();
    });
}

function syncRetryAllUnstashed() {
    runSynchronouslyWhen(reqresUnstashedIssueAcc[0].size > 0, "retryAllUnstashed", retryAllUnstashed);
}

function syncStashAll(alsoLimbo) {
    runSynchronously("stash", stashAll, alsoLimbo);
}

function loadAndBroadcastSaved(rrfilter) {
    return async (wantStop) => {
        try {
            let log = await loadSaved(rrfilter, wantStop);
            broadcastToSaved("resetSaved", log);
        } catch (err) {
            if (!(err instanceof StopIteration))
                throw err;
        }
    };
}

function requeueSaved(reset) {
    runSynchronously("requeueSaved", async () => {
        broadcastToSaved("resetSaved", [null]); // invalidate UI

        let log = await loadSaved(savedFilters);
        for (let loggable of log) {
            if (reset)
                loggable.archived = 0;

            let archivable = [loggable, null];

            // yes, this is inefficient, but without this, calling this
            // function twice in rapid succession can produce weird results
            try {
                await syncWithStorage(archivable, 1, false);
            } catch(err) {
                logError(err);
                continue;
            }

            reqresQueue.push(archivable);
            reqresQueueSize += loggable.dumpSize;
        }
    });
    wantBroadcastSaved = true;
    scheduleEndgame(null);
}

function deleteSaved() {
    runSynchronously("deleteSaved", async () => {
        broadcastToSaved("resetSaved", [null]); // invalidate UI

        let log = await loadSaved(savedFilters);
        for (let loggable of log) {
            let archivable = [loggable, null];

            try {
                await syncWithStorage(archivable, 0, false);
            } catch(err) {
                logError(err);
                continue;
            }
        }
    });
    wantBroadcastSaved = true;
    scheduleEndgame(null);
}

async function processArchiving(updatedTabId) {
    while (config.archive && reqresQueue.length > 0) {
        let archivable = reqresQueue.shift();
        let [loggable, dump] = archivable;
        let dumpSize = loggable.dumpSize;
        reqresQueueSize -= dumpSize;

        if (config.discardAll) {
            await unstashOne(archivable);
            continue;
        }

        try {
            updateLoggable(loggable);

            let allOK = true;

            // NB: below, `res === null` means "no action was taken"

            if (config.archiveExportAs) {
                let res = await exportAsOne(archivable);
                allOK &&= res !== false;
                if (res === true)
                    wantBucketSaveAs = true;
            }

            if (config.archiveSubmitHTTP) {
                let res = await submitHTTPOne(archivable);
                allOK &&= res !== false;
            }

            // other archival methods go here

            if (!allOK)
                // it's in reqresUnarchivedIssueAcc now
                // try stashing it without recording failures
                await syncWithStorage(archivable, 1, true).catch(logError);
            else if (config.archiveSaveLS) {
                let res = await saveOne(archivable);
                if (res !== false)
                    // Prevent future calls to `retryAllUnstashed` from un-saving this
                    // archivable, which can happen with, e.g., the following sequence of
                    // events:
                    //   finished -> in_limbo -> stashMany -> out of disk space ->
                    //   the user fixes it -> popInLimbo ->
                    //   queued -> saveOne -> syncRetryAllUnstashed
                    reqresUnstashedIssueAcc[0].delete(archivable);
                if (res === true)
                    wantBroadcastSaved = true;
            }
            else
                // (notEliding)
                await syncWithStorage(archivable, 0, false);
        } catch (err) {
            logHandledError(err);
            markAsErrored(err, archivable);
            // try stashing without recording failures
            await syncWithStorage(archivable, 1, true).catch(logError);
        }

        gotNewArchivedOrNot = true;

        let tabId = loggable.tabId;
        updatedTabId = mergeUpdatedTabIds(updatedTabId, tabId);
        scheduleUpdateDisplay(true, tabId, false, getGoodEpisodic(reqresQueue.length));
    }

    broadcastToState(null, "resetQueued", getQueuedLog);
    broadcastToState(null, "resetUnarchived", getUnarchivedLog);

    return updatedTabId;
}
