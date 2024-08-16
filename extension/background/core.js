/*
 * The core code of pWebArc.
 *
 * Contains HTTP request+response capture via browser's WebRequest API and
 * some middle-ware APIs used by the UI parts of pWebArc.
 *
 * Copyright (c) 2023-2024 Jan Malakhovski <oxij@oxij.org>
 *
 * This file is a part of pwebarc project.
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

"use strict";

// NB: "reqres" means "request + response"

let updateAvailable = false;

function handleUpdateAvailable(details) {
    updateAvailable = true;
}

let sessionId = Date.now();

// default config
let configVersion = 5;
let configDefaults = {
    version: configVersion,

    // debugging options
    ephemeral: false, // stop the config from being saved to disk
    debugging: false, // verbose debugging logs
    dumping: false, // dump dumps to console
    snapshotAny: false, // snapshot isBoringURL
    discardAll: false,

    // UI
    lastSeenVersion: manifest.version,
    seenChangelog: true,
    seenHelp: false,
    colorblind: false,
    pureText: false,

    // log settings
    history: 1024,

    // are we collecting new data?
    collecting: true,

    // prefer `IndexedDB` to `storage.local` for stashing and saving?
    preferIndexedDB: useDebugger,
    // GZip dumps written to local storage
    gzipLSDumps: true,

    // should we stash unarchived reqres to local storage?
    stash: true,

    // are we archiving? or temporarily paused
    archive: true,

    // archive how?

    // export via exportAs
    archiveExportAs: false,
    exportAsHumanReadable: true,
    exportAsMaxSize: 64,
    exportAsTimeout: 3,
    exportAsInFlightTimeout: 60,
    gzipExportAs: true,

    // via HTTP
    archiveSubmitHTTP: false,
    submitHTTPURLBase: "http://127.0.0.1:3210/pwebarc/dump",

    // to local storage
    archiveSaveLS: true,

    // archiving notifications
    archiveDoneNotify: true,
    archiveFailedNotify: true,
    archiveStuckNotify: true,

    // problematic options
    markProblematicPartialRequest: false,
    markProblematicCanceled: false,
    markProblematicNoResponse: true,
    markProblematicIncomplete: true,
    markProblematicIncompleteFC: false,
    markProblematicTransientCodes: true,
    markProblematicPermanentCodes: false,
    markProblematicWithImportantErrors: true,
    markProblematicPickedWithErrors: true,
    markProblematicDroppedWithErrors: false,
    problematicNotify: true,
    problematicNotifyNumber: 3,

    // collection options
    archivePartialRequest: true,
    archiveCanceled: false,
    archiveNoResponse: false,
    archiveIncompleteResponse: false,
    archive1xxCodes: true,
    archive3xxCodes: true,
    archiveTransientCodes: true,
    archivePermanentCodes: true,
    archiveWithErrors: true,

    // limbo options
    limboMaxNumber: 1024,
    limboMaxSize: 128,
    limboNotify: true,

    // automatic actions
    autoUnmarkProblematic: false,
    autoPopInLimboCollect: false,
    autoPopInLimboDiscard: false,
    autoTimeout: 1,
    autoNotify: true,

    // Firefox workarounds
    workaroundFirefoxFirstRequest: true,

    // Chromium workarounds
    workaroundChromiumResetRootTab: true,
    workaroundChromiumResetRootTabURL: "about:blank",
    workaroundChromiumDebugTimeout: 3,

    root: {
        collecting: true,
        limbo: false,
        negLimbo: false,
        stashLimbo: true,
        bucket: "default",
    },

    extension: {
        collecting: false,
        limbo: false,
        negLimbo: false,
        stashLimbo: true,
        bucket: "extension",
    },

    background: {
        collecting: true,
        limbo: false,
        negLimbo: false,
        stashLimbo: true,
        bucket: "background",
    },
};
// current config
let config = assignRec({}, configDefaults);
// last config saved in storage
let savedConfig = undefined;

async function saveConfig() {
    if (equalRec(savedConfig, config))
        return;
    savedConfig = assignRec({}, config);
    console.log("saving config", savedConfig);
    await browser.storage.local.set({ config: savedConfig }).catch(logError);
}

function scheduleSaveConfig() {
    resetSingletonTimeout(scheduledSaveState, "saveConfig", 1000, async () => {
        await saveConfig();
        await updateDisplay(true);
    });
    // NB: needs updateDisplay afterwards
}

// scheduled internal functions
let scheduledInternal = new Map();
// scheduled cancelable functions
let scheduledCancelable = new Map();
// scheduled save state functions
let scheduledSaveState = new Map();
// scheduled functions hidden from the UI
let scheduledHidden = new Map();

function runAllActions() {
    runSynchronously(async () => {
        await popAllSingletonTimeouts(scheduledCancelable, true);
        await popAllSingletonTimeouts(scheduledInternal, true);
        await popAllSingletonTimeouts(scheduledSaveState, true);
    });
    scheduleEndgame(null);
}

function cancelAllActions() {
    runSynchronously(async () => {
        await popAllSingletonTimeouts(scheduledCancelable, false);
    });
    scheduleEndgame(null);
}

async function sleepResetTab(tabId, priority, resetFunc, preFunc, actionFunc) {
    resetSingletonTimeout(scheduledInternal, `resetTab#${tabId}`, 100, async () => {
        let r;
        if (resetFunc !== undefined)
            r = await resetFunc(tabId);
        resetSingletonTimeout(scheduledInternal, `reloadTab#${tabId}`, 300, async () => {
            try {
                if (preFunc !== undefined)
                    await preFunc(tabId);
                if (actionFunc !== undefined)
                    await actionFunc(tabId, r);
            } finally {
                await updateDisplay(true, tabId);
            }
        }, priority);
    }, priority);
    await updateDisplay(true, tabId);
}

function resetAndNavigateTab(tabId, url, priority) {
    return sleepResetTab(tabId, priority,
                         blankTab, undefined,
                         (tabId) => navigateTabTo(tabId, url));
}

function resetAttachDebuggerAndNavigateTab(tabId, url, priority) {
    return sleepResetTab(tabId, priority,
                         blankTab, attachDebugger,
                         (tabId) => navigateTabTo(tabId, url));
}

function resetAttachDebuggerAndReloadTab(tabId, priority) {
    return sleepResetTab(tabId, priority,
                         captureURLThenBlankTab, attachDebugger,
                         navigateTabTo);
}

function attachDebuggerAndReloadTab(tabId, priority) {
    return sleepResetTab(tabId, priority,
                         undefined, attachDebugger,
                         browser.tabs.reload);
}

// per-tab config
let tabConfig = new Map();
let openTabs = new Set();
let negateConfigFor = new Set();
let negateOpenerTabIds = [];

function prefillChildren(data) {
    return assignRec({
        children: assignRec({}, data),
    }, data);
}

function getOriginConfig(tabId, fromExtension) {
    if (fromExtension)
        return prefillChildren(config.extension);
    else if (tabId == -1)
        return prefillChildren(config.background);
    else if (tabId === null)
        return prefillChildren(config.root);
    else
        return cacheSingleton(tabConfig, tabId, () => prefillChildren(config.root));
}

function setOriginConfig(tabId, fromExtension, tabcfg) {
    function clean() {
        let d = assignRec({}, tabcfg);
        delete d["children"];
        return d;
    }

    if (fromExtension) {
        config.extension = clean();
        broadcast(["updateConfig", config]);
    } else if (tabId == -1) {
        // background process
        config.background = clean();
        broadcast(["updateConfig", config]);
    } else if (tabId === null) {
        config.root = clean();
        broadcast(["updateConfig", config]);
    } else {
        tabConfig.set(tabId, tabcfg);
        broadcast(["updateOriginConfig", tabId, tabcfg]);

        if (useDebugger) {
            // Chromium does not provide `browser.menus.onShown` event
            updateMenu(tabcfg);
            syncDebuggersState();
        }
    }

    scheduleUpdateDisplay(false, null);
}

function processNewTab(tabId, openerTabId) {
    openTabs.add(tabId);

    if (useDebugger && openerTabId === undefined && negateOpenerTabIds.length > 0)
        // On Chromium, `browser.tabs.create` with `openerTabId` specified
        // does not pass it into `openerTabId` of `handleTabCreated` (it's a
        // bug), so we have to work around it by using `negateOpenerTabIds`
        // variable.
        openerTabId = negateOpenerTabIds.shift();

    let openercfg = getOriginConfig(openerTabId !== undefined ? openerTabId : null);

    let children = openercfg.children;
    if (openerTabId !== undefined && negateConfigFor.delete(openerTabId)) {
        // Negate children.collecting when `openerTabId` is in `negateConfigFor`.
        children = assignRec({}, openercfg.children);
        children.collecting = !children.collecting;
    }

    let tabcfg = prefillChildren(children);
    tabConfig.set(tabId, tabcfg);

    scheduleUpdateDisplay(false, tabId);

    return tabcfg;
}

// collect all tabs referenced in not yet archived reqres
function getUsedTabs() {
    let usedTabs = new Set();
    for (let [k, v] of reqresInFlight.entries())
        usedTabs.add(v.tabId);
    for (let [k, v] of debugReqresInFlight.entries())
        usedTabs.add(v.tabId);
    for (let v of reqresFinishingUp)
        usedTabs.add(v.tabId);
    for (let v of debugReqresFinishingUp)
        usedTabs.add(v.tabId);
    for (let v of reqresAlmostDone)
        usedTabs.add(v.tabId);
    for (let [v, _x] of reqresProblematic)
        usedTabs.add(v.tabId);
    for (let [v, _x] of reqresLimbo)
        usedTabs.add(v.tabId);
    for (let [v, _x] of reqresQueue)
        usedTabs.add(v.tabId);
    for (let f of reqresErrored.values())
        for (let v of f.queue)
            usedTabs.add(v[0].tabId);
    for (let v of reqresFailedToStashByArchivable.keys())
        usedTabs.add(v[0].tabId);
    for (let v of reqresFailedToArchiveByArchivable.keys())
        usedTabs.add(v[0].tabId);

    return usedTabs;
}

// frees unused `tabConfig` and `tabState` structures, returns `true` if
// cleanup changed stats (which can happens when a deleted tab has problematic
// reqres)
function cleanupTabs() {
    let usedTabs = getUsedTabs();

    // delete configs of closed and unused tabs
    for (let tabId of Array.from(tabConfig.keys())) {
        if(tabId === -1 || openTabs.has(tabId) || usedTabs.has(tabId))
            continue;
        if (config.debugging)
            console.log("removing config of tab", tabId);
        tabConfig.delete(tabId);
        tabState.delete(tabId);
    }

    // delete any stale leftovers from tabState
    for (let tabId of Array.from(tabState.keys())) {
        if(tabId === -1 || openTabs.has(tabId) || usedTabs.has(tabId))
            continue;
        console.warn("removing stale tab state", tabId);
        tabState.delete(tabId);
    }
}

function cleanupAfterTab(tabId) {
    let unprob = 0;
    let unlimbo = 0;

    if (config.autoUnmarkProblematic) {
        if (config.debugging)
            console.log("cleaning up reqresProblematic after tab", tabId);
        unprob = unmarkProblematic(null, tabId);
    }

    if (config.autoPopInLimboCollect || config.autoPopInLimboDiscard) {
        if (config.debugging)
            console.log("cleaning up reqresLimbo after tab", tabId);
        if (config.autoPopInLimboCollect)
            unlimbo = popInLimbo(true, null, tabId);
        else if (config.autoPopInLimboDiscard)
            unlimbo = popInLimbo(false, null, tabId);
    }

    if (config.autoNotify && (unprob > 0 || unlimbo > 0)) {
        let message;
        let what = config.autoPopInLimboCollect ? "collected" : "discarded";
        let icon = "problematic";
        if (unprob > 0 && unlimbo > 0)
            message = `Auto-unmarked ${unprob} problematic and auto-${what} ${unlimbo} in-limbo reqres from tab #${tabId}.`;
        else if (unprob > 0)
            message = `Auto-unmarked ${unprob} problematic reqres from tab #${tabId}.`;
        else {
            message = `Auto-${what} ${unlimbo} in-limbo reqres from tab #${tabId}.`;
            icon = "limbo";
        }

        browser.notifications.create(`cleaned-${tabId}`, {
            title: "pWebArc: AUTO",
            message,
            iconUrl: iconURL(icon, 128),
            type: "basic",
        }).catch(logError);
    }

    cleanupTabs();
    scheduleUpdateDisplay(true, tabId);
}

function scheduleCleanupAfterTab(tabId, untimeout) {
    let tabstats = getTabStats(tabId);
    if (config.autoUnmarkProblematic && tabstats.problematic > 0
       || (config.autoPopInLimboCollect || config.autoPopInLimboDiscard) && tabstats.in_limbo > 0) {
        resetSingletonTimeout(scheduledCancelable, `cleanupAfterTab#${tabId}`, config.autoTimeout * 1000 - untimeout, () => cleanupAfterTab(tabId));
    }
}

function processRemoveTab(tabId) {
    openTabs.delete(tabId);

    if (useDebugger && Array.from(debugReqresInFlight.values()).some((r) => r.tabId === tabId)) {
        // after a small timeout, force emit all `debugReqresInFlight` of this
        // tab, since Chromium won't send any new debug events for them anyway
        let timeout = config.workaroundChromiumDebugTimeout * 1000;
        resetSingletonTimeout(scheduledInternal, `forceStopDebugTab#${tabId}`, timeout, () => {
            if (config.debugging)
                console.log("cleaning up debugReqresInFlight after tab", tabId);
            emitTabInFlightDebug(tabId, "pWebArc::EMIT_FORCED_BY_CLOSED_TAB");
            processMatchFinishingUpWebRequestDebug();
            scheduleCleanupAfterTab(tabId, timeout);
            scheduleUpdateDisplay(true, tabId);
        });
        scheduleUpdateDisplay(true);
    } else
        scheduleCleanupAfterTab(tabId, 0);
}

// session state

// reqres in-flight, indexed by requestId
let reqresInFlight = new Map();
// reqres that are "completed" by the browser, but might have an unfinished filterResponseData filter
let reqresFinishingUp = [];
// completely finished reqres
let reqresAlmostDone = [];
// problematic archivables
let reqresProblematic = [];
// archivables in limbo, waiting to be either dropped or queued
let reqresLimbo = [];
let reqresLimboSize = 0;
// request log
let reqresLog = [];
// archivables in the process of being archived
let reqresQueue = [];
let reqresQueueSize = 0;
// dumps ready for export, indexed by bucket
let reqresBundledAs = new Map();
// archivables that failed to be processed in some way, indexed by error message
let reqresErrored = new Map();
// archivables that failed to sync to indexedDB, indexed by error message
let reqresFailedToStashByError = new Map();
// same thing, but archivable as key, and `syncOne` args as values
let reqresFailedToStashByArchivable = new Map();
// archivables that failed in server submission, indexed by archiveURL, then by error message
let reqresFailedToArchiveByArchiveError = new Map();
// map `archivables -> int`, the `int` is a count of how many times each archivable appears
// in`reqresFailedToArchiveByArchiveError`
let reqresFailedToArchiveByArchivable = new Map();

function truncateLog() {
    while (reqresLog.length > config.history)
        reqresLog.shift();
}

function getInFlightLog() {
    let res = [];
    for (let v of reqresAlmostDone)
        res.push(makeLoggableReqres(v));
    for (let v of reqresFinishingUp)
        res.push(makeLoggableReqres(v));
    for (let v of debugReqresFinishingUp)
        res.push(makeLoggableReqres(v));
    for (let [k, v] of reqresInFlight.entries())
        res.push(makeLoggableReqres(v));
    for (let [k, v] of debugReqresInFlight.entries()) {
        // `.url` can be unset, see (veryEarly) in `emitDebugRequest`.
        if (v.url !== undefined && !isBoringURL(v.url))
            res.push(makeLoggableReqres(v));
    }
    return res;
}

function getLoggables(archivables, res) {
    for (let [v, _x] of archivables) {
        res.push(v);
    }
    return res;
}

function getProblematicLog() {
    return getLoggables(reqresProblematic, []);
}

function getInLimboLog() {
    return getLoggables(reqresLimbo, []);
}

function getQueuedLog() {
    return getLoggables(reqresQueue, []);
}

function getFailedLog() {
    return getLoggables(reqresFailedToArchiveByArchivable.keys(), []);
}

function getByErrorMap(archiveURL) {
    return cacheSingleton(reqresFailedToArchiveByArchiveError, archiveURL, () => new Map());
}

function getByErrorMapRecord(byErrorMap, error) {
    return cacheSingleton(byErrorMap, errorMessageOf(error), () => { return {
        recoverable: true,
        queue: [],
        size: 0,
    }; });
}

function recordByErrorTo(v, recoverable, archivable, size) {
    v.when = Date.now();
    v.recoverable = v.recoverable && recoverable;
    v.queue.push(archivable);
    v.size += size;

    let count = reqresFailedToArchiveByArchivable.get(archivable);
    if (count === undefined)
        count = 0;
    reqresFailedToArchiveByArchivable.set(archivable, count + 1);
}

function recordByError(byErrorMap, error, recoverable, archivable, size) {
    let v = getByErrorMapRecord(byErrorMap, error);
    recordByErrorTo(v, recoverable, archivable, size);
}

function markAsErrored(error, archivable) {
    let dumpSize = archivable[0].dumpSize;
    if (dumpSize === undefined)
        dumpSize = 0;
    recordByError(reqresErrored, error, false, archivable, dumpSize);
    gotNewErrored = true;
}

function forgetErrored() {
    runSynchronously(async () => {
        for (let f of reqresErrored.values())
            await syncMany(f.queue, 0, false);
        reqresErrored = new Map();
    });
    scheduleEndgame(null);
}

// persistent global stats
let persistentStatsDefaults = {
    // problematicTotal is reqresProblematic.length
    // total numbers of picked and dropped reqres
    pickedTotal: 0,
    droppedTotal: 0,
    // total numbers of collected and discarded reqres
    collectedTotal: 0,
    collectedSize: 0,
    discardedTotal: 0,
    discardedSize: 0,
    submittedHTTPTotal: 0,
    submittedHTTPSize: 0,
    exportedAsTotal: 0,
    exportedAsSize: 0,
};
let dbstatsDefaults = { number: 0, size: 0 };
// persistent global variables
let globalsVersion = 1;
let globals = assignRec({
    version: globalsVersion,
    stashedLS: assignRec({}, dbstatsDefaults),
    stashedIDB: assignRec({}, dbstatsDefaults),
    savedLS: assignRec({}, dbstatsDefaults),
    savedIDB: assignRec({}, dbstatsDefaults),
}, persistentStatsDefaults);
// did it change recently?
let changedGlobals = false;
// last stats saved in storage
let savedGlobals = undefined;

async function saveGlobals() {
    if (equalRec(savedGlobals, globals))
        return;
    savedGlobals = assignRec({}, globals);
    console.log("saving globals", savedGlobals);
    await browser.storage.local.set({ globals: savedGlobals }).catch(logError);
    await browser.storage.local.remove("persistentStats").catch(() => {});
    await browser.storage.local.remove("globalStats").catch(() => {});
}

async function resetPersistentStats() {
    globals = updateFromRec(globals, persistentStatsDefaults);
    await saveGlobals();
    await updateDisplay(true);
}

// per-source globals.pickedTotal, globals.droppedTotal, etc
let tabState = new Map();
let tabStateDefaults = {
    problematicTotal: 0,
    pickedTotal: 0,
    droppedTotal: 0,
    inLimboTotal: 0,
    inLimboSize: 0,
    collectedTotal: 0,
    collectedSize: 0,
    discardedTotal: 0,
    discardedSize: 0,
};

function getOriginState(tabId, fromExtension) {
    // NB: not tracking extensions separately here, unlike with configs
    if (fromExtension)
        tabId = -1;
    return cacheSingleton(tabState, tabId, () => assignRec({}, tabStateDefaults));
}

// scheduleComplaints flags
// do we have a new failed to stash or save reqres
let gotNewSyncedOrFailed = false;
// do we have new failed to submit or new archived reqres?
let gotNewArchivedOrFailed = false;
// do we need to show empty queue notification?
let wantArchiveDoneNotify = true;
// do we have new queued reqres?
let gotNewQueued = false;
// do we have new reqres in limbo?
let gotNewLimbo = false;
// do we have new problematic reqres?
let gotNewProblematic = false;
// do we have new buggy reqres?
let gotNewErrored = false;

// scheduleEndgame flags
let gotNewExportedAs = false;
let wantRetryFailed = false;
let wantBroadcastSaved = false;

function getNumberAndSizeFromQueues(m) {
    let number = 0;
    let size = 0;
    for (let f of m.values()) {
        number += f.queue.length;
        size += f.size;
    }
    return [number, size];
}

function getNumberAndSizeFromKeys(m) {
    let size = 0;
    for (let v of m.keys())
        size += v[0].dumpSize;
    return [m.size, size];
}

// Compute total sizes of all queues and similar.
// Used in the UI.
function getStats() {
    let [bundledAs, bundledAsSize] = getNumberAndSizeFromQueues(reqresBundledAs);

    let [errored, erroredSize] = getNumberAndSizeFromQueues(reqresErrored);

    let [stashFailed, stashFailedSize] = getNumberAndSizeFromKeys(reqresFailedToStashByArchivable);

    let [archiveFailed, archiveFailedSize] = getNumberAndSizeFromKeys(reqresFailedToArchiveByArchivable);

    let in_flight = reqresAlmostDone.length +
        Math.max(reqresInFlight.size, debugReqresInFlight.size) +
        Math.max(reqresFinishingUp.length, debugReqresFinishingUp.length);

    let actions = [];
    forEachSingletonTimeout(scheduledCancelable, (key) => actions.push(key));
    forEachSingletonTimeout(scheduledSaveState, (key) => actions.push(key));
    let low_prio = actions.length;
    forEachSingletonTimeout(scheduledInternal, (key) => actions.push(key));

    return {
        scheduled_low: low_prio,
        scheduled: actions.length + synchronousClosures.length,
        actions,
        in_flight,
        problematic: reqresProblematic.length,
        picked: globals.pickedTotal,
        dropped: globals.droppedTotal,
        in_limbo: reqresLimbo.length,
        in_limbo_size: reqresLimboSize,
        collected: globals.collectedTotal,
        collected_size: globals.collectedSize,
        discarded: globals.discardedTotal,
        discarded_size: globals.discardedSize,
        queued: reqresQueue.length,
        queued_size: reqresQueueSize,
        stashed: globals.stashedLS.number + globals.stashedIDB.number,
        stashed_size: globals.stashedLS.size + globals.stashedIDB.size,
        unstashed: stashFailed,
        unstashed_size: stashFailedSize,
        exportedAs: globals.exportedAsTotal,
        exportedAs_size: globals.exportedAsSize,
        bundledAs,
        bundledAs_size: bundledAsSize,
        submittedHTTP: globals.submittedHTTPTotal,
        submittedHTTP_size: globals.submittedHTTPSize,
        saved: globals.savedLS.number + globals.savedIDB.number,
        saved_size: globals.savedLS.size + globals.savedIDB.size,
        failed: archiveFailed,
        failed_size: archiveFailedSize,
        errored,
        errored_size: erroredSize,
        issues: in_flight
            + reqresProblematic.length
            + reqresLimbo.length
            + reqresQueue.length
            + stashFailed
            + archiveFailed
            + errored,
    };
}

// Produce a value similar to that of `getStats`, but for a single tab.
// Used in the UI.
function getTabStats(tabId) {
    let info = tabState.get(tabId);
    if (info === undefined)
        info = tabStateDefaults;

    let in_flight = 0;
    let in_flight_debug = 0;
    for (let [k, v] of reqresInFlight.entries())
        if (v.tabId === tabId)
            in_flight += 1;
    for (let [k, v] of debugReqresInFlight.entries())
        if (v.tabId === tabId)
            in_flight_debug += 1;

    let finishing_up = 0;
    let finishing_up_debug = 0;
    for (let v of reqresFinishingUp)
        if (v.tabId === tabId)
            finishing_up += 1;
    for (let v of debugReqresFinishingUp)
        if (v.tabId === tabId)
            finishing_up_debug += 1;

    let almost_done = 0;
    for (let v of reqresAlmostDone)
        if (v.tabId === tabId)
            almost_done += 1;

    return {
        in_flight: almost_done +
            Math.max(in_flight, in_flight_debug) +
            Math.max(finishing_up, finishing_up_debug),
        problematic: info.problematicTotal,
        picked: info.pickedTotal,
        dropped: info.droppedTotal,
        in_limbo: info.inLimboTotal,
        in_limbo_size: info.inLimboSize,
        collected: info.collectedTotal,
        collected_size: info.collectedSize,
        discarded: info.discardedTotal,
        discarded_size: info.discardedSize,
    };
}

function isAcceptedLoggable(tabId, rrfilter, loggable) {
    return (tabId === null || loggable.sessionId === sessionId && loggable.tabId === tabId)
        && (rrfilter === null || isAcceptedBy(rrfilter, loggable));
}

function unmarkProblematic(num, tabId, rrfilter) {
    if (reqresProblematic.length == 0)
        return;
    if (rrfilter === undefined)
        rrfilter = null;

    let [popped, unpopped] = partitionN((archivable) => {
        let [loggable, dump] = archivable;
        return isAcceptedLoggable(tabId, rrfilter, loggable);
    }, num, reqresProblematic);

    if (popped.length === 0)
        return 0;

    // this is written as a separate loop to make it mostly atomic w.r.t. reqresProblematic

    for (let archivable of popped) {
        let [loggable, dump] = archivable;
        try {
            let info = getOriginState(loggable.tabId, loggable.fromExtension);
            loggable.problematic = false;
            loggable.dirty = true;
            info.problematicTotal -= 1;
        } catch (err) {
            logHandledError(err);
            markAsErrored(err, archivable);
        }
    }

    reqresProblematic = unpopped;

    // reset all the logs, since some statuses may have changed
    broadcast(["resetProblematicLog", getProblematicLog()]);
    broadcast(["resetInLimboLog", getInLimboLog()]);
    broadcast(["resetLog", reqresLog]);

    scheduleEndgame(tabId);

    return popped.length;
}

function rotateProblematic(num, tabId, rrfilter) {
    if (reqresProblematic.length == 0)
        return;
    if (rrfilter === undefined)
        rrfilter = null;

    let [popped, unpopped] = partitionN((archivable) => {
        let [loggable, dump] = archivable;
        return isAcceptedLoggable(tabId, rrfilter, loggable);
    }, num, reqresProblematic);

    // append them to the end
    unpopped.push(...popped);
    reqresProblematic = unpopped;

    broadcast(["resetProblematicLog", getProblematicLog()]);
}

function popInLimbo(collect, num, tabId, rrfilter) {
    if (reqresLimbo.length == 0)
        return;
    if (rrfilter === undefined)
        rrfilter = null;

    let [popped, unpopped] = partitionN((archivable) => {
        let [loggable, dump] = archivable;
        return isAcceptedLoggable(tabId, rrfilter, loggable);
    }, num, reqresLimbo);

    if (popped.length == 0)
        return 0;

    // this is written as a separate loop to make it mostly atomic w.r.t. reqresLimbo

    let minusSize = 0;
    let newQueued = [];
    let newLog = [];
    for (let archivable of popped) {
        let [loggable, dump] = archivable;
        try {
            let dumpSize = loggable.dumpSize;
            minusSize += dumpSize;

            let info = getOriginState(loggable.tabId, loggable.fromExtension);
            loggable.in_limbo = false;
            loggable.dirty = true;
            info.inLimboTotal -= 1;
            info.inLimboSize -= dumpSize;
            processNonLimbo(collect, info, archivable, newQueued, newLog);
        } catch (err) {
            logHandledError(err);
            markAsErrored(err, archivable);
        }
    }

    reqresLimbo = unpopped;
    reqresLimboSize -= minusSize;
    truncateLog();
    changedGlobals = true;

    if (popped.some((r) => r.problematic === true))
        // also reset problematic, since reqres statuses have changed
        broadcast(["resetProblematicLog", getProblematicLog()]);
    broadcast(["resetInLimboLog", getInLimboLog()]);
    if (newQueued.length > 0)
        broadcast(["newQueued", newQueued]);
    broadcast(["newLog", newLog]);

    scheduleEndgame(tabId);

    return popped.length;
}

function rotateInLimbo(num, tabId, rrfilter) {
    if (reqresLimbo.length == 0)
        return;
    if (rrfilter === undefined)
        rrfilter = null;

    let [popped, unpopped] = partitionN((archivable) => {
        let [loggable, dump] = archivable;
        return isAcceptedLoggable(tabId, rrfilter, loggable);
    }, num, reqresLimbo);

    // append them to the end
    unpopped.push(...popped);
    reqresLimbo = unpopped;

    broadcast(["resetInLimboLog", getInLimboLog()]);
}

function forgetHistory(tabId, rrfilter) {
    if (reqresLog.length == 0)
        return;
    if (rrfilter === undefined)
        rrfilter = null;

    let [popped, unpopped] = partitionN((loggable) => {
        return isAcceptedLoggable(tabId, rrfilter, loggable);
    }, null, reqresLog);

    if (popped.length === 0)
        return;

    reqresLog = unpopped;
    broadcast(["resetLog", reqresLog]);
    scheduleUpdateDisplay(true, tabId);
}

// browserAction state
let udStats = null;
let udTitle = null;
let udBadge = null;
let udColor = null;
let udEpisode = 1;

// `updatedTabId === null` means "config changed or any tab could have been updated"
// `updatedTabId === undefined` means "no tabs changed"
// otherwise, it's a tabId of a changed tab
function makeUpdateDisplay(statsChanged, updatedTabId, episodic) {
    let changed = updatedTabId === null;

    // only run the rest every `episodic` updates, when it's set
    if (!changed && udEpisode < episodic) {
        udEpisode += 1;
        return;
    }
    udEpisode = 1;

    let stats;
    let title;
    let badge;
    let color;

    if (statsChanged || udStats === null || changed) {
        stats = getStats();

        if (udStats === null
            // because these global stats influence the tab's icon
            || stats.failed !== udStats.failed
            || stats.queued != udStats.queued)
            changed = true;

        udStats = stats;

        broadcast(["updateStats", stats]);

        badge = "";
        color = 0;
        let chunks = [];

        if (stats.issues > 0)
            badge = stats.issues.toString();

        if (!config.collecting)
            chunks.push("off");

        if (stats.in_flight > 0) {
            badge += "T";
            color = 1;
            chunks.push(`still tracking ${stats.in_flight} in-flight reqres`);
        }
        if (stats.problematic > 0) {
            badge += "P";
            color = 1;
            chunks.push(`${stats.problematic} problematic reqres`);
        }
        if (stats.in_limbo > 0) {
            badge += "L";
            color = 1;
            chunks.push(`${stats.in_limbo} reqres in limbo`);
        }
        if (stats.queued > 0) {
            badge += "Q";
            chunks.push(`${stats.queued} reqres in queue`);
        }
        if (stats.bundledAs > 0) {
            badge += "B";
            color = 1;
            chunks.push(`${stats.bundledAs} reqres bundled for export`);
        }
        if (!config.archive && !config.stash) {
            badge += "H";
            color = 1;
            chunks.push("ephemeral mode (both archiving and stashing are disabled)");
        }
        if (config.autoPopInLimboDiscard || config.discardAll) {
            badge += "!";
            color = 2;
            chunks.push("auto-discarding");
        }
        if (stats.errored > 0) {
            badge += "E";
            color = 2;
            chunks.push(`internal errors on ${stats.errored} reqres`);
        }
        if (stats.unstashed > 0) {
            badge += "F";
            color = 2;
            chunks.push(`failed to stash ${stats.unstashed} reqres`);
        }
        if (stats.failed > 0) {
            badge += "F";
            color = 2;
            chunks.push(`failed to archive ${stats.failed} reqres`);
        }
        if (config.ephemeral) {
            badge += "D";
            if (color === 0)
                color = 1;
            chunks.push("debugging: ephemeral config");
        }
        if (config.debugging || config.dumping) {
            badge += "D";
            if (color === 0)
                color = 1;
            chunks.push("debugging: logging (SLOW!)");
        }

        if (stats.scheduled > stats.scheduled_low) {
            badge += "~";
            if (color === 0)
                color = 1;
            chunks.push(`${stats.scheduled} scheduled actions`);
        }
        if (stats.scheduled == stats.scheduled_low && stats.scheduled_low > 0) {
            badge += ".";
            chunks.push(`${stats.scheduled_low} low-priority scheduled actions`);
        }

        if (chunks.length > 0)
            title = "pWebArc: " + chunks.join(", ");
        else
            title = "pWebArc: idle";

        if (udBadge !== badge) {
            changed = true;
            udBadge = badge;
        }

        if (udColor !== color) {
            changed = true;
            udColor = color;
        }

        if (udTitle != title) {
            changed = true;
            udTitle = title;
        }
    } else {
        stats = udStats;
        title = udTitle;
    }

    if (updatedTabId === undefined) {
        if (!changed)
            // no tab-specific stuff needs updating, skip the rest of this
            return;

        // to simplify the logic below
        updatedTabId = null;
    }

    async function updateBrowserAction() {
        if (badge !== undefined) {
            await browser.browserAction.setBadgeText({ text: badge });
            if (config.debugging)
                console.log(`updated browserAction: badge "${badge}"`);
        }

        if (color !== undefined) {
            switch (color) {
            case 0:
                await browser.browserAction.setBadgeTextColor({ color: "#ffffff" });
                await browser.browserAction.setBadgeBackgroundColor({ color: "#777777" });
                break;
            case 1:
                await browser.browserAction.setBadgeTextColor({ color: "#000000" });
                await browser.browserAction.setBadgeBackgroundColor({ color: "#e0e020" });
                break;
            default:
                await browser.browserAction.setBadgeTextColor({ color: "#ffffff" });
                await browser.browserAction.setBadgeBackgroundColor({ color: "#e02020" });
            }
        }

        let tabs = await browser.tabs.query({ active: true });
        for (let tab of tabs) {
            let tabId = tab.id;
            let stateTabId = getStateTabIdOrTabId(tab);

            // skip updates for unchanged tabs, when specified
            if (updatedTabId !== null && updatedTabId !== tabId && updatedTabId !== stateTabId)
                continue;

            let tabcfg = tabConfig.get(stateTabId);
            if (tabcfg === undefined)
                tabcfg = prefillChildren(config.root);
            let tabstats = getTabStats(stateTabId);

            let icon;

            let isLimbo = tabcfg.limbo || tabcfg.children.limbo;
            let isNegLimbo = tabcfg.negLimbo || tabcfg.children.negLimbo;
            let isBothLimbo = isLimbo && isNegLimbo;
            let isLimboSame = tabcfg.limbo === tabcfg.children.limbo;
            let isNegLimboSame = tabcfg.negLimbo === tabcfg.children.negLimbo;

            if (tabstats.in_flight > 0)
                icon = "tracking";
            else if (config.archive && stats.queued > 0)
                icon = "archiving";
            else if (stats.failed > 0)
                icon = "error";
            else if (tabstats.problematic > 0)
                icon = "problematic";
            else if (!config.collecting)
                icon = "off";
            else if (!tabcfg.collecting || !tabcfg.children.collecting) {
                if (tabcfg.collecting === tabcfg.children.collecting)
                    icon = "off";
                else if (isBothLimbo)
                    icon = "off-part-bothlimbo";
                else if (isLimbo)
                    icon = "off-part-limbo";
                else if (isNegLimbo)
                    icon = "off-part-neglimbo";
                else
                    icon = "off-part";
            } else if (isBothLimbo) {
                if (isLimboSame && isNegLimboSame)
                    icon = "bothlimbo";
                else
                    icon = "bothlimbo-mix";
            } else if (isLimbo) {
                if (tabcfg.limbo === tabcfg.children.limbo)
                    icon = "limbo";
                else
                    icon = "limbo-part";
            } else if (isNegLimbo) {
                if (tabcfg.negLimbo === tabcfg.children.negLimbo)
                    icon = "neglimbo";
                else
                    icon = "neglimbo-part";
            } else
                icon = "idle";

            let tchunks = [];
            if (!tabcfg.collecting)
                tchunks.push("off");
            if (tabstats.problematic > 0)
                tchunks.push(`${tabstats.problematic} problematic reqres`);
            if (tabstats.in_limbo > 0)
                tchunks.push(`${tabstats.in_limbo} reqres in limbo`);
            if (tabstats.in_flight > 0)
                tchunks.push(`still tracking ${tabstats.in_flight} in-flight reqres`);

            if (tabcfg.limbo && tabcfg.negLimbo)
                tchunks.push("picking and dropping into limbo");
            else if (tabcfg.limbo)
                tchunks.push("picking into limbo");
            else if (tabcfg.negLimbo)
                tchunks.push("dropping into limbo");

            let ttitle = title;
            if (tchunks.length != 0)
                ttitle += "; this tab: " + tchunks.join(", ");

            if (useDebugger) {
                // Chromium does not support per-window browserActions, so we have to update them per-tab.
                await browser.browserAction.setIcon({ tabId, path: mkIcons(icon) }).catch(logErrorExceptWhenStartsWith("No tab with id:"));
                await browser.browserAction.setTitle({ tabId, title: ttitle }).catch(logErrorExceptWhenStartsWith("No tab with id:"));
            } else {
                let windowId = tab.windowId;
                await browser.browserAction.setIcon({ windowId, path: mkIcons(icon) }).catch(logError);
                await browser.browserAction.setTitle({ windowId, title: ttitle }).catch(logError);
            }

            if (config.debugging)
                console.log(`updated browserAction: tabId ${tabId}: icon "${icon}", title "${ttitle}"`);
        }
    }

    return updateBrowserAction;
}

async function updateDisplay(statsChanged, updatedTabId, episodic) {
    let res = makeUpdateDisplay(statsChanged, updatedTabId, episodic);
    if (res !== undefined)
        await res();
}

let udStatsChanged = false;
let udUpdatedTabId;

async function scheduleUpdateDisplay(statsChanged, updatedTabId) {
    udStatsChanged = udStatsChanged || statsChanged;
    if (udUpdatedTabId === undefined)
        udUpdatedTabId = updatedTabId;
    else
        // then merging more than one value, the result is `null`, i.e. a full
        // update
        udUpdatedTabId = null;

    resetSingletonTimeout(scheduledInternal, "updateDisplay", 10, async () => {
        await updateDisplay(udStatsChanged, udUpdatedTabId);
        udStatsChanged = false;
        udUpdatedTabId = undefined;
    });
}

// schedule processFinishingUp
function scheduleFinishingUp() {
    resetSingletonTimeout(scheduledInternal, "finishingUp", 100, async () => {
        await updateDisplay(true);
        processFinishingUp();
    });
}

// evaluator for `synchronousClosures` below
async function evalSynchronousClosures(closures) {
    while (closures.length > 0) {
        let [fun, args] = closures.shift();
        try {
            await fun(...args);
        } catch (err) {
            logError(err);
        }
    }
}

// a list of [function, args] pairs; these are closures that need to be run synchronously
let synchronousClosures = [];

// syntax sugar
function runSynchronously(func, ...args) {
    synchronousClosures.push([func, args]);
}

// schedule processArchiving, processAlmostDone, etc
function scheduleEndgame(updatedTabId) {
    if (synchronousClosures.length > 0) {
        resetSingletonTimeout(scheduledInternal, "endgame", 0, async () => {
            await updateDisplay(true, updatedTabId);
            await evalSynchronousClosures(synchronousClosures);
            scheduleEndgame(null);
        });
    } else if (config.archive && reqresQueue.length > 0) {
        resetSingletonTimeout(scheduledInternal, "endgame", 0, async () => {
            await updateDisplay(true, updatedTabId);
            await processArchiving();
            scheduleEndgame(null);
        });
    } else if (reqresAlmostDone.length > 0) {
        resetSingletonTimeout(scheduledInternal, "endgame", 0, async () => {
            await updateDisplay(true, updatedTabId);
            await processAlmostDone();
            scheduleEndgame(null);
        });
    } else /* if (!config.archive || reqresQueue.length == 0) */ {
        resetSingletonTimeout(scheduledInternal, "endgame", 0, async () => {
            if (wantBroadcastSaved) {
                let log = await getSavedLog(savedFilters);
                broadcast(["resetSaved", log]);
            }

            cleanupTabs();

            // do we have some reqres in flight?
            let haveInFlight = reqresInFlight.size + debugReqresInFlight.size + reqresFinishingUp.length + debugReqresFinishingUp.length > 0;

            if (changedGlobals) {
                changedGlobals = false;

                // is this change important?
                let boring = true;
                if (savedGlobals === undefined
                    || (!haveInFlight && (savedGlobals.collectedTotal !== globals.collectedTotal
                                          || savedGlobals.submittedHTTPTotal !== globals.submittedHTTPTotal
                                          || savedGlobals.exportedAsTotal !== globals.exportedAsTotal))
                    || savedGlobals.stashedLS.number !== globals.stashedLS.number
                    || savedGlobals.stashedIDB.number !== globals.stashedIDB.number
                    || savedGlobals.savedLS.number !== globals.savedLS.number
                    || savedGlobals.savedIDB.number !== globals.savedIDB.number)
                    boring = false;

                resetSingletonTimeout(scheduledSaveState, "saveGlobals", boring ? 90000 : 1000, async () => {
                    await saveGlobals();
                    await updateDisplay(true);
                });
            }

            if (gotNewExportedAs) {
                gotNewExportedAs = false;
                // schedule exports
                scheduleExportAsAll(haveInFlight
                                    ? config.exportAsInFlightTimeout * 1000
                                    : config.exportAsTimeout * 1000
                                    , null);
            }

            if (wantRetryFailed) {
                wantRetryFailed = false;
                if (config.archive && reqresFailedToArchiveByArchivable.size > 0)
                    // retry failed in 60s
                    scheduleRetryFailed(60000, false);
            }

            scheduleComplaints(1000);

            await updateDisplay(true, updatedTabId);
        });
    }
}

