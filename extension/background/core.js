/*
 * The core code of pWebArc.
 * And WebRequest-assisted request collection (for Firefox-based browsers).
 *
 * Copyright (c) 2023-2024 Jan Malakhovski <oxij@oxij.org>
 *
 * This file can be distributed under the terms of the GNU GPL, version 3 or later.
 */

"use strict";

// for archiving
let sourceDesc = browser.nameVersion + "+pWebArc/" + manifest.version;

// default config
let configVersion = 3;
let config = {
    version: configVersion,

    // debugging options
    ephemeral: false, // stop the config from being saved to disk
    debugging: false, // verbose debugging logs
    dumping: false, // dump dumps to console
    doNotQueue: false,

    // UI
    lastSeenVersion: manifest.version,
    seenChangelog: true,
    seenHelp: false,
    colorblind: false,
    pureText: false,

    // log settings
    history: 1000,
    logDiscarded: true,

    // are we collecting new data?
    collecting: true,

    // are we archiving? or temporarily paused
    archiving: true,
    archiveURLBase: "http://127.0.0.1:3210/pwebarc/dump",
    archiveNotifyOK: true,
    archiveNotifyFailed: true,
    archiveNotifyDisabled: true,

    // problematic options
    markProblematicPartialRequest: false,
    markProblematicCanceled: false,
    markProblematicNoResponse: true,
    markProblematicIncomplete: true,
    markProblematicIncompleteFC: false,
    markProblematicWithErrors: false,
    markProblematicPickedWithErrors: true,
    problematicNotify: true,
    problematicNotifyNumber: 3,

    // collection options
    archivePartialRequest: true,
    archiveCanceled: false,
    archiveNoResponse: false,
    archiveIncompleteResponse: false,
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

    // workarounds
    workaroundFirefoxFirstRequest: true,
    workaroundChromiumDebugTimeout: 3,

    root: {
        collecting: true,
        limbo: false,
        negLimbo: false,
        profile: "default",
    },

    extension: {
        collecting: false,
        limbo: false,
        negLimbo: false,
        profile: "extension",
    },

    background: {
        collecting: true,
        limbo: false,
        negLimbo: false,
        profile: "background",
    },
};

// scheduled internal functions
let scheduledInternal = new Map();
// scheduled cancelable functions
let scheduledCancelable = new Map();
// scheduled functions hidden from the UI
let scheduledHidden = new Map();

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
    else if (tabId == -1) // background process
        return prefillChildren(config.background);
    return cacheSingleton(tabConfig, tabId, () => prefillChildren(config.root));
}

function processNewTab(tabId, openerTabId) {
    openTabs.add(tabId);

    if (useDebugger && openerTabId === undefined && negateOpenerTabIds.length > 0) {
        // On Chromium, `browser.tabs.create` with `openerTabId` specified
        // does not pass it into `openerTabId` variable here (it's a bug), so
        // we have to work around it by using `negateOpenerTabIds` variable.
        openerTabId = negateOpenerTabIds.shift();
    }

    let openercfg;
    if (openerTabId !== undefined)
        openercfg = getOriginConfig(openerTabId);
    else
        openercfg = prefillChildren(config.root); // root tab

    let children = openercfg.children;
    if (openerTabId !== undefined && negateConfigFor.delete(openerTabId)) {
        // Negate children.collecting when `openerTabId` is in `negateConfigFor`.
        children = assignRec({}, openercfg.children);
        children.collecting = !children.collecting;
    }
    let tabcfg = prefillChildren(children);
    tabConfig.set(tabId, tabcfg);
    return tabcfg;
}

// frees unused `tabConfig` and `tabState` structures, returns `true` if
// cleanup changed stats (which can happens when a deleted tab has problematic
// reqres)
function cleanupTabs() {
    // collect all tabs referenced in not yet archived requests
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
    for (let v of reqresProblematic)
        usedTabs.add(v.tabId);
    for (let [v, _x] of reqresLimbo)
        usedTabs.add(v.tabId);
    for (let [v, _x] of reqresQueue)
        usedTabs.add(v.tabId);
    for (let [k, f] of reqresFailed.entries())
        for(let v of f.queue)
            usedTabs.add(v.tabId);

    // delete configs of closed and unused tabs
    for (let tabId of Array.from(tabConfig.keys())) {
        if(openTabs.has(tabId) || usedTabs.has(tabId))
            continue;
        if (config.debugging)
            console.log("removing config of tab", tabId);
        tabConfig.delete(tabId);
        tabState.delete(tabId);
    }

    // delete any stale leftovers from tabState
    for (let tabId of Array.from(tabState.keys())) {
        if(openTabs.has(tabId) || usedTabs.has(tabId))
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
        if (unprob > 0 && unlimbo > 0)
            message = `Auto-unmarked ${unprob} problematic and auto-${what} ${unlimbo} in-limbo reqres from tab #${tabId}.`;
        else if (unprob > 0)
            message = `Auto-unmarked ${unprob} problematic reqres from tab #${tabId}.`;
        else
            message = `Auto-${what} ${unlimbo} in-limbo reqres from tab #${tabId}.`;

        browser.notifications.create(`cleaned-${tabId}`, {
            title: "pWebArc: AUTO",
            message,
            iconUrl: iconURL("error", 128),
            type: "basic",
        }).catch(logError);
    }

    cleanupTabs();
    updateDisplay(0, true, false, tabId);
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
        resetSingletonTimeout(scheduledCancelable, `forceStopDebugTab#${tabId}`, timeout, () => {
            if (config.debugging)
                console.log("cleaning up debugReqresInFlight after tab", tabId);
            forceEmitInFlightDebug(tabId, "pWebArc::EMIT_FORCED_BY_CLOSED_TAB");
            processMatchFinishingUpWebRequestDebug();
            scheduleCleanupAfterTab(tabId, timeout);
            updateDisplay(0, true, false, tabId);
        });
    } else
        scheduleCleanupAfterTab(tabId, 0);

    updateDisplay(0, true, false, tabId);
}

