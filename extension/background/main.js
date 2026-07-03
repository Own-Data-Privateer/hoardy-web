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
 * The `main` function and other core initializations and handlers used `Hoardy-Web`.
 *
 * NB: "reqres" means "request + response".
 */

"use strict";

// Stuff that does not fit anywhere else.

function applyToReqres13(func, early, a, b, c, d, e, f, g, h, i, j, k, l, m) {
    applyToReqresInFlight5(func, early, a, b, c, d, e);
    applyToReqresProblematic1(func, f);
    applyToReqresNotInFlight3(func, g, h, i);
    applyToReqresBundled1(func, j);
    applyToReqresWithIssues3(func, k, l, m);
}

// Archiving/replay via an archiving server.

async function checkServer() {
    wantCheckServer = false;

    if (!(config.archive && config.archiveSubmitHTTP
          || config.rearchiveSubmitHTTP
          || config.replaySubmitHTTP))
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

function checkReplay(replayType) {
    if (replayType === undefined)
        replayType = "Replay";
    const ifFixed = `\n\nIf you fixed it and the error persists, press the "Retry" button the "Queued/Failed" line in the popup.`;

    if (config.replaySubmitHTTP === false) {
        browser.notifications.create(`error-replay`, {
            title: "Hoardy-Web: ERROR",
            message: escapeNotification(config, `${replayType} is forbidden by the "Replay from the archiving server" option.\n\nEnable it to allow this feature.`),
            iconUrl: iconURL("error", 128),
            type: "basic",
        }).catch(logError);

        return false;
    } else if (!serverConfig.alive) {
        browser.notifications.create(`error-replay`, {
            title: "Hoardy-Web: ERROR",
            message: escapeNotification(config, `${replayType} is impossible because the archiving server at \`${serverConfig.baseURL}\` is unavailable.` + ifFixed),
            iconUrl: iconURL("error", 128),
            type: "basic",
        }).catch(logError);

        return false;
    } else if (!serverConfig.canReplay) {
        browser.notifications.create(`error-replay`, {
            title: "Hoardy-Web: ERROR",
            message: escapeNotification(config, `${replayType} is impossible because the archiving server at \`${serverConfig.baseURL}\` does not support replay.\n\nSwitch your archiving server to \`hoardy-web serve\` for this feature to work.` + ifFixed),
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
    if (config.replaySubmitHTTP === false || !serverConfig.alive || !serverConfig.canReplay)
        throw Error("replay is not available");

    let replayURL = serverConfig.info.replay_latest.replace("{url}", url);
    return (new URL(replayURL, serverConfig.baseURL)).href;
}

function replayOne(tabId, url) {
    runSynchronouslyB(`replay#${tabId}`, (tabId, url) => {
        popInLimbo(true, {tabId});
        runSynchronouslyWhenArchived(tabId, "replay",
                                     // force return undefined
                                     (tabId, url) => navigateTabTo(tabId, url).then(noop), tabId, url);
    }, tabId, url);
    // return undefined;
}

async function replay(tabIdOrNull, direction) {
    if (!checkReplay())
        return;

    let tabs;
    if (tabIdOrNull === null)
        tabs = await browser.tabs.query({});
    else {
        let tab = await browser.tabs.get(tabIdOrNull);
        tabs = [ tab ];
    }
    let updatedTabId;

    for (let tab of tabs) {
        let tabId = tab.id;
        let tabcfg = getTabConfig(tabId);
        let url = getTabURL(tab);
        if (tabIdOrNull === null && !tabcfg.replayable
            || isBoringOrServerURL(url)) {
            if (config.debugRuntime)
                console.log("MAIN: NOT replaying tab", tabId, url);
            continue;
        }

        let replayURL = latestReplayOf(url);

        if (config.debugRuntime)
            console.log("MAIN: replaying tab", tabId, url, "->", replayURL);

        await runWhenTabSettles(
            "replay", `replay tab #${tabId} (${url.substr(0, 80)})`,
            tabId, tabcfg, 0,
            replayOne, tabId, replayURL
        );

        updatedTabId = mergeUpdatedTabIds(updatedTabId, tabId);
    }

    scheduleEndgame(updatedTabId);
}

// Handlers.

// is there a new version ready to be used?
let updateAvailable = false;

function handleUpdateAvailable(details) {
    updateAvailable = true;
    if (config.autoReloadOnUpdates)
        shortcutCommands.reloadSelf();
    else
        scheduleUpdateDisplay(true);
}

async function handleBeforeNavigate(e) {
    if (config.debugRuntime)
        console.log("BROWSER: tab navigation", e.tabId, e.url);
}

function chromiumResetRootTab(tabId, tabcfg) {
    // Navigate to `workaroundChromiumResetRootTabURL` instead.
    //
    // NB: `priority` argument here overrides `attachDebuggerAndReloadTab` what
    // `handleBeforeRequest` does. Thus, this action wins.
    if (tabcfg.collecting && config.workaroundChromiumResetRootTab)
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
    processReplaceTab(addedTabId, removedTabId);
}

function handleTabActivated(tab) {
    let tabId = tab.tabId;

    if (config.debugRuntime)
        console.log("BROWSER: tab activated", tabId);

    if (useDebugger)
        // Chromium does not provide `browser.menus.onShown` event
        updateMenu(getTabConfig(tabId));

    // Update immediately.
    forceUpdateDisplay(false, tabId, true);
}

function handleTabUpdated(tabId, changeInfo, tab) {
    if (config.debugRuntime)
        console.log("BROWSER: tab updated", tabId, getTabURL(tab));

    // On Firefox, there's no `tab.pendingUrl`, so we skip updates until `tab.url` is set.
    //
    // Otherwise, `updateDisplay` might get confused about which icon to show for our internal pages
    // narrowed to a tracked tab.
    if (!useDebugger && tab.url === undefined)
        return;

    // `handleTabUpdated` usually gets called by the browser repeatedly many times in succession, so
    // we `scheduleUpdateDisplay` here instead.
    scheduleUpdateDisplay(false, tabId, false);
}

let rpcCommands = {
    getSessionId: () => sessionId,

    getConfig: () => config,
    setConfig: (newConfig) => runThenScheduleEndgame(setConfig, newConfig),
    resetConfig: () => runThenScheduleEndgame(setConfig, configDefaults),

    getTabConfig,
    setTabConfig: (tabId, newConfig) => {
        let oldConfig = getTabConfig(tabId);
        newConfig = updateFromRec(prefillChildren(configDefaults.root), newConfig);
        setTabConfig(tabId, undefined, newConfig, oldConfig);
    },

    getStats,
    resetStats,

    getTabStats,

    // NB: not wrapping these ones because they return `Promise`s
    snapshot: (tabId) => {
        snapshot(tabId);
    },
    replay: (tabId, direction) => {
        replay(tabId, direction);
    },

    getInFlight,
    stopInFlight: (rrfilter, reason) => {
        if (reason === undefined)
            reason = "capture::EMIT_FORCED::BY_USER";
        let updatedTabId = stopInFlight(rrfilter, reason);
        scheduleEndgame(updatedTabId);
    },

    getProblematic,
    unmarkProblematic: (rrfilter) => runThenScheduleEndgame(syncUnmarkProblematic, rrfilter),
    rotateProblematic: (rrfilter) => runThenScheduleEndgame(syncRotateProblematic, rrfilter),

    getInLimbo,
    popInLimbo: (collect, rrfilter) => runThenScheduleEndgame(syncPopInLimbo, collect, rrfilter),
    rotateInLimbo: (rrfilter) => runThenScheduleEndgame(syncRotateInLimbo, rrfilter),

    getLog: () => reqresLog,
    forgetLog: (rrfilter) => runThenScheduleEndgame(syncForgetLog, rrfilter),

    getQueued,

    getUnarchived,
    retryUnarchived: (unrecoverable, rrfilter) => runThenScheduleEndgame(syncRetryUnarchived, unrecoverable, rrfilter),

    getBuggedOut,
    archiveBuggedOut: (rrfilter) => runThenScheduleEndgame(syncArchiveBuggedOut, rrfilter),
    deleteBuggedOut: (rrfilter) => runThenScheduleEndgame(syncDeleteBuggedOut, rrfilter),

    getSavedFilters: () => savedFilters,
    setSavedFilters: (newSavedFilters) => runThenScheduleEndgame(setSavedFilters, newSavedFilters),

    exportAs: (bucketOrNull) => {
        scheduleBucketSaveAs(0, bucketOrNull);
        scheduleUpdateDisplay(true);
    },
    rearchiveSaved: (...args) => runThenScheduleEndgame(syncRearchiveSaved, ...args),
    deleteSaved: (rrfilter) => runThenScheduleEndgame(syncDeleteSaved, rrfilter),
};

let shortcutCommands = {
    // Global
    reloadSelf,
    cancelReloadSelf,

    runActions: () => runThenScheduleEndgame(syncRunActions),
    cancelActions: () => runThenScheduleEndgame(syncCancelActions),

    exportAsAll: () => {
        scheduleBucketSaveAs(0, null);
        scheduleUpdateDisplay(true);
    },
    stashAll: () => runThenScheduleEndgame(syncStashAll, true),
    retryAllUnstashed: () => runThenScheduleEndgame(syncRetryAllUnstashed),
    retryAllUnarchived: () => runThenScheduleEndgame(syncRetryUnarchived, true, {}),
    retryAllFailed: () => {
        syncRetryUnarchived(true, {});
        syncRetryAllUnstashed();
        scheduleEndgame(null);
    },
    rearchiveAdjunctSaved: () => runThenScheduleEndgame(syncRearchiveSaved, null, false, false, false),

    snapshotAll: () => rpcCommands.snapshot(null),
    replayAll: () => rpcCommands.replay(null, null),

    forgetAllLog: () => runThenScheduleEndgame(syncForgetLog, {}),
    showState: (tabId, activeTabId) => showState(null, null, "top", activeTabId),
    showLog: (tabId, activeTabId) => showState(null, null, "tail", activeTabId, true, scrollEndIntoView),

    stopAllInFlight: () => rpcCommands.stopInFlight(null),
    unmarkAllProblematic: () => runThenScheduleEndgame(syncUnmarkProblematic, {}),
    collectAllInLimbo: () => runThenScheduleEndgame(syncPopInLimbo, true, {}),
    discardAllInLimbo: () => runThenScheduleEndgame(syncPopInLimbo, false, {}),

    // NB: wrapping these because they return `Promise`s
    smartSwitchTabsBackward: () => {
        smartSwitchTabs(false, false, true);
    },
    smartSwitchTabsForward: () => {
        smartSwitchTabs(false, true, true);
    },
    smartSwitchTabsLatest: () => {
        smartSwitchTabs(false, false, false);
    },
    highlightTabsBackward: () => {
        smartSwitchTabs(true, false, true);
    },
    highlightTabsForward: () => {
        smartSwitchTabs(true, true, true);
    },
    highlightTabsLatest: () => {
        smartSwitchTabs(true, false, false);
    },

    // per-Tab
    snapshotTab: rpcCommands.snapshot,
    // TODO rename -> *Backward
    replayTabBack: (tabId) => rpcCommands.replay(tabId, false),
    replayTabForward: (tabId) => rpcCommands.replay(tabId, true),

    forgetAllTabLog: (tabId) => runThenScheduleEndgame(syncForgetLog, {tabId}),
    showTabState: (tabId, activeTabId) => showState(sessionId, tabId, "top", activeTabId),
    showTabLog: (tabId, activeTabId) => showState(sessionId, tabId, "tail", activeTabId, true, scrollEndIntoView),

    stopAllTabInFlight: (tabId) => rpcCommands.stopInFlight({tabId}),
    unmarkAllTabProblematic: (tabId) => runThenScheduleEndgame(syncUnmarkProblematic, {tabId}),
    collectAllTabInLimbo: (tabId) => runThenScheduleEndgame(syncPopInLimbo, true, {tabId}),
    discardAllTabInLimbo: (tabId) => runThenScheduleEndgame(syncPopInLimbo, false, {tabId}),
};

function initShortcutCommands() {
    let commands = manifest.commands;
    for (let command of Object.keys(commands)) {
        if (command.startsWith("_") || shortcutCommands[command] !== undefined)
            continue;
        if (command.startsWith("toggleTabConfig")) {
            let [field, children] = mapShortcutName((field, children) => [field, children], command);

            shortcutCommands[command] = (tabId) => {
                let oldTabcfg = getTabConfig(tabId);
                let tabcfg = assignRec({}, oldTabcfg);

                let cfg = children ? tabcfg.children : tabcfg;
                if (cfg[field] === undefined)
                    throw Error(`toggleTabConfig*: no such field: ${field}`);
                cfg[field] = !cfg[field];

                setTabConfig(tabId, undefined, tabcfg, oldTabcfg);
            };
            continue;
        }
        console.error(`a superfulous manifest.commands entry: ${command}`);
    }
}

async function handleShortcut(request) {
    if (config.debugRuntime)
        console.log("BROWSER: SHORTCUT: request", request);

    let tab = await getActiveTab();
    if (tab === null)
        return;
    let activeTabId = tab.id;

    // The map is set this way so that show-state -> show-tab-state would open
    // the state narrowed to background tasks. This is not very intuitive but
    // rather useful.
    let tabId = getMapURLParam(statePageURL, "tab", getTabURL(tab), toNumber, TAB_ID_NONE, activeTabId);

    let action = shortcutCommands[request];
    if (action !== undefined) {
        action(tabId, activeTabId);
        return;
    }

    console.error("BROWSER: SHORTCUT: unknown request", request);
    throw new Error(`unknown request`);
}

function evalRPCRequest(request) {
    let command = request[0];

    let shortcutFunc = shortcutCommands[command];
    if (shortcutFunc !== undefined) {
        let tabId = request[1];
        shortcutFunc(tabId, tabId);
        return null;
    }

    let rpcFunc = rpcCommands[command];
    if (rpcFunc !== undefined) {
        request.shift();
        let res = rpcFunc(...request);
        if (res !== undefined)
            return res;
        return null;
    }

    console.error("BROWSER: RPC: unknown request", request);
    throw new Error(`unknown request`);
}

function handleInternalMessage(request, sender, sendResponse) {
    sendResponse(evalRPCRequest(request));
}

function handleNotificationClicked(notificationId) {
    if (config.debugRuntime)
        console.log("BROWSER: NOTIFICATION: clicked", notificationId);

    switch (notificationId) {
    case "info-updated":
        rpcCommands.setConfig({ seenChangelog: true });
        showChangelog("");
        return;
    default:
        if (notificationId.startsWith("error-"))
            showHelp("error-notifications");
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
        id: "replay-tab",
        contexts: ["link"],
        title: "Replay Link in New Tab",
    });

    browser.menus.create({
        id: "replay-window",
        contexts: ["link"],
        title: "Replay Link in New Window",
    });

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
        browser.menus.update("replay-tab", { icons: mkIcons("replay") });
        browser.menus.update("replay-window", { icons: mkIcons("replay") });
        browser.menus.update("open-not-tab", { icons: menuIcons[true] });
        browser.menus.update("open-not-window", { icons: menuIcons[true] });

        // Firefox provides `browser.menus.onShown` event, so `updateMenu` can be called on-demand
        browser.menus.onShown.addListener(catchAll((info, tab) => {
            if (tab === undefined) return;
            updateMenu(getTabConfig(tab.id));
            browser.menus.refresh();
        }));
    }

    browser.menus.onClicked.addListener(catchAll(handleMenuAction));
}

async function main() {
    browser.runtime.onUpdateAvailable.addListener(catchAll(handleUpdateAvailable));

    // Init stuff.
    initShortcutCommands();

    // Load old config and state.

    let localData = await browser.storage.local.get([
        "config", "state", "session",
        // obsolete names for `state`
        "globals", "persistentStats", "globalStats"
    ]).catch(() => { return {}; });

    let oldConfig = localData.config;
    if (oldConfig !== undefined) {
        console.log(`MAIN: Loading config of version ${oldConfig.version}`);

        config = updateFromRec(config, upgradeConfig(oldConfig));
        // just in case
        config.ephemeral = false;

        // NB: we set `savedConfig` to the upgraded version so that calling `scheduleSaveConfig`
        // would be a noop
        savedConfig = assignRec({}, config);

        // NB: see also `fixConfig` bit below
    }

    let oldState = getFirstDefined(localData.state, localData.globals, localData.persistentStats, localData.globalStats);
    if (oldState !== undefined) {
        console.log(`MAIN: Loading state of version ${oldState.version}`);

        state = updateFromRec(state, upgradeState(oldState));

        // NB: this is a bit tricky. The following bit ensures that `savedState` has all keys of
        // `dynamicStateDefaults` ...
        savedState = assignRec({}, state);
        // then, it resets them ...
        state = updateFromRec(state, dynamicStateDefaults);
        // and then repopulates them in some of the following (reDynamicState) bits, thus making the
        // `scheduleSaveState` that will be run from `scheduleEndgame` below into a noop.
    }

    let lastSeenVersion = config.lastSeenVersion;
    config.lastSeenVersion = manifest.version;

    if (lastSeenVersion != manifest.version) {
        if(config.seenChangelog) {
            // reset `config.seenChangelog` when major version changes
            let vOld = lastSeenVersion.split(".");
            let vNew = manifest.version.split(".").slice(0, 2);
            config.seenChangelog = equalRec(vOld, vNew);
        }

        browser.notifications.create("info-updated", {
            title: "Hoardy-Web: INFO",
            message: escapeNotification(config, `\`Hoardy-Web\` updated \`${lastSeenVersion}\` -> \`${manifest.version}\``),
            iconUrl: iconURL("main", 128),
            type: "basic",
        }).catch(logError);
    }

    // for debugging
    if (false) {
        config.ephemeral = true;
        config.debugRuntime = true;
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

    if (reqresIDB === undefined && (state.stashedIDB.number > 0 || state.savedIDB.number > 0)) {
        browser.notifications.create("error-noIndexedDB", {
            title: "Hoardy-Web: ERROR",
            message: escapeNotification(config, `Failed to open Hoardy-Web's database using \`IndexedDB\` API, but it appears that \`IndexedDB\` was previously used for stashing and/or archiving reqres.\n\n\`IndexedDB\` API appears to be unusable at the moment, so all data persistence operations will now be done via \`storage.local\` API instead. This means that old reqres are now (temporarily) unavailable.\n\nSee the "Help" page for more info and instructions on how to fix this.`),
            iconUrl: iconURL("error", 128),
            type: "basic",
        }).catch(logError);
    }

    // Init `config` and `serverConfig`.

    // NB: this goes here and not right after the `upgradeConfig` bit above because this depends on
    // reqresIDB
    [config, serverConfig] = fixConfig(config, configDefaults, serverConfig);

    // Restore the old session, if reloading with `reloadSelf`.
    // This restores old `sessionId`, tab configs, `reqresLog`,
    // and its elements in `reqresProblematic`.

    let oldSession = localData.session;
    let sessionBg;
    let sessionTabs = {};
    if (oldSession !== undefined) {
        // to prevent it from being loaded again
        await browser.storage.local.remove("session").catch(noop);

        sessionId = oldSession.id;
        console.log(`MAIN: Loading old session ${oldSession.id}`);
        sessionBg = oldSession.bg;
        sessionTabs = oldSession.tabs || {};
        reqresLog = oldSession.log;
    }

    // Restore the state of background requests.

    if (sessionBg !== undefined) {
        // NB: (reDynamicState)
        let bgstate = updateFromRec(assignRec({}, tabStateDefaults), sessionBg, dynamicStateDefaults);
        tabState.set(-1, bgstate);
    }

    // Init configs and states of currently open tabs, possibly reusing old session data.

    let tabs = await browser.tabs.query({});
    for (let tab of tabs) {
        let tabId = tab.id;
        let tabUrl = getTabURL(tab);

        // record they exist
        openTabs.add(tabId);

        let tabcfg = prefillChildren(config.root);
        let tabstate = assignRec({}, tabStateDefaults);

        let oldTab = sessionTabs[tabId];
        if (oldTab !== undefined && oldTab.url === tabUrl) {
            // recover old values
            tabcfg = updateFromRec(tabcfg, getFirstDefined(oldTab.cfg, oldTab.tabcfg));
            // NB: (reDynamicState)
            tabstate = updateFromRec(tabstate, oldTab.state, dynamicStateDefaults);
        }

        setTabConfig(tabId, undefined, tabcfg, tabcfg, true);
        tabState.set(tabId, tabstate);

        // on Chromium, reset their URLs, maybe
        if (useDebugger && tabUrl === "chrome://newtab/")
            chromiumResetRootTab(tabId, tabcfg);
    }

    // Reset their windowId's to match our current state and populate reqresProblematic.
    for (let loggable of reqresLog) {
        if (loggable.problematic) {
            let tabstate = getTabState(loggable.tabId, loggable.fromExtension);
            reqresProblematic.push([loggable, null]);
            // NB: (reDynamicState)
            tabstate.problematicTotal += 1;
            tabstate.problematicSize += loggable.dumpSize;
            gotNewProblematic = true;
        }
    }

    // Init capture.

    let filterAllN = { url: [{}] };
    browser.webNavigation.onBeforeNavigate.addListener(catchAll(handleBeforeNavigate), filterAllN)

    initCapture();
    if (useDebugger)
        await initDebugCapture(tabs);

    // Init RPC.

    initWebextRPC(handleInternalMessage);

    // Init UI events.

    initMenus();
    browser.notifications.onClicked.addListener(catchAll(handleNotificationClicked));
    if (browser.commands !== undefined)
        browser.commands.onCommand.addListener(catchAll(handleShortcut));

    browser.tabs.onCreated.addListener(catchAll(handleTabCreated));
    browser.tabs.onRemoved.addListener(catchAll(handleTabRemoved));
    browser.tabs.onReplaced.addListener(catchAll(handleTabReplaced));
    browser.tabs.onActivated.addListener(catchAll(handleTabActivated));
    browser.tabs.onUpdated.addListener(catchAll(handleTabUpdated));

    // Schedule server check and stashed reqres loading.
    //
    // NB: this reuses `scheduleHidden, "endgame"` task singleton so that all `scheduleEndgame`
    // internals would block until this thing finishes.
    resetSingletonTimeout(scheduledHidden, "endgame", 100, async () => {
        await loadStashed(); // NB: (reDynamicState)
        await fsckDumps();
        scheduleEndgame(null, 0);
    });

    // Schedule displayed state update.
    scheduleUpdateDisplay(true, null, true);

    // Init done.

    console.log(`MAIN: Initialized Hoardy-Web with source of '${sourceDesc}'.`);
    console.log("MAIN: runtime options are", { useSVGIcons, useBlocking, useDebugger });
    console.log("MAIN: config is", config);
    console.log("MAIN: state is", state);
    console.log("MAIN: Ready to Hoard the Web!");

    // Generate some reminder notifications.

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

    if (!config.debugRuntime)
        return;

    // Run tests all the tests and report any errors.

    let errors = await runTests();
    let issues = Object.entries(errors).map((e) => `- ${e[0]}: ${e[1]}`).join("\n");

    if (issues.length > 0) {
        browser.notifications.create("tests", {
            title: "Hoardy-Web: UNIT TESTS FAILED",
            message: escapeNotification(config, issues),
            iconUrl: iconURL("error", 128),
            type: "basic",
        }).catch(logError);
    }
}

main();