async function doRetryAllUnstashed() {
    let newByError = new Map();
    let newByArchivable = new Map();
    for (let [archivable, args] of reqresFailedToStashByArchivable.entries()) {
        let [state, elide] = args;
        await syncOne(archivable, state, elide, newByError, newByArchivable);
    }
    reqresFailedToStashByError = newByError;
    reqresFailedToStashByArchivable = newByArchivable;
    gotNewSyncedOrFailed = true;
}

function retryUnstashed() {
    runSynchronously(doRetryAllUnstashed);
    scheduleEndgame(null);
}

async function doStashAll(alsoLimbo) {
    await doRetryAllUnstashed();
    await syncMany(reqresQueue, 1, true);
    if (alsoLimbo)
        await syncMany(reqresLimbo, 1, true);
    for (let m of reqresFailedToArchiveByArchiveError.values())
        for (let f of m.values())
            await syncMany(f.queue, 1, true);
}

function stashAll(alsoLimbo) {
    runSynchronously(doStashAll, alsoLimbo);
    scheduleEndgame(null);
}

function retryOneFailed(archiveURL, unrecoverable) {
    let byErrorMap = reqresFailedToArchiveByArchiveError.get(archiveURL);
    if (byErrorMap === undefined)
        return;
    for (let [reason, failed] of Array.from(byErrorMap.entries())) {
        if (!unrecoverable && !failed.recoverable)
            continue;

        for (let archivable of failed.queue) {
            let [loggable, dump] = archivable;
            let dumpSize = loggable.dumpSize;
            reqresQueue.push(archivable);
            reqresQueueSize += dumpSize;

            let count = reqresFailedToArchiveByArchivable.get(archivable);
            if (count > 1)
                reqresFailedToArchiveByArchivable.set(archivable, count - 1);
            else if (count !== undefined)
                reqresFailedToArchiveByArchivable.delete(archivable);
        }

        byErrorMap.delete(reason);
    }
    if (byErrorMap.size === 0)
        reqresFailedToArchiveByArchiveError.delete(archiveURL);
}

