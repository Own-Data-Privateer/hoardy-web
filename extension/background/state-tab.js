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

function getOriginState(tabId, fromExtension) {
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
    for (let f of reqresErroredIssueAcc[0])
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

function processRemoveTab(tabId) {
    openTabs.delete(tabId);

    let updatedTabId = stopInFlight(tabId, "capture::EMIT_FORCED::BY_CLOSED_TAB");

    scheduleCleanupAfterTab(tabId);

    scheduleEndgame(updatedTabId);
}

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
        || config.workOfflineReplay && isServerURL(url)
        || config.workOfflineData && url.startsWith("data:")) {
        if (!tabcfg.workOffline) {
            toggleTabConfigWorkOffline(tabcfg);
            return true;
        }
    }
    return false;
}
