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
 * Global config and state.
 */

"use strict";

// default config
let sourceConfigDefaults = {
    autoReplay: false,
    // are in work offline mode?
    workOffline: false,
    // are we collecting new data?
    collecting: true,
    // are we also collecting work offline requests?
    collectingWorkOffline: true,
    problematicNotify: true,
    limbo: false,
    negLimbo: false,
    stashLimbo: true,
    bucket: "default",
};

let configVersion = 9;

let configDefaults = {
    version: configVersion,

    // behavior
    history: 1024,
    autoReloadOnUpdates: false,

    // user interface
    sparse: null,
    colors: null,
    colorblind: false,
    seasonal: true,
    season: {
        halloween: null,
        winter: null,
    },
    pureText: false,
    animateIcon: 800,
    spawnNewTabs: !isMobile,

    // notifications
    verbose: true,
    escapeNotifications: false,
    hintNotify: true,
    invisibleUINotify: true,

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
    rearchiveExportAs: !isMobile,
    exportAsHumanReadable: true,
    exportAsBundle: true,
    exportAsMaxSize: 64,
    exportAsTimeout: 3,
    exportAsInFlightTimeout: 60,
    gzipExportAs: true,

    // submission and replay via HTTP
    archiveSubmitHTTP: false,
    rearchiveSubmitHTTP: false,
    replaySubmitHTTP: null,
    submitHTTPURLBase: "http://127.0.0.1:3210/",
    submitHTTPParanoid: true,

    // saving to local storage
    archiveSaveLS: true,
    persistLSParanoid: true,

    // archiving notifications
    archiveDoneNotify: true,
    persistFailedNotify: true,
    archiveStuckNotify: true,

    // problematic marking options
    markProblematicPartialRequest: false,
    markProblematicBuggy: true,
    markProblematicCanceled: false,
    markProblematicNoResponse: true,
    markProblematicIncomplete: true,
    markProblematicIncompleteFC: false,
    markProblematicTransientCodes: true,
    markProblematicPermanentCodes: false,
    markProblematicWithImportantErrors: true,
    markProblematicPickedWithErrors: true,
    markProblematicDroppedWithErrors: false,

    // problematic unmarking options
    autoUnmarkProblematic: false,
    autoUnmarkProblematicSimilar: true,
    autoUnmarkProblematicSimilarAcrossTabs: true,
    autoUnmarkProblematicSimilarAcrossLimbo: true,

    // problematic notifications
    problematicNotify: null,
    problematicNotifyNumber: 3,

    // picking options
    archivePartialRequest: true,
    archiveBuggy: true,
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
    limboNotifyInterval: 300,
    limboNotify: true,

    // automatic actions
    autoPopInLimboCollect: false,
    autoPopInLimboDiscard: false,
    // automatic actions notifications
    autoTimeout: 0,
    autoNotify: true,

    // work offline settings
    workOfflineFile: true,
    workOfflineData: false,
    workOfflineReplay: true,
    autoReplayOffInReplay: true,

    root: assignRec({
        snapshottable: true,
        replayable: true,
        settleDelay: 5,
        settleRetries: 5,
    }, sourceConfigDefaults),

    background: assignRec({}, sourceConfigDefaults, {
        bucket: "background",
    }),

    extension: assignRec({}, sourceConfigDefaults, {
        bucket: "extension",
    }),

    // debugging options
    ephemeral: false, // stop the config from being saved to disk
    snapshotAny: false, // snapshot isBoringOrServerURL

    debugConfig: false, // allow unsafe config
    debugRuntime: false, // log runtime events
    debugCaptures: false, // log capture events
    dumpCaptures: false, // log CBOR dumps
    debugPersisence: false, // log stashes and archivals
    discardAll: false, // drop all reqres on archival

    // meta
    lastSeenVersion: manifest.version,
    seenChangelog: true,
    seenHelp: false,
};

// archiving/replay server config
let serverConfigDefaults = {
    baseURL: configDefaults.submitHTTPURLBase,
    alive: false,
    info: {
        version: 0,
        dump_wrr: "/pwebarc/dump",
    },
    canDump: false,
    canReplay: false,
};

