/*
 * Copyright (c) 2023-2026 Jan Malakhovski <oxij@oxij.org>
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
 * Per-tab/origin config and stats.
 */

"use strict";

// per-window config
let windowConfig = new Map();

function getWindowConfig(windowId) {
    if (windowId === WINDOW_ID_NONE)
        return config.root;
    return cacheSingleton(windowConfig, windowId, () => assignRec({}, config.root));
}

function setWindowConfig(windowId, wincfg, oldWincfg, dontBroadcast) {
    fixSourceConfig(wincfg, config.root);
    windowConfig.set(windowId, wincfg);

    if (dontBroadcast)
        return;

    broadcastToPopup("updateWindowConfig", windowId, wincfg);

    scheduleUpdateDisplay(false);
}

// per-window state
let windowStateDefaults = assignRec({}, dynamicStateDefaults, commonStateDefaults);

let windowState = new Map();

function getWindowState(windowId) {
    return cacheSingleton(windowState, windowId, () => assignRec({}, windowStateDefaults));
}

// per-tab config
let tabConfig = new Map();

// per-tab state
let tabStateDefaults = assignRec({
    windowId: WINDOW_ID_NONE,
    emitTimeStamp: 0,
}, windowStateDefaults);

// per-tab state
let tabState = new Map();

function getTabStateInternal(tabId) {
    return cacheSingleton(tabState, tabId, () => assignRec({}, tabStateDefaults));
}

let tabStateProxyFuncs = {
    set(obj, name, value) {
        let old = obj[name];
        obj[name] = value;

        if (!windowStateDefaults.hasOwnProperty(name))
            return true;

        let diff = value - old;

        let winstate = getWindowState(obj.windowId);
        winstate[name] += diff;

        state[name] += diff;
        wantSaveState = true;

        return true;
    }
}

function getTabState(tabId, fromExtension) {
    // NB: not tracking extensions separately here, unlike with configs
    if (fromExtension)
        tabId = TAB_ID_NONE;
    return new Proxy(getTabStateInternal(tabId), tabStateProxyFuncs);
}

function getWindowId(tabId) {
    let tabstate = tabState.get(tabId);
    if (tabstate === undefined)
        return WINDOW_ID_NONE;
    return tabstate.windowId;
}

function prefillChildren(data) {
    return assignRec({
        children: assignRec({}, data),
    }, data);
}

function getTabConfig(tabId, fromExtension) {
    if (fromExtension)
        return prefillChildren(config.extension);
    if (tabId === TAB_ID_NONE)
        return prefillChildren(config.background);
    console.assert(tabId !== undefined, "tabId !== undefined");
    return cacheSingleton(tabConfig, tabId,
                          (tabId) => prefillChildren(getWindowConfig(getWindowId(tabId))));
}

function fixTabConfig(tabId, url, cfg, oldCfg) {
    fixSourceConfig(cfg, () => getWindowConfig(getWindowId(tabId)));
    fixSourceConfig(cfg.children, cfg);

    if (url !== undefined) {
        // force some settings based on tab's URL
        if ((cfg.autoReplay || cfg.children.autoReplay) && config.autoReplayOffInReplay && isServerURL(url))
            cfg.autoReplay = cfg.children.autoReplay = false;
        if ((!cfg.workOffline || !cfg.children.workOffline) && (
               config.workOfflineFile && url.startsWith("file:") ||
               config.workOfflineData && url.startsWith("data:")) ||
               config.workOfflineReplay && isServerURL(url)
           )
            cfg.workOffline = cfg.children.workOffline = true;
    }

    // the most common case
    if (cfg === oldCfg)
        return;

    // propagate any changes to `.children`
    for (let field of Object.keys(cfg)) {
        if (field === "children")
            continue;

        if (cfg[field] !== oldCfg[field])
            cfg.children[field] = cfg[field];
    }
}

function setTabConfig(tabId, tabUrl, tabcfg, oldTabcfg, dontBroadcast) {
    fixTabConfig(tabId, tabUrl, tabcfg, oldTabcfg);
    tabConfig.set(tabId, tabcfg);

    if (dontBroadcast)
        return;

    broadcastToPopup("updateTabConfig", tabId, tabcfg);

    if (useDebugger) {
        // Chromium does not provide `browser.menus.onShown` event
        updateMenu(tabcfg);
        syncDebuggersState();
    }

    scheduleUpdateDisplay(false, tabId);
}

// collect all tabs referenced in not yet archived reqres
// NB: ignores rrfilter.limit
function getUsedTabs(rrfilter, unqueued, problematic, limbo, log, dumping) {
    let rrpredicate = compileReqresFilter(rrfilter)[1];

    let set = new Set();

    function collect(reqres, c) {
        if (c && rrpredicate(reqres))
            set.add(reqres.tabId);
    }
    applyToReqres13(
        collect, true,
        unqueued, unqueued, unqueued, unqueued, unqueued, // inFlight
        problematic, // problematic
        limbo, log, dumping, // limbo, log, queue
        dumping, // bundled
        dumping, dumping, true // unstashed, unarchived, bugged out
    );

    return set;
}