// browserAction state
let oldTitle = null;
let oldBadge = null;
let oldColor = null;

// archiving state
// reqres means "request + response"

// requests in-flight, indexed by requestId
let reqresInFlight = new Map();
// requests that are "completed" by the browser, but might have an unfinished filterResponseData filter
let reqresFinishingUp = [];
// completely finished requests
let reqresAlmostDone = [];
// problematic requests
let reqresProblematic = [];
// requests in limbo, waiting to be either dropped or queued for archival
let reqresLimbo = [];
let reqresLimboSize = 0;
// requests in the process of being archived
let reqresQueue = [];
// total number of archived reqres
let reqresArchivedTotal = 0;
// failed requests, indexed by archiveURL
let reqresFailed = new Map();

// request log
let reqresLog = [];

function getInFlightLog() {
    let res = [];
    for (let v of reqresAlmostDone)
        res.push(shallowCopyOfReqres(v));
    for (let v of reqresFinishingUp)
        res.push(shallowCopyOfReqres(v));
    for (let v of debugReqresFinishingUp)
        res.push(shallowCopyOfReqres(v));
    for (let [k, v] of reqresInFlight.entries())
        res.push(shallowCopyOfReqres(v));
    for (let [k, v] of debugReqresInFlight.entries()) {
        if (!isBoringURL(v.url))
            res.push(shallowCopyOfReqres(v));
    }
    return res;
}

function getInLimboLog() {
    let res = [];
    for (let [v, _x] of reqresLimbo) {
        res.push(v);
    }
    return res;
}

let persistentStatsDefaults = {
    // problematicTotal is reqresProblematic.length
    // total numbers of picked and dropped reqres
    pickedTotal: 0,
    droppedTotal: 0,
    // total numbers of collected and discarded reqres
    collectedTotal: 0,
    collectedSize: 0,
    discardedTotal: 0,
};

// persistent global stats
let persistentStats = assignRec({}, persistentStatsDefaults);
// did it change recently?
let changedPersistentStats = false;

async function savePersistentStats() {
    console.log("saving persistentStats", persistentStats);
    changedPersistentStats = false;
    await browser.storage.local.set({ persistentStats }).catch(logError);
    await browser.storage.local.remove("globalStats").catch(() => {});
}

async function resetPersistentStats() {
    persistentStats = assignRec({}, persistentStatsDefaults);
    await savePersistentStats();
    await updateDisplay(0, true, false);
}

// per-source persistentStats.pickedTotal, persistentStats.droppedTotal, etc
let tabState = new Map();
let defaultTabState = {
    problematicTotal: 0,
    pickedTotal: 0,
    droppedTotal: 0,
    inLimboTotal: 0,
    inLimboSize: 0,
    collectedTotal: 0,
    collectedSize: 0,
    discardedTotal: 0,
};

function getOriginState(tabId, fromExtension) {
    // NB: not tracking extensions separately here, unlike with configs
    if (fromExtension)
        tabId = -1;
    return cacheSingleton(tabState, tabId, () => assignRec({}, defaultTabState));
}

// scheduleComplaints flags
// do we have new failed or archived reqres?
let newArchivedOrFailed = false;
// do we need to show empty queue notification?
let needArchivingOK = true;
// do we have new queued reqres?
let newQueued = false;
// do we have new reqres in limbo?
let newLimbo = false;
// do we have newp problematic reqres?
let newProblematic = false;

// Compute total sizes of all queues and similar.
// Used in the UI.
function getStats() {
    let archive_failed = 0;
    for (let [archiveURL, f] of reqresFailed.entries()) {
        archive_failed += f.queue.length;
    }

    let in_flight = reqresAlmostDone.length +
        Math.max(reqresInFlight.size, debugReqresInFlight.size) +
        Math.max(reqresFinishingUp.length, debugReqresFinishingUp.length);

    let low_prio = countSingletonTimeouts(scheduledCancelable);

    return {
        scheduled_low: low_prio,
        scheduled: low_prio
                 + countSingletonTimeouts(scheduledInternal),
        in_flight,
        problematic: reqresProblematic.length,
        picked: persistentStats.pickedTotal,
        dropped: persistentStats.droppedTotal,
        in_limbo: reqresLimbo.length,
        in_limbo_size: reqresLimboSize,
        in_queue: reqresQueue.length,
        collected: persistentStats.collectedTotal,
        collected_size: persistentStats.collectedSize,
        discarded: persistentStats.discardedTotal,
        archive_ok: reqresArchivedTotal,
        archive_failed,
        issues: in_flight
            + reqresLimbo.length + reqresQueue.length
            + reqresProblematic.length + archive_failed,
    };
}

// Produce a value similar to that of `getStats`, but for a single tab.
// Used in the UI.
function getTabStats(tabId) {
    let info = tabState.get(tabId);
    if (info === undefined)
        info = defaultTabState;

    let in_flight = 0;
    let in_flight_debug = 0;
    for (let [k, v] of reqresInFlight.entries())
        if (v.tabId == tabId)
            in_flight += 1;
    for (let [k, v] of debugReqresInFlight.entries())
        if (v.tabId == tabId)
            in_flight_debug += 1;

    let finishing_up = 0;
    let finishing_up_debug = 0;
    for (let v of reqresFinishingUp)
        if (v.tabId == tabId)
            finishing_up += 1;
    for (let v of debugReqresFinishingUp)
        if (v.tabId == tabId)
            finishing_up_debug += 1;

    let almost_done = 0;
    for (let v of reqresAlmostDone)
        if (v.tabId == tabId)
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
    };
}

