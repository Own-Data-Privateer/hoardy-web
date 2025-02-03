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
 * The `main` function and other core initializations and handlers used `Hoardy-Web`.
 *
 * NB: "reqres" means "request + response".
 */

"use strict";

// Closed tab auto-cleanup.

function cleanupAfterTab(tabId) {
    let unprob = 0;
    let unlimbo = 0;

    if (config.autoUnmarkProblematic) {
        if (config.debugRuntime)
            console.log("MAIN: cleaning up reqresProblematic after tab", tabId);
        unprob = unmarkProblematic(null, tabId);
    }

    if (config.autoPopInLimboCollect || config.autoPopInLimboDiscard) {
        if (config.debugRuntime)
            console.log("MAIN: cleaning up reqresLimbo after tab", tabId);
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

function scheduleCleanupAfterTab(tabId) {
    if (!config.autoUnmarkProblematic && !config.autoPopInLimboCollect && !config.autoPopInLimboDiscard)
        // nothing to do
        return;

    let tabstats = getTabStats(tabId);
    if (config.autoUnmarkProblematic && tabstats.problematic > 0
        || (config.autoPopInLimboCollect || config.autoPopInLimboDiscard)
           && tabstats.in_limbo > 0)
        scheduleAction(scheduledDelayed, `cleanup-tab#${tabId}`, config.autoTimeout * 1000, () => {
            cleanupAfterTab(tabId);
            return tabId;
        });
}

// Archivig via `exportSaveAs`.

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
        scheduleAction(scheduledDelayed, `exportAs-${bucket}`, timeout, () => {
            bucketSaveAs(bucket);
        });

    // NB: needs scheduleUpdateDisplay after
}

// Archiving/replay via an archiving server.

async function checkServer() {
    wantCheckServer = false;

    if (!(config.archive && config.archiveSubmitHTTP || config.replaySubmitHTTP))
        return;

    let baseURL = serverConfig.baseURL;

    if (config.debugRuntime)
        console.log("MAIN: checking the archiving server at", baseURL);

    let infoURL = new URL("hoardy-web/server-info", baseURL);

    let response;
    try {
        response = await fetch(infoURL.href);
    } catch (err) {
        logHandledError(err);
        await browser.notifications.create("error-server-connection", {
            title: "Hoardy-Web: ERROR",
            message: escapeNotification(config, `\`Hoardy-Web\` can't establish a connection to the archiving server at \`${baseURL}\`:\n${errorMessageOf(err)}`),
            iconUrl: iconURL("failed", 128),
            type: "basic",
        });
        return;
    }

    // clear stale
    await browser.notifications.clear("error-server-connection");

    let info;
    if (response.status === 200) {
        try {
            info = await response.json();
        } catch (err) {
            logError(err);
        }
    } else if (response.status === 404)
        // an old version of `hoardy-web-sas`
        info = assignRec({}, serverConfigDefaults.info);

    if (info !== undefined)
        serverConfig.alive = true;
    else
        info = { version: 0 };

    serverConfig.info = info;
    serverConfig.canDump = info.dump_wrr !== undefined;
    serverConfig.canReplay = info.replay_latest !== undefined;

    if (!serverConfig.alive) {
        await browser.notifications.create("error-server", {
            title: "Hoardy-Web: ERROR",
            message: escapeNotification(config, `The archiving server at \`${baseURL}\` appears to be unavailable.`),
            iconUrl: iconURL("failed", 128),
            type: "basic",
        });
        return;
    } else if (!serverConfig.canDump && config.archive && config.archiveSubmitHTTP) {
        await browser.notifications.create("error-server", {
            title: "Hoardy-Web: ERROR",
            message: escapeNotification(config, `The archiving server at \`${baseURL}\` does not support archiving, it appears to be a replay-only instance.`),
            iconUrl: iconURL("failed", 128),
            type: "basic",
        });
        return;
    } else
        // clear stale
        await browser.notifications.clear("error-server");

    if (serverConfig.info.version < 0) {
        await browser.notifications.create("warning-server", {
            title: "Hoardy-Web: WARNING",
            message: escapeNotification(config, `You are running a deprecated version of an archiving server at \`${baseURL}\`, please update it.`),
            iconUrl: iconURL("archiving", 128),
            type: "basic",
        });
    } else
        // clear stale
        await browser.notifications.clear("warning-server");
}

function checkReplay() {
    const ifFixed = `\n\nIf you fixed it and the error persists, press the "Retry" button the "Queued/Failed" line in the popup.`;

    if (config.replaySubmitHTTP === false) {
        browser.notifications.create(`error-replay`, {
            title: "Hoardy-Web: ERROR",
            message: escapeNotification(config, `Replay is forbidden by the "Replay from the archiving server" option.\n\nEnable it to allow this feature.`),
            iconUrl: iconURL("error", 128),
            type: "basic",
        }).catch(logError);

        return false;
    } else if (!serverConfig.alive) {
        browser.notifications.create(`error-replay`, {
            title: "Hoardy-Web: ERROR",
            message: escapeNotification(config, `Replay is impossible because the archiving server at \`${serverConfig.baseURL}\` is unavailable.` + ifFixed),
            iconUrl: iconURL("error", 128),
            type: "basic",
        }).catch(logError);

        return false;
    } else if (!serverConfig.canReplay) {
        browser.notifications.create(`error-replay`, {
            title: "Hoardy-Web: ERROR",
            message: escapeNotification(config, `The archiving server at \`${serverConfig.baseURL}\` does not support replay.\n\nSwitch your archiving server to \`hoardy-web serve\` for this feature to work.` + ifFixed),
            iconUrl: iconURL("error", 128),
            type: "basic",
        }).catch(logError);

        return false;
    } else
        // clear stale
        browser.notifications.clear("error-replay").catch(logError);

    return true;
}

function latestReplayOf(url) {
    if (!serverConfig.canReplay)
        throw Error("replay is not available");

    let replayURL = serverConfig.info.replay_latest.replace("{url}", url);
    return (new URL(replayURL, serverConfig.baseURL)).href;
}

async function replay(tabIdNull, direction) {
    if (!checkReplay())
        return;

    let tabs;
    if (tabIdNull === null)
        tabs = await browser.tabs.query({});
    else {
        let tab = await browser.tabs.get(tabIdNull);
        tabs = [ tab ];
    }

    for (let tab of tabs) {
        let tabId = tab.id;
        let tabcfg = getOriginConfig(tabId);
        let url = getTabURL(tab);
        if (tabIdNull === null && !tabcfg.replayable
            || isBoringOrServerURL(url)) {
            if (config.debugRuntime)
                console.log("MAIN: NOT replaying tab", tabId, url);
            continue;
        }
        await navigateTabTo(tabId, latestReplayOf(url));
    }
}

// Handlers.

// is there a new version ready to be used?
let updateAvailable = false;

function handleUpdateAvailable(details) {
    updateAvailable = true;
    if (config.autoReloadOnUpdates)
        reloadSelf();
    else
        scheduleUpdateDisplay(true);
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

    if (config.debugRuntime)
        console.log("BROWSER: tab added", tabId, tab.openerTabId);

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
    if (config.debugRuntime)
        console.log("BROWSER: tab removed", tabId);
    processRemoveTab(tabId);
}

function handleTabReplaced(addedTabId, removedTabId) {
    if (config.debugRuntime)
        console.log("BROWSER: tab replaced", removedTabId, addedTabId);
    processRemoveTab(removedTabId);
    processNewTab(addedTabId);
}

function handleTabActivated(e) {
    let tabId = e.tabId;
    if (config.debugRuntime)
        console.log("BROWSER: tab activated", tabId);
    if (useDebugger)
        // Chromium does not provide `browser.menus.onShown` event
        updateMenu(getOriginConfig(tabId));
    // Usually, this will not be enough, see `handleTabUpdated`.
    scheduleUpdateDisplay(false, tabId, true);
}

function handleTabUpdated(tabId, changeInfo, tab) {
    if (config.debugRuntime)
        console.log("BROWSER: tab updated", tabId, getTabURL(tab));
    if (!useDebugger && tab.url === undefined)
        // On Firefox, there's no `tab.pendingUrl`, so `scheduleUpdateDisplay`
        // might get confused about which icon to show for our internal pages
        // narrowed to a tracked tab. So, we skip updates until `tab.url` is
        // set.
        return;
    scheduleUpdateDisplay(false, tabId, true);
}

function handleInternalMessage(request, sender, sendResponse) {
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

        [config, serverConfig] = fixConfig(config, oldConfig, serverConfig);

        if (config.stash && config.stash != oldConfig.stash)
            syncStashAll(false);

        if (config.archive && config.archiveSubmitHTTP
            && (config.archive !== oldConfig.archive
                || config.archiveSubmitHTTP !== oldConfig.archiveSubmitHTTP
                || config.submitHTTPURLBase !== oldConfig.submitHTTPURLBase)) {
            retryAllUnarchived(true);
            wantArchiveDoneNotify = true;
        }

        if (config.replaySubmitHTTP !== false
            && (config.replaySubmitHTTP !== oldConfig.replaySubmitHTTP
                || config.submitHTTPURLBase !== oldConfig.submitHTTPURLBase))
            wantCheckServer = true;

        if (!config.ephemeral && !equalRec(config, oldConfig))
            // save config after a little pause to give the user time to click
            // the same toggle again without torturing the SSD
            scheduleSaveConfig(1000);

        if (useDebugger)
            syncDebuggersState();

        scheduleEndgame(null);
        broadcast(["updateConfig", config]);
        break;
    case "resetConfig":
        config = assignRec({}, configDefaults);
        scheduleSaveConfig(0);
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
        let updatedTabId = stopInFlight(arg1, "capture::EMIT_FORCED::BY_USER");
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
        syncRetryAllUnstashed();
        retryAllUnarchived(true);
        scheduleEndgame(null);
        break;
    case "retryUnarchived":
        retryAllUnarchived(true);
        scheduleEndgame(null);
        break;
    case "getSavedFilters":
        sendResponse(savedFilters);
        return;
    case "setSavedFilters":
        setSavedFilters(arg1);
        scheduleEndgame(null);
        break;
    case "requeueSaved":
        requeueSaved(arg1);
        break;
    case "deleteSaved":
        deleteSaved();
        break;
    case "deleteErrored":
        syncDeleteAllErrored();
        scheduleEndgame(null);
        break;
    case "stashAll":
        syncStashAll(true);
        scheduleEndgame(null);
        break;
    case "retryUnstashed":
        syncRetryAllUnstashed();
        scheduleEndgame(null);
        break;
    case "snapshot":
        snapshot(arg1);
        break;
    case "replay":
        replay(arg1, arg2);
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
        scheduleBucketSaveAs(0, arg1);
        scheduleUpdateDisplay(true);
        break;
    case "broadcast":
        broadcast(arg1);
        break;
    default:
        console.error("BROWSER: RPC: unknown request", request);
        throw new Error("what request?");
    }
    sendResponse(null);
}

