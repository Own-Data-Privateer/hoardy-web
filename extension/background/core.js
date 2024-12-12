/*
 * The core code of `Hoardy-Web`.
 *
 * Contains HTTP request+response capture via browser's WebRequest API and
 * some middle-ware APIs used by the UI parts of `Hoardy-Web`.
 *
 * Copyright (c) 2023-2024 Jan Malakhovski <oxij@oxij.org>
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

"use strict";

// NB: "reqres" means "request + response"

// current session ID, to prevent old reqres from being counted as belonging
// to current tabs, etc
let sessionId = Date.now();

// default config
let configVersion = 6;
let configDefaults = {
    version: configVersion,

    // behavior
    history: 1024,
    autoReloadOnUpdates: false,

    // user interface
    colors: null,
    colorblind: false,
    seasonal: true,
    season: {
        halloween: null,
    },
    pureText: false,
    animateIcon: 500,
    spawnNewTabs: !isMobile,

    // notifications
    verbose: true,
    hintNotify: true,
    invisibleUINotify: true,

    // work offline settings
    workOfflineImpure: false,
    workOfflineFile: true,
    workOfflineData: false,

    // Firefox workarounds
    workaroundFirefoxFirstRequest: true,

    // Chromium workarounds
    workaroundChromiumResetRootTab: true,
    workaroundChromiumResetRootTabURL: "about:blank",
    workaroundChromiumDebugTimeout: 3,

    // persistence

    // should we stash unarchived reqres to local storage?
    stash: true,
    // are we archiving? or temporarily paused
    archive: true,

    // prefer `IndexedDB` to `storage.local` for stashing and saving?
    preferIndexedDB: useDebugger,
    // GZip dumps written to local storage
    gzipLSDumps: true,

    // export via exportAs
    archiveExportAs: false,
    exportAsHumanReadable: true,
    exportAsBundle: true,
    exportAsMaxSize: 32,
    exportAsTimeout: 3,
    exportAsInFlightTimeout: 60,
    gzipExportAs: true,

    // submission via HTTP
    archiveSubmitHTTP: false,
    submitHTTPURLBase: "http://127.0.0.1:3210/pwebarc/dump",

    // saving to local storage
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
    // problematic notifications
    problematicNotify: true,
    problematicNotifyNumber: 3,

    // picking options
    archivePartialRequest: true,
    archiveCanceled: false,
    archiveNoResponse: false,
    archiveIncompleteResponse: false,
    archive1xxCodes: true,
    archive3xxCodes: true,
    archiveTransientCodes: true,
    archivePermanentCodes: true,
    archiveWithErrors: true,

    // limbo notifications
    limboMaxNumber: 1024,
    limboMaxSize: 128,
    limboNotify: true,

    // automatic actions
    autoUnmarkProblematic: false,
    autoPopInLimboCollect: false,
    autoPopInLimboDiscard: false,
    // automatic actions notifications
    autoTimeout: 1,
    autoNotify: true,

    // are in work offline mode?
    workOffline: false,
    // are we collecting new data?
    collecting: true,

    root: {
        snapshottable: true,
        workOffline: false,
        collecting: true,
        problematicNotify: true,
        limbo: false,
        negLimbo: false,
        stashLimbo: true,
        bucket: "default",
    },

    extension: {
        workOffline: false,
        collecting: false,
        problematicNotify: true,
        limbo: false,
        negLimbo: false,
        stashLimbo: true,
        bucket: "extension",
    },

    background: {
        workOffline: false,
        collecting: true,
        problematicNotify: true,
        limbo: false,
        negLimbo: false,
        stashLimbo: true,
        bucket: "background",
    },

    // debugging options
    debugging: false, // verbose debugging logs
    discardAll: false, // drop all reqres on archival
    dumping: false, // dump dumps to console
    ephemeral: false, // stop the config from being saved to disk
    snapshotAny: false, // snapshot isBoringURL

    // meta
    lastSeenVersion: manifest.version,
    seenChangelog: true,
    seenHelp: false,
};
// current config
let config = assignRec({}, configDefaults);
// last config saved in storage
let savedConfig = undefined;

async function saveConfig() {
    if (equalRec(savedConfig, config))
        return;
    savedConfig = assignRec({}, config);
    if (config.debugging)
        console.log("saving config", savedConfig);
    await browser.storage.local.set({ config: savedConfig }).catch(logError);
}

function asyncSaveConfig() {
    scheduleAction(scheduledSaveState, "saveConfig", 1000, () => {
        saveConfig();
    });
    // NB: needs scheduleUpdateDisplay afterwards
}

let runningActions = new Set();

// a list of [function, args] pairs; these are closures that need to be run synchronously
let synchronousClosures = [];

// syntax sugar
function runSynchronously(name, func, ...args) {
    synchronousClosures.push([name, func, args]);
}

// scheduled cancelable functions
let scheduledCancelable = new Map();
// scheduled retries
let scheduledRetry = new Map();
// scheduled delayed functions
let scheduledDelayed = new Map();
// scheduled save state functions
let scheduledSaveState = new Map();
// scheduled internal functions
let scheduledInternal = new Map();
// scheduled internal functions hidden from the UI
let scheduledHidden = new Map();

function syncRunActions() {
    runSynchronously("runAll", async () => {
        //await runAllSingletonTimeouts(scheduledCancelable);
        await runAllSingletonTimeouts(scheduledDelayed);
        await runAllSingletonTimeouts(scheduledSaveState);
    });
}

function syncCancelActions() {
    runSynchronously("cancelAll", async () => {
        await cancelAllSingletonTimeouts(scheduledCancelable);
        await cancelAllSingletonTimeouts(scheduledDelayed);
        await cancelAllSingletonTimeouts(scheduledRetry);
    });
}

// TODO topologically, updateDisplay goes here

// Schedule a given function using resetSingletonTimeout.
// The scheduled function is experted to return `updatedTabId` value.
function scheduleActionExtra(map, key, priority, timeout, hurry, func, endgame) {
    let value = resetSingletonTimeout(map, key, timeout, func, priority, hurry);
    if (value === undefined)
        // it was already scheduled (and might have been re-scheduled), no nothing
        return;

    value.before.push(async () => {
        if (config.debugging)
            console.warn("running", key);
        runningActions.add(key);
        await forceUpdateDisplay(true);
    });
    value.after.push(async (results) => {
        if (config.debugging)
            console.warn("finished", key, results);
        runningActions.delete(key);

        // merge results of all performed updates
        let updatedTabId;
        for (let res of results)
            updatedTabId = mergeUpdatedTabIds(updatedTabId, res)

        if (endgame)
            scheduleEndgame(updatedTabId);
        else
            await forceUpdateDisplay(true, updatedTabId);
    });
    return value;
}

function scheduleAction(map, key, timeout, func) {
    return scheduleActionExtra(map, key, 100, timeout, false, func, false);
}

function scheduleActionEndgame(map, key, timeout, func) {
    return scheduleActionExtra(map, key, 100, timeout, false, func, true);
}

async function sleepResetTab(tabId, priority, resetFunc, preFunc, actionFunc) {
    scheduleActionExtra(scheduledInternal, `reset-tab#${tabId}`, priority, 100, true, async () => {
        let r;
        if (resetFunc !== undefined)
            r = await resetFunc(tabId);
        scheduleActionExtra(scheduledInternal, `reload-tab#${tabId}`, priority, 300, true, async () => {
            try {
                if (preFunc !== undefined)
                    await preFunc(tabId);
                if (actionFunc !== undefined)
                    await actionFunc(tabId, r);
            } catch (err) {
                logError(err);
            }
        }, false);
    }, false);
}

function resetAndNavigateTab(tabId, url, priority) {
    return sleepResetTab(tabId, priority,
                         navigateTabToBlank, undefined,
                         (tabId, _ignored) => navigateTabTo(tabId, url));
}

function resetAttachDebuggerAndNavigateTab(tabId, url, priority) {
    return sleepResetTab(tabId, priority,
                         navigateTabToBlank, attachDebugger,
                         (tabId, _ignored) => navigateTabTo(tabId, url));
}

function resetAttachDebuggerAndReloadTab(tabId, priority) {
    return sleepResetTab(tabId, priority,
                         getTabURLThenNavigateTabToBlank, attachDebugger,
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

function setTabConfigInternal(tabId, tabcfg) {
    if (tabcfg.children !== undefined && !tabcfg.children.bucket)
        tabcfg.children.bucket = getFirstOk(tabcfg.bucket, config.root.bucket, configDefaults.root.bucket);
    if (!tabcfg.bucket)
        tabcfg.bucket = getFirstOk(config.root.bucket, configDefaults.root.bucket);

    tabConfig.set(tabId, tabcfg);
}

function setTabConfig(tabId, tabcfg) {
    setTabConfigInternal(tabId, tabcfg);

    broadcast(["updateTabConfig", tabId, tabcfg]);

    if (useDebugger) {
        // Chromium does not provide `browser.menus.onShown` event
        updateMenu(tabcfg);
        syncDebuggersState();
    }

    scheduleUpdateDisplay(false, tabId);
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
    for (let v of reqresUnstashedByArchivable.keys())
        usedTabs.add(v[0].tabId);
    for (let v of reqresUnarchivedByArchivable.keys())
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
            title: "Hoardy-Web: AUTO",
            message,
            iconUrl: iconURL(icon, 128),
            type: "basic",
        }).catch(logError);
    }

    cleanupTabs();
}

function processRemoveTab(tabId) {
    openTabs.delete(tabId);

    let updatedTabId = syncStopInFlight(tabId, "capture::EMIT_FORCED::BY_CLOSED_TAB");

    // cleanup after this tab
    let tabstats = getTabStats(tabId);
    if (config.autoUnmarkProblematic && tabstats.problematic > 0
        || (config.autoPopInLimboCollect || config.autoPopInLimboDiscard)
           && tabstats.in_limbo > 0)
        scheduleAction(scheduledDelayed, `cleanup-tab#${tabId}`, config.autoTimeout * 1000, () => {
            cleanupAfterTab(tabId);
            return tabId;
        });

    scheduleEndgame(updatedTabId);
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
let reqresUnstashedByError = new Map();
// same thing, but archivable as key, and `syncOne` args as values
let reqresUnstashedByArchivable = new Map();
// archivables that failed in server submission, indexed by archiveURL, then by error message
let reqresUnarchivedByArchiveError = new Map();
// map `archivables -> int`, the `int` is a count of how many times each archivable appears
// in`reqresUnarchivedByArchiveError`
let reqresUnarchivedByArchivable = new Map();

function truncateLog() {
    while (reqresLog.length > config.history)
        reqresLog.shift();
}

function getInFlightLog() {
    let res = [];
    for (let [k, v] of debugReqresInFlight.entries()) {
        // `.url` can be unset, see (veryEarly) in `emitDebugRequest`.
        if (v.url !== undefined && !isBoringURL(v.url))
            res.push(makeLoggableReqres(v));
    }
    for (let [k, v] of reqresInFlight.entries())
        res.push(makeLoggableReqres(v));
    for (let v of debugReqresFinishingUp)
        res.push(makeLoggableReqres(v));
    for (let v of reqresFinishingUp)
        res.push(makeLoggableReqres(v));
    for (let v of reqresAlmostDone)
        res.push(makeLoggableReqres(v));
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

function getUnarchivedLog() {
    return getLoggables(reqresUnarchivedByArchivable.keys(), []);
}

function getByErrorMap(archiveURL) {
    return cacheSingleton(reqresUnarchivedByArchiveError, archiveURL, () => new Map());
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

    let count = reqresUnarchivedByArchivable.get(archivable);
    if (count === undefined)
        count = 0;
    reqresUnarchivedByArchivable.set(archivable, count + 1);
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

function syncForgetErrored() {
    runSynchronously("forgetErrored", async () => {
        for (let f of reqresErrored.values())
            await syncMany(f.queue, 0, false);
        reqresErrored = new Map();
    });
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
    if (config.debugging)
        console.log("saving globals", savedGlobals);
    await browser.storage.local.set({ globals: savedGlobals }).catch(logError);
    await browser.storage.local.remove("persistentStats").catch(() => {});
    await browser.storage.local.remove("globalStats").catch(() => {});
}

async function resetPersistentStats() {
    globals = updateFromRec(globals, persistentStatsDefaults);
    await saveGlobals();
    scheduleUpdateDisplay(true);
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

// asyncNotifications flags
// do we have a newly- or recently failed to be stashed or saved/archived to local storage reqres?
let gotNewSyncedOrNot = false;
// do we have a newly- or recently failed to be archived reqres?
let gotNewArchivedOrNot = false;
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
let wantRetryUnarchived = false;
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

    let [stashFailed, stashFailedSize] = getNumberAndSizeFromKeys(reqresUnstashedByArchivable);

    let [archiveFailed, archiveFailedSize] = getNumberAndSizeFromKeys(reqresUnarchivedByArchivable);

    let in_flight = Math.max(reqresInFlight.size, debugReqresInFlight.size);

    let finishing_up = Math.max(reqresFinishingUp.length, debugReqresFinishingUp.length) + reqresAlmostDone.length;

    let actions = [];
    scheduledCancelable.forEach((v, key) => actions.push(key));
    scheduledRetry.forEach((v, key) => actions.push(key));
    scheduledDelayed.forEach((v, key) => actions.push(key));
    scheduledSaveState.forEach((v, key) => actions.push(key));
    let low_prio = actions.length;
    scheduledInternal.forEach((v, key) => actions.push(key));
    // scheduledHidden are not shown to the UI
    synchronousClosures.forEach((v) => actions.push(v[0]));

    return {
        update_available: updateAvailable,
        reload_pending: wantReloadSelf,
        running: runningActions.size,
        running_actions: Array.from(runningActions.values()).sort().join(", "),
        scheduled_low: low_prio,
        scheduled: actions.length,
        scheduled_actions: actions.join(", "),
        in_flight,
        finishing_up,
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
        unarchived: archiveFailed,
        unarchived_size: archiveFailedSize,
        failed: stashFailed + archiveFailed,
        failed_size: stashFailedSize + archiveFailedSize,
        errored,
        errored_size: erroredSize,
        issues: in_flight
            + finishing_up
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
        in_flight: Math.max(in_flight, in_flight_debug),
        finishing_up: Math.max(finishing_up, finishing_up_debug) + almost_done,
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

    if (popped.length === 0)
        return 0;

    // this is written as a separate loop to make it mostly atomic w.r.t. reqresLimbo

    let minusSize = 0;
    let newlyQueued = [];
    let newlyLogged = [];
    let newlyStashed = [];
    let newlyUnstashed = [];

    for (let archivable of popped) {
        let [loggable, dump] = archivable;
        try {
            let dumpSize = loggable.dumpSize;
            minusSize += dumpSize;

            let info = getOriginState(loggable.tabId, loggable.fromExtension);
            loggable.in_limbo = false;
            loggable.dirty = true;
            if (loggable.sessionId === sessionId) {
                info.inLimboTotal -= 1;
                info.inLimboSize -= dumpSize;
            }
            processNonLimbo(collect, info, archivable, newlyQueued, newlyLogged, newlyStashed, newlyUnstashed);
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
        // reset problematic, since reqres statuses have changed
        broadcast(["resetProblematicLog", getProblematicLog()]);
    // since (popped.length > 0)
    broadcast(["resetInLimboLog", getInLimboLog()]);
    if (newlyQueued.length > 0)
        broadcast(["newQueued", newlyQueued]);
    if (newlyLogged.length > 0)
        broadcast(["newLog", newlyLogged]);

    if (newlyStashed.length > 0)
        runSynchronously("stashNew", syncMany, newlyStashed, 1, true);
    if (newlyUnstashed.length > 0)
        runSynchronously("unstash", syncMany, newlyUnstashed, 0, false);

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

// Chromium does not support per-window browserActions, so we have to
// update them per-tab. Fenix does support them, but updates appear to
// be rather inconsistent, while this works perfectly.
let perWindowUpdates = !useDebugger && !isMobile;

function setTitle(windowId, tabId, title) {
    if (!isMobile)
        // mobile browsers don't have that much space there
        title = "Hoardy-Web: " + title;

    let attrs = perWindowUpdates
        ? { windowId, title }
        : { tabId, title };
    return browser.browserAction.setTitle(attrs).catch(logErrorExceptWhenStartsWith("No tab with id:"));
}

let windowIdIcons = new Map();

// `browser.browserAction.setIcon` but with multiple icons. The given
// icons will be rotated in a loop N times, and then the process will
// stop at the very first icon.
async function setIcons(windowId, tabId, active, icons, force) {
    let clen = icons.length;
    if (clen === 0)
        throw new Error("need at least one icon to rotate");

    if (perWindowUpdates) {
        if (!active)
            // nothing to do
            return;
        else if (!force) {
            // NB: `force` happens when `scheduleUpdateDisplay` is called from
            // `handleTabActivated` or `handleTabUpdated`.
            let wicons = windowIdIcons.get(windowId);
            if (equalRec(wicons, icons))
                // nothing to do
                return;
        }
        windowIdIcons.set(windowId, icons);
    }

    let attrs = icons.map((v) => perWindowUpdates
                          ? { windowId, path: mkIcons(v) }
                          : { tabId, path: mkIcons(v) });

    let rotatingName = `rotateIcons-${windowId}`;
    let settingName = `setIcon-${tabId}`;

    if (!perWindowUpdates && active)
        // wait for the previous setter to this tab to finish
        await popSingletonTimeout(scheduledHidden, settingName, false, true);

    // set or rotate icons
    resetSingletonTimeout(scheduledHidden, active ? rotatingName : settingName, 0, async (wantStop) => {
        try {
            if (active && clen > 1) {
                // when on active tab, and with more than one frame, animate.
                for (let i = 0; i < 20; ++i) {
                    for (let j = 0; j < clen; ++j) {
                        if (wantStop())
                            throw new StopIteration();
                        await browser.browserAction.setIcon(attrs[j]);
                        await sleep(config.animateIcon);
                    }
                }
            }
            // freeze on the first frame
            await browser.browserAction.setIcon(attrs[0]);
        } catch (err) {
            if (!(err instanceof StopIteration))
                logErrorExceptWhenStartsWith("No tab with id:")(err);
        }
    });
}

// browserAction state
let udStats = null;
let udBadge = null;
let udColor = null;
let udGTitle = null;

// `updatedTabId === null` means "config changed or any tab could have been updated"
// `updatedTabId === undefined` means "no tabs changed"
// otherwise, it's a tabId of a changed tab
async function doUpdateDisplay(statsChanged, updatedTabId, forceResetIcons) {
    statsChanged = statsChanged || udStats === null;
    let wantUpdate = updatedTabId === null;

    let stats = udStats;
    let badge = udBadge;
    let color = udColor;
    let gtitle = udGTitle;

    if (statsChanged || wantUpdate) {
        stats = getStats();

        badge = "";
        color = 0;
        let chunks = [];

        if (stats.running > 0) {
            badge += "^";
            color = Math.max(color, 1);
            chunks.push(`${stats.running} running actions`);
        }

        if (stats.issues > 0)
            badge += stats.issues.toString();

        if (stats.errored > 0) {
            badge += "!";
            color = Math.max(color, 2);
            chunks.push(`internal errors on ${stats.errored} reqres`);
        }
        if (stats.unstashed > 0) {
            badge += "F";
            color = Math.max(color, 2);
            chunks.push(`failed to stash ${stats.unstashed} reqres`);
        }
        if (stats.unarchived > 0) {
            badge += "F";
            color = Math.max(color, 2);
            chunks.push(`failed to archive ${stats.unarchived} reqres`);
        }
        if (stats.in_flight > 0) {
            badge += "T";
            color = Math.max(color, 1);
            chunks.push(`tracking ${stats.in_flight} in-flight reqres`);
        }
        if (stats.finishing_up > 0) {
            badge += "T";
            color = Math.max(color, 1);
            chunks.push(`tracking ${stats.finishing_up} finishing-up reqres`);
        }
        if (stats.queued > 0) {
            badge += "Q";
            chunks.push(`${stats.queued} queued reqres`);
        }
        if (stats.bundledAs > 0) {
            badge += "B";
            color = Math.max(color, 1);
            chunks.push(`${stats.bundledAs} reqres bundled for export`);
        }
        if (stats.problematic > 0) {
            badge += "P";
            color = Math.max(color, 1);
            chunks.push(`${stats.problematic} problematic reqres`);
        }
        if (stats.in_limbo > 0) {
            badge += "L";
            color = Math.max(color, 1);
            chunks.push(`${stats.in_limbo} in-limbo reqres`);
        }
        if (config.workOffline) {
            badge += "O";
            chunks.push("work offline");
        }
        if (!config.collecting) {
            badge += "I";
            chunks.push("ignore new requests");
        }
        if (!config.stash && !config.archive) {
            badge += "?";
            color = Math.max(color, 1);
            chunks.push("ephemeral collection");
        }
        if (config.autoPopInLimboDiscard) {
            badge += "/L";
            color = Math.max(color, 2);
            chunks.push("auto-discard in-limbo");
        }
        if (config.discardAll) {
            badge += "/Q";
            color = Math.max(color, 2);
            chunks.push("auto-discard queued");
        }
        if (config.ephemeral) {
            badge += "/C";
            color = Math.max(color, 1);
            chunks.push("ephemeral config");
        }
        if (config.debugging || config.dumping) {
            badge += "D";
            color = Math.max(color, 1);
            chunks.push("debug log (slow!)");
        }

        if (stats.in_flight + stats.finishing_up
            + stats.queued + stats.bundledAs === 0)
            chunks.push("idle");

        if (stats.scheduled > stats.scheduled_low) {
            badge += "~";
            color = Math.max(color, 1);
            chunks.push(`${stats.scheduled} scheduled actions`);
        }
        if (stats.scheduled == stats.scheduled_low && stats.scheduled_low > 0) {
            badge += ".";
            chunks.push(`${stats.scheduled_low} low-priority scheduled actions`);
        }

        gtitle = chunks.join(", ");

        wantUpdate = wantUpdate
            || udBadge !== badge || udColor !== color || udGTitle !== gtitle
            || udStats === null
            // because these global stats influence the tab's icon
            || stats.errored !== udStats.errored
            || stats.failed !== udStats.failed
            || stats.queued != udStats.queued
            || stats.bundledAs !== udStats.bundledAs;

        if (statsChanged)
            broadcast(["updateStats", stats]);

        udStats = stats;
    }

    if (updatedTabId === undefined && !wantUpdate)
        // no tab-specific stuff needs updating, skip the rest of this
        return;

    if (udBadge !== badge) {
        await browser.browserAction.setBadgeText({ text: badge });
        udBadge = badge;
        if (config.debugging)
            console.log(`updated browserAction: badge "${badge}"`);
    }

    if (udColor !== color) {
        let backgroundRGB;
        let colorRGB;
        switch (color) {
        case 0:
            backgroundRGB = "#777";
            colorRGB = "#fff";
            break;
        case 1:
            backgroundRGB = "#e0e020";
            colorRGB = "#000";
            break;
        default:
            backgroundRGB = "#e02020";
            colorRGB = "#fff";
        }
        await browser.browserAction.setBadgeBackgroundColor({ color: backgroundRGB });
        await browser.browserAction.setBadgeTextColor({ color: colorRGB });
        udColor = color;
        if (config.debugging)
            console.log(`updated browserAction: color "${color}"`);
    }

    if (udGTitle !== gtitle)
        udGTitle = gtitle;

    let tabs;
    if (useDebugger && updatedTabId == null)
        // On Chromium, when updating all tabs, actually update all tabs,
        // otherwise switching to those tabs for the first time will
        // display the `main` icon at first and then blink-switch to the
        // target icon, which is ugly.
        tabs = await browser.tabs.query({});
    else
        // On Firefox and when updating a select tab, we need only update
        // for active tabs. This is more efficient.
        tabs = await browser.tabs.query({ active: true });

    if (statsChanged && updatedTabId === null) {
        // ask open pages to ask for updates to specific tabs they want via `getTabStats`
        broadcast(["updateTabStats", null]);
        statsChanged = false;
    }

    if (updatedTabId === undefined)
        // to simplify the logic below
        updatedTabId = null;

    for (let tab of tabs) {
        let windowId = tab.windowId;
        let tabId = tab.id;
        let stateTabId = getStateTabIdOrTabId(tab);

        // skip updates for unchanged tabs, when specified
        if (updatedTabId !== null && updatedTabId !== tabId && updatedTabId !== stateTabId)
            continue;

        let tabcfg = tabConfig.get(stateTabId);
        if (tabcfg === undefined)
            tabcfg = prefillChildren(config.root);
        let tabstats = getTabStats(stateTabId);

        if (statsChanged)
            broadcast(["updateTabStats", stateTabId, tabstats]);

        let icons = [];

        if (stats.errored > 0)
            icons.push("error");
        if (stats.failed > 0)
            icons.push("failed");
        if (stats.queued + stats.bundledAs > 0)
            icons.push("archiving");

        let tchunks = [];
        let cchunks = [];

        if (tabstats.in_flight > 0) {
            icons.push("tracking");
            tchunks.push(`${tabstats.in_flight} in-flight reqres`);
        }
        if (tabstats.finishing_up > 0) {
            icons.push("tracking");
            tchunks.push(`${tabstats.finishing_up} finishing-up reqres`);
        }
        if (tabstats.problematic > 0) {
            icons.push("problematic");
            tchunks.push(`${tabstats.problematic} problematic reqres`);
        }
        if (tabstats.in_limbo > 0) {
            icons.push("in_limbo");
            tchunks.push(`${tabstats.in_limbo} in-limbo reqres`);
        }

        let pwicon;
        let picon;
        function addSub(icons, chunks, cfg, child) {
            let wicon;
            let icon;

            if (config.workOffline || cfg.workOffline) {
                wicon = "work_offline";
                chunks.push("work offline");
            }

            if (!config.collecting || !cfg.collecting) {
                icon = "off";
                chunks.push("ignore new requests");
            } else if (cfg.limbo && cfg.negLimbo) {
                icon = "bothlimbo";
                chunks.push("pick and drop into limbo");
            } else if (cfg.limbo) {
                icon = "limbo";
                chunks.push("pick into limbo");
            } else if (cfg.negLimbo) {
                icon = "neglimbo";
                chunks.push("drop into limbo");
            } else {
                icon = "idle";
                chunks.push("queue normally");
            }

            if (wicon !== pwicon || icon !== picon) {
                if (wicon)
                    icons.push(wicon);
                icons.push(icon);
                // add a separator
                if (child)
                    icons.push("main");
            }

            pwicon = wicon;
            picon = icon;
        }

        addSub(icons, tchunks, tabcfg);
        addSub(icons, cchunks, tabcfg.children, true);

        let ttitle = tchunks.join(", ");
        let ctitle = cchunks.join(", ");
        if (ctitle === ttitle)
            ctitle = "same";

        let title = `${badge}${badge ? ": " : ""}${gtitle}; this tab: ${ttitle}; its new children: ${ctitle}`;

        // update browserAction
        await setTitle(windowId, tabId, title);
        await setIcons(windowId, tabId, tab.active, icons, forceResetIcons);

        if (config.debugging)
            console.log(`updated browserAction: tabId ${tabId}: icons ${icons.join(", ")}, title "${title}"`);
    }
}

let udStatsChanged = false;
let udUpdatedTabId;
let udEpisode = 1;
let udForceResetIcons = false;

function scheduleUpdateDisplay(statsChanged, updatedTabId, episodic, timeout, forceResetIcons) {
    // merge succesive arguments
    statsChanged = udStatsChanged = udStatsChanged || statsChanged;
    updatedTabId = udUpdatedTabId = mergeUpdatedTabIds(udUpdatedTabId, updatedTabId);
    forceResetIcons = udForceResetIcons = udForceResetIcons || forceResetIcons;

    // only run the rest every `episodic` updates, when it's set
    if (udEpisode < episodic) {
        udEpisode += 1;
        return;
    }
    udEpisode = 1;

    resetSingletonTimeout(scheduledHidden, "updateDisplay", timeout !== undefined ? timeout : 100, async () => {
        // reset
        udStatsChanged = false;
        udUpdatedTabId = undefined;
        udForceResetIcons = false;

        await doUpdateDisplay(statsChanged, updatedTabId, forceResetIcons);

        // we schedule this here because otherwise we will have to schedule it
        // almost everywhere `scheduleUpdateDisplay` is used
        if (wantReloadSelf)
            resetSingletonTimeout(scheduledHidden, "reload", 300, performReloadSelf);
    }, undefined, true);
}

async function forceUpdateDisplay(statsChanged, updatedTabId, episodic) {
    scheduleUpdateDisplay(statsChanged, updatedTabId, episodic, 0);
    await popSingletonTimeout(scheduledHidden, "updateDisplay", true, true);
}

function getEpisodic(num) {
    if (num > 200)
        return 100;
    else if (num > 20)
        return 10;
    else
        return 1;
}

// schedule processFinishingUp
function scheduleFinishingUp() {
    if (reqresFinishingUp.length == 0 && debugReqresFinishingUp.length == 0)
        // nothing to do
        return;

    scheduleAction(scheduledInternal, "finishingUp", 100, () => {
        return processFinishingUp(false);
    });
    scheduleUpdateDisplay(true);
}

let seUpdatedTabId;

// schedule processArchiving, processAlmostDone, etc
function scheduleEndgame(updatedTabId) {
    updatedTabId = seUpdatedTabId = mergeUpdatedTabIds(seUpdatedTabId, updatedTabId);

    if (synchronousClosures.length > 0) {
        resetSingletonTimeout(scheduledHidden, "endgame", 0, async () => {
            // reset
            seUpdatedTabId = undefined;

            while (synchronousClosures.length > 0) {
                let [name, fun, args] = synchronousClosures.shift();

                let key = "endgame::" + name;
                if (config.debugging)
                    console.warn("running", key);

                await forceUpdateDisplay(true, updatedTabId, getEpisodic(synchronousClosures.length));
                updatedTabId = undefined;

                try {
                    let res = fun(...args);
                    if (res instanceof Promise)
                        await res;
                } catch (err) {
                    logError(err);
                }

                if (config.debugging)
                    console.warn("finished", key);
                runningActions.delete(key);
            }

            // TODO: this is inefficient, make all closures call us
            // explicitly instead or use `mergeUpdatedTabIds` above instead
            scheduleEndgame(null);
        });
    } else if (config.archive && reqresQueue.length > 0) {
        resetSingletonTimeout(scheduledHidden, "endgame", 0, async () => {
            // reset
            seUpdatedTabId = undefined;

            await forceUpdateDisplay(true, updatedTabId);
            updatedTabId = await processArchiving(updatedTabId);
            scheduleEndgame(updatedTabId);
        });
    } else if (reqresAlmostDone.length > 0) {
        resetSingletonTimeout(scheduledHidden, "endgame", 0, async () => {
            // reset
            seUpdatedTabId = undefined;

            await forceUpdateDisplay(true, updatedTabId);
            updatedTabId = await processAlmostDone(updatedTabId);
            scheduleEndgame(updatedTabId);
        });
    } else /* if (!config.archive || reqresQueue.length == 0) */ {
        resetSingletonTimeout(scheduledHidden, "endgame", 0, async () => {
            // reset
            seUpdatedTabId = undefined;

            if (wantBroadcastSaved) {
                wantBroadcastSaved = false;
                scheduleAction(scheduledInternal, "readSaved", 0, async (wantStop) => {
                    let log;
                    try {
                        log = await getSavedLog(savedFilters, wantStop);
                        broadcast(["resetSaved", log]);
                    } catch (err) {
                        if (!(err instanceof StopIteration))
                            throw err;
                    }
                });
            }

            cleanupTabs();

            // do we have some reqres in flight?
            let haveInFlight = reqresInFlight.size + debugReqresInFlight.size + reqresFinishingUp.length + debugReqresFinishingUp.length > 0;

            if (changedGlobals) {
                changedGlobals = false;

                // is this change important?
                let boring = true;
                if (savedGlobals === undefined
                    || wantReloadSelf
                    || (!haveInFlight && (savedGlobals.collectedTotal !== globals.collectedTotal
                                          || savedGlobals.submittedHTTPTotal !== globals.submittedHTTPTotal
                                          || savedGlobals.exportedAsTotal !== globals.exportedAsTotal))
                    || savedGlobals.stashedLS.number !== globals.stashedLS.number
                    || savedGlobals.stashedIDB.number !== globals.stashedIDB.number
                    || savedGlobals.savedLS.number !== globals.savedLS.number
                    || savedGlobals.savedIDB.number !== globals.savedIDB.number)
                    boring = false;

                scheduleAction(scheduledSaveState, "persistStats", boring ? 90000 : (wantReloadSelf ? 0 : 1000), () => {
                    saveGlobals();
                });
            }

            if (gotNewExportedAs) {
                gotNewExportedAs = false;
                // schedule exportAs for all buckets
                asyncBucketSaveAs(haveInFlight
                                  ? config.exportAsInFlightTimeout * 1000
                                  : (wantReloadSelf ? 0 : config.exportAsTimeout * 1000)
                                  , null);
            }

            if (wantRetryUnarchived) {
                wantRetryUnarchived = false;
                if (config.archive && reqresUnarchivedByArchivable.size > 0)
                    // retry unarchived in 60s
                    scheduleActionEndgame(scheduledRetry, "retryUnarchived", 60000, () => {
                        syncRetryUnarchived(false);
                        return null;
                    });
            }

            asyncNotifications(1000);

            scheduleUpdateDisplay(true, updatedTabId);
        });
    }
}