function unmarkProblematic(num, tabId, rrfilter) {
    if (reqresProblematic.length == 0)
        return;
    if (tabId === undefined)
        tabId = null;
    if (rrfilter === undefined)
        rrfilter = null;

    let [popped, unpopped] = partitionN((shallow) => {
        let res = (tabId === null || shallow.tabId == tabId)
               && (rrfilter === null || isAcceptedBy(rrfilter, shallow));
        if (res) {
            shallow.problematic = false;
            let info = getOriginState(shallow.tabId, shallow.fromExtension);
            info.problematicTotal -= 1;
        }
        return res;
    }, num, reqresProblematic);
    reqresProblematic = unpopped;

    if (popped.length > 0) {
        // reset all the logs, since some statuses may have changed
        broadcast(["resetProblematicLog", reqresProblematic]);
        broadcast(["resetInLimboLog", getInLimboLog()]);
        broadcast(["resetLog", reqresLog]);
        cleanupTabs();
        updateDisplay(0, true, false, tabId);
        scheduleComplaints(100);
    }

    return popped.length;
}

function rotateProblematic(num, tabId, rrfilter) {
    if (reqresProblematic.length == 0)
        return;
    if (tabId === undefined)
        tabId = null;
    if (rrfilter === undefined)
        rrfilter = null;

    let [popped, unpopped] = partitionN((shallow) => {
        let res = (tabId === null || shallow.tabId == tabId)
               && (rrfilter === null || isAcceptedBy(rrfilter, shallow));
        return res;
    }, num, reqresProblematic);
    // rotate them to the back
    for (let shallow of popped)
        unpopped.push(shallow);
    reqresProblematic = unpopped;

    broadcast(["resetProblematicLog", reqresProblematic]);
    //updateDisplay(0, false, false, tabId);
}

function popInLimbo(collect, num, tabId, rrfilter) {
    if (reqresLimbo.length == 0)
        return;
    if (tabId === undefined)
        tabId = null;
    if (rrfilter === undefined)
        rrfilter = null;

    let newLog = [];
    let [popped, unpopped] = partitionN((el) => {
        let [shallow, dump] = el;
        let res = (tabId === null || shallow.tabId == tabId)
               && (rrfilter === null || isAcceptedBy(rrfilter, shallow));
        if (res) {
            let info = getOriginState(shallow.tabId, shallow.fromExtension);
            info.inLimboTotal -= 1;
            info.inLimboSize -= dump.byteLength;
            processFinishedReqres(info, collect, shallow, dump, newLog);
            reqresLimboSize -= dump.byteLength;
        }
        return res;
    }, num, reqresLimbo);
    reqresLimbo = unpopped;

    if (popped.length > 0) {
        broadcast(["resetInLimboLog", getInLimboLog()]);
        if (popped.some((r) => r.problematic === true))
            // also reset problematic, since reqres statuses have changed
            broadcast(["resetProblematicLog", reqresProblematic]);
        broadcast(["newLog", newLog, false]);
        scheduleEndgame(tabId);
    }

    return popped.length;
}

function rotateInLimbo(num, tabId, rrfilter) {
    if (reqresLimbo.length == 0)
        return;
    if (tabId === undefined)
        tabId = null;
    if (rrfilter === undefined)
        rrfilter = null;

    let [popped, unpopped] = partitionN((el) => {
        let [shallow, dump] = el;
        let res = (tabId === null || shallow.tabId == tabId)
               && (rrfilter === null || isAcceptedBy(rrfilter, shallow));
        return res;
    }, num, reqresLimbo);
    // rotate them to the back
    for (let el of popped)
        unpopped.push(el);
    reqresLimbo = unpopped;

    broadcast(["resetInLimboLog", getInLimboLog()]);
    //updateDisplay(0, false, false, tabId);
}

function forgetHistory(tabId, rrfilter) {
    if (reqresLog.length == 0)
        return;
    if (tabId === undefined)
        tabId = null;
    if (rrfilter === undefined)
        rrfilter = null;

    let [popped, unpopped] = partitionN((shallow) => {
        let res = (tabId === null || shallow.tabId == tabId)
               && (rrfilter === null || isAcceptedBy(rrfilter, shallow))
               && (shallow.problematic === false
                // this is so that the user could forget problematic reqres
                // with `forgetHistory` button
                || rrfilter !== null && rrfilter.problematic !== null);
        return res;
    }, null, reqresLog);
    reqresLog = unpopped;

    broadcast(["resetLog", reqresLog]);
    updateDisplay(0, true, false, tabId);
}