function retryFailed(unrecoverable) {
    for (let archiveURL of Array.from(reqresFailedToArchiveByArchiveError.keys()))
        retryOneFailed(archiveURL, unrecoverable);

    broadcast(["resetQueued", getQueuedLog()]);
    broadcast(["resetFailed", getFailedLog()]);

    scheduleEndgame(null);
}

function scheduleRetryFailed(timeout, unrecoverable) {
    resetSingletonTimeout(scheduledCancelable, "retryFailed", timeout, () => retryFailed(unrecoverable));
}

function formatFailures(why, list) {
    let parts = [];
    for (let [reason, failed] of list)
        parts.push(`- ${why} ${failed.queue.length} items because ${reason}.`);
    return parts.join("\n");
}

async function doComplain() {
    // record the current state, because the rest of this chunk is async
    let rrErrored = Array.from(reqresErrored.entries());
    let rrUnstashed = Array.from(reqresFailedToStashByError.entries());
    let rrUnsubmitted = Array.from(reqresFailedToArchiveByArchiveError.entries());

    if (gotNewErrored && rrErrored.length > 0) {
        gotNewErrored = false;

        await browser.notifications.create("errors", {
            title: "pWebArc: ERROR",
            message: `Some internal errors:\n${formatFailures("Failed to process", rrErrored)}`,
            iconUrl: iconURL("error", 128),
            type: "basic",
        });
    } else if (rrErrored.length === 0)
        // clear stale
        await browser.notifications.clear("errors");

    if (gotNewQueued && reqresQueue.length > 0) {
        gotNewQueued = false;

        if (config.archiveStuckNotify && !config.archive && !config.stash) {
            await browser.notifications.create("notSaving", {
                title: "pWebArc: WARNING",
                message: "Some reqres are waiting in the archival queue, but both reqres stashing and archiving are disabled.",
                iconUrl: iconURL("archiving", 128),
                type: "basic",
            });
        }
    } else if (config.archive || config.stash)
        // clear stale
        await browser.notifications.clear("notSaving");

    if (gotNewSyncedOrFailed && rrUnstashed.length > 0) {
        gotNewSyncedOrFailed = false;

        if (config.archiveFailedNotify) {
            // generate a new one
            await browser.notifications.create("unstashed", {
                title: "pWebArc: FAILED",
                message: `For browser's local storage:\n${formatFailures("Failed to stash", rrUnstashed)}`,
                iconUrl: iconURL("error", 128),
                type: "basic",
            });
        }
    } else if (rrUnstashed.length === 0)
        // clear stale
        await browser.notifications.clear("unstashed");

    if (gotNewArchivedOrFailed) {
        gotNewArchivedOrFailed = false;

        // get shown notifications
        let all_ = await browser.notifications.getAll();
        let all = Object.keys(all_);

        // clear stale
        for (let label in all) {
            if (!label.startsWith("unsubmitted-"))
                continue;
            let archiveURL = label.substr(12);
            if (rrUnsubmitted.every((e) => e[0] !== archiveURL))
                await browser.notifications.clear(label);
        }

        if (config.archiveFailedNotify) {
            // generate new ones
            for (let [archiveURL, byErrorMap] of rrUnsubmitted) {
                let where;
                if (archiveURL === "exportAs")
                    where = "Export via `saveAs`";
                else if (archiveURL === "localStorage")
                    where = "Browser's local storage";
                else
                    where = `Archiving server at ${archiveURL}`;
                await browser.notifications.create(`unsubmitted-${archiveURL}`, {
                    title: "pWebArc: FAILED",
                    message: `${where}:\n${formatFailures("Failed to archive", byErrorMap.entries())}`,
                    iconUrl: iconURL("error", 128),
                    type: "basic",
                });
            }
        }

        let isDone = rrUnstashed.length === 0 && rrUnsubmitted.length === 0;

        if (wantArchiveDoneNotify && isDone && reqresQueue.length === 0) {
            wantArchiveDoneNotify = false;

            if (config.archiveDoneNotify) {
                // generate a new one
                await browser.notifications.create("done", {
                    title: "pWebArc: OK",
                    message: "Archiving appears to work OK!\n\nThis message won't be repeated unless something breaks.",
                    iconUrl: iconURL("idle", 128),
                    type: "basic",
                });
            }
        }
    }

    let fatLimbo = reqresLimbo.length > config.limboMaxNumber
                || reqresLimboSize > config.limboMaxSize * MEGABYTE;

    if (fatLimbo && gotNewLimbo) {
        gotNewLimbo = false;

        if (config.limboNotify) {
            // generate a new one
            await browser.notifications.create("fatLimbo", {
                title: "pWebArc: WARNING",
                message: `Too much stuff in limbo, collect or discard some of those reqres to reduce memory consumption and improve browsing performance.`,
                iconUrl: iconURL("limbo", 128),
                type: "basic",
            });
        }
    } else if (!fatLimbo)
        // clear stale
        await browser.notifications.clear("fatLimbo");

    if (gotNewProblematic) {
        gotNewProblematic = false;

        if (config.problematicNotify && reqresProblematic.length > 0) {
            // generate a new one
            //
            // make a log of no more than `problematicNotifyNumber`
            // elements, merging those referencing the same URL
            let latest = new Map();
            for (let i = reqresProblematic.length - 1; i >= 0; --i) {
                let r = reqresProblematic[i][0];
                let desc = (r.method ? r.method : "?") + " " + r.url;
                let l = latest.get(desc);
                if (l === undefined) {
                    if (latest.size < config.problematicNotifyNumber)
                        latest.set(desc, 1);
                    else
                        break;
                } else
                    latest.set(desc, l + 1);
            }
            let latestDesc = [];
            for (let [k, v] of latest.entries()) {
                if (k.length < 80)
                    latestDesc.push(`${v}x ${k}`);
                else
                    latestDesc.push(`${v}x ${k.substr(0, 80)}\u2026`);
            }
            latestDesc.reverse();
            await browser.notifications.create("problematic", {
                title: "pWebArc: WARNING",
                message: `Have ${reqresProblematic.length} reqres marked as problematic:\n` + latestDesc.join("\n"),
                iconUrl: iconURL("problematic", 128),
                type: "basic",
            });
        }
    } else if (reqresProblematic.length === 0)
        // clear stale
        await browser.notifications.clear("problematic");
}

