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
 * Per-tab/origin config and stats.
 */

"use strict";

// per-tab config
let tabConfig = new Map();

// per-tab state
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

// per-source globals.pickedTotal, globals.droppedTotal, etc
let tabState = new Map();

function getTabState(tabId, fromExtension) {
    // NB: not tracking extensions separately here, unlike with configs
    if (fromExtension)
        tabId = TAB_ID_NONE;
    return cacheSingleton(tabState, tabId, () => assignRec({}, tabStateDefaults));
}

function prefillChildren(data) {
    return assignRec({
        children: assignRec({}, data),
    }, data);
}

function getTabConfig(tabId, fromExtension) {
    if (fromExtension)
        return prefillChildren(config.extension);
    else if (tabId === TAB_ID_NONE)
        return prefillChildren(config.background);
    else if (tabId === null)
        return prefillChildren(config.root);
    else
        return cacheSingleton(tabConfig, tabId, () => prefillChildren(config.root));
}

function fixTabConfig(url, cfg, oldCfg) {
    fixSourceConfig(cfg, config.root);
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
    fixTabConfig(tabUrl, tabcfg, oldTabcfg);
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
                runSynchronously(name, cleanupLimboAfterTab, tabId);
                scheduleEndgame(tabId);
            });
        }
    }

    return updatedTabId;
}

// Tracking open tabs and generating their configs.

let openTabs = new Set();
let negateConfigFor = new Set();
let negateOpenerTabIds = [];

function processNewTab(tabId, openerTabId) {
    openTabs.add(tabId);

    if (useDebugger && openerTabId === undefined && negateOpenerTabIds.length > 0)
        // On Chromium, `browser.tabs.create` with `openerTabId` specified
        // does not pass it into `openerTabId` of `handleTabCreated` (it's a
        // bug), so we have to work around it by using `negateOpenerTabIds`
        // variable.
        openerTabId = negateOpenerTabIds.shift();

    let openercfg = getTabConfig(openerTabId !== undefined ? openerTabId : null);

    let base = openercfg.children;
    if (openerTabId !== undefined && negateConfigFor.delete(openerTabId)) {
        // Negate `base.collecting` when `openerTabId` is in `negateConfigFor`.
        base = assignRec({}, base);
        base.collecting = !base.collecting;
    }

    let tabcfg = prefillChildren(base);
    tabConfig.set(tabId, tabcfg);

    scheduleUpdateDisplay(false, tabId);

    return tabcfg;
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