async function handleShortcut(command) {
    if (config.debugRuntime)
        console.log("BROWSER: SHORTCUT: request", command);

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
    case "replayAll":
        replay(null, null);
        return;
    case "replayTabBack":
        replay(tabId, false);
        return;
    case "replayTabForward":
        replay(tabId, true);
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
        console.error("BROWSER: SHORTCUT: unknown command", command);
        return;
    }

    setTabConfig(tabId, tabcfg);
}

function handleNotificationClicked(notificationId) {
    if (config.debugRuntime)
        console.log("BROWSER: NOTIFICATION: clicked", notificationId);

    if (notificationId.startsWith("error-"))
        showHelp("", "error-notifications");
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

function handleMenuAction(info, tab) {
    if (config.debugRuntime)
        console.log("BROWSER: MENU: request", info, "in tab", tab);

    let cmd = info.menuItemId;
    let url = info.linkUrl;
    let newWindow = cmd.endsWith("-window")
        && (url.startsWith("http:") || url.startsWith("https:"));

    if (cmd.startsWith("replay-")) {
        if (!checkReplay())
            return;
        url = latestReplayOf(url);
    } else if (cmd.startsWith("open-not-")) {
        negateConfigFor.add(tab.id);
        if (useDebugger)
            // work around Chromium bug
            negateOpenerTabIds.push(tab.id);
    }

    browser.tabs.create({
        url,
        openerTabId: tab.id,
        windowId: tab.windowId,
    }).then((tab) => {
        if (config.debugRuntime)
            console.log("BROWSER: MENU: spawned new tab", tab, "with url", url);

        if (!useDebugger && tab.url.startsWith("about:"))
            // On Firefox, downloads spawned as new tabs become "about:blank"s and get closed.
            // Spawning a new window in this case is counterproductive.
            newWindow = false;

        if (newWindow)
            browser.windows.create({ tabId: tab.id }).catch(logError);
    }, logError);
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

    browser.menus.create({
        id: "replay-tab",
        contexts: ["link"],
        title: "Replay Link in New Tab",
    });

    browser.menus.create({
        id: "replay-window",
        contexts: ["link"],
        title: "Replay Link in New Window",
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

    browser.menus.onClicked.addListener(catchAll(handleMenuAction));
}

async function main() {
    browser.runtime.onUpdateAvailable.addListener(catchAll(handleUpdateAvailable));

    // Load old config and globals.

    let localData = await browser.storage.local.get([
        "config", "globals", "session",
        // obsolete names for `globals`
        "persistentStats", "globalStats"
    ]).catch(() => { return {}; });

    let oldConfig = localData.config;
    if (oldConfig !== undefined) {
        console.log(`MAIN: Loading config of version ${oldConfig.version}`);

        upgradeConfig(oldConfig);
        config = updateFromRec(config, oldConfig);
    }
    savedConfig = assignRec({}, config);

    let oldGlobals = getFirstDefined(localData.globals, localData.persistentStats, localData.globalStats);
    if (oldGlobals !== undefined) {
        console.log(`MAIN: Loading globals of version ${oldGlobals.version}`);

        oldGlobals = upgradeGlobals(oldGlobals);
        globals = updateFromRec(globals, oldGlobals);
    }
    savedGlobals = assignRec({}, globals);

    let lastSeenVersion = config.lastSeenVersion;
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

    // Init IndexedDB.

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
            message: escapeNotification(config, `Failed to open/create a database via \`IndexedDB\` API, all data persistence will be done via \`storage.local\` API instead. This is not ideal, but not particularly bad. However, the critical issue is that it appears \`Hoardy-Web\` previously used \`IndexedDB\` for archiving and/or stashing reqres.\n\nSee the "Help" page for more info and instructions on how to fix this.`),
            iconUrl: iconURL("error", 128),
            type: "basic",
        }).catch(logError);
    }

    // Init `config` and `serverConfig`.
    // NB: this depends on reqresIDB

    [config, serverConfig] = fixConfig(config, configDefaults, serverConfig);

    // Restore the old session, if reloading with `reloadSelf`.
    // This restores old `sessionId`, tab configs, `reqresLog`,
    // and its elements in `reqresProblematic`.

    let oldSession = localData.session;
    let sessionTabs = {};
    if (oldSession !== undefined) {
        // to prevent it from being loaded again
        await browser.storage.local.remove("session").catch(() => {});

        sessionId = oldSession.id;
        console.log(`MAIN: Loading old session ${oldSession.id}`);
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

    // Get all currently open tabs
    let tabs = await browser.tabs.query({});
    // ... and start listening for updates.
    browser.tabs.onCreated.addListener(catchAll(handleTabCreated));
    browser.tabs.onRemoved.addListener(catchAll(handleTabRemoved));
    browser.tabs.onReplaced.addListener(catchAll(handleTabReplaced));
    browser.tabs.onActivated.addListener(catchAll(handleTabActivated));
    browser.tabs.onUpdated.addListener(catchAll(handleTabUpdated));

    // Init configs and states of currently open tabs, possibly reusing old session data.

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

    // Load stashed reqres.
    // This might take a while, new tabs will get processed in the meantime.

    await loadStashed();

    console.log(`MAIN: Initialized Hoardy-Web with source of '${sourceDesc}'.`);
    console.log("MAIN: runtime options are", { useSVGIcons, useBlocking, useDebugger });
    console.log("MAIN: config is", config);
    console.log("MAIN: globals are", globals);

    // Init capture.

    let filterAllN = { url: [{}] };
    browser.webNavigation.onBeforeNavigate.addListener(catchAll(handleBeforeNavigate), filterAllN)

    initCapture();
    if (useDebugger)
        await initDebugCapture(tabs);

    if (browser.commands !== undefined)
        browser.commands.onCommand.addListener(catchAll(handleShortcut));

    // Init UI handling.

    initMenus();
    browser.notifications.onClicked.addListener(catchAll(handleNotificationClicked));

    // Init RPC.

    initWebextRPC(handleInternalMessage);

    // Finishing up.

    console.log("MAIN: Ready to Hoard the Web!");

    if (lastSeenVersion != manifest.version) {
        browser.notifications.create("info-updated", {
            title: "Hoardy-Web: INFO",
            message: escapeNotification(config, `\`Hoardy-Web\` updated \`${lastSeenVersion}\` -> \`${manifest.version}\``),
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
            message: escapeNotification(config, `Some auto-discarding options are enabled: ${what.join(", ")}.`),
            iconUrl: iconURL("limbo", 128),
            type: "basic",
        }).catch(logError);
    }

    scheduleGlobalNotifications(1000);

    resetSingletonTimeout(scheduledHidden, "endgame", 100, async () => {
        // a bit of a hack to only run this instead of the whole `scheduleEndgame(null)`
        await checkServer();
    });

    scheduleUpdateDisplay(true, null, true);
}

main();