function scheduleComplaints(timeout) {
    resetSingletonTimeout(scheduledHidden, "complaints", timeout, doComplain);
}

// reqres persistence

let reqresIDB; // set in init

async function dumpLS() {
    await lslotDump();

    if (reqresIDB !== undefined)
        await idbDump(reqresIDB);
}

async function loadDump(archivable, unelide, allowNull) {
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
    if (inLS) {
        mkTransaction = mkLSlotTransaction;
        stashStats = globals.stashedLS;
        savedStats = globals.savedLS;
    } else {
        mkTransaction = mkIDBTransaction;
        stashStats = globals.stashedIDB;
        savedStats = globals.savedIDB;
    }
    return [mkTransaction, stashStats, savedStats];
}

async function syncWipeOne(tss, dumpSize, dumpId, stashId, saveId) {
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
        changedGlobals = true;
    }
    if (saveId !== undefined) {
        savedStats.number -= 1;
        savedStats.size -= dumpSize;
        changedGlobals = true;
    }
}

async function syncWriteOne(tss, state, clean, dump, dumpSize, dumpId, stashId, saveId) {
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
        changedGlobals = true;
    } else if (stashId !== undefined && clean.stashId === undefined) {
        stashStats.number -= 1;
        stashStats.size -= dumpSize;
        changedGlobals = true;
    }
    if (saveId === undefined && clean.saveId !== undefined) {
        savedStats.number += 1;
        savedStats.size += dumpSize;
        changedGlobals = true;
    } else if (saveId !== undefined && clean.saveId === undefined) {
        savedStats.number -= 1;
        savedStats.size -= dumpSize;
        changedGlobals = true;
    }
}

async function doSyncOne(archivable, state, elide) {
    let [loggable, dump] = archivable;

    // Is it in `storage.local` (`true`), in `indexedDB` (`false`), or neither (`undefined`)?
    let inLS = loggable.inLS;
    // Current values.
    let dirty = loggable.dirty === true;
    let dumpId = loggable.dumpId;
    let stashId = loggable.stashId;
    let saveId = loggable.saveId;

    // Do we want it to be stored in `storage.local`?
    let wantInLS = inLS === true || !config.preferIndexedDB || reqresIDB === undefined;

    // Do we even have anything to do?
    if (state === 0 && dumpId === undefined && stashId === undefined && saveId === undefined)
        return;
    else if ((dumpId !== undefined || dump === null)
             && (
              (state === 1 && stashId !== undefined && saveId === undefined)
           || (state === 2 && stashId === undefined && saveId !== undefined)
             )
             && inLS === wantInLS
             && !dirty)
        return;

    let dumpSize = loggable.dumpSize;

    // Pristine version of loggable, which will be written to storage.
    let clean = assignRec({}, loggable);
    clean.version = 1;
    delete clean["inLS"];
    delete clean["dirty"];
    delete clean["dumpId"];
    delete clean["stashId"];
    delete clean["saveId"];

    if (state === 0)
        // delete from the current store
        await syncWipeOne(selectTSS(inLS !== false), dumpSize, dumpId, stashId, saveId);
    else {
        // because we don't want to save these
        deleteLoggableFields(clean);

        if (inLS === undefined || inLS === wantInLS)
            // first write or overwrite to the same store
            await syncWriteOne(selectTSS(wantInLS), state, clean, dump, dumpSize, dumpId, stashId, saveId);
        else {
            // we are moving the data from one store to the other
            dump = await loadDump(archivable, true, true);
            await syncWriteOne(selectTSS(wantInLS), state, clean, dump, dumpSize);
            await syncWipeOne(selectTSS(inLS), dumpSize, dumpId, stashId, saveId);
        }

        clean.inLS = wantInLS;
        // reuse old fields
        copyLoggableFields(loggable, clean);
    }

    archivable[0] = clean;
    if (elide)
        // free memory
        archivable[1] = null;

    if (config.debugging)
        console.warn(state === 0 ? "DELETED" : (state === 1 ? "STASHED" : "SAVED"),
                     "elide", elide,
                     "ids", dumpId, stashId, saveId,
                     "clean", clean);
}

async function syncOne(archivable, state, elide, rrFailed, rrLast) {
    if (rrFailed === undefined)
        rrFailed = reqresFailedToStashByError;
    if (rrLast === undefined)
        rrLast = reqresFailedToStashByArchivable;

    let [loggable, dump] = archivable;
    let dumpSize = loggable.dumpSize;

    try {
        await doSyncOne(archivable, state, elide);
    } catch (err) {
        logHandledError(err);
        recordByError(rrFailed, err, false, archivable, dumpSize);
        rrLast.set(archivable, [state, elide]);
        gotNewSyncedOrFailed = true;
        return false;
    }

    gotNewSyncedOrFailed = true;
    return true;
}

async function syncMany(archivables, state, elide) {
    for (let archivable of archivables) {
        let [loggable, dump] = archivable;
        updateLoggable(loggable);

        await syncOne(archivable, state, elide);
        await updateDisplay(true, loggable.tabId, 100);
    }
}

class StopIteration extends Error {}

async function forEachSynced(storeName, func, limit) {
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

// reqres archiving

function recordManyFailed(archiveURL, reason, recoverable, archivables, func) {
    let m = getByErrorMap(archiveURL);
    let v = getByErrorMapRecord(m, reason);

    for (let archivable of archivables) {
        let [loggable, dump] = archivable;
        let dumpSize = loggable.dumpSize;
        if (func !== undefined)
            func(loggable);
        recordByErrorTo(v, recoverable, archivable, dumpSize);
    }

    gotNewArchivedOrFailed = true;
    wantArchiveDoneNotify = true;
    wantRetryFailed = true;
}

function recordOneFailedTo(byErrorMap, reason, recoverable, archivable, dumpSize) {
    recordByError(byErrorMap, reason, recoverable, archivable, dumpSize);
    gotNewArchivedOrFailed = true;
    wantArchiveDoneNotify = true;
    wantRetryFailed = true;
}

function recordOneFailed(archiveURL, reason, recoverable, archivable, dumpSize) {
    let m = getByErrorMap(archiveURL);
    recordOneFailedTo(m, reason, recoverable, archivable, dumpSize);
}

function recordOneAssumedBroken(archiveURL, archivable, dumpSize) {
    let byErrorMap = reqresFailedToArchiveByArchiveError.get(archiveURL);
    if (byErrorMap !== undefined) {
        let recent = Array.from(byErrorMap.entries()).filter(
            (x) => (Date.now() - x[1].when) < 1000 && !x[0].endsWith(" (assumed)")
        )[0];
        if (recent !== undefined) {
            // we had recent errors there, fail this reqres immediately
            recordOneFailedTo(byErrorMap, recent[0] + " (assumed)", recent[1].recoverable, archivable, dumpSize);
            return true;
        }
    }
    return false;
}

let lastExportEpoch;
let lastExportNum = 0;

// export all reqresBundledAs as fake-"Download" with a WRR-bundle of their dumps
function exportAsAll(bucket, ifGEQ) {
    let res = reqresBundledAs.get(bucket);
    if (res === undefined
        || ifGEQ !== undefined && res.size < ifGEQ)
        return;

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
        if (lastExportEpoch !== epoch)
            lastExportNum = 0;
        else
            lastExportNum += 1;
        lastExportEpoch = epoch;

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

        saveAs(dataChunks, mime, `pWebArc-export-${bucket}-${dt}_${lastExportNum}.${ext}`);

        globals.exportedAsTotal += res.queue.length;
        globals.exportedAsSize += res.size;
    } catch (err) {
        recordManyFailed("exportAs", err, false, res.queue, (loggable) => {
            loggable.exportedAs = false;
            loggable.dirty = true;
        });
        runSynchronously(syncMany, Array.from(res.queue), 1, true);
        // NB: This is slightly fragile, consider the following sequence of
        // events for a given archivable:
        //
        //  exportAsOne -> submitHTTPOne -> saveOne
        //  -> ... -> exportAsAll, which fails -> recordFailed
        //  -> syncMany
        //
        // It will work only if `runSynchronously` is run after `saveOne`
        // (which is true, given how `scheduleEndgame` is written). Also,
        // note, that it will first save the archivable, and then un-save it,
        // this is by design, since, ideally, this this `catch` would never be
        // run.
        //
        // Now consider this:
        //
        //  exportAsOne -> submitHTTPOne -> (no saveOne) -> syncOne(archivable, 0, ...)
        //  -> ... -> exportAsAll, which fails -> recordFailed
        //  -> syncMany
        //
        // Which will only work if that first `syncOne` does not elide the
        // dump from memory, see (notEliding).
    } finally {
        reqresBundledAs.delete(bucket);
    }
}

// schedule exportAsAll action
function scheduleExportAsAll(timeout, bucketOrNull) {
    if (reqresBundledAs.size === 0)
        return;

    let buckets;
    if (bucketOrNull === null)
        buckets = Array.from(reqresBundledAs.keys());
    else
        buckets = [ bucketOrNull ];

    for (let bucket of buckets) {
        resetSingletonTimeout(scheduledCancelable, `exportAsAll-${bucket}`, timeout, async () => {
            exportAsAll(bucket);
            scheduleEndgame(null);
        });
    }
}