function upgradeConfig(config) {
    function rename(from, to, ...args) {
        if (args.length === 0)
            args = [config];
        for (let cfg of args) {
            let old = cfg[from];
            if (old === undefined)
                return;
            delete cfg[from];
            cfg[to] = old;
        }
    }

    switch (config.version) {
    case 1:
        rename("collectPartialRequests", "archivePartialRequest");
        rename("collectNoResponse", "archiveNoResponse");
        rename("collectIncompleteResponses", "archiveIncompleteResponse");
    case 2:
        // because it got updated lots
        config.seenHelp = false;
    case 3:
        // making them disjoint
        if (config.markProblematicWithErrors)
            config.markProblematicPickedWithErrors = true;
        rename("markProblematicWithErrors", "markProblematicDroppedWithErrors");
    case 4:
        // because that, essentially, was the default before, even though it is not now
        config.archiveSubmitHTTP = true;
        config.archiveSaveLS = false;

        rename("archiving", "archive")
        rename("archiveURLBase", "submitHTTPURLBase");
        rename("archiveNotifyOK", "archiveDoneNotify");
        rename("archiveNotifyFailed", "archiveFailedNotify");
        rename("archiveNotifyDisabled", "archiveStuckNotify");

        rename("profile", "bucket", config.root, config.background, config.extension);
    case 5:
        if (config.exportAsMaxSize === 0) {
            config.exportAsBundle = false;
            config.exportAsMaxSize = configDefaults.exportAsMaxSize;
        }
        // because it got updated lots
        config.seenHelp = false;
    case 6:
        // its semantics changed
        config.problematicNotify = config.autoNotify ? true : null;
        rename("debugging", "debugRuntime");
    case 7:
        // its semantics changed
        config.collectingWorkOffline = true;
    case 8:
        rename("archiveFailedNotify", "persistFailedNotify");
        rename("saveLSParanoid", "persistLSParanoid");

        config.root.workOffline = config.root.workOffline && config.workOffline;
        config.root.collecting = config.root.collecting && config.collecting;
        config.root.collectingWorkOffline = config.collectingWorkOffline;
        config.background.workOffline = config.background.workOffline && config.workOffline;
        config.background.collecting = config.background.collecting && config.collecting;
        config.background.collectingWorkOffline = config.collectingWorkOffline;
        config.extension.workOffline = config.extension.workOffline && config.workOffline;
        config.extension.collecting = config.extension.collecting && config.collecting;
        config.extension.collectingWorkOffline = config.collectingWorkOffline;
        delete config["workOffline"];
        delete config["collecting"];
        delete config["collectingWorkOffline"];
    case 9:

    // epilog, do NOT move or copy-paste this `break` into the above
        break;
    default:
        console.warn(`Bad old config version ${config.version}, reusing values as-is without updates`);
        // the following updateFromRec will do its best
    }

    config.version = configVersion;

    return config;
}

tests.upgradeConfig = () => {
    let value = {
        version: 1,
        debugging: false,
        history: 1000,

        archiving: true,
        archiveURLBase: "http://127.0.0.1:3210/pwebarc/dump",

        collecting: true,
        collectPartialRequests: true,
        collectNoResponse: false,
        collectIncompleteResponses: false,

        root: {
            collecting: true,
            profile: "default",
        },

        background: {
            collecting: true,
            profile: "background",
        },

        extension: {
            collecting: false,
            profile: "extension",
        },
    };

    let up = upgradeConfig(assignRec({}, value));

    // sanity checks
    if (up.version !== configVersion)
        throw new Error("upgradeConfig version");
    try {
        updateFromRec(assignRec({}, configDefaults), up);
    } catch (err) {
        console.trace();
        throw new Error("upgradeConfig updateFromRec", { cause: err });
    }

    let issues = [];
    let res = equivalentRec((a, b, prefix) => {
        if (a === undefined && b !== undefined) {
            console.error("upgradeConfig", prefix, a, b);
            issues.push(prefix);
            return false;
        }
        return true;
    }, configDefaults, up, false);

    if (!res)
        throw new Error("upgradeConfig fields");
}

