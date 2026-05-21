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
        tabId = -1;
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
    else if (tabId == -1)
        return prefillChildren(config.background);
    else if (tabId === null)
        return prefillChildren(config.root);
    else
        return cacheSingleton(tabConfig, tabId, () => prefillChildren(config.root));
}

function fixTabConfig(url, cfg, oldCfg) {
    // do some fixups
    if (!cfg.bucket)
        cfg.bucket = getFirstOk(config.root.bucket, configDefaults.root.bucket);
    if (!cfg.children.bucket)
        cfg.children.bucket = cfg.bucket;

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
    for (let v of reqresBuggedOutIssueAcc[0])
        usedTabs.add(v[0].tabId);
    for (let v of reqresUnstashedIssueAcc[0])
        usedTabs.add(v[0].tabId);
    for (let v of reqresUnarchivedIssueAcc[0])
        usedTabs.add(v[0].tabId);

    return usedTabs;
}

// Free unused `tabConfig` and `tabState` structures.
function cleanupTabs() {
    let usedTabs = getUsedTabs();

    // delete configs of closed and unused tabs
    for (let tabId of Array.from(tabConfig.keys())) {
        if(tabId === -1 || openTabs.has(tabId) || usedTabs.has(tabId))
            continue;
        if (config.debugRuntime)
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

// Closed tab auto-cleanup.

function cleanupProblematicAfterTab(tabId) {
    if (config.debugRuntime)
        console.log("MAIN: cleaning up reqresProblematic after tab", tabId);

    let unprob = unmarkProblematic({tabId});

    if (config.problematicNotify === true && unprob > 0)
        browser.notifications.create(`cleanedProblematic-${tabId}`, {
            title: "Hoardy-Web: AUTO",
            message: `Auto-unmarked ${unprob} problematic reqres from tab #${tabId}.`,
            iconUrl: iconURL("problematic", 128),
            type: "basic",
        }).catch(logError);

    cleanupTabs();
}

function cleanupLimboAfterTab(tabId) {
    if (config.debugRuntime)
        console.log("MAIN: cleaning up reqresLimbo after tab", tabId);

    let what;
    let unlimbo = 0;
    if (config.autoPopInLimboCollect) {
        what = "collected";
        unlimbo = popInLimbo(true, {tabId});
    } else if (config.autoPopInLimboDiscard) {
        what = "discarded";
        unlimbo = popInLimbo(false, {tabId});
    }

    if (config.autoNotify && unlimbo > 0)
        browser.notifications.create(`cleanedLimbo-${tabId}`, {
            title: "Hoardy-Web: AUTO",
            message: `Auto-${what} ${unlimbo} in-limbo reqres from tab #${tabId}.`,
            iconUrl: iconURL("limbo", 128),
            type: "basic",
        }).catch(logError);

    cleanupTabs();
}

function cleanupAfterTab(tabId) {
    let updatedTabId;
    let tabstats = getTabStats(tabId);

    if (config.autoUnmarkProblematic && tabstats.problematic > 0) {
        cleanupProblematicAfterTab(tabId);
        updatedTabId = tabId;
    }

    if ((config.autoPopInLimboCollect || config.autoPopInLimboDiscard) && tabstats.in_limbo > 0) {
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
        updatedTabId = stopInFlight(tabId, "capture::EMIT_FORCED::BY_CLOSED_TAB");
    updatedTabId = mergeUpdatedTabIds(updatedTabId, cleanupAfterTab(tabId));

    scheduleEndgame(updatedTabId);
}