async function exportAsOne(archivable) {
    let [loggable, dump] = archivable;
    let dumpSize = loggable.dumpSize;

    if (isArchivedVia(loggable, archivedViaExportAs))
        return true;

    // load the dump
    dump = await loadDump(archivable, true, false);

    let archiveURL = "exportAs";
    let bucket = loggable.bucket;
    let maxSize = config.exportAsMaxSize * MEGABYTE;

    // export if this dump will not fit
    exportAsAll(bucket, maxSize - dumpSize);

    // record it in the bundle
    let u = cacheSingleton(reqresBundledAs, bucket, () => { return {
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
    exportAsAll(bucket, maxSize);

    gotNewExportedAs = true;

    return true;
}

async function saveOne(archivable) {
    let [loggable, dump] = archivable;
    let dumpSize = loggable.dumpSize;

    let archiveURL = "localStorage";
    if (recordOneAssumedBroken(archiveURL, archivable, dumpSize))
        return false;

    // Prevent future calls to `doRetryAllUnstashed` from un-saving this
    // archivable, which can happen with, e.g., the following sequence of
    // events:
    //   finished -> in_limbo -> syncOne -> out of disk space ->
    //   the user fixes it -> popInLimbo ->
    //   queued -> saveOne -> retryUnstashed
    reqresFailedToStashByArchivable.delete(archivable);

    try {
        await doSyncOne(archivable, 2, true);
    } catch (err) {
        logHandledError(err);
        recordOneFailed(archiveURL, err, false, archivable, dumpSize);
        return false;
    }

    gotNewArchivedOrFailed = true;
    wantBroadcastSaved = true;
    return true;
}

// this is used as an argument to `forEachSynced`
function loadOneStashed(loggable) {
    addLoggableFields(loggable);

    let info = getOriginState(loggable.tabId, loggable.fromExtension);
    let dumpId = loggable.dumpId;
    let dumpSize = loggable.dumpSize;

    let archivable = [loggable, null];

    if (loggable.problematic) {
        reqresProblematic.push(archivable);
        gotNewProblematic = true;
        info.problematicTotal += 1;
    }

    if (loggable.in_limbo || loggable.collected) {
        if (dumpId === undefined)
            throw new Error("dumpId is not specified");

        if (loggable.in_limbo) {
            reqresLimbo.push(archivable);
            reqresLimboSize += dumpSize;
            gotNewLimbo = true;
            info.inLimboTotal += 1;
            info.inLimboSize += dumpSize;
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
    let [newStashedLS, newStashedIDB] = await forEachSynced("stash", loadOneStashed);

    // recover from wrong counts
    if (newStashedLS !== undefined && !equalRec(globals.stashedLS, newStashedLS)) {
        globals.stashedLS = newStashedLS;
        changedGlobals = true;
    }
    if (newStashedIDB !== undefined && !equalRec(globals.stashedIDB, newStashedIDB)) {
        globals.stashedIDB = newStashedIDB;
        changedGlobals = true;
    }
}

async function getSavedLog(rrfilter) {
    if (rrfilter === undefined)
        rrfilter = null;

    let res = [];
    let [newSavedLS, newSavedIDB] = await forEachSynced("save", (loggable) => {
        if (!isAcceptedLoggable(null, rrfilter, loggable))
            return false;
        addLoggableFields(loggable);
        res.push(loggable);
        return true;
    }, rrfilter !== null ? rrfilter.limit : null);

    // recover from wrong counts
    if (newSavedLS !== undefined && !equalRec(globals.savedLS, newSavedLS)) {
        globals.savedLS = newSavedLS;
        changedGlobals = true;
    }
    if (newSavedIDB !== undefined && !equalRec(globals.savedIDB, newSavedIDB)) {
        globals.savedIDB = newSavedIDB;
        changedGlobals = true;
    }

    return res;
}

let savedFilters = assignRec({}, rrfilterDefaults);
savedFilters.limit = 1024;

function requeueSaved(reset) {
    runSynchronously(async () => {
        broadcast(["resetSaved", [null]]); // invalidate UI

        let log = await getSavedLog(savedFilters);
        for (let loggable of log) {
            if (reset)
                loggable.archived = 0;

            let archivable = [loggable, null];

            // yes, this is inefficient, but without this, calling this
            // function twice in rapid succession can produce weird results
            try {
                await doSyncOne(archivable, 1, false);
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
    runSynchronously(async () => {
        broadcast(["resetSaved", [null]]); // invalidate UI

        let log = await getSavedLog(savedFilters);
        for (let loggable of log) {
            let archivable = [loggable, null];

            try {
                await doSyncOne(archivable, 0, false);
            } catch(err) {
                logError(err);
                continue;
            }
        }
    });
    wantBroadcastSaved = true;
    scheduleEndgame(null);
}

// reqres archiving

async function submitHTTPOne(archivable) {
    let [loggable, dump] = archivable;
    let dumpSize = loggable.dumpSize;

    if (isArchivedVia(loggable, archivedViaSubmitHTTP))
        return true;

    dump = await loadDump(archivable, true, false);

    let archiveURL = config.submitHTTPURLBase + "?profile=" + encodeURIComponent(loggable.bucket || config.root.bucket);

    if (recordOneAssumedBroken(archiveURL, archivable, dumpSize))
        return false;

    if (config.debugging)
        console.log("trying to archive", loggable);

    function broken(reason, recoverable) {
        logHandledError(reason);
        recordOneFailed(archiveURL, reason, recoverable, archivable, dumpSize);
    }

    let response;
    try {
        response = await fetch(archiveURL, {
            method: "POST",
            headers: {
                "Content-Type": "application/cbor",
                "Content-Length": dump.byteLength.toString(),
            },
            body: dump,
        });
    } catch (err) {
        broken(`pWebArc can't establish a connection to the archiving server: ${errorMessageOf(err)}`, true);
        return false;
    }

    let responseText = await response.text();

    if (response.status !== 200) {
        broken(`request to the archiving server failed with ${response.status} ${response.statusText}: ${responseText}`, false);
        return false;
    }

    retryOneFailed(archiveURL, true);
    globals.submittedHTTPTotal += 1;
    globals.submittedHTTPSize += loggable.dumpSize;
    loggable.archived |= archivedViaSubmitHTTP;
    loggable.dirty = true;

    gotNewArchivedOrFailed = true;
    return true;
}

async function processArchiving() {
    while (config.archive && reqresQueue.length > 0) {
        let archivable = reqresQueue.shift();
        let [loggable, dump] = archivable;
        let dumpSize = loggable.dumpSize;
        reqresQueueSize -= dumpSize;

        if (config.discardAll) {
            await syncOne(archivable, 0, false);
            continue;
        }

        try {
            updateLoggable(loggable);

            let allOK = true;

            if (config.archiveExportAs)
                allOK &&= await exportAsOne(archivable);

            if (config.archiveSubmitHTTP)
                allOK &&= await submitHTTPOne(archivable);

            // other archival methods go here

            if (!allOK)
                // it's in reqresFailedToArchiveByArchiveError now, stash it without
                // recording it in reqresFailedToStashByError and
                // reqresFailedToStashByArchivable
                await doSyncOne(archivable, 1, true).catch(logError);
            else if (config.archiveSaveLS)
                await saveOne(archivable);
            else
                // (notEliding)
                await syncOne(archivable, 0, false);
        } catch (err) {
            logHandledError(err);
            markAsErrored(err, archivable);
            await syncOne(archivable, 1, true);
        }

        await updateDisplay(true, loggable.tabId, 10);
    }

    broadcast(["resetQueued", getQueuedLog()]);
    broadcast(["resetFailed", getFailedLog()]);
}

// tracking and capture

function getHeaderString(header) {
    if (header.binaryValue !== undefined) {
        let dec = new TextDecoder("utf-8", { fatal: false });
        return dec.decode(header.binaryValue);
    } else {
        return header.value;
    }
}

// get header value as string
function getHeaderValue(headers, name) {
    name = name.toLowerCase();
    for (let header of headers) {
        if (header.name.toLowerCase() == name)
            return getHeaderString(header);
    }
    return;
}

// encode browser's Headers structure into an Array of [string, Uint8Array] pairs
function encodeHeaders(headers) {
    let result = [];
    for (let i = 0; i < headers.length; ++i) {
        let header = headers[i];
        let binValue;

        // always encode header value as bytes
        if (header.binaryValue !== undefined) {
            binValue = new Uint8Array(header.binaryValue);
        } else {
            let enc = new TextEncoder("utf-8", { fatal: true });
            binValue = enc.encode(header.value);
        }

        result.push([header.name, binValue]);
    }

    return result;
}

let sourceDesc = browser.nameVersion + "+pWebArc/" + manifest.version;

// render reqres structure into a CBOR dump
function renderReqres(encoder, reqres) {
    // record URL as sent over the wire, i.e. without a #hash and with a
    // trailing slash instead of an empty path
    let url = normalizeURL(reqres.url);

    // use the Referer header as is, if browser f*cked it up, we want to know
    let referer = getHeaderValue(reqres.requestHeaders, "Referer");

    // canonicalize documentUrl (i.e. add trailing slashes, as Chromium f*cks
    // up its initiator field all the time) and use the canonicalized URL when
    // no documentUrl is set (in Firefox topmost level document does not get
    // documentUrl, which is annoying, we want to save the #hashes there).
    let documentUrl;
    if (isDefinedURL(reqres.documentUrl))
        documentUrl = canonicalizeURL(reqres.documentUrl);
    else
        documentUrl = canonicalizeURL(reqres.url);

    // do similarly for originUrl for similar Chromium-related reasons
    let originUrl;
    if (isDefinedURL(reqres.originUrl))
        originUrl = canonicalizeURL(reqres.originUrl);

    // The primary effect of the normalization and canonicalization above and
    // the code below is that loading a URL with a #hash will record a
    // normalized URL in the Request, but then will also record the full URL
    // with the hash in document_url and/or origin_url.

    let rest = {};

    // record if different from normalized URL and referer
    if (documentUrl !== undefined
        && documentUrl !== url
        && documentUrl !== referer)
        rest.document_url = documentUrl;

    // record if different from normalized URL, referer, and documentUrl
    if (originUrl !== undefined
        && originUrl !== url
        && originUrl !== referer
        && originUrl !== documentUrl)
        rest.origin_url = originUrl;

    if (reqres.errors.length > 0)
        rest.errors = reqres.errors;

    if (reqres.fromCache)
        rest.from_cache = true;

    if (!reqres.sent)
        rest.sent = false;

    // Chromium did not emit the WebRequest half
    if (reqres.fake)
        rest.fake = true;

    let response = null;
    if (reqres.responded) {
        response = [
            Math.floor(reqres.responseTimeStamp),
            reqres.statusCode,
            reqres.reason,
            encodeHeaders(reqres.responseHeaders),
            reqres.responseComplete,
            reqres.responseBody,
        ]
    }

    encoder.encode([
        "WEBREQRES/1",
        sourceDesc,
        reqres.protocol,
        [
            Math.floor(reqres.requestTimeStamp),
            reqres.method,
            url,
            encodeHeaders(reqres.requestHeaders),
            reqres.requestComplete,
            reqres.requestBody,
        ],
        response,
        Math.floor(reqres.emitTimeStamp),
        rest,
    ], {
        allowNull: true,
        allowUndefined: false,
    });
}

async function processOneAlmostDone(reqres, newProblematic, newLimbo, newQueued, newLog) {
    if (reqres.tabId === undefined)
        // just in case
        reqres.tabId = -1;

    if (!useDebugger && reqres.responseComplete && reqres.errors.some(isIncompleteError))
        // Apparently, sometimes Firefox calls `filter.onstop` for aborted
        // requests as if nothing out of the ordinary happened. It is a
        // bug, yes.
        //
        // Our `filter.onstop` marks requests as complete. So, we have to
        // undo that.
        //
        // We are doing that here instead of in `emitRequest` because the
        // `filter` is guaranteed to be finished here.
        reqres.responseComplete = false;

    let lineProtocol;
    let lineReason;
    if (reqres.statusLine !== undefined) {
        lineProtocol = reqres.statusLine.split(" ", 1)[0];
        lineReason = "";
        let pos = reqres.statusLine.indexOf(" ", lineProtocol.length + 1);
        if (pos !== -1)
            lineReason = reqres.statusLine.substr(pos + 1);
    }

    if (reqres.protocol === undefined) {
        if (lineProtocol !== undefined && lineProtocol !== "")
            reqres.protocol = lineProtocol;
        else if (getHeaderValue(reqres.requestHeaders, ":authority") !== undefined)
            reqres.protocol = "HTTP/2.0";
        else
            reqres.protocol = "HTTP/1.0";
    }

    if (reqres.reason === undefined) {
        if (lineReason !== undefined)
            reqres.reason = lineReason;
        else
            reqres.reason = "";
    }

    let updatedTabId = reqres.tabId;
    let statusCode = reqres.statusCode;

    let options = getOriginConfig(updatedTabId, reqres.fromExtension);
    let info = getOriginState(updatedTabId, reqres.fromExtension);

    let state = "complete";
    let problematic = false;
    let picked = true;

    if (reqres.protocol === "SNAPSHOT") {
        // it's a snapshot
        state = "snapshot";
    } else if (!reqres.sent) {
        // it failed somewhere before handleSendHeaders
        state = "canceled";
        problematic = config.markProblematicCanceled;
        picked = config.archiveCanceled;
    } else if (!reqres.responded) {
        // no response after sending headers
        state = "no_response";
        problematic = config.markProblematicNoResponse;
        picked = config.archiveNoResponse;
        // filter.onstop might have set it to true
        reqres.responseComplete = false;
    } else if (!reqres.responseComplete) {
        state = "incomplete";
        problematic = config.markProblematicIncomplete;
        picked = config.archiveIncompleteResponse;
    } else if (!useDebugger && statusCode === 200 && reqres.fromCache && reqres.responseBody.byteLength == 0) {
        let clength = getHeaderValue(reqres.responseHeaders, "Content-Length")
        if (clength !== undefined && clength !== 0) {
            // Under Firefox, filterResponseData filters will get empty response data for some
            // cached objects. We use a special state for these, as this is not really an error,
            // and reloading the page will not help in archiving that data, as those requests
            // will be answered from cache again. (But reloading the page with cache disabled
            // with Control+F5 will.)
            state = "incomplete_fc";
            problematic = config.markProblematicIncompleteFC;
            picked = config.archiveIncompleteResponse;
            // filter.onstop will have set it to true
            reqres.responseComplete = false;
        } else
            state = "complete_fc";
    } else if (reqres.fromCache)
        state = "complete_fc";

    if (!reqres.requestComplete) {
        // requestBody recovered from formData
        problematic = problematic || config.markProblematicPartialRequest;
        picked = picked && config.archivePartialRequest;
    }

    if (!reqres.responded || statusCode >= 200 && statusCode < 300) {
        // do nothing
    } else if (statusCode >= 100 && statusCode < 200)
        picked = picked && config.archive1xxCodes;
    else if (statusCode >= 300 && statusCode < 400)
        picked = picked && config.archive3xxCodes;
    else if (transientStatusCodes.has(statusCode)) {
        picked = picked && config.archiveTransientCodes;
        problematic = problematic || config.markProblematicTransientCodes;
    } else if (statusCode >= 400 && statusCode < 600) {
        picked = picked && config.archivePermanentCodes;
        problematic = problematic || config.markProblematicPermanentCodes;
    } else
        // a weird status code, mark it!
        problematic = true;

    if (reqres.errors.some(isNonTrivialError)) {
        // it had some potentially problematic errors
        picked = picked && config.archiveWithErrors;
        problematic = problematic
            || (config.markProblematicWithImportantErrors
                && reqres.errors.some(isImportantError))
            || (picked ? config.markProblematicPickedWithErrors
                       : config.markProblematicDroppedWithErrors);
    }

    let in_limbo = picked && options.limbo || !picked && options.negLimbo;

    // dump it to console when debugging
    if (config.debugging)
        console.log(picked ? "PICKED" : "DROPPED",
                    in_limbo ? "LIMBO" : "QUEUED",
                    reqres.requestId,
                    "state", state,
                    reqres.protocol, reqres.method, reqres.url,
                    "tabId", updatedTabId,
                    "req", reqres.requestComplete,
                    "res", reqres.responseComplete,
                    "result", statusCode, reqres.reason, reqres.statusLine,
                    "errors", reqres.errors,
                    "bucket", options.bucket,
                    reqres);

    let loggable = makeLoggableReqres(reqres);
    loggable.bucket = options.bucket;
    loggable.net_state = state;
    loggable.was_problematic = loggable.problematic = problematic;
    loggable.picked = picked;
    loggable.was_in_limbo = loggable.in_limbo = in_limbo;

    if (picked) {
        globals.pickedTotal += 1;
        info.pickedTotal += 1;
    } else {
        globals.droppedTotal += 1;
        info.droppedTotal += 1;
    }

    let dump;
    let dumpSize;
    {
        let encoder = new CBOREncoder();
        renderReqres(encoder, reqres);

        if (in_limbo || picked) {
            dump = encoder.result();
            dumpSize = dump.byteLength;

            if (config.dumping)
                dumpToConsole(dump);
        } else {
            dump = null;
            dumpSize = encoder.resultByteLength;
        }
    }

    loggable.dumpSize = dumpSize;
    let archivable = [loggable, dump];

    if (in_limbo) {
        reqresLimbo.push(archivable);
        reqresLimboSize += dumpSize;
        gotNewLimbo = true;
        info.inLimboTotal += 1;
        info.inLimboSize += dumpSize;
        newLimbo.push(loggable);
        if (config.stash && options.stashLimbo)
            runSynchronously(syncOne, archivable, 1, true);
    } else
        processNonLimbo(picked, info, archivable, newQueued, newLog);

    if (problematic) {
        reqresProblematic.push(archivable);
        gotNewProblematic = true;
        info.problematicTotal += 1;
        newProblematic.push(loggable);
    }

    changedGlobals = true;
}

function processNonLimbo(collect, info, archivable, newQueued, newLog) {
    let [loggable, dump] = archivable;
    let dumpSize = loggable.dumpSize;
    if (collect) {
        loggable.collected = true;
        reqresQueue.push(archivable);
        reqresQueueSize += dumpSize;
        newQueued.push(loggable);
        gotNewQueued = true;

        globals.collectedTotal += 1;
        globals.collectedSize += dumpSize;
        info.collectedTotal += 1;
        info.collectedSize += dumpSize;

        if (!config.archive && config.stash) {
            if (loggable.was_in_limbo)
                updateLoggable(loggable);

            // stuck queue, stash it
            runSynchronously(syncOne, archivable, 1, false);
        }
    } else {
        loggable.collected = false;
        globals.discardedTotal += 1;
        globals.discardedSize += dumpSize;
        info.discardedTotal += 1;
        info.discardedSize += dumpSize;

        if (loggable.was_in_limbo)
            // in case it was stashed before
            runSynchronously(syncOne, archivable, 0, false);
    }

    reqresLog.push(loggable);
    newLog.push(loggable);
}

async function processAlmostDone() {
    let newProblematic = [];
    let newLimbo = [];
    let newQueued = [];
    let newLog = [];

    while (reqresAlmostDone.length > 0) {
        let reqres = reqresAlmostDone.shift();
        try {
            await processOneAlmostDone(reqres, newProblematic, newLimbo, newQueued, newLog);
        } catch (err) {
            logHandledError(err);
            markAsErrored(err, [reqres, null]);
        }
        await updateDisplay(true, reqres.tabId, 10);
    }

    truncateLog();

    broadcast(["resetInFlight", getInFlightLog()]);
    if (newProblematic.length > 0)
        broadcast(["newProblematic", newProblematic]);
    if (newLimbo.length > 0)
        broadcast(["newLimbo", newLimbo]);
    if (newQueued.length > 0)
        broadcast(["newQueued", newQueued]);
    if (newLog.length > 0)
        broadcast(["newLog", newLog]);
}

async function snapshotOneTab(tabId, tabUrl) {
    if (!config.snapshotAny && isBoringURL(tabUrl)) {
        // skip stuff like handleBeforeRequest does
        if (config.debugging)
            console.log("NOT taking DOM snapshot of tab", tabId, tabUrl);
        return;
    }

    if (config.debugging)
        console.log("taking DOM snapshot of tab", tabId, tabUrl);

    let start = Date.now();
    let allErrors = [];

    try {
        let allResults = await browser.tabs.executeScript(tabId, {
            file: "/inject/snapshot.js",
            allFrames: true,
        });

        if (config.debugging)
            console.log("snapshot.js returned", allResults);

        let emit = Date.now();

        for (let data of allResults) {
            if (data === undefined) {
                allErrors.push("access denied");
                continue;
            }

            let [date, documentUrl, originUrl, url, ct, result, errors] = data;

            if (!config.snapshotAny && isBoringURL(url))
                // skip stuff like handleBeforeRequest does, again, now for
                // sub-frames
                continue;
            else if (errors.length > 0) {
                allErrors.push(errors.join("; "));
                continue;
            } else if (typeof result !== "string") {
                allErrors.push(`failed to snapshot a frame with \`${ct}\` content type`);
                continue;
            }

            let reqres = {
                sessionId,
                requestId: undefined,
                tabId,
                fromExtension: false,

                protocol: "SNAPSHOT",
                method: "DOM",
                url,

                documentUrl,
                originUrl,

                errors: [],

                requestTimeStamp: start,
                requestHeaders: [],
                requestBody: new ChunkedBuffer(),
                requestComplete: true,

                sent: false,
                responded: true,
                fromCache: false,

                responseTimeStamp: date,
                responseHeaders : [
                    { name: "Content-Type", value: ct }
                ],
                responseBody: result,
                responseComplete: true,

                statusCode: 200,
                reason: "OK",

                emitTimeStamp: emit,
            };

            reqresAlmostDone.push(reqres);
        }
    } catch (err) {
        allErrors.push(err.toString());
    } finally {
        if (allErrors.length > 0)
            await browser.notifications.create(`snapshot-${tabId}`, {
                title: "pWebArc: ERROR",
                message: `While taking DOM snapshot of tab #${tabId} (${tabUrl.substr(0, 80)}):\n- ${allErrors.join("\n- ")}`,
                iconUrl: iconURL("error", 128),
                type: "basic",
            }).catch(logError);
    }
}

async function snapshotTab(tabIdNull) {
    if (tabIdNull === null) {
        // snapshot all tabs
        let tabs = await browser.tabs.query({});
        for (let tab of tabs) {
            let tabId = tab.id;
            let tabcfg = getOriginConfig(tabId);
            if (!tabcfg.collecting)
                continue;
            await snapshotOneTab(tabId, getTabURL(tab));
        }
    } else {
        let tab = await browser.tabs.get(tabIdNull);
        await snapshotOneTab(tabIdNull, getTabURL(tab));
    }

    scheduleEndgame(tabIdNull);
}

function emitTabInFlightWebRequest(tabId, reason) {
    for (let [requestId, reqres] of Array.from(reqresInFlight.entries())) {
        if (tabId === null || reqres.tabId == tabId)
            emitRequest(requestId, reqres, "webRequest::" + reason, true);
    }
}

// wait up for reqres filters to finish
function processFinishingUpWebRequest(forcing) {
    let notFinished = [];

    for (let reqres of reqresFinishingUp) {
        if (reqres.filter === undefined) {
            // this reqres finished even before having a filter
            reqresAlmostDone.push(reqres);
            continue;
        }

        let fs = reqres.filter.status;
        if (fs == "disconnected" || fs == "closed" || fs == "failed") {
            // the filter is done, remove it
            delete reqres["filter"];
            reqresAlmostDone.push(reqres);
            continue;
        }

        // the filter of this reqres is not finished yet
        // try again later
        notFinished.push(reqres);
    }

    reqresFinishingUp = notFinished;

    if (forcing)
        return;

    scheduleEndgame(null);
}

let processFinishingUp = processFinishingUpWebRequest;
if (useDebugger)
    processFinishingUp = processMatchFinishingUpWebRequestDebug;

// flush reqresFinishingUp into the reqresAlmostDone, interrupting filters
function forceFinishingUpWebRequest(predicate) {
    for (let reqres of reqresFinishingUp) {
        if (predicate !== undefined && !predicate(reqres))
            continue;

        // disconnect the filter, if not disconnected already
        if (reqres.filter !== undefined) {
            try {
                reqres.filter.disconnect()
            } catch (e) {
                //ignore
            }
            delete reqres["filter"];
        }

        if (config.debugging)
            console.warn("UNSTUCK webRequest requestId", reqres.requestId,
                         "tabId", reqres.tabId,
                         "url", reqres.url,
                         "reqres", reqres);

        reqresAlmostDone.push(reqres);
    }

    reqresFinishingUp = [];
}

function stopAllInFlight(tabId) {
    if (useDebugger)
        emitTabInFlightDebug(tabId, "pWebArc::EMIT_FORCED_BY_USER");
    emitTabInFlightWebRequest(tabId, "pWebArc::EMIT_FORCED_BY_USER");

    processFinishingUp(true);

    if (useDebugger)
        forceFinishingUpDebug((r) => tabId == null || r.tabId == tabId);
    forceFinishingUpWebRequest((r) => tabId == null || r.tabId == tabId);

    scheduleEndgame(tabId);
}

function emitRequest(requestId, reqres, error, dontFinishUp) {
    reqresInFlight.delete(requestId);

    reqres.emitTimeStamp = Date.now();

    if (reqres.formData !== undefined) {
        // recover requestBody from formData
        let contentType = getHeaderValue(reqres.requestHeaders, "Content-Type") || "";
        let parts = contentType.split(";");
        if (parts[0] == "application/x-www-form-urlencoded") {
            let bodyParts = [];
            for (const [name, value] of Object.entries(reqres.formData)) {
                bodyParts.push(
                    `${encodeURIComponent(name)}=${encodeURIComponent(value.join("")).replace(/%20/g, "+")}`,
                );
            }
            let enc = new TextEncoder("utf-8", { fatal: true });
            reqres.requestBody.push(enc.encode(bodyParts.join("&")));
        } else if (parts[0] == "multipart/form-data") {
            let boundary;
            for (let i = 1; i < parts.length; ++i) {
                if (parts[i].startsWith("boundary=")) {
                    boundary = parts[i].substr(9);
                    break;
                }
            }

            if (config.debugging)
                console.log(reqres.formData);

            let enc = new TextEncoder("utf-8", { fatal: true });

            if (boundary !== undefined) {
                for (const [name, value] of Object.entries(reqres.formData)) {
                    let data = enc.encode("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + encodeURIComponent(name) + "\"\r\n\r\n" + value.join("") + "\r\n")
                    reqres.requestBody.push(data);
                }

                let epilog = enc.encode("--" + boundary + "--\r\n");
                reqres.requestBody.push(epilog);
            } else
                console.warn("can't recover requestBody from formData, unknown Content-Type format", contentType);
        } else
            console.warn("can't recover requestBody from formData, unknown Content-Type format", contentType);
        delete reqres["formData"];
    }

    if (error !== undefined) {
        if (isUnknownError(error))
            console.error("emitRequest", requestId, "error", error, reqres);
        reqres.errors.push(error);
    }

    reqresFinishingUp.push(reqres);
    if (!dontFinishUp)
        processFinishingUp();
}

function logEvent(rtype, e, reqres) {
    if (config.debugging)
        console.warn("EVENT webRequest",
                     rtype,
                     "requestId", e.requestId,
                     "tabId", e.tabId,
                     "url", e.url,
                     "event", e,
                     "reqres", reqres);
}

// reqres

function shallowCopyOfReqres(reqres) {
    return {
        sessionId: reqres.sessionId,
        requestId: reqres.requestId,
        tabId: reqres.tabId,
        fromExtension: reqres.fromExtension,

        protocol: reqres.protocol,

        method: reqres.method,
        url: reqres.url,

        documentUrl: reqres.documentUrl,
        originUrl: reqres.originUrl,
        errors: Array.from(reqres.errors),

        requestTimeStamp: reqres.requestTimeStamp,
        requestComplete: reqres.requestComplete,

        sent: reqres.sent,
        responded: reqres.responded,

        responseTimeStamp: reqres.responseTimeStamp,
        statusLine: reqres.statusLine,
        statusCode: reqres.statusCode,
        reason: reqres.reason,
        fromCache: reqres.fromCache,
        responseComplete: reqres.responseComplete,

        redirectUrl: reqres.redirectUrl,

        emitTimeStamp: reqres.emitTimeStamp,
    };
}

function addLoggableFields(loggable) {
    // status in wrrarms
    loggable.status = (loggable.requestComplete ? "C" : "I") +
        (loggable.responded
         ? loggable.statusCode.toString() + (loggable.responseComplete ? "C" : "I")
         : "N");
}

function copyLoggableFields(loggable, clean) {
    clean.status = loggable.status;
}

function deleteLoggableFields(loggable) {
    delete loggable["status"];
}

function makeLoggableReqres(reqres) {
    let loggable = shallowCopyOfReqres(reqres);
    addLoggableFields(loggable);
    return loggable;
}

function updateLoggable(loggable) {
    if (loggable.sessionId !== sessionId)
        return;

    let options = getOriginConfig(loggable.tabId, loggable.fromExtension);
    if (loggable.bucket !== options.bucket) {
        loggable.bucket = options.bucket;
        loggable.dirty = true;
    }
}

// handlers

let workaroundFirstRequest = true;

function handleBeforeRequest(e) {
    // don't do anything if we are globally disabled
    if (!config.collecting) return;

    // ignore data, file, end extension URLs
    // NB: file: URL only happen on Chromium, Firefox does not emit those
    if (isBoringURL(e.url))
        return;

    let initiator;
    if (isDefinedURL(e.documentUrl))
        initiator = e.documentUrl; // Firefox
    else if (isDefinedURL(e.initiator) && e.initiator !== "null")
        initiator = e.initiator; // Chromium

    let fromExtension = false;
    if (initiator !== undefined) {
        // ignore our own requests
        if (initiator.startsWith(selfURL) // Firefox
            || (initiator + "/") == selfURL) // Chromium
            return;

        // request originates from another extension
        if (isExtensionURL(initiator))
            fromExtension = true;
    }

    // ignore this request if archiving is disabled for this tab or extension
    let options = getOriginConfig(e.tabId, fromExtension);
    if (!options.collecting) return;

    logEvent("BeforeRequest", e, undefined);

    // Should we generate and then immediately cancel this reqres?
    let reject = false;

    // On Chromium, cancel all requests from a tab that is not yet debugged,
    // start debugging, and then reload the tab.
    if (useDebugger && e.tabId !== -1
        && !tabsDebugging.has(e.tabId)
        && (e.url.startsWith("http://") || e.url.startsWith("https://"))) {
        if (config.debugging)
            console.warn("canceling and restarting request to", e.url, "as tab", e.tabId, "is not managed yet");
        if (e.type == "main_frame") {
            // attach debugger and reload the main flame
            attachDebuggerAndReloadTab(e.tabId).catch(logError);
            // not using
            //   resetAttachDebuggerAndNavigateTab(e.tabId, e.url).catch(logError);
            // or
            //   resetAttachDebuggerAndReloadTab(e.tabId).catch(logError);
            // bacause they reset the referrer
            return { cancel: true };
        } else
            // cancel it, but generate a reqres for it, so that it would be
            // logged
            reject = true;
    }

    // On Firefox, cancel the very first navigation request, redirect the tab
    // to `about:blank`, and then reload the tab with the original URL to
    // work-around a Firefox bug where it will fail to run `onstop` for the
    // `filterResponseData` of the very first request, thus breaking it.
    if (!useDebugger && workaroundFirstRequest) {
        workaroundFirstRequest = false;
        if (config.workaroundFirefoxFirstRequest
            && e.tabId !== -1
            && initiator === undefined
            && e.type == "main_frame"
            && (e.url.startsWith("http://") || e.url.startsWith("https://"))) {
            if (config.debugging)
                console.warn("canceling and restarting request to", e.url, "to workaround a bug in Firefox");
            resetAndNavigateTab(e.tabId, e.url).catch(logError);
            return { cancel: true };
        }
    }

    let requestId = e.requestId;
    let reqres = {
        sessionId,
        requestId,
        tabId: e.tabId,
        fromExtension,

        method: e.method,
        url: e.url,

        errors: [],

        requestTimeStamp: e.timeStamp,
        requestHeaders: [],
        requestBody: new ChunkedBuffer(),
        requestComplete: true,

        sent: false,
        responded: false,

        responseHeaders : [],
        responseBody: new ChunkedBuffer(),
        responseComplete: false,
        fromCache: false,
    };

    if (isDefinedURL(e.documentUrl))
        reqres.documentUrl = e.documentUrl;

    if (isDefinedURL(e.originUrl))
        reqres.originUrl = e.originUrl; // Firefox
    else if (isDefinedURL(e.initiator) && e.initiator !== "null")
        reqres.originUrl = e.initiator; // Chromium

    if (e.requestBody !== undefined && e.requestBody !== null) {
        if (e.requestBody.raw !== undefined) {
            let raw = e.requestBody.raw;
            let complete = true;
            for (let i = 0; i < raw.length; ++i) {
                let el = raw[i].bytes;
                if (el === undefined) {
                    complete = false;
                    continue;
                }
                reqres.requestBody.push(new Uint8Array(el));
            }
            reqres.requestComplete = complete;
        } else if (e.requestBody.formData !== undefined) {
            reqres.formData = e.requestBody.formData;
            reqres.requestComplete = false;
        }
    }

    if (reject) {
        reqres.errors.push("webRequest::pWebArc::NO_DEBUGGER::CANCELED")
        reqresAlmostDone.push(reqres);
        scheduleEndgame(e.tabId);
        return { cancel: true };
    }

    if (!useDebugger) {
        // Firefox
        let filter = browser.webRequest.filterResponseData(requestId);
        filter.onstart = (event) => {
            if (config.debugging)
                console.log("filterResponseData", requestId, "started");
        };
        filter.ondata = (event) => {
            if (config.debugging)
                console.log("filterResponseData", requestId, "chunk", event.data);
            reqres.responseBody.push(new Uint8Array(event.data));
            filter.write(event.data);
        };
        filter.onstop = (event) => {
            if (config.debugging)
                console.log("filterResponseData", requestId, "finished");
            reqres.responseComplete = true;
            filter.disconnect();
            scheduleFinishingUp(); // in case we were waiting for this filter
        };
        filter.onerror = (event) => {
            if (filter.error !== "Invalid request ID") {
                // if filter was actually started
                let error = "filterResponseData::" + filter.error;
                if (isUnknownError(error))
                    console.error("filterResponseData", requestId, "error", error);
                reqres.errors.push(error);
            }
            scheduleFinishingUp(); // in case we were waiting for this filter
        };

        reqres.filter = filter;
    }

    reqresInFlight.set(requestId, reqres);
    broadcast(["newInFlight", [makeLoggableReqres(reqres)]]);
    scheduleUpdateDisplay(true, e.tabId);
}

function handleBeforeSendHeaders(e) {
    let reqres = reqresInFlight.get(e.requestId);
    if (reqres === undefined) return;

    logEvent("BeforeSendHeaders", e, reqres);
}

function handleSendHeaders(e) {
    let reqres = reqresInFlight.get(e.requestId);
    if (reqres === undefined) return;

    logEvent("SendHeaders", e, reqres);
    reqres.sent = true;
    reqres.requestHeaders = e.requestHeaders;
}

function completedCopyOfReqres(reqres) {
    let res = shallowCopyOfReqres(reqres);
    // copy what shallowCopyOfReqres does not
    res.requestHeaders = reqres.requestHeaders;
    res.requestBody = reqres.requestBody;
    res.formData = reqres.formData;
    res.responseHeaders = reqres.responseHeaders;
    // set responseBody to an empty buffer
    res.responseBody = new ChunkedBuffer();
    // and mark as complete, as the name implies
    res.responseComplete = true;
    // alno note that we ignore the filter here
    return res;
}

function fillResponse(reqres, e) {
    reqres.responded = true;
    reqres.responseTimeStamp = e.timeStamp;
    reqres.statusCode = e.statusCode;
    reqres.statusLine = e.statusLine;
    reqres.responseHeaders = e.responseHeaders;
    reqres.fromCache = e.fromCache;
}

function handleHeadersRecieved(e) {
    let reqres = reqresInFlight.get(e.requestId);
    if (reqres === undefined) return;

    logEvent("HeadersRecieved", e, reqres);

    if (reqres.responded) {
        // the browser can call this multiple times for the same request, e.g.
        // when sending If-Modified-Since and If-None-Match and receiving
        // 304 response.

        // So, we emit a completed copy of this with an empty response body
        let creqres = completedCopyOfReqres(reqres);
        emitRequest(e.requestId, creqres);

        // and continue with the old one (not vice versa, because the filter
        // refers to the old one, and changing that reference would be
        // impossible, since it's asynchronous)
        reqresInFlight.set(e.requestId, reqres);
    }

    fillResponse(reqres, e);
}

function handleBeforeRedirect(e) {
    let reqres = reqresInFlight.get(e.requestId);
    if (reqres === undefined) return;

    logEvent("BeforeRedirect", e, reqres);

    if (!reqres.responded) {
        // this happens when a request gets redirected right after
        // handleBeforeRequest by another extension
        fillResponse(reqres, e);

        if (!useDebugger && reqres.statusCode === 0) {
            // workaround internal Firefox redirects giving no codes and statuses
            reqres.statusCode = 307;
            reqres.statusLine = "HTTP/1.0 307 Internal Redirect";
            reqres.responseHeaders = [
                { name: "Location", value: e.redirectUrl }
            ];
        }
    }

    reqres.responseComplete = true;
    reqres.redirectUrl = e.redirectUrl;

    emitRequest(e.requestId, reqres);

    // after this it will go back to handleBeforeRequest, so we don't need to
    // copy anything here
}

function handleAuthRequired(e) {
    let reqres = reqresInFlight.get(e.requestId);
    if (reqres === undefined) return;

    logEvent("AuthRequired", e, reqres);

    // similarly to above
    let creqres = completedCopyOfReqres(reqres);
    emitRequest(e.requestId, creqres);

    // after this it will goto back to handleBeforeSendHeaders, so
    reqresInFlight.set(e.requestId, reqres);
}

function handleCompleted(e) {
    let reqres = reqresInFlight.get(e.requestId);
    if (reqres === undefined) return;

    logEvent("Completed", e, reqres);
    emitRequest(e.requestId, reqres);
}

function handleErrorOccurred(e) {
    let reqres = reqresInFlight.get(e.requestId);
    if (reqres === undefined) return;

    logEvent("ErrorOccured", e, reqres);
    emitRequest(e.requestId, reqres, "webRequest::" + e.error);
}

function handleNotificationClicked(notificationId) {
    if (reqresFailedToArchiveByArchivable.size === 0) return;

    browser.tabs.create({
        url: browser.runtime.getURL("/page/help.html#errors"),
    });
}

function chromiumResetRootTab(tabId, tabcfg) {
    // Navigate to `workaroundChromiumResetRootTabURL` instead.
    //
    // NB: `priority` argument here overrides `attachDebuggerAndReloadTab` what
    // `handleBeforeRequest` does. Thus, this action wins.
    resetAttachDebuggerAndNavigateTab(tabId, config.workaroundChromiumResetRootTabURL, 0).catch(logError);
}

function handleTabCreated(tab) {
    let tabId = tab.id;

    if (config.debugging)
        console.log("tab added", tabId, tab.openerTabId);

    if (useDebugger && tab.pendingUrl == "chrome://newtab/") {
        // work around Chrome's "New Tab" action creating a child tab by
        // ignoring openerTabId
        let tabcfg = processNewTab(tabId, undefined);
        // reset its URL, maybe
        if (config.collecting && tabcfg.collecting && config.workaroundChromiumResetRootTab)
            chromiumResetRootTab(tabId, tabcfg);
    } else
        processNewTab(tabId, tab.openerTabId);
}

function handleTabRemoved(tabId) {
    if (config.debugging)
        console.log("tab removed", tabId);
    processRemoveTab(tabId);
}

function handleTabReplaced(addedTabId, removedTabId) {
    if (config.debugging)
        console.log("tab replaced", removedTabId, addedTabId);
    processRemoveTab(removedTabId);
    processNewTab(addedTabId);
}

function handleTabActivated(e) {
    if (config.debugging)
        console.log("tab activated", e.tabId);
    if (useDebugger)
        // Chromium does not provide `browser.menus.onShown` event
        updateMenu(getOriginConfig(e.tabId));
    // Usually, this will not be enough, see `handleTabUpdated`.
    scheduleUpdateDisplay(false, e.tabId);
}

function handleTabUpdated(tabId, changeInfo, tabInfo) {
    if (config.debugging)
        console.log("tab updated", tabId);
    if (/* Firefox */ changeInfo.url !== undefined || /* Chromium */ useDebugger)
        // On Firefox, there's no `tab.pendingUrl`, so `updateDisplay` might
        // get confused about which icon to show for our internal pages
        // narrowed to a tracked tab until `tab.url` is set. Hence, we need to
        // run `scheduleUpdateDisplay` as soon as it is set.
        //
        // On Chromium, Chromium resets the browserAction icon each time tab chages
        // state, so we have to update icons after each one.
        scheduleUpdateDisplay(false, tabId);
}

// open client tab ports
let openPorts = new Map();

// Yes, this overrides the function in ../lib/utils.js
//
// This is the whole point. In normal modules `broadcast` just sends data to
// the `handleMessage` below, which then uses this function to broadcast it to
// all connected ports. And this module uses this function directly instead.
// (So, this module is the center of a star message-passing topology.)
function broadcast(data) {
    if (config.debugging)
        console.log("broadcasting", data);

    for (let [portId, port] of openPorts.entries()) {
        port.postMessage(data);
    }
}

function handleConnect(port) {
    let portId;
    if (useDebugger) {
        if (port.sender.tab !== undefined)
            portId = port.sender.tab.id;
        else
            portId = port.sender.url;
    } else
        portId = port.sender.contextId;
    if (config.debugging)
        console.log("port opened", portId, port);
    openPorts.set(portId, port);
    port.onDisconnect.addListener(catchAll(() => {
        if (config.debugging)
            console.log("port disconnected", portId);
        openPorts.delete(portId);
    }));
}

function handleMessage(request, sender, sendResponse) {
    if (config.debugging)
        console.log("got message", request);

    let cmd = request[0];
    switch (cmd) {
    case "getSessionId":
        sendResponse(sessionId);
        break;
    case "getConfig":
        sendResponse(config);
        break;
    case "setConfig":
        let oldConfig = config;
        config = updateFromRec(assignRec({}, oldConfig), request[1]);

        fixConfig(config, oldConfig);

        if (!config.ephemeral && !equalRec(oldConfig, config))
            // save config after a little pause to give the user time to click
            // the same toggle again without torturing the SSD
            scheduleSaveConfig();

        if (useDebugger)
            syncDebuggersState();

        if (oldConfig.archiveSubmitHTTP !== config.archiveSubmitHTTP)
            wantArchiveDoneNotify = true;

        if (config.stash && oldConfig.stash != config.stash)
            stashAll(false);

        if (config.archive && oldConfig.archive !== config.archive)
            scheduleRetryFailed(0, false);

        scheduleUpdateDisplay(true, null);
        broadcast(["updateConfig", config]);
        sendResponse(null);
        break;
    case "resetConfig":
        config = assignRec({}, configDefaults);
        scheduleSaveConfig();
        scheduleUpdateDisplay(true, null);
        broadcast(["updateConfig", config]);
        sendResponse(null);
        break;
    case "getOriginConfig":
        sendResponse(getOriginConfig(request[1], request[2]));
        break;
    case "setOriginConfig":
        setOriginConfig(request[1], request[2], request[3]);
        sendResponse(null);
        break;
    case "getStats":
        sendResponse(getStats());
        break;
    case "resetPersistentStats":
        resetPersistentStats();
        break;
    case "getTabStats":
        sendResponse(getTabStats(request[1]));
        break;
    case "getProblematicLog":
        sendResponse(getProblematicLog());
        break;
    case "unmarkProblematic":
        unmarkProblematic(request[1], request[2], request[3]);
        sendResponse(null);
        break;
    case "rotateProblematic":
        rotateProblematic(request[1], request[2], request[3]);
        sendResponse(null);
        break;
    case "getInFlightLog":
        sendResponse(getInFlightLog());
        break;
    case "stopAllInFlight":
        stopAllInFlight(request[1]);
        sendResponse(null);
        break;
    case "getInLimboLog":
        sendResponse(getInLimboLog());
        break;
    case "popInLimbo":
        popInLimbo(request[1], request[2], request[3], request[4]);
        sendResponse(null);
        break;
    case "rotateInLimbo":
        rotateInLimbo(request[1], request[2], request[3]);
        sendResponse(null);
        break;
    case "getLog":
        sendResponse(reqresLog);
        break;
    case "forgetHistory":
        forgetHistory(request[1], request[2]);
        sendResponse(null);
        break;
    case "getQueuedLog":
        sendResponse(getQueuedLog());
        break;
    case "getFailedLog":
        sendResponse(getFailedLog());
        break;
    case "retryFailed":
        scheduleRetryFailed(0, true);
        // technically, we need
        //scheduleUpdateDisplay(true, null);
        // here, but it would be useless, since timeout is 0
        sendResponse(null);
        break;
    case "getSavedFilters":
        sendResponse(savedFilters);
        break;
    case "setSavedFilters":
        savedFilters = updateFromRec(savedFilters, request[1]);
        broadcast(["setSavedFilters", savedFilters]);
        broadcast(["resetSaved", [null]]); // invalidate UI
        wantBroadcastSaved = true;
        scheduleEndgame(null);
        sendResponse(null);
        break;
    case "requeueSaved":
        requeueSaved(request[1]);
        sendResponse(null);
        break;
    case "deleteSaved":
        deleteSaved();
        sendResponse(null);
        break;
    case "forgetErrored":
        forgetErrored();
        sendResponse(null);
        break;
    case "stashAll":
        stashAll(true);
        sendResponse(null);
        break;
    case "retryUnstashed":
        retryUnstashed();
        sendResponse(null);
        break;
    case "snapshotTab":
        snapshotTab(request[1]);
        sendResponse(null);
        break;
    case "runAllActions":
        runAllActions();
        sendResponse(null);
        break;
    case "cancelAllActions":
        cancelAllActions();
        sendResponse(null);
        break;
    case "exportAsAll":
        scheduleExportAsAll(0, request[1]);
        sendResponse(null);
        break;
    case "broadcast":
        broadcast(request[1]);
        sendResponse(null);
        break;
    default:
        console.error("what?", request);
        throw new Error("what request?");
    }
}

let menuTitleTab = {
    true: "Open Link in New Tracked Tab",
    false: "Open Link in New Untracked Tab",
}
let menuTitleWindow = {
    true: "Open Link in New Tracked Window",
    false: "Open Link in New Untracked Window",
}
let menuIcons = {
    true: mkIcons("idle"),
    false: mkIcons("off"),
}
let menuOldState = true;

function updateMenu(tabcfg) {
    let newState = !tabcfg.children.collecting;

    if (menuOldState === newState) return;
    menuOldState = newState;

    if (useDebugger) {
        browser.menus.update("open-not-tab", { title: menuTitleTab[newState] });
        browser.menus.update("open-not-window", { title: menuTitleWindow[newState] });
    } else {
        browser.menus.update("open-not-tab", { title: menuTitleTab[newState], icons: menuIcons[newState] });
        browser.menus.update("open-not-window", { title: menuTitleWindow[newState], icons: menuIcons[newState] });
    }
}

function initMenus() {
    browser.menus.create({
        id: "open-not-tab",
        contexts: ["link"],
        title: menuTitleTab[true],
    });

    browser.menus.create({
        id: "open-not-window",
        contexts: ["link"],
        title: menuTitleWindow[true],
    });

    if (!useDebugger) {
        browser.menus.update("open-not-tab", { icons: menuIcons[true] });
        browser.menus.update("open-not-window", { icons: menuIcons[true] });

        // Firefox provides `browser.menus.onShown` event, so `updateMenu` can be called on-demand
        browser.menus.onShown.addListener(catchAll((info, tab) => {
            if (tab === undefined) return;
            updateMenu(getOriginConfig(tab.id));
            browser.menus.refresh();
        }));
    }

    browser.menus.onClicked.addListener(catchAll((info, tab) => {
        if (config.debugging)
            console.log("menu action", info, tab);

        let url = info.linkUrl;
        let newWindow = info.menuItemId === "open-not-window"
            && (url.startsWith("http:") || url.startsWith("https:"));

        negateConfigFor.add(tab.id);
        if (useDebugger)
            // work around Chromium bug
            negateOpenerTabIds.push(tab.id);

        browser.tabs.create({
            url,
            openerTabId: tab.id,
            windowId: tab.windowId,
        }).then((tab) => {
            if (config.debugging)
                console.log("created new tab", tab);

            if (!useDebugger && tab.url.startsWith("about:"))
                // On Firefox, downloads spawned as new tabs become "about:blank"s and get closed.
                // Spawning a new window in this case is counterproductive.
                newWindow = false;

            if (newWindow)
                browser.windows.create({ tabId: tab.id }).catch(logError);
        }, logError);
    }));
}

async function handleCommand(command) {
    let tab = await getActiveTab();
    if (tab === null)
        return;
    // The map is set this way so that show-state -> show-tab-state would open
    // the state narrowed to background tasks. This is not very intuitive but
    // rather useful.
    let tabId = getMapURLParam(stateURL, "tab", new URL(getTabURL(tab, "")), toNumber, -1, tab.id);

    let tabcfg = undefined;
    switch (command) {
    case "showState":
        showState("", "top", tab.id);
        return;
    case "showLog":
        showState("", "tail", tab.id);
        return;
    case "showTabState":
        showState(`?tab=${tabId}`, "top", tab.id);
        return;
    case "showTabLog":
        showState(`?tab=${tabId}`, "tail", tab.id);
        return;
    case "unmarkAllProblematic":
        unmarkProblematic(null, null);
        return;
    case "collectAllInLimbo":
        popInLimbo(true, null, null);
        return;
    case "discardAllInLimbo":
        popInLimbo(false, null, null);
        return;
    case "unmarkAllTabProblematic":
        unmarkProblematic(null, tabId);
        return;
    case "collectAllTabInLimbo":
        popInLimbo(true, null, tabId);
        return;
    case "discardAllTabInLimbo":
        popInLimbo(false, null, tabId);
        return;
    case "snapshotAll":
        snapshotTab(null);
        return;
    case "snapshotTab":
        snapshotTab(tabId);
        return;
    case "toggleTabConfigTracking":
        tabcfg = getOriginConfig(tabId);
        tabcfg.collecting = !tabcfg.collecting;
        tabcfg.children.collecting = tabcfg.collecting;
        break;
    case "toggleTabConfigChildrenTracking":
        tabcfg = getOriginConfig(tabId);
        tabcfg.children.collecting = !tabcfg.children.collecting;
        break;
    case "toggleTabConfigLimbo":
        tabcfg = getOriginConfig(tabId);
        tabcfg.limbo = !tabcfg.limbo;
        tabcfg.children.limbo = tabcfg.limbo;
        break;
    case "toggleTabConfigChildrenLimbo":
        tabcfg = getOriginConfig(tabId);
        tabcfg.children.limbo = !tabcfg.children.limbo;
        break;
    default:
        console.error(`unknown command ${command}`);
        return;
    }

    setOriginConfig(tabId, false, tabcfg);
}

function fixConfig(cfg, old) {
    if (reqresIDB === undefined)
        cfg.preferIndexedDB = false;
    else if (useDebugger)
        // can not be disabled on Chromium ATM, since serialization of
        // Uint8Array to `storage.local` won't work there
        cfg.preferIndexedDB = true;

    let anyA = cfg.archiveExportAs || cfg.archiveSubmitHTTP || cfg.archiveSaveLS;
    if (!anyA) {
        // at lest one of these must be set
        if (cfg.archiveSaveLS !== old.archiveSaveLS)
            cfg.archiveExportAs = true;
        else
            cfg.archiveSaveLS = true;
    }

    // to prevent surprises
    if (cfg.archive
        && (reqresQueue.length > 0 || reqresFailedToArchiveByArchivable.size > 0)
        && (cfg.archiveExportAs !== old.archiveExportAs
         || cfg.archiveSubmitHTTP !== old.archiveSubmitHTTP
         || cfg.archiveSaveLS !== old.archiveSaveLS))
        cfg.archive = false;

    // clamp
    cfg.exportAsTimeout = clamp(0, 900, cfg.exportAsTimeout);
    cfg.exportAsInFlightTimeout = clamp(cfg.exportAsTimeout, 900, cfg.exportAsInFlightTimeout);

    // these are mutually exclusive
    if (cfg.autoPopInLimboCollect !== old.autoPopInLimboCollect)
        cfg.autoPopInLimboDiscard = cfg.autoPopInLimboDiscard && !cfg.autoPopInLimboCollect;
    else
        cfg.autoPopInLimboCollect = cfg.autoPopInLimboCollect && !cfg.autoPopInLimboDiscard;
}

function upgradeConfig(cfg) {
    function rename(from, to) {
        let old = cfg[from];
        delete cfg[from];
        cfg[to] = old;
    }

    switch (cfg.version) {
    case 1:
        rename("collectPartialRequests", "archivePartialRequest");
        rename("collectNoResponse", "archiveNoResponse");
        rename("collectIncompleteResponses", "archiveIncompleteResponse")
    case 2:
        // because it got updated lots
        cfg.seenHelp = false;
    case 3:
        // making them disjoint
        if (cfg.markProblematicWithErrors)
            cfg.markProblematicPickedWithErrors = true;
        rename("markProblematicWithErrors", "markProblematicDroppedWithErrors")
    case 4:
        // because that, essentially, was the default before, even though it is not now
        cfg.archiveSubmitHTTP = true;
        cfg.archiveSaveLS = false;

        rename("archiving", "archive")
        rename("archiveURLBase", "submitHTTPURLBase");
        rename("archiveNotifyOK", "archiveDoneNotify")
        rename("archiveNotifyFailed", "archiveFailedNotify")
        rename("archiveNotifyDisabled", "archiveStuckNotify")

        config.root.bucket = config.root.profile;
        config.extension.bucket = config.extension.profile;
        config.background.bucket = config.background.profile;
    case 5:
        break;
    default:
        console.warn(`Bad old config version ${cfg.version}, reusing values as-is without updates`);
        // the following updateFromRec will do its best
    }

    return cfg;
}

function upgradeGlobals(globs) {
    if (globs.version === undefined)
        globs.version = 1;

    return globs;
}

async function init() {
    browser.runtime.onUpdateAvailable.addListener(catchAll(handleUpdateAvailable));

    let localData = await browser.storage.local.get([
        "config", "globals", "persistentStats", "globalStats"
    ]).catch(() => { return {}; });

    let oldConfig = localData.config;
    if (oldConfig !== undefined) {
        console.log(`Loading old config of version ${oldConfig.version}`);

        oldConfig  = upgradeConfig(oldConfig);
        config = updateFromRec(config, oldConfig);
    }

    let oldGlobals = localData.globals;
    if (oldGlobals === undefined)
        oldGlobals = localData.persistentStats;
    if (oldGlobals === undefined)
        oldGlobals = localData.globalStats;

    if (oldGlobals !== undefined) {
        console.log(`Loading old globals of version ${oldGlobals.version}`);

        oldGlobals = upgradeGlobals(oldGlobals);
        globals = updateFromRec(globals, oldGlobals);
    }

    config.version = configVersion;
    config.ephemeral = false;
    if (config.seenChangelog && config.lastSeenVersion != manifest.version) {
        // reset `config.seenChangelog` when major version changes
        let vOld = config.lastSeenVersion.split(".");
        let vNew = manifest.version.split(".").slice(0, 2);
        config.seenChangelog = vNew.every((e, i) => e == vOld[i]);
    }
    config.lastSeenVersion = manifest.version;

    if (false) {
        // for debugging
        config.ephemeral = true;
    }

    // get all currently open tabs
    let tabs = await browser.tabs.query({});
    for (let tab of tabs) {
        // record them
        openTabs.add(tab.id);

        // compute and cache their configs
        let tabcfg = getOriginConfig(tab.id);
        // on Chromium, reset their URLs, maybe
        if (useDebugger
            && config.collecting && tabcfg.collecting && config.workaroundChromiumResetRootTab
            && tab.pendingUrl == "chrome://newtab/")
            chromiumResetRootTab(tab.id, tabcfg);
    }

    // try opening indexedDB
    try {
        reqresIDB = await idbOpen("pwebarc", 1, (db, oldVersion, newVersion) => {
            db.createObjectStore("dump", { autoIncrement: true });
            db.createObjectStore("stash", { autoIncrement: true });
            db.createObjectStore("save", { autoIncrement: true });
        });
    } catch (err) {
        logHandledError(err);
    }

    if (reqresIDB === undefined && (globals.stashedIDB.number > 0 || globals.savedIDB.number > 0)) {
        browser.notifications.create("noIndexedDB", {
            title: "pWebArc: ERROR",
            message: `Failed to open/create a database via \`IndexedDB\` API, all data persistence will be done via \`storage.local\` API instead. This is not ideal, but not particularly bad. However, the critical issue is that it appears pWebArc previously used \`IndexedDB\` for archiving and/or stashing reqres.\n\nSee the "Help" page for more info and instructions on how to fix this.`,
            iconUrl: iconURL("error", 128),
            type: "basic",
        }).catch(logError);
    }

    await loadStashed();

    fixConfig(config, config);

    console.log(`initialized pWebArc with source of '${sourceDesc}'`);
    console.log("runtime options are", { useSVGIcons, useBlocking, useDebugger });
    console.log("config is", config);
    console.log("globals are", globals);

    if (useBlocking)
        browser.webRequest.onBeforeRequest.addListener(catchAll(handleBeforeRequest), {urls: ["<all_urls>"]}, ["blocking", "requestBody"]);
    else
        browser.webRequest.onBeforeRequest.addListener(catchAll(handleBeforeRequest), {urls: ["<all_urls>"]}, ["requestBody"]);
    browser.webRequest.onBeforeSendHeaders.addListener(catchAll(handleBeforeSendHeaders), {urls: ["<all_urls>"]});
    browser.webRequest.onSendHeaders.addListener(catchAll(handleSendHeaders), {urls: ["<all_urls>"]}, ["requestHeaders"]);
    browser.webRequest.onHeadersReceived.addListener(catchAll(handleHeadersRecieved), {urls: ["<all_urls>"]}, ["responseHeaders"]);
    browser.webRequest.onBeforeRedirect.addListener(catchAll(handleBeforeRedirect), {urls: ["<all_urls>"]}, ["responseHeaders"]);
    browser.webRequest.onAuthRequired.addListener(catchAll(handleAuthRequired), {urls: ["<all_urls>"]});
    browser.webRequest.onCompleted.addListener(catchAll(handleCompleted), {urls: ["<all_urls>"]});
    browser.webRequest.onErrorOccurred.addListener(catchAll(handleErrorOccurred), {urls: ["<all_urls>"]});

    browser.notifications.onClicked.addListener(catchAll(handleNotificationClicked));

    browser.tabs.onCreated.addListener(catchAll(handleTabCreated));
    browser.tabs.onRemoved.addListener(catchAll(handleTabRemoved));
    browser.tabs.onReplaced.addListener(catchAll(handleTabReplaced));
    browser.tabs.onActivated.addListener(catchAll(handleTabActivated));
    browser.tabs.onUpdated.addListener(catchAll(handleTabUpdated));

    browser.commands.onCommand.addListener(catchAll(handleCommand));

    browser.runtime.onMessage.addListener(catchAll(handleMessage));
    browser.runtime.onConnect.addListener(catchAll(handleConnect));

    initMenus();

    if (useDebugger)
        await initDebugger(tabs);

    await updateDisplay(true, null);

    console.log("pWebArc is ready!");

    if (config.autoPopInLimboDiscard || config.discardAll) {
        let what = [];
        if (config.autoPopInLimboDiscard)
            what.push(`"Auto-discard reqres in limbo"`);
        if (config.discardAll)
            what.push(`"Discard all reqres just before archival"`);
        browser.notifications.create("autoDiscard", {
            title: "pWebArc: REMINDER",
            message: `Some auto-discarding options are enabled: ${what.join(", ")}.`,
            iconUrl: iconURL("limbo", 128),
            type: "basic",
        }).catch(logError);
    }

    scheduleComplaints(1000);
}

init();