let updateDisplayEpisode = 1;
async function updateDisplay(episodic, statsChanged, switchedTab, updatedTabId) {
    if (!switchedTab && updateDisplayEpisode < episodic) {
        updateDisplayEpisode += 1;
        return;
    }
    updateDisplayEpisode = 1;

    if (updatedTabId === undefined)
        updatedTabId = null;

    let stats = getStats();

    if (statsChanged)
        broadcast(["updateStats", stats]);

    let newBadge = "";
    let newColor = 0;
    let chunks = [];

    if (stats.issues > 0)
        newBadge = stats.issues.toString();

    if (!config.collecting)
        chunks.push("off");
    if (!config.archiving || stats.archive_failed > 0) {
        newBadge += "A";
        newColor = 1;
        if (!config.archiving)
            chunks.push("not archiving");
        if (stats.archive_failed > 0)
            chunks.push(`failed to archive ${stats.archive_failed} reqres`);
    }
    if (stats.problematic > 0) {
        newBadge += "P";
        newColor = 1;
        chunks.push(`${stats.problematic} problematic reqres`);
    }
    if (stats.in_flight > 0) {
        newBadge += "T";
        chunks.push(`still tracking ${stats.in_flight} in-flight reqres`);
    }
    if (stats.scheduled > stats.scheduled_low) {
        newBadge += "~";
        newColor = 1;
        chunks.push(`${stats.scheduled} scheduled actions`);
    }
    if (stats.in_limbo > 0) {
        newBadge += "L";
        newColor = 1;
        chunks.push(`${stats.in_limbo} reqres in limbo`);
    }
    if (stats.in_queue > 0) {
        newBadge += "Q";
        chunks.push(`${stats.in_queue} reqres in queue`);
    }
    if (stats.scheduled == stats.scheduled_low && stats.scheduled_low > 0) {
        newBadge += ".";
        chunks.push(`${stats.scheduled_low} low-priority scheduled actions`);
    }
    if (config.ephemeral) {
        newBadge += "E";
        newColor = 1;
        chunks.push("ephemeral");
    }
    if (config.debugging || config.dumping) {
        newBadge += "D";
        newColor = 1;
        chunks.push("debugging (SLOW!)");
    }
    if (config.autoPopInLimboDiscard || config.doNotQueue) {
        newBadge += "!";
        newColor = 2;
        chunks.push("auto-discarding");
    }

    let newTitle = "pWebArc: idle";
    if (chunks.length != 0)
        newTitle = "pWebArc: " + chunks.join(", ");

    let changed = switchedTab;
    if (oldTitle != newTitle || oldBadge !== newBadge) {
        if (config.debugging)
            console.log(`updated browserAction: badge "${newBadge}", title "${newTitle}"`);

        oldTitle = newTitle;
        oldBadge = newBadge;
        changed = true;

        await browser.browserAction.setBadgeText({ text: newBadge });

        if (oldColor !== newColor) {
            oldColor = newColor;
            switch (newColor) {
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
    }

    if (!changed && updatedTabId === null)
        return;

    let tabs = await browser.tabs.query({ active: true });
    for (let tab of tabs) {
        let tabId = getStateTabIdOrTabId(tab);

        // skip updates for unchanged tabs, when specified
        if (!changed && updatedTabId !== null && updatedTabId != tabId)
            continue;

        let tabcfg = tabConfig.get(tabId);
        if (tabcfg === undefined)
            tabcfg = config.root;
        let tabstats = getTabStats(tabId);

        let icon;
        if (config.archiving && stats.in_queue > 0)
            icon = "archiving";
        else if (stats.archive_failed > 0)
            icon = "error";
        else if (tabstats.in_flight > 0)
            icon = "tracking";
        else if (tabstats.problematic > 0)
            icon = "error";
        else if (!config.collecting || !tabcfg.collecting)
            icon = "off";
        else if (tabcfg.limbo || tabcfg.negLimbo)
            icon = "limbo";
        else
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

        let title = newTitle;
        if (tchunks.length != 0)
            title += "; this tab: " + tchunks.join(", ");

        if (config.debugging)
            console.log(`updated browserAction: tabId ${tab.id}: icon "${icon}", title "${title}"`);

        if (useDebugger) {
            // Chromium does not support per-window browserActions, so we have to update them per-tab.
            await browser.browserAction.setIcon({ tabId: tab.id, path: mkIcons(icon) }).catch(logErrorExceptWhenStartsWith("No tab with id:"));
            await browser.browserAction.setTitle({ tabId: tab.id, title }).catch(logErrorExceptWhenStartsWith("No tab with id:"));
        } else {
            let windowId = tab.windowId;
            await browser.browserAction.setIcon({ windowId, path: mkIcons(icon) }).catch(logError);
            await browser.browserAction.setTitle({ windowId, title }).catch(logError);
        }
    }
}

// schedule processFinishingUp
async function scheduleFinishingUp() {
    resetSingletonTimeout(scheduledInternal, "finishingUp", 100, async () => {
        await updateDisplay(0, true, false);
        processFinishingUp();
    });
}

// schedule processArchiving and processAlmostDone
async function scheduleEndgame(updatedTabId) {
    if (config.archiving && reqresQueue.length > 0) {
        resetSingletonTimeout(scheduledInternal, "endgame", 0, async () => {
            await updateDisplay(10, true, false, updatedTabId);
            processArchiving();
        });
    } else if (reqresAlmostDone.length > 0) {
        resetSingletonTimeout(scheduledInternal, "endgame", 0, async () => {
            await updateDisplay(10, true, false, updatedTabId);
            processAlmostDone();
        });
    } else if (!config.archiving || reqresQueue.length == 0) {
        cleanupTabs();

        // use a much longer timeout if some reqres are still in flight
        let inFlight = reqresInFlight.size + debugReqresInFlight.size
                     + reqresFinishingUp.length + debugReqresFinishingUp.length;
        let timeout = inFlight > 0 ? 10000 : 100;

        scheduleComplaints(timeout);
        if (changedPersistentStats)
            resetSingletonTimeout(scheduledCancelable, "savePersistentStats", timeout, async () => {
                await savePersistentStats();
                await updateDisplay(0, true, false);
            });
        await updateDisplay(0, true, false, updatedTabId);
    }
}

// mark this archiveURL as failing
function markArchiveAsFailed(archiveURL, when, reason) {
    let v = reqresFailed.get(archiveURL);
    if (v === undefined) {
        v = {
            when,
            reason,
            queue: [],
        };
        reqresFailed.set(archiveURL, v);
    } else {
        v.when = when;
        v.reason = reason;
    }

    return v;
}

// cleanup stale
function cleanupFailedArchives() {
    for (let [archiveURL, failed] of Array.from(reqresFailed.entries())) {
        if (failed.queue.length == 0)
            reqresFailed.delete(archiveURL);
    }
}

function retryFailedArchive(archiveURL) {
    let failed = reqresFailed.get(archiveURL);
    if (failed === undefined)
        return;
    for (let e of failed.queue)
        reqresQueue.push(e);
    reqresFailed.delete(archiveURL);
}

function retryAllFailedArchives() {
    for (let [archiveURL, failed] of Array.from(reqresFailed.entries())) {
        for (let e of failed.queue)
            reqresQueue.push(e);
        reqresFailed.delete(archiveURL);
    }
    scheduleEndgame(null);
}

function retryAllFailedArchivesIn(timeout) {
    resetSingletonTimeout(scheduledInternal, "retryAllFailedArchives", timeout, retryAllFailedArchives);
}

async function doComplain() {
    if (newQueued && config.archiveNotifyDisabled && !config.archiving && reqresQueue.length > 0) {
        newQueued = false;
        await browser.notifications.create("notArchiving", {
            title: "pWebArc: WARNING",
            message: "Some data is waiting in the archival queue, but archiving is disabled.",
            iconUrl: iconURL("archiving", 128),
            type: "basic",
        });
    }

    if (newArchivedOrFailed) {
        newArchivedOrFailed = false;

        // cleanup stale archives
        cleanupFailedArchives();

        // record the current state, because the rest of this chunk is async
        let rrFailed = Array.from(reqresFailed.entries());
        let queueLen = reqresQueue.length;

        // get shown notifications
        let all_ = await browser.notifications.getAll();
        let all = Object.keys(all_);

        // clear stale
        for (let label in all) {
            if (!label.startsWith("archiving-"))
                continue;
            let archiveURL = label.substr(10);
            if (rrFailed.every((e) => e[0] !== archiveURL))
                await browser.notifications.clear(label);
        }

        if (config.archiveNotifyFailed) {
            // generate new ones
            for (let [archiveURL, failed] of rrFailed) {
                await browser.notifications.create(`archiving-${archiveURL}`, {
                    title: "pWebArc: FAILED",
                    message: `Failed to archive ${failed.queue.length} items in the queue because ${failed.reason}`,
                    iconUrl: iconURL("error", 128),
                    type: "basic",
                });
            }
        }

        if (rrFailed.length == 0 && queueLen == 0) {
            if (config.archiveNotifyOK && needArchivingOK) {
                needArchivingOK = false;
                // generate a new one
                await browser.notifications.create("archivingOK", {
                    title: "pWebArc: OK",
                    message: "Archiving appears to work OK!\nThis message won't be repeated unless something breaks.",
                    iconUrl: iconURL("idle", 128),
                    type: "basic",
                });
            }
        } else if (rrFailed.length > 0)
            // clear stale
            await browser.notifications.clear("archivingOK");
    }


    let fatLimbo = reqresLimbo.length > config.limboMaxNumber
                || reqresLimboSize > config.limboMaxSize * MEGABYTE;

    if (!fatLimbo)
        // clear stale
        await browser.notifications.clear("fatLimbo");
    else if (newLimbo && config.limboNotify) {
        newLimbo = false;

        // generate a new one
        await browser.notifications.create("fatLimbo", {
            title: "pWebArc: WARNING",
            message: `Too much stuff in limbo, collect or discard some of those reqres to reduce memory consumption and improve browsing performance.`,
            iconUrl: iconURL("limbo", 128),
            type: "basic",
        });
    }

    if (reqresProblematic.length == 0)
        // clear stale
        await browser.notifications.clear("problematic");
    else if (newProblematic && config.problematicNotify) {
        newProblematic = false;

        // generate a new one
        //
        // make a log of no more than `problematicNotifyNumber`
        // elements, merging those referencing the same URL
        let latest = new Map();
        for (let i = reqresProblematic.length - 1; i >= 0; --i) {
            let r = reqresProblematic[i];
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
            message: `Have ${reqresProblematic.length} reqres marked as problematic.\n\n` + latestDesc.join("\n"),
            iconUrl: iconURL("error", 128),
            type: "basic",
        });
    }
}

function scheduleComplaints(timeout) {
    resetSingletonTimeout(scheduledHidden, "complaints", timeout, doComplain);
}

function processArchiving() {
    if (reqresQueue.length == 0)
        return;

    let archivable = reqresQueue.shift();
    let [shallow, dump] = archivable;

    // we ignore and recompute shallow.profile here because the user could
    // have changed some settings while archiving was disabled
    let options = getOriginConfig(shallow.tabId, shallow.fromExtension);
    shallow.profile = options.profile;

    let archiveURL = config.archiveURLBase + "?profile=" + encodeURIComponent(options.profile);

    let failed = reqresFailed.get(archiveURL);
    if (failed !== undefined && (Date.now() - failed.when) < 1000) {
        // this archiveURL is marked broken, and we just had a failure there, fail this reqres immediately
        failed.queue.push(archivable);
        newArchivedOrFailed = true;
        needArchivingOK = true;
        scheduleEndgame(shallow.tabId);
        return;
    }

    function broken(reason) {
        let failed = markArchiveAsFailed(archiveURL, Date.now(), reason);
        failed.queue.push(archivable);
        newArchivedOrFailed = true;
        needArchivingOK = true;
        // retry failed in 60s
        retryAllFailedArchivesIn(60000);
        scheduleEndgame(shallow.tabId);
    }

    function allok() {
        retryFailedArchive(archiveURL);
        reqresArchivedTotal += 1;
        newArchivedOrFailed = true;
        broadcast(["newArchived", [shallow]]);
        scheduleEndgame(shallow.tabId);
    }

    if (config.debugging)
        console.log("trying to archive", shallow);

    const req = new XMLHttpRequest();
    req.open("POST", archiveURL, true);
    req.responseType = "text";
    req.setRequestHeader("Content-Type", "application/cbor");
    req.onabort = (event) => {
        //console.log("archiving aborted", event);
        broken(`a request to \n${archiveURL}\n was aborted by the browser`);
    }
    req.onerror = (event) => {
        //console.log("archiving error", event);
        broken(`pWebArc can't establish a connection to the archive at\n${archiveURL}`);
    }
    req.onload = (event) => {
        //console.log("archiving loaded", event);
        if (req.status == 200)
            allok();
        else
            broken(`a request to\n${archiveURL}\nfailed with:\n${req.status} ${req.statusText}: ${req.responseText}`);
    };
    req.send(dump);
}

function getHeaderString(header) {
    if (header.binValue !== undefined) {
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

// render reqres structure into a CBOR dump
function renderReqres(reqres) {
    let encoder = new CBOREncoder();

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
    if (reqres.documentUrl !== undefined)
        documentUrl = canonicalizeURL(reqres.documentUrl);
    else
        documentUrl = canonicalizeURL(reqres.url);

    // do similarly for originUrl for similar Chromium-related reasons
    let originUrl = undefined;
    if (reqres.originUrl !== undefined)
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

    // Chromium did not emit the WebRequest half
    if (reqres.fake)
        rest.fake = true;

    let response = null;
    if (reqres.sent && reqres.responseTimeStamp !== undefined) {
        response = [
            reqres.responseTimeStamp,
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
            reqres.requestTimeStamp,
            reqres.method,
            url,
            encodeHeaders(reqres.requestHeaders),
            reqres.requestComplete,
            reqres.requestBody,
        ],
        response,
        reqres.emitTimeStamp,
        rest,
    ], {
        allowNull: true,
        allowUndefined: false,
    });

    return encoder.result()
}

function processFinishedReqres(info, collect, shallow, dump, newLog) {
    shallow.in_limbo = false;
    shallow.collected = collect;

    if (collect) {
        if (!config.doNotQueue) {
            reqresQueue.push([shallow, dump]);
            newQueued = true;
        }
        persistentStats.collectedTotal += 1;
        persistentStats.collectedSize += dump.byteLength;
        changedPersistentStats = true;
        info.collectedTotal += 1;
        info.collectedSize += dump.byteLength;
    } else {
        persistentStats.discardedTotal += 1;
        changedPersistentStats = true;
        info.discardedTotal += 1;
    }

    if (collect || config.logDiscarded || shallow.was_problematic) {
        reqresLog.push(shallow);
        while (reqresLog.length > config.history)
            reqresLog.shift();

        if (newLog === undefined)
            broadcast(["newLog", [shallow], true]);
        else
            newLog.push(shallow);
    }
}

function processAlmostDone() {
    if (reqresAlmostDone.length == 0)
        return;

    let reqres = reqresAlmostDone.shift()
    if (reqres.tabId === undefined)
        reqres.tabId = -1;

    if (!useDebugger && reqres.errors.some(isAbortedError))
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

    let updatedTabId = reqres.tabId;

    let options = getOriginConfig(updatedTabId, reqres.fromExtension);
    let info = getOriginState(updatedTabId, reqres.fromExtension);

    let state = "complete";
    let problematic = false;
    let picked = true;

    if (!reqres.sent) {
        // it failed somewhere before handleSendHeaders
        state = "canceled";
        problematic = config.markProblematicCanceled;
        picked = config.archiveCanceled;
    } else if (reqres.responseTimeStamp === undefined) {
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
    } else if (reqres.statusCode === 200 && reqres.fromCache) {
        let clength = getHeaderValue(reqres.responseHeaders, "Content-Length")
        if (clength !== undefined && clength != 0 && reqres.responseBody.byteLength == 0) {
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

    if (reqres.errors.some(isProblematicError)) {
        // it had some potentially problematic errors
        picked = picked && config.archiveWithErrors;
        problematic = problematic
            || config.markProblematicWithErrors
            || (picked && config.markProblematicPickedWithErrors);
    }

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
        if (getHeaderValue(reqres.requestHeaders, ":authority") !== undefined)
            reqres.protocol = "HTTP/2.0";
        else if (lineProtocol !== undefined && lineProtocol !== "")
            reqres.protocol = lineProtocol;
        else
            reqres.protocol = "HTTP/1.0";
    }

    if (reqres.reason === undefined) {
        if (lineReason !== undefined)
            reqres.reason = lineReason;
        else
            reqres.reason = "";
    }

    // dump it to console when debugging
    if (config.debugging)
        console.log(picked ? "PICKED" : "DROPPED", reqres.requestId,
                    "state", state,
                    reqres.protocol, reqres.method, reqres.url,
                    "tabId", updatedTabId,
                    "req", reqres.requestComplete,
                    "res", reqres.responseComplete,
                    "result", reqres.statusCode, reqres.reason, reqres.statusLine,
                    "errors", reqres.errors,
                    "profile", options.profile,
                    reqres);

    let shallow = shallowCopyOfReqres(reqres);
    shallow.net_state = state;
    shallow.profile = options.profile;
    shallow.was_problematic = shallow.problematic = problematic;
    shallow.picked = picked;
    shallow.was_in_limbo = shallow.in_limbo = false;

    if (problematic) {
        reqresProblematic.push(shallow);
        info.problematicTotal += 1;
    }

    if (picked) {
        persistentStats.pickedTotal += 1;
        info.pickedTotal += 1;
    } else {
        persistentStats.droppedTotal += 1;
        info.droppedTotal += 1;
    }

    if (picked || options.negLimbo) {
        let dump = renderReqres(reqres);

        if (config.dumping)
            dumpToConsole(dump);

        if (picked && options.limbo || !picked && options.negLimbo) {
            shallow.was_in_limbo = shallow.in_limbo = true;
            reqresLimbo.push([shallow, dump]);
            reqresLimboSize += dump.byteLength;
            info.inLimboTotal += 1;
            info.inLimboSize += dump.byteLength;
            newLimbo = true;
            broadcast(["newLimbo", [shallow]]);
        } else
            processFinishedReqres(info, true, shallow, dump);
    } else
        processFinishedReqres(info, false, shallow, undefined);

    if (problematic) {
        newProblematic = true;
        broadcast(["newProblematic", [shallow]]);
    }

    scheduleEndgame(updatedTabId);
}

function forceEmitInFlightWebRequest(tabId, reason) {
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
    if (tabId === undefined)
        tabId = null;

    processFinishingUp(true);
    forceEmitInFlightWebRequest(tabId, "pWebArc::EMIT_FORCED_BY_USER");
    if (useDebugger) {
        forceEmitInFlightDebug(tabId, "pWebArc::EMIT_FORCED_BY_USER");
        processMatchFinishingUpWebRequestDebug(true);
        forceFinishingUpDebug((r) => tabId == null || r.tabId == tabId);
    }
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
    if (e.documentUrl !== undefined && e.documentUrl !== null)
        initiator = e.documentUrl; // Firefox
    else if (e.initiator !== undefined && e.initiator !== null && e.initiator !== "null")
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

    // On Chromium, cancel all network requests from tabs that are not
    // yet debugged, start debugging, and then reload the tab.
    if (useDebugger && e.tabId !== -1
        && !tabsDebugging.has(e.tabId)
        && (e.url.startsWith("http://") || e.url.startsWith("https://"))) {
        if (config.debugging)
            console.warn("canceling and restarting request to", e.url, "as tab", e.tabId, "is not managed yet");
        attachDebuggerAndReloadIn(e.tabId, 1000);
        return { cancel: true };
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
            resetTab(e.tabId, "about:blank").then(() => browser.tabs.update(e.tabId, { url: e.url })).catch(logError);
            return { cancel: true };
        }
    }

    let requestId = e.requestId;
    let reqres = {
        requestId: requestId,
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

        responseHeaders : [],
        responseBody: new ChunkedBuffer(),
        responseComplete: false,
        fromCache: false,
    };

    if (e.documentUrl !== undefined && e.documentUrl !== null)
        reqres.documentUrl = e.documentUrl;

    if (e.originUrl !== undefined && e.originUrl !== null)
        reqres.originUrl = e.originUrl; // Firefox
    else if (e.initiator !== undefined && e.initiator !== null && e.initiator !== "null")
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
    broadcast(["newInFlight", [shallowCopyOfReqres(reqres)]]);
    updateDisplay(0, true, false);
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

function handleHeadersRecieved(e) {
    let reqres = reqresInFlight.get(e.requestId);
    if (reqres === undefined) return;

    logEvent("HeadersRecieved", e, reqres);

    if (reqres.responseTimeStamp !== undefined) {
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

    reqres.responseTimeStamp = e.timeStamp;
    reqres.statusCode = e.statusCode;
    reqres.statusLine = e.statusLine;
    reqres.responseHeaders = e.responseHeaders;
    reqres.fromCache = e.fromCache;
}

function handleBeforeRedirect(e) {
    let reqres = reqresInFlight.get(e.requestId);
    if (reqres === undefined) return;

    logEvent("BeforeRedirect", e, reqres);

    if (reqres.responseTimeStamp === undefined) {
        // this happens when a request gets redirected right after
        // handleBeforeRequest by another extension
        reqres.responseTimeStamp = e.timeStamp;
        reqres.statusCode = e.statusCode;
        reqres.statusLine = e.statusLine;
        reqres.responseHeaders = e.responseHeaders;
        reqres.fromCache = e.fromCache;
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
    if (reqresFailed.size === 0) return;

    browser.tabs.create({
        url: browser.runtime.getURL("/page/help.html#errors"),
    });
}

function handleTabCreated(tab) {
    if (config.debugging)
        console.log("tab added", tab.id, tab.openerTabId);

    if (useDebugger && tab.pendingUrl == "chrome://newtab/") {
        // work around Chrome's "New Tab" action creating a child tab by
        // ignoring openerTabId
        let tabcfg = processNewTab(tab.id, undefined);
        // Unfortunately, Chromium does not allow attaching the debugger to
        // chrome:// URLs, meaning that new tabs with the default page opened
        // will not get debugged, thus no response bodies will ever get
        // collected there. So, we navigate new tabs to about:blank instead.
        if (config.collecting && tabcfg.collecting)
            browser.tabs.update(tab.id, { url: "about:blank" }).then(() => {
                setTimeout(() => attachDebugger(tab.id), 500);
            }, logError);
    } else
        processNewTab(tab.id, tab.openerTabId);
    updateDisplay(0, false, true);
}

function handleTabRemoved(tabId) {
    if (config.debugging)
        console.log("tab removed", tabId);
    processRemoveTab(tabId);
    updateDisplay(0, false, true);
}

function handleTabReplaced(addedTabId, removedTabId) {
    if (config.debugging)
        console.log("tab replaced", removedTabId, addedTabId);
    processRemoveTab(removedTabId);
    processNewTab(addedTabId);
    updateDisplay(0, false, true);
}

function handleTabActivated(e) {
    if (config.debugging)
        console.log("tab activated", e.tabId);
    if (useDebugger)
        // Chromium does not provide `browser.menus.onShown` event
        updateMenu(e.tabId);
    // This will do nothing on Chromium, see handleTabUpdatedChromium
    updateDisplay(0, false, true);
}

function handleTabUpdatedChromium(tabId, changeInfo, tabInfo) {
    if (config.debugging)
        console.log("tab updated", tabId);
    // Chromium resets the browserAction icon when tab chages state, so we
    // have to update icons after each one
    updateDisplay(0, false, true);
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
    case "getConfig":
        sendResponse(config);
        break;
    case "setConfig":
        let oldconfig = config;
        config = updateFromRec(assignRec({}, config), request[1], true);
        updateDisplay(0, false, false);

        if (oldconfig.archiving !== config.archiving && config.archiving)
            retryAllFailedArchives();

        if (useDebugger)
            syncDebuggersState();

        if (!config.ephemeral) {
            // save config after a little pause to give the user time to click
            // the same toggle again without torturing the SSD
            let eConfig = assignRec({}, config);
            resetSingletonTimeout(scheduledInternal, "saveConfig", 500, () => {
                console.log("saving config", eConfig);
                browser.storage.local.set({ config: eConfig }).catch(logError);
                updateDisplay(0, true, false);
            });
            updateDisplay(0, true, false);
        }

        broadcast(["updateConfig"]);
        sendResponse(null);
        break;
    case "getOriginConfig":
        sendResponse(getOriginConfig(request[1]));
        break;
    case "setTabConfig":
        tabConfig.set(request[1], request[2]);
        if (useDebugger) {
            updateMenu(request[1]); // Chromium does not provide `browser.menus.onShown` event
            syncDebuggersState();
        }
        broadcast(["updateTabConfig", request[1], request[2]]);
        updateDisplay(0, false, true);
        sendResponse(null);
        break;
    case "retryAllFailedArchives":
        retryAllFailedArchivesIn(100);
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
    case "getLog":
        sendResponse(reqresLog);
        break;
    case "forgetHistory":
        forgetHistory(request[1], request[2]);
        sendResponse(null);
        break;
    case "getProblematicLog":
        sendResponse(reqresProblematic);
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
    case "runAllActions":
        popAllSingletonTimeouts(scheduledCancelable, true);
        popAllSingletonTimeouts(scheduledInternal, true);
        updateDisplay(0, true, false);
        sendResponse(null);
        break;
    case "cancelCleanupActions":
        popAllSingletonTimeouts(scheduledCancelable, false);
        updateDisplay(0, true, false);
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

function updateMenu(tabId) {
    let cfg = getOriginConfig(tabId);
    let newState = !cfg.children.collecting;

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
            updateMenu(tab.id);
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
    let tabId = mapStateTabId(new URL(getTabURL(tab, "")), (x) => x, -1, tab.id);

    let tabcfg = undefined;
    switch (command) {
    case "showState":
        showState("", "top", tab.id);
        return;
    case "showLog":
        showState("", "bottom", tab.id);
        return;
    case "showTabState":
        showState(`?tab=${tabId}`, "top", tab.id);
        return;
    case "showTabLog":
        showState(`?tab=${tabId}`, "bottom", tab.id);
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
    default:
        console.error(`unknown command ${command}`);
        return;
    }

    updateDisplay(0, false, true, tabId);
    broadcast(["updateTabConfig", tabId]);
}

function upgradeConfigAndPersistentStats(cfg, stats) {
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
        break;
    default:
        console.warn(`Bad old config version ${cfg.version}, reusing values as-is without updates`);
        // the following updateFromRec will do its best
    }

    return [cfg, stats];
}

async function init(storage) {
    let oldConfig = storage.config;
    if (oldConfig !== undefined) {
        let oldPersistentStats = storage.persistentStats;
        if (oldPersistentStats === undefined)
            oldPersistentStats = storage.globalStats;

        if (oldConfig.version !== configVersion) {
            console.log(`Loading old config of version ${oldConfig.version}`);
            [oldConfig, oldPersistentStats] = upgradeConfigAndPersistentStats(oldConfig, oldPersistentStats);
        }

        config = updateFromRec(config, oldConfig, true);
        persistentStats = updateFromRec(persistentStats, oldPersistentStats, true);
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

    if (config.autoPopInLimboDiscard || config.doNotQueue) {
        let what = [];
        if (config.autoPopInLimboDiscard)
            what.push(`"Auto-discard reqres in limbo"`);
        if (config.doNotQueue)
            what.push(`"Do not queue new reqres"`);
        browser.notifications.create("autoDiscard", {
            title: "pWebArc: REMINDER",
            message: `Some auto-discarding options are enabled: ${what.join(", ")}.`,
            iconUrl: iconURL("limbo", 128),
            type: "basic",
        }).catch(logError);
    }

    if (false) {
        // for debugging
        config.ephemeral = true;
    }

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
    if (useDebugger)
        browser.tabs.onUpdated.addListener(catchAll(handleTabUpdatedChromium));

    // record it all currently open tabs, compute and cache their configs
    let tabs = await browser.tabs.query({});
    for (let tab of tabs) {
        openTabs.add(tab.id);
        getOriginConfig(tab.id);
    }

    browser.runtime.onMessage.addListener(catchAll(handleMessage));
    browser.runtime.onConnect.addListener(catchAll(handleConnect));

    initMenus();
    updateDisplay(0, true, true);

    if (useDebugger)
        await initDebugger(tabs);

    browser.commands.onCommand.addListener(catchAll(handleCommand));

    console.log(`initialized pWebArc with source of '${sourceDesc}'`);
    console.log("runtime options are", { useSVGIcons, useBlocking, useDebugger });
    console.log("config is", config);
}

browser.storage.local.get(null).then(init, (error) => init({}));