async function smartSwitchTabs(highlight, direction, roundRobin) {
    let usedTabs = getUsedTabs({sessionId}, true, true, true, false, false);
    let isInteresting = (tabId) => usedTabs.has(tabId);

    let tabs = await browser.tabs.query({currentWindow: true});

    if (highlight)
        tabs = tabs.filter((tab) => isInteresting(tab.id));

    if (tabs.length === 0)
        return;

    tabs.sort((a, b) => {
        let aid = a.id;
        let bid = b.id;

        if (!highlight) {
            // interesing ones go first
            let ai = isInteresting(aid);
            let bi = isInteresting(bid);
            if (ai !== bi)
                return ai ? -1 : 1;
        }

        // otherwise, sort in order of their last `emitTimeStamp`s
        return getTabState(bid).emitTimeStamp - getTabState(aid).emitTimeStamp;
    });
    if (direction)
        tabs.reverse();

    let act = roundRobin ? mapRoundRobinTabsPerWindow : mapTabsPerWindow;

    await Promise.all(
        act((windowId, tabs) => {
            if (config.debugRuntime)
                console.log("smartSwitchTabs", windowId, tabs.map((tab) => tab.id));

            if (highlight)
                return browser.tabs.highlight(assignRec(
                    { windowId, tabs: tabs.map((e) => e.index) },
                    useDebugger ? undefined : { populate: false }
                )).catch(logError);
            else
                return browser.tabs.highlight(assignRec(
                    { windowId, tabs: [tabs[0].index] },
                    useDebugger ? undefined : { populate: false }
                )).catch(logError);
                // NB: not doing
                //   return browser.tabs.update(tabs[0].id, {active: true}).catch(logError);
                // instead because that keeps old highlight if `tabs[0]` was highlighted too
        }, tabs)
    );
}

// Free unused `tabConfig` and `tabState` structures.
function cleanupTabs() {
    let usedTabs = getUsedTabs(null, true, true, true, true, true);

    // delete configs of closed and unused tabs
    for (let tabId of Array.from(tabConfig.keys())) {
        if(tabId === TAB_ID_NONE || openTabs.has(tabId) || usedTabs.has(tabId))
            continue;
        if (config.debugRuntime)
            console.log("removing config of tab", tabId);
        tabConfig.delete(tabId);
        tabState.delete(tabId);
    }

    // delete any stale leftovers from tabState
    for (let tabId of Array.from(tabState.keys())) {
        if(tabId === TAB_ID_NONE || openTabs.has(tabId) || usedTabs.has(tabId))
            continue;
        console.warn("removing stale tab state", tabId);
        tabState.delete(tabId);
    }
}

// Closed tab auto-cleanup.

function cleanupProblematicAfterTab(tabId) {
    if (config.debugRuntime)
        console.log("MAIN: cleaning up reqresProblematic after tab", tabId);

    let unprob = unmarkProblematic({tabId})[1];

    if (config.problematicNotify === true && unprob > 0)
        browser.notifications.create(`cleanedProblematic-${tabId}`, {
            title: "Hoardy-Web: AUTO",
            message: `Auto-unmarked ${unprob} problematic reqres from tab #${tabId}.`,
            iconUrl: iconURL("problematic", 128),
            type: "basic",
        }).catch(logError);

    cleanupTabs();

    return unprob > 0 ? tabId : undefined;
}

function cleanupLimboAfterTab(tabId) {
    if (config.debugRuntime)
        console.log("MAIN: cleaning up reqresLimbo after tab", tabId);

    let what;
    let unlimbo = 0;
    if (config.autoPopInLimboCollect) {
        what = "collected";
        unlimbo = popInLimbo(true, {tabId})[1];
    } else if (config.autoPopInLimboDiscard) {
        what = "discarded";
        unlimbo = popInLimbo(false, {tabId})[1];
    }

    if (config.autoNotify && unlimbo > 0)
        browser.notifications.create(`cleanedLimbo-${tabId}`, {
            title: "Hoardy-Web: AUTO",
            message: `Auto-${what} ${unlimbo} in-limbo reqres from tab #${tabId}.`,
            iconUrl: iconURL("limbo", 128),
            type: "basic",
        }).catch(logError);

    cleanupTabs();

    return unlimbo > 0 ? tabId : undefined;
}

function cleanupAfterTab(tabId) {
    let tabstate = tabState.get(tabId);
    if (tabstate === undefined)
        return;

    let updatedTabId;

    if (config.autoUnmarkProblematic && tabstate.problematicTotal > 0) {
        cleanupProblematicAfterTab(tabId);
        updatedTabId = tabId;
    }

    if ((config.autoPopInLimboCollect || config.autoPopInLimboDiscard) && tabstate.inLimboTotal > 0) {
        if (config.autoTimeout === 0) {
            cleanupLimboAfterTab(tabId);
            updatedTabId = tabId;
        } else {
            let name = `cleanup-tab#${tabId}`;
            resetSingletonTimeout(scheduledDelayed, name, config.autoTimeout * 1000, () => {
                runSynchronouslyB(name, cleanupLimboAfterTab, tabId);
                scheduleEndgame(tabId);
            });
        }
    }

    return updatedTabId;
}