function setServer(config) {
    let res = assignRec({}, serverConfigDefaults);

    let serverURL;
    try {
        serverURL = new URL(config.submitHTTPURLBase);
    } catch (err) {
        logHandledError(err);
        browser.notifications.create("error-server-url", {
            title: "Hoardy-Web: ERROR",
            message: escapeNotification(config, `Malformed \`Server URL\` \`${config.submitHTTPURLBase}\`:\n${errorMessageOf(err)}`),
            iconUrl: iconURL("error", 128),
            type: "basic",
        }).catch(logError);
        return;
    }

    // clear stale
    browser.notifications.clear("error-server-url").catch(logError);

    if (serverURL.pathname == "/pwebarc/dump")
        // handle old-style URLs
        serverURL.pathname = "/";
    // just in case
    serverURL.search = "";
    serverURL.hash = "";

    res.baseURL = serverURL.href;

    return res;
}

function fixSourceConfig(cfg, defaults, noTab) {
    // if unset, reset to default
    if (!cfg.bucket) {
        if (typeof defaults === "function")
            defaults = defaults();
        cfg.bucket = defaults.bucket;
    }

    if (noTab)
        return;

    cfg.settleDelay = clamp(0, 60, toNumber(cfg.settleDelay));
    cfg.settleRetries = clamp(0, 100, toNumber(cfg.settleRetries));
}