async function doRetryAllUnstashed() {
    let newByError = new Map();
    let newByArchivable = new Map();
    for (let [archivable, args] of reqresUnstashedByArchivable.entries()) {
        let [state, elide] = args;
        await syncOne(archivable, state, elide, newByError, newByArchivable);
    }
    reqresUnstashedByError = newByError;
    reqresUnstashedByArchivable = newByArchivable;
    gotNewSyncedOrNot = true;
}

function syncRetryUnstashed() {
    runSynchronously("retryUnstashed", doRetryAllUnstashed);
}

async function doStashAll(alsoLimbo) {
    await doRetryAllUnstashed();
    await syncMany(reqresQueue, 1, true);
    if (alsoLimbo)
        await syncMany(reqresLimbo, 1, true);
    for (let m of reqresUnarchivedByArchiveError.values())
        for (let f of m.values())
            await syncMany(f.queue, 1, true);
}

function syncStashAll(alsoLimbo) {
    runSynchronously("stashAll", doStashAll, alsoLimbo);
}

function retryOneUnarchived(archiveURL, unrecoverable) {
    let byErrorMap = reqresUnarchivedByArchiveError.get(archiveURL);
    if (byErrorMap === undefined)
        return;
    for (let [reason, unarchived] of Array.from(byErrorMap.entries())) {
        if (!unrecoverable && !unarchived.recoverable)
            continue;

        for (let archivable of unarchived.queue) {
            let [loggable, dump] = archivable;
            let dumpSize = loggable.dumpSize;
            reqresQueue.push(archivable);
            reqresQueueSize += dumpSize;

            let count = reqresUnarchivedByArchivable.get(archivable);
            if (count > 1)
                reqresUnarchivedByArchivable.set(archivable, count - 1);
            else if (count !== undefined)
                reqresUnarchivedByArchivable.delete(archivable);
        }

        byErrorMap.delete(reason);
    }
    if (byErrorMap.size === 0)
        reqresUnarchivedByArchiveError.delete(archiveURL);
}