function closeTabThenDiscardInLimbo(tabId) {
    runSynchronouslyB("closeTabThenDiscardInLimbo", async () => {
        try {
            await browser.tabs.remove(tabId);
        } catch (err) {
            logError(err);
            return;
        }
        // drop some stuff immediately
        popInLimbo(false, {tabId});
        // drop the rest when it finishes
        runSynchronouslyWhenNoInFlight(tabId, `discardTab#${tabId}`, () => syncPopInLimbo(false, {tabId}));
    });
}

// Tracking open tabs and generating their configs.

let openTabs = new Set();
let negateConfigFor = new Set();
let openerIds = [];

function processNewTab(tabId, windowId, openerTabId) {
    openTabs.add(tabId);

    let openerWindowId = windowId;

    if (openerIds.length > 0)
        // (openerIdsWorkaround)
        //
        // Work around the fact that `browser.windows.create` has no `openerTabId` argument.
        //
        // Also, on Chromium, `browser.tabs.create` with `openerTabId` specified does not pass it
        // into `openerTabId` of `handleTabCreated` (it's a bug).
        [openerWindowId, openerTabId] = openerIds.shift();

    let wincfg;

    if (openerWindowId !== windowId) {
        // this is a new tab spawned into a new window, copy old window's config
        wincfg = assignRec({}, getWindowConfig(openerWindowId));
        setWindowConfig(windowId, wincfg, wincfg);
    } else
        wincfg = getWindowConfig(windowId);

    let tabstate = getTabStateInternal(tabId);
    // force it, in case an async function created it via `getTabState`
    tabstate.windowId = windowId;
    tabstate.emitTimeStamp = Date.now();

    let oldTabcfg;
    let tabcfg = oldTabcfg = prefillChildren(openerTabId !== undefined ? getTabConfig(openerTabId).children : wincfg);

    if (openerTabId !== undefined && negateConfigFor.delete(openerTabId)) {
        // Negate `tabcfg.collecting` when `openerTabId` is in `negateConfigFor`.
        tabcfg = assignRec({}, tabcfg);
        tabcfg.collecting = !tabcfg.collecting;
    }

    setTabConfig(tabId, undefined, tabcfg, oldTabcfg);

    return tabcfg;
}

function processUpdateTab(tabId, windowId) {
    let tabstate = tabState.get(tabId);
    if (tabstate === undefined)
        return false;

    let oldWindowId = tabstate.windowId;
    if (oldWindowId === windowId)
        return false;

    // so, this tab was moved from one window to another

    // if `windowId` is a completely new window, clone `oldWindowId`'s per-window config instead of
    // using `config.root`
    let wincfg = windowConfig.get(windowId);
    if (wincfg === undefined) {
        wincfg = assignRec({}, getWindowConfig(oldWindowId));
        setWindowConfig(windowId, wincfg, wincfg);
    }

    // update its state
    tabstate.windowId = windowId;

    // substract its stats from the first and add them to the second
    let oldWinstate = getWindowState(oldWindowId);
    let winstate = getWindowState(windowId);

    for (let k of Object.keys(windowStateDefaults)) {
        let v = tabstate[k];
        oldWinstate[k] -= v;
        winstate[k] += v;
    }

    // apply this change to all the reqres
    function rewrite(v) {
        if (v.tabId === tabId)
            v.windowId = windowId;
    }
    applyToReqres13(rewrite, true);

    // reset everything
    broadcastToState(tabId, "resetInFlight", () => getInFlight(null));
    broadcastToState(tabId, "resetProblematic", getProblematic);
    broadcastToState(tabId, "resetInLimbo", getInLimbo);
    broadcastToState(tabId, "resetLog", reqresLog);
    broadcastToState(tabId, "resetQueued", getQueued);
    broadcastToState(tabId, "resetUnarchived", getUnarchived);
    broadcastToState(tabId, "resetBuggedOut", getBuggedOut);

    return true;
}

function processRemoveTab(tabId) {
    openTabs.delete(tabId);

    let updatedTabId;
    if (useDebugger)
        updatedTabId = stopInFlight({tabId}, "capture::EMIT_FORCED::BY_CLOSED_TAB");
    updatedTabId = mergeUpdatedTabIds(updatedTabId, cleanupAfterTab(tabId));

    scheduleEndgame(updatedTabId);
}

function processReplaceTab(addedTabId, removedTabId) {
    openTabs.delete(removedTabId);
    openTabs.add(addedTabId);

    // NB: Not calling `.delete`s below because some async stuff might still be using the old
    // values, so we have to make `addedTabId` and `removedTabId` share their states.
    //
    // Unused keys will be freed in `cleanupTabs`.

    let tabcfg = tabConfig.get(removedTabId);
    if (tabcfg !== undefined)
        // tabConfig.delete(removedTabId);
        tabConfig.set(addedTabId);

    let tabstate = tabState.get(removedTabId);
    if (tabstate !== undefined)
        // tabState.delete(removedTabId);
        tabState.set(addedTabId, tabState);

    scheduleUpdateDisplay(false, addedTabId);
}