function fixConfig(config, oldConfig, serverConfig) {
    config.history = clamp(64, 10240, toNumber(config.history));

    // when more than one season is forced, reset the old ones to `null`s
    let season = config.season;
    let numSeasons = Array.from(Object.keys(season)).filter((k) => season[k]).length;
    if (numSeasons > 1) {
        for (let key of Object.keys(season))
            if (season[key] === oldConfig.season[key])
                season[key] = null;
    }

    config.animateIcon = clamp(100, 5000, toNumber(config.animateIcon));

    config.workaroundChromiumDebugTimeout = clamp(1, 120, toNumber(config.workaroundChromiumDebugTimeout));

    if (!config.debugConfig && !isMobile && !config.spawnNewTabs) {
        // unavailable
        config.spawnNewTabs = true;

        if (config.hintNotify)
            browser.notifications.create("hint-configNotSupported-spawnNewTabs", {
                title: "Hoardy-Web: HINT",
                message: escapeNotification(config, `"Spawn internal pages in new tabs" can not be disabled on a desktop browser. See the description of that option for more info.` + annoyingNotification(config, "Generate notifications about > ... UI hints")),
                iconUrl: iconURL("main", 128),
                type: "basic",
            }).catch(logError);
    }

    if (reqresIDB === undefined)
        config.preferIndexedDB = false;
    else if (!config.debugConfig && useDebugger && !config.preferIndexedDB) {
        // can not be disabled on Chromium ATM, since serialization of
        // Uint8Array to `storage.local` won't work there
        config.preferIndexedDB = true;

        if (config.hintNotify)
            browser.notifications.create("hint-configNotSupported-preferIndexedDB", {
                title: "Hoardy-Web: HINT",
                message: escapeNotification(config, `"Prefer \`IndexedDB\` API" can not be disabled on a Chromium-based browser. See the description of that option for more info.` + annoyingNotification(config, "Generate notifications about > ... UI hints")),
                iconUrl: iconURL("main", 128),
                type: "basic",
            }).catch(logError);
    }

    let noArchiveExportAs = isMobile && isFirefox;
    if (!config.debugConfig && noArchiveExportAs && (config.archiveExportAs || config.rearchiveExportAs)) {
        // Firefox on Android crashes with this set see "Quirks and Bugs" in ../page/help.org
        config.archiveExportAs = false;
        config.rearchiveExportAs = false;

        if (config.hintNotify)
            browser.notifications.create("hint-configNotSupported-archiveExportAs", {
                title: "Hoardy-Web: HINT",
                message: escapeNotification(config, `"Export via \`saveAs\` is not supported on Firefox-based mobile browsers. See the "Help" page for more info.` + annoyingNotification(config, "Generate notifications about > ... UI hints")),
                iconUrl: iconURL("main", 128),
                type: "basic",
            }).catch(logError);
    }

    // at lest one of these must be set
    if (!(config.archiveExportAs || config.archiveSubmitHTTP || config.archiveSaveLS)) {
        if (config.archiveSaveLS !== oldConfig.archiveSaveLS && !noArchiveExportAs)
            config.archiveExportAs = true;
        else
            config.archiveSaveLS = true;
    }

    // to prevent surprises
    if (config.archive
        && (reqresQueue.length > 0 || reqresUnarchivedIssueAcc[0].size > 0)
        && (config.archiveExportAs !== oldConfig.archiveExportAs
         || config.archiveSubmitHTTP !== oldConfig.archiveSubmitHTTP
         || config.archiveSaveLS !== oldConfig.archiveSaveLS)) {
        config.archive = false;

        if (config.hintNotify)
            browser.notifications.create("hint-notArchivingNow", {
                title: "Hoardy-Web: HINT",
                message: escapeNotification(config, `"Archive \`collected\` reqres" option was disabled because the archival queue and/or the list of failed reqres are non-empty.` + annoyingNotification(config, "Generate notifications about > ... UI hints")),
                iconUrl: iconURL("off", 128),
                type: "basic",
            }).catch(logError);
    }

    config.exportAsMaxSize = clamp(1, 512, toNumber(config.exportAsMaxSize));
    config.exportAsTimeout = clamp(1, 900, toNumber(config.exportAsTimeout));
    config.exportAsInFlightTimeout = clamp(config.exportAsTimeout, 1200, toNumber(config.exportAsInFlightTimeout));

    // if unset, reset to default
    if (!config.submitHTTPURLBase)
        config.submitHTTPURLBase = configDefaults.submitHTTPURLBase;

    if (config.submitHTTPURLBase !== oldConfig.submitHTTPURLBase)
        serverConfig = setServer(config);

    config.problematicNotifyNumber = clamp(1, 32, toNumber(config.problematicNotifyNumber));
    config.limboMaxNumber = clamp(1, 10240, toNumber(config.limboMaxNumber));
    config.limboMaxSize = clamp(1, 512, toNumber(config.limboMaxSize));
    config.limboNotifyInterval = clamp(1, 3600, toNumber(config.limboNotifyInterval));

    // these are mutually exclusive
    if (config.autoPopInLimboCollect && config.autoPopInLimboDiscard) {
        if (config.autoPopInLimboCollect != oldConfig.autoPopInLimboCollect)
            config.autoPopInLimboDiscard = !config.autoPopInLimboCollect;
        else
            config.autoPopInLimboCollect = !config.autoPopInLimboDiscard;
    }
    config.autoTimeout = clamp(0, 3600, toNumber(config.autoTimeout));

    // fix per-source ones
    fixSourceConfig(config.root, configDefaults.root);
    fixSourceConfig(config.background, configDefaults.background, true);
    fixSourceConfig(config.extension, configDefaults.extension, true);

    DEBUG_WEBEXT_RPC = DEBUG_CAYDARSC = config.debugRuntime;

    return [config, serverConfig];
}

// these are to be computed dynamically from `reqresProblematic` and `reqresLimbo`
let dynamicStateDefaults = {
    problematicTotal: 0,
    problematicSize: 0,
    inLimboTotal: 0,
    inLimboSize: 0,
};

// common
let commonStateDefaults = {
    pickedTotal: 0,
    pickedSize: 0,
    droppedTotal: 0,
    droppedSize: 0,
    collectedTotal: 0,
    collectedSize: 0,
    discardedTotal: 0,
    discardedSize: 0,
};

// these can be reset by `resetStats`
let resettableStateDefaults = assignRec({
    exportedAsTotal: 0,
    exportedAsSize: 0,
    submittedHTTPTotal: 0,
    submittedHTTPSize: 0,
    dumpedTotal: 0,
    dumpedUndo: 0,
    dumpedSize: 0,
    dumpedReal: 0,
    stashedTotal: 0,
    stashedRedo: 0,
    stashedUndo: 0,
    savedTotal: 0,
    savedRedo: 0,
    savedUndo: 0,
}, commonStateDefaults);

let dbStateDefaults = { number: 0, size: 0 };