function syncRetryUnarchived(unrecoverable) {
    for (let archiveURL of Array.from(reqresUnarchivedByArchiveError.keys()))
        retryOneUnarchived(archiveURL, unrecoverable);

    broadcast(["resetQueued", getQueuedLog()]);
    broadcast(["resetUnarchived", getUnarchivedLog()]);
}

function formatFailures(why, list) {
    let parts = [];
    for (let [reason, unarchived] of list)
        parts.push(`- ${why} ${unarchived.queue.length} items because ${reason}.`);
    return parts.join("\n");
}

async function doNotify() {
    // record the current state, because the rest of this chunk is async
    let rrErrored = Array.from(reqresErrored.entries());
    let rrUnstashed = Array.from(reqresUnstashedByError.entries());
    let rrUnarchived = Array.from(reqresUnarchivedByArchiveError.entries());

    if (gotNewErrored && rrErrored.length > 0) {
        gotNewErrored = false;

        await browser.notifications.create("error-errored", {
            title: "Hoardy-Web: ERROR",
            message: `Some internal errors:\n${formatFailures("Failed to process", rrErrored)}`,
            iconUrl: iconURL("error", 128),
            type: "basic",
        });
    } else if (rrErrored.length === 0)
        // clear stale
        await browser.notifications.clear("error-errored");

    if (gotNewQueued && reqresQueue.length > 0) {
        gotNewQueued = false;

        if (config.archiveStuckNotify && !config.archive && !config.stash) {
            await browser.notifications.create("warning-notSaving", {
                title: "Hoardy-Web: WARNING",
                message: "Some reqres are waiting in the archival queue, but both reqres stashing and archiving are disabled.",
                iconUrl: iconURL("archiving", 128),
                type: "basic",
            });
        }
    } else if (config.archive || config.stash)
        // clear stale
        await browser.notifications.clear("warning-notSaving");

    if (gotNewSyncedOrNot && rrUnstashed.length > 0) {
        gotNewSyncedOrNot = false;

        if (config.archiveFailedNotify) {
            // generate a new one
            await browser.notifications.create("error-unstashed", {
                title: "Hoardy-Web: FAILED",
                message: `For browser's local storage:\n${formatFailures("Failed to stash", rrUnstashed)}`,
                iconUrl: iconURL("failed", 128),
                type: "basic",
            });
        }
    } else if (rrUnstashed.length === 0)
        // clear stale
        await browser.notifications.clear("error-unstashed");

    if (gotNewArchivedOrNot) {
        gotNewArchivedOrNot = false;

        // get shown notifications
        let all_ = await browser.notifications.getAll();
        let all = Object.keys(all_);

        // clear stale
        for (let label in all) {
            if (!label.startsWith("error-unarchived-"))
                continue;
            let archiveURL = label.substr(17);
            if (rrUnarchived.every((e) => e[0] !== archiveURL))
                await browser.notifications.clear(label);
        }

        if (config.archiveFailedNotify) {
            // generate new ones
            for (let [archiveURL, byErrorMap] of rrUnarchived) {
                let where;
                if (archiveURL === "exportAs")
                    where = "Export via `saveAs`";
                else if (archiveURL === "localStorage")
                    where = "Browser's local storage";
                else
                    where = `Archiving server at ${archiveURL}`;
                await browser.notifications.create(`error-unarchived-${archiveURL}`, {
                    title: "Hoardy-Web: FAILED",
                    message: `${where}:\n${formatFailures("Failed to archive", byErrorMap.entries())}`,
                    iconUrl: iconURL("failed", 128),
                    type: "basic",
                });
            }
        }

        let isDone = rrUnstashed.length === 0 && rrUnarchived.length === 0;

        if (wantArchiveDoneNotify && isDone && reqresQueue.length === 0) {
            wantArchiveDoneNotify = false;

            if (config.archiveDoneNotify) {
                // generate a new one
                await browser.notifications.create("ok-done", {
                    title: "Hoardy-Web: OK",
                    message: "Archiving appears to work OK!\n\nThis message won't be repeated unless something breaks." + annoyingNotification(config, "Generate notifications about > ... newly empty archival queue"),
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
            await browser.notifications.create("warning-fatLimbo", {
                title: "Hoardy-Web: WARNING",
                message: `Too much stuff in limbo, collect or discard some of those reqres to reduce memory consumption and improve browsing performance.` + annoyingNotification(config, "Generate notifications about > ... too much stuff in limbo"),
                iconUrl: iconURL("limbo", 128),
                type: "basic",
            });
        }
    } else if (!fatLimbo)
        // clear stale
        await browser.notifications.clear("warning-fatLimbo");

    if (gotNewProblematic) {
        gotNewProblematic = false;

        if (config.problematicNotify && reqresProblematic.length > 0) {
            // generate a new one
            //
            // make a log of no more than `problematicNotifyNumber`
            // elements, merging those referencing the same URL
            let latest = new Map();
            for (let i = reqresProblematic.length - 1; i >= 0; --i) {
                let loggable = reqresProblematic[i][0];
                let tabcfg = getOriginConfig(loggable.tabId, loggable.fromExtension);
                if (!tabcfg.problematicNotify)
                    continue;

                let desc = (loggable.method ? loggable.method : "?") + " " + loggable.url;
                let l = latest.get(desc);
                if (l === undefined) {
                    if (latest.size < config.problematicNotifyNumber)
                        latest.set(desc, 1);
                    else
                        break;
                } else
                    latest.set(desc, l + 1);
            }
            if (latest.size > 0) {
                let latestDesc = [];
                for (let [k, v] of latest.entries()) {
                    if (k.length < 80)
                        latestDesc.push(`${v}x ${k}`);
                    else
                        latestDesc.push(`${v}x ${k.substr(0, 80)}\u2026`);
                }
                latestDesc.reverse();
                await browser.notifications.create("warning-problematic", {
                    title: "Hoardy-Web: WARNING",
                    message: `Have ${reqresProblematic.length} reqres marked as problematic:\n` + latestDesc.join("\n") + annoyingNotification(config, "Generate notifications about > ... new 'problematic' reqres"),
                    iconUrl: iconURL("problematic", 128),
                    type: "basic",
                });
            }
        }
    } else if (reqresProblematic.length === 0)
        // clear stale
        await browser.notifications.clear("warning-problematic");
}

function asyncNotifications(timeout) {
    resetSingletonTimeout(scheduledHidden, "notify", timeout, doNotify);
    // NB: needs scheduleUpdateDisplay after
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
    if (inLS)
        return [mkLSlotTransaction, globals.stashedLS, globals.savedLS];
    else
        return [mkIDBTransaction, globals.stashedIDB, globals.savedIDB];
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
        rrFailed = reqresUnstashedByError;
    if (rrLast === undefined)
        rrLast = reqresUnstashedByArchivable;

    let [loggable, dump] = archivable;
    let dumpSize = loggable.dumpSize;

    try {
        await doSyncOne(archivable, state, elide);
    } catch (err) {
        logHandledError(err);
        recordByError(rrFailed, err, false, archivable, dumpSize);
        rrLast.set(archivable, [state, elide]);
        gotNewSyncedOrNot = true;
        return false;
    }

    gotNewSyncedOrNot = true;
    return true;
}

async function syncMany(archivables, state, elide) {
    for (let archivable of archivables) {
        let [loggable, dump] = archivable;
        updateLoggable(loggable);
        await syncOne(archivable, state, elide);
    }
}

function isSynced(archivable) {
    let [loggable, dump] = archivable;
    return loggable.inLS !== undefined && !loggable.dirty;
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

// reqres archiving

function recordManyUnarchived(archiveURL, reason, recoverable, archivables, func) {
    let m = getByErrorMap(archiveURL);
    let v = getByErrorMapRecord(m, reason);

    for (let archivable of archivables) {
        let [loggable, dump] = archivable;
        let dumpSize = loggable.dumpSize;
        if (func !== undefined)
            func(loggable);
        recordByErrorTo(v, recoverable, archivable, dumpSize);
    }

    gotNewArchivedOrNot = true;
    wantArchiveDoneNotify = true;
    wantRetryUnarchived = true;
}

function recordOneUnarchivedTo(byErrorMap, reason, recoverable, archivable, dumpSize) {
    recordByError(byErrorMap, reason, recoverable, archivable, dumpSize);
    gotNewArchivedOrNot = true;
    wantArchiveDoneNotify = true;
    wantRetryUnarchived = true;
}

function recordOneUnarchived(archiveURL, reason, recoverable, archivable, dumpSize) {
    let m = getByErrorMap(archiveURL);
    recordOneUnarchivedTo(m, reason, recoverable, archivable, dumpSize);
}

function recordOneAssumedBroken(archiveURL, archivable, dumpSize) {
    let byErrorMap = reqresUnarchivedByArchiveError.get(archiveURL);
    if (byErrorMap !== undefined) {
        let recent = Array.from(byErrorMap.entries()).filter(
            (x) => (Date.now() - x[1].when) < 1000 && !x[0].endsWith(" (assumed)")
        )[0];
        if (recent !== undefined) {
            // we had recent errors there, fail this reqres immediately
            recordOneUnarchivedTo(byErrorMap, recent[0] + " (assumed)", recent[1].recoverable, archivable, dumpSize);
            return true;
        }
    }
    return false;
}

let lastExportEpoch;
let lastExportNum = 0;

// export all reqresBundledAs as fake-"Download" with a WRR-bundle of their dumps
function bucketSaveAs(bucket, ifGEQ) {
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

        saveAs(dataChunks, mime, `Hoardy-Web-export-${bucket}-${dt}_${lastExportNum}.${ext}`);

        globals.exportedAsTotal += res.queue.length;
        globals.exportedAsSize += res.size;
    } catch (err) {
        recordManyUnarchived("exportAs", err, false, res.queue, (loggable) => {
            loggable.exportedAs = false;
            loggable.dirty = true;
        });
        runSynchronously("stash", syncMany, Array.from(res.queue), 1, true);
        // NB: This is slightly fragile, consider the following sequence of
        // events for a given archivable:
        //
        //   exportAsOne -> submitHTTPOne -> saveOne
        //   -> ... -> scheduledEndgame -> asyncBucketSaveAs -> bucketSaveAs, which fails
        //   -> recordManyUnarchived -> runSynchronously(syncMany, ...) -> scheduledEndgame
        //
        // It will first save the archivable, and then un-save and stash it
        // instead. This is by design, since, ideally, this this `catch` would
        // never be run.
        //
        // Also note that it will work properly only if the above
        // `runSynchronously` is run after run after `processArchiving` for
        // the same archivables. (The code is written to always make this
        // true.)
        //
        // Now consider this:
        //
        //   exportAsOne -> submitHTTPOne -> (no saveOne) -> syncOne(archivable, 0, ...)
        //   -> ... -> scheduleEndgame -> asyncBucketSaveAs -> bucketSaveAs, which fails
        //   -> recordManyUnarchived -> runSynchronously(syncMany, ...) -> scheduledEndgame
        //
        // Which will only work if that first `syncOne` does not elide the
        // dump from memory, see (notEliding).
    } finally {
        reqresBundledAs.delete(bucket);
    }
}

// schedule bucketSaveAs action
function asyncBucketSaveAs(timeout, bucketOrNull) {
    if (reqresBundledAs.size === 0)
        return;

    let buckets;
    if (bucketOrNull === null)
        buckets = Array.from(reqresBundledAs.keys());
    else
        buckets = [ bucketOrNull ];

    for (let bucket of buckets)
        scheduleAction(scheduledDelayed, `exportAs-${bucket}`, timeout, () => {
            bucketSaveAs(bucket);
        });

    // NB: needs scheduleUpdateDisplay after
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
    let maxSize = config.exportAsBundle ? config.exportAsMaxSize * MEGABYTE : 0;

    // export if this dump will not fit
    bucketSaveAs(bucket, maxSize - dumpSize);

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
    bucketSaveAs(bucket, maxSize);

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
    //   queued -> saveOne -> syncRetryUnstashed
    reqresUnstashedByArchivable.delete(archivable);

    try {
        await doSyncOne(archivable, 2, true);
    } catch (err) {
        logHandledError(err);
        recordOneUnarchived(archiveURL, err, false, archivable, dumpSize);
        return false;
    }

    gotNewArchivedOrNot = true;
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

async function getSavedLog(rrfilter, wantStop) {
    if (rrfilter === undefined)
        rrfilter = null;

    let res = [];
    let [newSavedLS, newSavedIDB] = await forEachSynced("save", (loggable) => {
        if (wantStop !== undefined && wantStop())
            throw new StopIteration();
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
    runSynchronously("requeueSaved", async () => {
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
    runSynchronously("deleteSaved", async () => {
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
        recordOneUnarchived(archiveURL, reason, recoverable, archivable, dumpSize);
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
        broken(`\`Hoardy-Web\` can't establish a connection to the archiving server: ${errorMessageOf(err)}`, true);
        return false;
    }

    let responseText = await response.text();

    if (response.status !== 200) {
        broken(`request to the archiving server failed with ${response.status} ${response.statusText}: ${responseText}`, false);
        return false;
    }

    retryOneUnarchived(archiveURL, true);
    globals.submittedHTTPTotal += 1;
    globals.submittedHTTPSize += loggable.dumpSize;
    loggable.archived |= archivedViaSubmitHTTP;
    loggable.dirty = true;

    gotNewArchivedOrNot = true;
    return true;
}

async function processArchiving(updatedTabId) {
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
                // it's in reqresUnarchivedByArchiveError now, stash it without
                // recording it in reqresUnstashedByError and
                // reqresUnstashedByArchivable
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

        let tabId = loggable.tabId;
        updatedTabId = mergeUpdatedTabIds(updatedTabId, tabId);
        scheduleUpdateDisplay(true, tabId, getEpisodic(reqresQueue.length));
    }

    broadcast(["resetQueued", getQueuedLog()]);
    broadcast(["resetUnarchived", getUnarchivedLog()]);

    return updatedTabId;
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

let sourceDesc = browser.nameVersion + "+Hoardy-Web/" + manifest.version;

// render reqres structure into a CBOR dump
function renderReqres(encoder, reqres) {
    let rest = {};

    if (isDefinedURL(reqres.documentUrl))
        rest.document_url = reqres.documentUrl;

    if (isDefinedURL(reqres.originUrl))
        rest.origin_url = reqres.originUrl;

    if (reqres.errors.length > 0)
        rest.errors = reqres.errors;

    if (reqres.fromCache)
        rest.from_cache = true;

    if (!reqres.sent)
        rest.sent = false;

    // Chromium did not emit the WebRequest half
    if (reqres.fake)
        rest.fake = true;

    // The response was genererated by another extension or a service/shared worker.
    if (reqres.generated)
        rest.generated = true;

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
            reqres.url,
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

async function processOneAlmostDone(reqres, newlyProblematic, newlyLimboed, newlyQueued, newlyLogged, newlyStashed, newlyUnstashed) {
    if (reqres.tabId === undefined)
        // just in case
        reqres.tabId = -1;

    if (!useDebugger && reqres.generated && !reqres.responded) {
        if (reqres.errors.length === 1 && reqres.errors[0].startsWith("webRequest::NS_ERROR_NET_ON_")) {
            // (raceCondition)
            //
            // This happens when the networking code in Firefox gets
            // interrupted by a service/shared worker fulfilling the request.
            //
            // See the top of
            // `devtools/shared/network-observer/NetworkObserver.sys.mjs` and
            // `activityErrorsMap` function in
            // `toolkit/components/extensions/webrequest/WebRequest.sys.mjs` in
            // Firefox sources for how those error codes get emitted.
            //
            // Ideally, `onErrorOccurred` would simply specify all the fields
            // `onCompleted` does in this case, but it does not, so we have to
            // handle it specially here.
            reqres.responded = true;
            reqres.responseTimeStamp = reqres.emitTimeStamp;
            reqres.statusCode = 200;
            reqres.reason = "Assumed OK";
            // so that it would be marked as problematic, since actual metatada is not available
            reqres.errors.push("webRequest::capture::RESPONSE::BROKEN");
        } else
            // This was a normal error, not a race between the response
            // generator and the networking code.
            reqres.generated = false;
    }

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
        // it failed somewhere before handleSendHeaders or was redirected
        // internally (e.g. by an extension)
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

    if (!reqres.errors.every(isTrivialError)) {
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
        console.warn(
            picked ? "PICKED" : "DROPPED",
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

    if (picked) {
        globals.pickedTotal += 1;
        info.pickedTotal += 1;
    } else {
        globals.droppedTotal += 1;
        info.droppedTotal += 1;
    }

    if (in_limbo) {
        reqresLimbo.push(archivable);
        reqresLimboSize += dumpSize;
        info.inLimboTotal += 1;
        info.inLimboSize += dumpSize;
        newlyLimboed.push(loggable);
        if (config.stash && options.stashLimbo)
            newlyStashed.push(archivable);
        gotNewLimbo = true;
    } else
        processNonLimbo(picked, info, archivable, newlyQueued, newlyLogged, newlyStashed, newlyUnstashed);

    if (problematic) {
        reqresProblematic.push(archivable);
        info.problematicTotal += 1;
        newlyProblematic.push(loggable);
        if (options.problematicNotify)
            gotNewProblematic = true;
    }

    changedGlobals = true;
}

function processNonLimbo(collect, info, archivable, newlyQueued, newlyLogged, newlyStashed, newlyUnstashed) {
    let [loggable, dump] = archivable;
    let dumpSize = loggable.dumpSize;
    if (collect) {
        loggable.collected = true;
        reqresQueue.push(archivable);
        reqresQueueSize += dumpSize;
        newlyQueued.push(loggable);
        gotNewQueued = true;

        globals.collectedTotal += 1;
        globals.collectedSize += dumpSize;
        info.collectedTotal += 1;
        info.collectedSize += dumpSize;

        if (!config.archive && config.stash)
            // stuck queue, stash it
            newlyStashed.push(archivable);
    } else {
        loggable.collected = false;
        globals.discardedTotal += 1;
        globals.discardedSize += dumpSize;
        info.discardedTotal += 1;
        info.discardedSize += dumpSize;

        if (loggable.inLS !== undefined)
            // it was stashed before, unstash it
            newlyUnstashed.push(archivable);
    }

    reqresLog.push(loggable);
    newlyLogged.push(loggable);
}

async function processAlmostDone(updatedTabId) {
    let newlyProblematic = [];
    let newlyLimboed = [];
    let newlyQueued = [];
    let newlyLogged = [];
    let newlyStashed = [];
    let newlyUnstashed = [];

    while (reqresAlmostDone.length > 0) {
        let reqres = reqresAlmostDone.shift();
        try {
            await processOneAlmostDone(reqres, newlyProblematic, newlyLimboed, newlyQueued, newlyLogged, newlyStashed, newlyUnstashed);
        } catch (err) {
            logHandledError(err);
            markAsErrored(err, [reqres, null]);
        }
        let tabId = reqres.tabId;
        updatedTabId = mergeUpdatedTabIds(updatedTabId, tabId);
        scheduleUpdateDisplay(true, tabId, getEpisodic(reqresAlmostDone.length));
    }

    truncateLog();

    broadcast(["resetInFlight", getInFlightLog()]);

    if (newlyProblematic.length > 0)
        broadcast(["newProblematic", newlyProblematic]);
    if (newlyLimboed.length > 0)
        broadcast(["newLimbo", newlyLimboed]);
    if (newlyQueued.length > 0)
        broadcast(["newQueued", newlyQueued]);
    if (newlyLogged.length > 0)
        broadcast(["newLog", newlyLogged]);

    if (newlyStashed.length > 0)
        runSynchronously("stashNew", syncMany, newlyStashed, 1, true);
    if (newlyUnstashed.length > 0)
        runSynchronously("unstash", syncMany, newlyUnstashed, 0, false);

    return updatedTabId;
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
            await browser.notifications.create(`error-snapshot-${tabId}`, {
                title: "Hoardy-Web: ERROR",
                message: `While taking DOM snapshot of tab #${tabId} (${tabUrl.substr(0, 80)}):\n- ${allErrors.join("\n- ")}`,
                iconUrl: iconURL("error", 128),
                type: "basic",
            }).catch(logError);
    }
}

async function snapshot(tabIdNull) {
    if (tabIdNull === null) {
        // snapshot all tabs
        let tabs = await browser.tabs.query({});
        for (let tab of tabs) {
            let tabId = tab.id;
            let tabcfg = getOriginConfig(tabId);
            if (!tabcfg.snapshottable)
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
        if (tabId === null || reqres.tabId === tabId)
            emitRequest(requestId, reqres, "webRequest::" + reason, true);
    }
}

// wait up for reqres filters to finish
function processFinishingUpWebRequest(forcing, updatedTabId) {
    let notFinished = [];

    for (let reqres of reqresFinishingUp) {
        if (reqres.filter === undefined) {
            // this reqres finished even before having a filter
            reqresAlmostDone.push(reqres);
            updatedTabId = mergeUpdatedTabIds(updatedTabId, reqres.tabId);
            continue;
        }

        let fs = reqres.filter.status;
        if (fs == "disconnected" || fs == "closed" || fs == "failed") {
            // the filter is done, remove it
            delete reqres["filter"];
            reqresAlmostDone.push(reqres);
            updatedTabId = mergeUpdatedTabIds(updatedTabId, reqres.tabId);
            continue;
        }

        // the filter of this reqres is not finished yet
        // try again later
        notFinished.push(reqres);
    }

    reqresFinishingUp = notFinished;

    if (!forcing)
        scheduleEndgame(updatedTabId);

    return updatedTabId;
}

let processFinishingUp = processFinishingUpWebRequest;
if (useDebugger)
    processFinishingUp = processMatchFinishingUpWebRequestDebug;

// flush reqresFinishingUp into the reqresAlmostDone, interrupting filters
function forceFinishingUpWebRequest(predicate, updatedTabId) {
    let notFinished = [];

    for (let reqres of reqresFinishingUp) {
        if (predicate !== undefined && !predicate(reqres)) {
            notFinished.push(reqres);
            continue;
        }

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
        updatedTabId = mergeUpdatedTabIds(updatedTabId, reqres.tabId);
    }

    reqresFinishingUp = notFinished;
    return updatedTabId;
}

function syncStopInFlight(tabId, reason, updatedTabId) {
    if (useDebugger)
        emitTabInFlightDebug(tabId, reason);
    emitTabInFlightWebRequest(tabId, reason);

    updatedTabId = processFinishingUp(true, tabId);

    if (useDebugger)
        updatedTabId = forceFinishingUpDebug((r) => tabId === null || r.tabId === tabId, updatedTabId);
    updatedTabId = forceFinishingUpWebRequest((r) => tabId === null || r.tabId === tabId, updatedTabId);

    return updatedTabId;
    // NB: needs scheduleEndgame after
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
        processFinishingUp(false);
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
    // status in `hoardy-web`
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

function toggleTabConfigWorkOffline(tabcfg) {
    if (config.workOfflineImpure) {
        tabcfg.collecting = tabcfg.workOffline;
        tabcfg.children.collecting = tabcfg.workOffline;
    }
    tabcfg.workOffline = !tabcfg.workOffline;
    tabcfg.children.workOffline = tabcfg.workOffline;
}

function resetTabConfigWorkOffline(tabcfg, url) {
    if (config.workOfflineFile && url.startsWith("file:")
        || config.workOfflineData && url.startsWith("data:")) {
        if (!tabcfg.workOffline) {
            toggleTabConfigWorkOffline(tabcfg);
            return true;
        }
    }
    return false;
}

function handleBeforeNavigate(e) {
    if (e.frameId !== 0)
        // ignore sub-frames
        return;

    let tabId = e.tabId;
    if (tabId === -1)
        // ignore background tabs
        return;

    let tabcfg = getOriginConfig(tabId);
    if (resetTabConfigWorkOffline(tabcfg, e.url))
        setTabConfig(tabId, tabcfg);
}

let workaroundFirstRequest = true;

function handleBeforeRequest(e) {
    let url = e.url;

    // Ignore data, file, end extension URLs.
    // NB: `file:` URLs only happen on Chromium, Firefox does not emit
    // any `webRequest` events for those.
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

    let options = getOriginConfig(e.tabId, fromExtension);
    let workOffline = config.workOffline || options.workOffline;

    // ignore this request if archiving is disabled
    if (!config.collecting || !options.collecting) {
        if (workOffline)
            return { cancel: true };
        return;
    }

    logEvent("BeforeRequest", e, undefined);

    // Should we generate and then immediately cancel this reqres?
    let reject = false;

    // On Chromium, cancel all requests from a tab that is not yet debugged,
    // start debugging, and then reload the tab.
    if (useDebugger && e.tabId !== -1
        && !tabsDebugging.has(e.tabId)
        && (url.startsWith("http://") || url.startsWith("https://"))) {
        if (config.debugging)
            console.warn("canceling and restarting request to", url, "as tab", e.tabId, "is not managed yet");
        if (e.type == "main_frame") {
            // attach debugger and reload the main frame
            attachDebuggerAndReloadTab(e.tabId).catch(logError);
            // not using
            //   resetAttachDebuggerAndNavigateTab(e.tabId, url).catch(logError);
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
    if (!useDebugger && workaroundFirstRequest && !workOffline) {
        workaroundFirstRequest = false;
        if (config.workaroundFirefoxFirstRequest
            && e.tabId !== -1
            && initiator === undefined
            && e.type == "main_frame"
            && (url.startsWith("http://") || url.startsWith("https://"))) {
            if (config.debugging)
                console.warn("canceling and restarting request to", url, "to workaround a bug in Firefox");
            resetAndNavigateTab(e.tabId, url).catch(logError);
            return { cancel: true };
        }
    }

    let tabId = e.tabId;
    let requestId = e.requestId;
    let reqres = {
        sessionId,
        requestId,
        tabId,
        fromExtension,

        method: e.method,
        url,

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

    if (isDefinedURL(e.documentUrl)
        && !e.documentUrl.startsWith(selfURL)) // just in case
        reqres.documentUrl = e.documentUrl;

    if (isDefinedURL(e.originUrl)
        && !e.originUrl.startsWith(selfURL)) // do not leak extension id when using config.workaroundFirefoxFirstRequest
        reqres.originUrl = e.originUrl; // Firefox
    else if (isDefinedURL(e.initiator)
             && e.initiator !== "null"
             && !e.initiator.startsWith(selfURL)) // just in case
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

    if (reject || workOffline) {
        if (reject)
            reqres.errors.push("webRequest::capture::CANCELED::NO_DEBUGGER")
        if (workOffline)
            reqres.errors.push("webRequest::capture::CANCELED::BY_WORK_OFFLINE")
        reqresAlmostDone.push(reqres);
        scheduleEndgame(tabId);
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
    scheduleUpdateDisplay(true, tabId);
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
    reqres.fromCache = e.fromCache;
    reqres.statusCode = e.statusCode;
    reqres.statusLine = e.statusLine;
    reqres.responseHeaders = e.responseHeaders;
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

    reqres.redirectUrl = e.redirectUrl;
    reqres.responseComplete = true;

    if (!reqres.responded) {
        // This happens when a request gets redirected right after
        // `handleBeforeRequest` by the browser itself, by another extension,
        // or a service/shared worker.
        let firefoxInternalRedirect = !useDebugger && e.statusCode === 0;
        let firefoxExtensionRedirectToSelf = !useDebugger && (e.statusCode < 300 || e.statusCode >= 400) && isExtensionURL(e.redirectUrl);
        if (firefoxInternalRedirect || firefoxExtensionRedirectToSelf) {
            // Work around internal Firefox redirects giving no codes and
            // statuses or extensions redirecting to their local files under
            // Firefox.
            reqres.generated = true;
            reqres.responded = true;
            reqres.responseTimeStamp = e.timeStamp;
            reqres.fromCache = false;
            reqres.statusCode = 307;
            reqres.reason = "Internal Redirect";
            reqres.responseHeaders = [
                { name: "Location", value: e.redirectUrl }
            ];
            // these give no data, usually
            if (firefoxExtensionRedirectToSelf)
                reqres.responseComplete = false;
        } else
            fillResponse(reqres, e);
    }

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

    if (!reqres.responded) {
        // This happens when a request gets fulfilled by another extension or
        // a service/shared worker.
        reqres.generated = true;
        fillResponse(reqres, e);
    }

    emitRequest(e.requestId, reqres);
}

function handleErrorOccurred(e) {
    let reqres = reqresInFlight.get(e.requestId);
    if (reqres === undefined) return;

    logEvent("ErrorOccured", e, reqres);

    if (!reqres.responded) {
        // This happens when a request gets started as normal, but then the
        // loading gets interrupted by another extension or a service/shared
        // worker.
        reqres.generated = true;
        reqres.fromCache = e.fromCache;
        // NB: Not setting `reqres.responded`, nor `reqres.responseTimeStamp` here.
        // NB: This then continues to (raceCondition).
    }

    emitRequest(e.requestId, reqres, "webRequest::" + e.error);
}

function handleNotificationClicked(notificationId) {
    if (notificationId.startsWith("error-"))
        showHelp("", "error-notifications");
}

function chromiumResetRootTab(tabId, tabcfg) {
    // Navigate to `workaroundChromiumResetRootTabURL` instead.
    //
    // NB: `priority` argument here overrides `attachDebuggerAndReloadTab` what
    // `handleBeforeRequest` does. Thus, this action wins.
    if (config.collecting && tabcfg.collecting && config.workaroundChromiumResetRootTab)
        resetAttachDebuggerAndNavigateTab(tabId, config.workaroundChromiumResetRootTabURL, 0).catch(logError);
}

function handleTabCreated(tab) {
    let tabId = tab.id;

    if (config.debugging)
        console.log("tab added", tabId, tab.openerTabId);

    if (useDebugger && tab.pendingUrl === "chrome://newtab/") {
        // work around Chrome's "New Tab" action creating a child tab by
        // ignoring openerTabId
        let tabcfg = processNewTab(tabId, undefined);
        // reset its URL, maybe
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
    let tabId = e.tabId;
    if (config.debugging)
        console.log("tab activated", tabId);
    if (useDebugger)
        // Chromium does not provide `browser.menus.onShown` event
        updateMenu(getOriginConfig(tabId));
    // Usually, this will not be enough, see `handleTabUpdated`.
    scheduleUpdateDisplay(false, tabId, 1, 0, true);
}

function handleTabUpdated(tabId, changeInfo, tab) {
    if (config.debugging)
        console.log("tab updated", tabId);
    if (!useDebugger && tab.url === undefined)
        // On Firefox, there's no `tab.pendingUrl`, so `scheduleUpdateDisplay`
        // might get confused about which icon to show for our internal pages
        // narrowed to a tracked tab. So, we skip updates until `tab.url` is
        // set.
        return;
    scheduleUpdateDisplay(false, tabId, 1, 0, true);
}

// do we actually want to be reloaded?
let wantReloadSelf = false;

async function performReloadSelf() {
    if (!wantReloadSelf)
        return;

    let notGood
        = reqresErrored.size
        + reqresUnstashedByArchivable.size;
        //+ reqresUnarchivedByArchivable.size // these will be caught below

    if (notGood !== 0) {
        browser.notifications.create("error-noReload", {
            title: "Hoardy-Web: ERROR",
            message: `\`Hoardy-Web\` can NOT be reloaded while some \`unstashed\` and/or \`errored\` reqres are present.`,
            iconUrl: iconURL("error", 128),
            type: "basic",
        }).catch(logError);

        wantReloadSelf = false;
        return;
    }

    let notDoneReqres
        = reqresInFlight.size
        + debugReqresInFlight.size
        + reqresFinishingUp.length
        + debugReqresFinishingUp.length
        + reqresAlmostDone.length
        + reqresBundledAs.size;

    let notDoneTasks
        = synchronousClosures.length
        + runningActions.size
        + scheduledCancelable.size
        // scheduledRetry is ignored here
        + scheduledDelayed.size
        + scheduledSaveState.size
        + scheduledInternal.size;
        // scheduledHidden is ignored here;

    let allSynced
        = reqresLimbo.every(isSynced)
        && reqresQueue.every(isSynced)
        && Array.from(reqresUnarchivedByArchivable.keys()).every(isSynced);

    let reloadAllowed
        = notDoneReqres === 0
        && notDoneTasks === 0
        && allSynced;

    if (!reloadAllowed) {
        let stats = getStats()
        console.warn("reload blocked,",
                     "#reqres", notDoneReqres,
                     "running", stats.running_actions,
                     "scheduled", stats.scheduled_actions,
                     "synced?", allSynced);
        return;
    }

    console.warn("reloading!");

    let tabs = {};
    let currentTabs = await browser.tabs.query({});

    for (let tab of currentTabs) {
        let tabId = tab.id;
        tabs[tabId] = {
            url: getTabURL(tab),
            tabcfg: tabConfig.get(tabId),
        };
    }

    let session = {
        id: sessionId,
        tabs,
        log: reqresLog,
        // queue and others are stashed
    };

    await browser.storage.local.set({ session });

    if (useDebugger && currentTabs.every((tab) => tab.url === "about:blank" || isExtensionURL(tab.url)))
        // Chromium will close all such tabs on extension reload, meaning, in
        // this case, the whole browser window will close
        await browser.tabs.create({ url: "chrome://extensions/" });

    browser.runtime.reload();
}

function reloadSelf() {
    wantReloadSelf = true;
    //retryUnarchived(true);
    syncRetryUnstashed();
    syncStashAll(true);
    syncRunActions();
    scheduleEndgame(null);
}

function cancelReloadSelf() {
    wantReloadSelf = false;
    scheduleEndgame(null);
}

// is there a new version ready to be used?
let updateAvailable = false;

function handleUpdateAvailable(details) {
    updateAvailable = true;
    if (config.autoReloadOnUpdates)
        reloadSelf();
    else
        scheduleUpdateDisplay(true);
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

    let [cmd, arg1, arg2, arg3, arg4] = request;
    switch (cmd) {
    case "reloadSelf":
        reloadSelf();
        break;
    case "cancelReloadSelf":
        cancelReloadSelf();
        break;
    case "getSessionId":
        sendResponse(sessionId);
        return;
    case "getConfig":
        sendResponse(config);
        return;
    case "setConfig":
        let oldConfig = config;
        config = updateFromRec(assignRec({}, oldConfig), arg1);

        fixConfig(config, oldConfig);

        if (!config.ephemeral && !equalRec(oldConfig, config))
            // save config after a little pause to give the user time to click
            // the same toggle again without torturing the SSD
            asyncSaveConfig();

        if (useDebugger)
            syncDebuggersState();

        if (oldConfig.archiveSubmitHTTP !== config.archiveSubmitHTTP)
            wantArchiveDoneNotify = true;

        if (config.stash && oldConfig.stash != config.stash)
            syncStashAll(false);

        if (config.archive && oldConfig.archive !== config.archive)
            syncRetryUnarchived(false);

        scheduleEndgame(null);
        broadcast(["updateConfig", config]);
        break;
    case "resetConfig":
        config = assignRec({}, configDefaults);
        asyncSaveConfig();
        scheduleUpdateDisplay(true, null);
        broadcast(["updateConfig", config]);
        break;
    case "getTabConfig":
        sendResponse(getOriginConfig(arg1));
        return;
    case "setTabConfig":
        setTabConfig(arg1, arg2);
        break;
    case "getStats":
        sendResponse(getStats());
        return;
    case "resetPersistentStats":
        resetPersistentStats();
        break;
    case "getTabStats":
        sendResponse(getTabStats(arg1));
        return;
    case "getProblematicLog":
        sendResponse(getProblematicLog());
        return;
    case "unmarkProblematic":
        unmarkProblematic(arg1, arg2, arg3);
        break;
    case "rotateProblematic":
        rotateProblematic(arg1, arg2, arg3);
        break;
    case "getInFlightLog":
        sendResponse(getInFlightLog());
        return;
    case "stopInFlight":
        let updatedTabId = syncStopInFlight(arg1, "capture::EMIT_FORCED::BY_USER");
        scheduleEndgame(updatedTabId);
        break;
    case "getInLimboLog":
        sendResponse(getInLimboLog());
        return;
    case "popInLimbo":
        popInLimbo(arg1, arg2, arg3, arg4);
        break;
    case "rotateInLimbo":
        rotateInLimbo(arg1, arg2, arg3);
        break;
    case "getLog":
        sendResponse(reqresLog);
        return;
    case "forgetHistory":
        forgetHistory(arg1, arg2);
        break;
    case "getQueuedLog":
        sendResponse(getQueuedLog());
        return;
    case "getUnarchivedLog":
        sendResponse(getUnarchivedLog());
        return;
    case "retryFailed":
        syncRetryUnarchived(true);
        syncRetryUnstashed();
        scheduleEndgame(null);
        break;
    case "retryUnarchived":
        syncRetryUnarchived(true);
        scheduleEndgame(null);
        break;
    case "getSavedFilters":
        sendResponse(savedFilters);
        return;
    case "setSavedFilters":
        savedFilters = updateFromRec(savedFilters, arg1);
        broadcast(["setSavedFilters", savedFilters]);
        broadcast(["resetSaved", [null]]); // invalidate UI
        wantBroadcastSaved = true;
        scheduleEndgame(null);
        break;
    case "requeueSaved":
        requeueSaved(arg1);
        break;
    case "deleteSaved":
        deleteSaved();
        break;
    case "forgetErrored":
        syncForgetErrored();
        scheduleEndgame(null);
        break;
    case "stashAll":
        syncStashAll(true);
        scheduleEndgame(null);
        break;
    case "retryUnstashed":
        syncRetryUnstashed();
        scheduleEndgame(null);
        break;
    case "snapshot":
        snapshot(arg1);
        break;
    case "runActions":
        syncRunActions();
        scheduleEndgame(null);
        break;
    case "cancelActions":
        syncCancelActions();
        scheduleEndgame(null);
        break;
    case "exportAs":
        asyncBucketSaveAs(0, arg1);
        scheduleUpdateDisplay(true);
        break;
    case "broadcast":
        broadcast(arg1);
        break;
    default:
        console.error("what?", request);
        throw new Error("what request?");
    }
    sendResponse(null);
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
    if (browser.menus === undefined)
        return;

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
    if (browser.menus === undefined)
        return;

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
        snapshot(null);
        return;
    case "snapshotTab":
        snapshot(tabId);
        return;
    case "toggleTabConfigSnapshottable":
        tabcfg = getOriginConfig(tabId);
        tabcfg.snapshottable = !tabcfg.snapshottable;
        tabcfg.children.snapshottable = tabcfg.snapshottable;
        break;
    case "toggleTabConfigChildrenSnapshottable":
        tabcfg = getOriginConfig(tabId);
        tabcfg.children.snapshottable = !tabcfg.children.snapshottable;
        break;
    case "toggleTabConfigWorkOffline":
        tabcfg = getOriginConfig(tabId);
        toggleTabConfigWorkOffline(tabcfg);
        break;
    case "toggleTabConfigChildrenWorkOffline":
        tabcfg = getOriginConfig(tabId);
        if (config.workOfflineImpure)
            tabcfg.children.collecting = tabcfg.children.workOffline;
        tabcfg.children.workOffline = !tabcfg.children.workOffline;
        break;
    case "toggleTabConfigTracking":
        tabcfg = getOriginConfig(tabId);
        tabcfg.collecting = !tabcfg.collecting;
        tabcfg.children.collecting = tabcfg.collecting;
        break;
    case "toggleTabConfigChildrenTracking":
        tabcfg = getOriginConfig(tabId);
        tabcfg.children.collecting = !tabcfg.children.collecting;
        break;
    case "toggleTabConfigProblematicNotify":
        tabcfg = getOriginConfig(tabId);
        tabcfg.problematicNotify = !tabcfg.problematicNotify;
        tabcfg.children.problematicNotify = tabcfg.problematicNotify;
        break;
    case "toggleTabConfigChildrenProblematicNotify":
        tabcfg = getOriginConfig(tabId);
        tabcfg.children.problematicNotify = !tabcfg.children.problematicNotify;
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

    setTabConfig(tabId, tabcfg);
}

function fixConfig(config, oldConfig) {
    if (reqresIDB === undefined)
        config.preferIndexedDB = false;
    else if (useDebugger && !config.preferIndexedDB) {
        // can not be disabled on Chromium ATM, since serialization of
        // Uint8Array to `storage.local` won't work there
        config.preferIndexedDB = true;

        if (config.hintNotify)
            browser.notifications.create("hint-configNotSupported-preferIndexedDB", {
                title: "Hoardy-Web: HINT",
                message: `"Prefer \`IndexedDB\` API" can not be disabled on a Chromium-based browser. See the description of that option for more info.` + annoyingNotification(config, "Generate notifications about > ... UI hints"),
                iconUrl: iconURL("main", 128),
                type: "basic",
            }).catch(logError);
    }

    if (isMobile && isFirefox && config.archiveExportAs) {
        config.archiveExportAs = false;

        // Firefox on Android does not switch to new tabs opened from the settings
        if (config.hintNotify)
            browser.notifications.create("hint-configNotSupported-archiveExportAs", {
                title: "Hoardy-Web: HINT",
                message: `"Export via \`saveAs\` is not supported on Firefox-based mobile browsers. See the "Help" page for more info.` + annoyingNotification(config, "Generate notifications about > ... UI hints"),
                iconUrl: iconURL("main", 128),
                type: "basic",
            }).catch(logError);
    }

    if (!isMobile && !config.spawnNewTabs) {
        config.spawnNewTabs = true;

        if (config.hintNotify)
            browser.notifications.create("hint-configNotSupported-spawnNewTabs", {
                title: "Hoardy-Web: HINT",
                message: `"Spawn internal pages in new tabs" can not be disabled on a desktop browser. See the description of that option for more info.` + annoyingNotification(config, "Generate notifications about > ... UI hints"),
                iconUrl: iconURL("main", 128),
                type: "basic",
            }).catch(logError);
    }

    let anyA = config.archiveExportAs || config.archiveSubmitHTTP || config.archiveSaveLS;
    if (!anyA) {
        // at lest one of these must be set
        if (config.archiveSaveLS !== oldConfig.archiveSaveLS)
            config.archiveExportAs = true;
        else
            config.archiveSaveLS = true;
    }

    // to prevent surprises
    if (config.archive
        && (reqresQueue.length > 0 || reqresUnarchivedByArchivable.size > 0)
        && (config.archiveExportAs !== oldConfig.archiveExportAs
         || config.archiveSubmitHTTP !== oldConfig.archiveSubmitHTTP
         || config.archiveSaveLS !== oldConfig.archiveSaveLS)) {
        config.archive = false;

        if (config.hintNotify)
            browser.notifications.create("hint-notArchivingNow", {
                title: "Hoardy-Web: HINT",
                message: `"Archive \`collected\` reqres" option was disabled because the archival queue and/or the list of failed reqres are non-empty.` + annoyingNotification(config, "Generate notifications about > ... UI hints"),
                iconUrl: iconURL("off", 128),
                type: "basic",
            }).catch(logError);
    }

    if (!config.background.bucket)
        config.background.bucket = configDefaults.background.bucket;
    if (!config.extension.bucket)
        config.extension.bucket = configDefaults.extension.bucket;
    if (!config.root.bucket)
        config.root.bucket = configDefaults.root.bucket;

    // clamp
    config.animateIcon = clamp(100, 5000, toNumber(config.animateIcon));
    config.exportAsMaxSize = clamp(1, useDebugger ? 512 : 32, toNumber(config.exportAsMaxSize));
    config.exportAsTimeout = clamp(0, 900, toNumber(config.exportAsTimeout));
    config.exportAsInFlightTimeout = clamp(config.exportAsTimeout, 900, toNumber(config.exportAsInFlightTimeout));

    // these are mutually exclusive
    if (config.autoPopInLimboCollect && config.autoPopInLimboDiscard)
        config.autoPopInLimboDiscard = false;
}

function upgradeConfig(config) {
    function rename(from, to) {
        let old = config[from];
        delete config[from];
        config[to] = old;
    }

    switch (config.version) {
    case 1:
        rename("collectPartialRequests", "archivePartialRequest");
        rename("collectNoResponse", "archiveNoResponse");
        rename("collectIncompleteResponses", "archiveIncompleteResponse")
    case 2:
        // because it got updated lots
        config.seenHelp = false;
    case 3:
        // making them disjoint
        if (config.markProblematicWithErrors)
            config.markProblematicPickedWithErrors = true;
        rename("markProblematicWithErrors", "markProblematicDroppedWithErrors")
    case 4:
        // because that, essentially, was the default before, even though it is not now
        config.archiveSubmitHTTP = true;
        config.archiveSaveLS = false;

        rename("archiving", "archive")
        rename("archiveURLBase", "submitHTTPURLBase");
        rename("archiveNotifyOK", "archiveDoneNotify")
        rename("archiveNotifyFailed", "archiveFailedNotify")
        rename("archiveNotifyDisabled", "archiveStuckNotify")

        config.root.bucket = config.root.profile;
        config.extension.bucket = config.extension.profile;
        config.background.bucket = config.background.profile;
    case 5:
        if (config.exportAsMaxSize === 0) {
            config.exportAsBundle = false;
            config.exportAsMaxSize = configDefaults.exportAsMaxSize;
        }
        // because it got updated lots
        config.seenHelp = false;
        break;
    case 6:
        break;
    default:
        console.warn(`Bad old config version ${config.version}, reusing values as-is without updates`);
        // the following updateFromRec will do its best
    }
}

function upgradeGlobals(globs) {
    if (globs.version === undefined)
        globs.version = 1;

    return globs;
}

async function init() {
    browser.runtime.onUpdateAvailable.addListener(catchAll(handleUpdateAvailable));

    let localData = await browser.storage.local.get([
        "config", "globals", "session",
        // obsolete names for `globals`
        "persistentStats", "globalStats"
    ]).catch(() => { return {}; });

    let oldConfig = localData.config;
    if (oldConfig !== undefined) {
        console.log(`Loading config of version ${oldConfig.version}`);

        upgradeConfig(oldConfig);
        config = updateFromRec(config, oldConfig);
        savedConfig = config;
    }

    let oldGlobals = getFirstDefined(localData.globals, localData.persistentStats, localData.globalStats);
    if (oldGlobals !== undefined) {
        console.log(`Loading globals of version ${oldGlobals.version}`);

        oldGlobals = upgradeGlobals(oldGlobals);
        globals = updateFromRec(globals, oldGlobals);
        savedGlobals = globals;
    }

    let lastSeenVersion = config.lastSeenVersion;
    config.version = configVersion;
    config.ephemeral = false;
    if (config.seenChangelog && lastSeenVersion != manifest.version) {
        // reset `config.seenChangelog` when major version changes
        let vOld = lastSeenVersion.split(".");
        let vNew = manifest.version.split(".").slice(0, 2);
        config.seenChangelog = equalRec(vOld, vNew);
    }
    config.lastSeenVersion = manifest.version;

    if (false) {
        // for debugging
        config.ephemeral = true;
        updateAvailable = true;
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
        browser.notifications.create("error-noIndexedDB", {
            title: "Hoardy-Web: ERROR",
            message: `Failed to open/create a database via \`IndexedDB\` API, all data persistence will be done via \`storage.local\` API instead. This is not ideal, but not particularly bad. However, the critical issue is that it appears \`Hoardy-Web\` previously used \`IndexedDB\` for archiving and/or stashing reqres.\n\nSee the "Help" page for more info and instructions on how to fix this.`,
            iconUrl: iconURL("error", 128),
            type: "basic",
        }).catch(logError);
    }

    // NB: this depends on reqresIDB
    fixConfig(config, config);

    let oldSession = localData.session;
    let sessionTabs = {};
    if (oldSession !== undefined) {
        // to prevent it from being loaded again
        await browser.storage.local.remove("session").catch(() => {});

        sessionId = oldSession.id;
        console.log(`Loading old session ${oldSession.id}`);
        sessionTabs = oldSession.tabs;
        reqresLog = oldSession.log;

        // populate reqresProblematic
        for (let loggable of reqresLog) {
            if (loggable.problematic) {
                let info = getOriginState(loggable.tabId, loggable.fromExtension);
                reqresProblematic.push([loggable, null]);
                info.problematicTotal += 1;
                gotNewProblematic = true;
            }
        }
    }

    // get all currently open tabs
    let tabs = await browser.tabs.query({});
    for (let tab of tabs) {
        let tabId = tab.id;
        let tabUrl = getTabURL(tab);

        // record they exist
        openTabs.add(tabId);

        let oldTab = sessionTabs[tab.id];

        let tabcfg = prefillChildren(config.root);
        if (oldTab !== undefined && oldTab.url === tabUrl)
            // reuse old config
            tabcfg = updateFromRec(tabcfg, oldTab.tabcfg);

        // on Chromium, reset their URLs, maybe
        if (useDebugger && tabUrl === "chrome://newtab/")
            chromiumResetRootTab(tabId, tabcfg);
        // reset workOffline toggles
        else if (tabUrl !== undefined)
            resetTabConfigWorkOffline(tabcfg, tabUrl);

        // save it
        setTabConfigInternal(tabId, tabcfg);
    }

    await loadStashed();

    console.log(`initialized Hoardy-Web with source of '${sourceDesc}'`);
    console.log("runtime options are", { useSVGIcons, useBlocking, useDebugger });
    console.log("config is", config);
    console.log("globals are", globals);

    // `webNavigation` and `webRequest` use different filter formats, of course.
    let filterAllN = { url: [{}] };
    let filterAllR = { urls: ["<all_urls>"] };

    browser.webNavigation.onBeforeNavigate.addListener(catchAll(handleBeforeNavigate), filterAllN)
    if (useBlocking)
        browser.webRequest.onBeforeRequest.addListener(catchAll(handleBeforeRequest), filterAllR, ["blocking", "requestBody"]);
    else
        browser.webRequest.onBeforeRequest.addListener(catchAll(handleBeforeRequest), filterAllR, ["requestBody"]);
    browser.webRequest.onBeforeSendHeaders.addListener(catchAll(handleBeforeSendHeaders), filterAllR);
    browser.webRequest.onSendHeaders.addListener(catchAll(handleSendHeaders), filterAllR, ["requestHeaders"]);
    browser.webRequest.onHeadersReceived.addListener(catchAll(handleHeadersRecieved), filterAllR, ["responseHeaders"]);
    browser.webRequest.onBeforeRedirect.addListener(catchAll(handleBeforeRedirect), filterAllR, ["responseHeaders"]);
    browser.webRequest.onAuthRequired.addListener(catchAll(handleAuthRequired), filterAllR);
    browser.webRequest.onCompleted.addListener(catchAll(handleCompleted), filterAllR, ["responseHeaders"]);
    browser.webRequest.onErrorOccurred.addListener(catchAll(handleErrorOccurred), filterAllR);

    browser.notifications.onClicked.addListener(catchAll(handleNotificationClicked));

    browser.tabs.onCreated.addListener(catchAll(handleTabCreated));
    browser.tabs.onRemoved.addListener(catchAll(handleTabRemoved));
    browser.tabs.onReplaced.addListener(catchAll(handleTabReplaced));
    browser.tabs.onActivated.addListener(catchAll(handleTabActivated));
    browser.tabs.onUpdated.addListener(catchAll(handleTabUpdated));

    if (browser.commands !== undefined)
        browser.commands.onCommand.addListener(catchAll(handleCommand));

    browser.runtime.onMessage.addListener(catchAll(handleMessage));
    browser.runtime.onConnect.addListener(catchAll(handleConnect));

    initMenus();

    if (useDebugger)
        await initDebugger(tabs);

    console.log("Ready to Hoard the Web!");

    if (lastSeenVersion != manifest.version) {
        browser.notifications.create("info-updated", {
            title: "Hoardy-Web: INFO",
            message: `\`Hoardy-Web\` updated \`${lastSeenVersion}\` -> \`${manifest.version}\``,
            iconUrl: iconURL("main", 128),
            type: "basic",
        }).catch(logError);
    }

    if (config.autoPopInLimboDiscard || config.discardAll) {
        let what = [];
        if (config.autoPopInLimboDiscard)
            what.push(`"Auto-discard reqres in limbo"`);
        if (config.discardAll)
            what.push(`"Discard all reqres just before archival"`);
        browser.notifications.create("reminder-autoDiscard", {
            title: "Hoardy-Web: REMINDER",
            message: `Some auto-discarding options are enabled: ${what.join(", ")}.`,
            iconUrl: iconURL("limbo", 128),
            type: "basic",
        }).catch(logError);
    }

    asyncNotifications(1000);

    scheduleUpdateDisplay(true, null);
}

init();