let stateVersion = 1;
let stateDefaults = assignRec({
    version: stateVersion,
    stashedLS: assignRec({}, dbStateDefaults),
    stashedIDB: assignRec({}, dbStateDefaults),
    savedLS: assignRec({}, dbStateDefaults),
    savedIDB: assignRec({}, dbStateDefaults),
}, dynamicStateDefaults, resettableStateDefaults);

function upgradeState(state) {
    if (state.version === undefined)
        state.version = 1;

    return state;
}

// Global state, its predicates, and persistence.

// current session ID, to prevent old reqres from being counted as belonging
// to current tabs, etc
let sessionId = Date.now();

// current config
let config = assignRec({}, configDefaults);
// last config saved in storage, will be set in `main`
let savedConfig;
// current server config
let serverConfig = assignRec({}, serverConfigDefaults);
// current global stats
let state = assignRec({}, stateDefaults);
// last global stats saved in storage, will be set in `main`
let savedState;

async function saveConfig(force) {
    if (!force && equalRec(savedConfig, config))
        return;

    savedConfig = assignRec({}, config);
    if (config.debugRuntime)
        console.warn("SAVE: writing config", savedConfig);
    await browser.storage.local.set({ config: savedConfig }).catch(logError);
}

function scheduleSaveConfig(timeout, force) {
    if (!force && equalRecWarnNeq(savedConfig, config, "SAVE:"))
        return;

    scheduleAction(scheduledSaveState, "saveConfig", timeout, () => {
        saveConfig(force);
        // return undefined;
    });
    // NB: needs scheduleUpdateDisplay afterwards
}

async function saveState(force) {
    if (!force && equalRec(savedState, state))
        return;

    savedState = assignRec({}, state);
    if (config.debugRuntime)
        console.warn("SAVE: writing state", savedState);
    await browser.storage.local.set({ state: savedState }).catch(logError);
    await browser.storage.local.remove("globals").catch(noop);
    await browser.storage.local.remove("persistentStats").catch(noop);
    await browser.storage.local.remove("globalStats").catch(noop);
}

function scheduleSaveState(timeout, force) {
    if (!force && equalRecWarnNeq(savedState, state, "SAVE:"))
        return;

    scheduleAction(scheduledSaveState, "saveState", timeout, () => {
        saveState(force);
        // return undefined;
    });
    // NB: needs scheduleUpdateDisplay afterwards
}

function resetStats() {
    state = updateFromRec(state, resettableStateDefaults);
    scheduleSaveState(0, true);
    scheduleUpdateDisplay(true);
}

function setConfig(newConfig) {
    let oldConfig = config;
    config = updateFromRec(assignRec({}, oldConfig), newConfig);

    [config, serverConfig] = fixConfig(config, oldConfig, serverConfig);

    if (config.stash && config.stash != oldConfig.stash)
        syncStashAll(false);

    if (config.archive && config.archiveSubmitHTTP
        && (config.archive !== oldConfig.archive
            || config.archiveSubmitHTTP !== oldConfig.archiveSubmitHTTP
            || config.submitHTTPURLBase !== oldConfig.submitHTTPURLBase)) {
        syncRetryUnarchived(true, {});
        wantArchiveDoneNotify = true;
    }

    if (config.rearchiveSubmitHTTP
        && (config.rearchiveSubmitHTTP !== oldConfig.rearchiveSubmitHTTP
            || config.submitHTTPURLBase !== oldConfig.submitHTTPURLBase)
     || config.replaySubmitHTTP !== false
        && (config.replaySubmitHTTP !== oldConfig.replaySubmitHTTP
            || config.submitHTTPURLBase !== oldConfig.submitHTTPURLBase))
        wantCheckServer = true;

    if (!config.ephemeral && !equalRec(config, oldConfig))
        // save config after a little pause to give the user time to click
        // the same toggle again without torturing the SSD
        scheduleSaveConfig(1000, true);

    if (useDebugger)
        syncDebuggersState();

    broadcast(false, "updateConfig", config);
}

function isServerURL(url) {
    return url.startsWith(serverConfig.baseURL);
}

function isBoringOrServerURL(url) {
    return isBoringURL(url) || isServerURL(url);
}
