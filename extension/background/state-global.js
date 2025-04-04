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
 * Global config and stats.
 */

"use strict";

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

    // work offline settings
    workOfflineImpure: false,
    workOfflineFile: true,
    workOfflineReplay: true,
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

    // saving to local storage
    archiveSaveLS: true,

    // archiving notifications
    archiveDoneNotify: true,
    archiveFailedNotify: true,
    archiveStuckNotify: true,

    // problematic options
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
    // problematic notifications
    problematicNotify: true,
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
        workOffline: false,
        collecting: true,
        problematicNotify: true,
        limbo: false,
        negLimbo: false,
        stashLimbo: true,
        bucket: "default",
        snapshottable: true,
        replayable: true,
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
    function rename(from, to) {
        let old = config[from];
        if (old === undefined)
            return;
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

    config.version = configVersion;
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

function fixConfig(config, oldConfig, serverConfig) {
    // reset to defaults
    if (!config.background.bucket)
        config.background.bucket = configDefaults.background.bucket;
    if (!config.extension.bucket)
        config.extension.bucket = configDefaults.extension.bucket;
    if (!config.root.bucket)
        config.root.bucket = configDefaults.root.bucket;

    if (!config.submitHTTPURLBase)
        config.submitHTTPURLBase = configDefaults.submitHTTPURLBase;

    // clamp
    config.animateIcon = clamp(100, 5000, toNumber(config.animateIcon));

    config.exportAsMaxSize = clamp(1, 512, toNumber(config.exportAsMaxSize));
    config.exportAsTimeout = clamp(0, 900, toNumber(config.exportAsTimeout));
    config.exportAsInFlightTimeout = clamp(config.exportAsTimeout, 900, toNumber(config.exportAsInFlightTimeout));

    // when more than one season is forced, reset the old ones to `null`s
    let season = config.season;
    let numSeasons = Array.from(Object.keys(season)).filter((k) => season[k]).length;
    if (numSeasons > 1) {
        for (let key of Object.keys(season))
            if (season[key] === oldConfig.season[key])
                season[key] = null;
    }

    // these are mutually exclusive
    if (config.autoPopInLimboCollect && config.autoPopInLimboDiscard) {
        if (config.autoPopInLimboCollect != oldConfig.autoPopInLimboCollect)
            config.autoPopInLimboDiscard = !config.autoPopInLimboCollect;
        else
            config.autoPopInLimboCollect = !config.autoPopInLimboDiscard;
    }

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

    if (config.submitHTTPURLBase !== oldConfig.submitHTTPURLBase)
        serverConfig = setServer(config);

    DEBUG_WEBEXT_RPC = DEBUG_CAYDARSC = config.debugRuntime;

    return [config, serverConfig];
}

// persistent global variables
let globalsVersion = 1;
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
let globalsDefaults = assignRec({
    version: globalsVersion,
    stashedLS: assignRec({}, dbstatsDefaults),
    stashedIDB: assignRec({}, dbstatsDefaults),
    savedLS: assignRec({}, dbstatsDefaults),
    savedIDB: assignRec({}, dbstatsDefaults),
}, persistentStatsDefaults);

function upgradeGlobals(globals) {
    if (globals.version === undefined)
        globals.version = 1;

    return globals;
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
let globals = assignRec({}, globalsDefaults);
// last global stats saved in storage, will be set in `main`
let savedGlobals;

async function saveConfig(force) {
    if (!force && equalRec(savedConfig, config))
        return;
    savedConfig = assignRec({}, config);
    if (config.debugRuntime)
        console.log("saving config", savedConfig);
    await browser.storage.local.set({ config: savedConfig }).catch(logError);
}

function scheduleSaveConfig(timeout, force) {
    scheduleActionWhen(force || !equalRec(savedConfig, config), scheduledSaveState, "saveConfig", timeout, () => {
        saveConfig(force);
    });
    // NB: needs scheduleUpdateDisplay afterwards
}

async function saveGlobals(force) {
    if (!force && equalRec(savedGlobals, globals))
        return;
    savedGlobals = assignRec({}, globals);
    if (config.debugRuntime)
        console.log("saving globals", savedGlobals);
    await browser.storage.local.set({ globals: savedGlobals }).catch(logError);
    await browser.storage.local.remove("persistentStats").catch(() => {});
    await browser.storage.local.remove("globalStats").catch(() => {});
}

function scheduleSaveGlobals(timeout, force) {
    scheduleActionWhen(force || !equalRec(savedGlobals, globals), scheduledSaveState, "saveGlobals", timeout, () => {
        saveGlobals(force);
    });
    // NB: needs scheduleUpdateDisplay afterwards
}

async function resetPersistentStats() {
    globals = updateFromRec(globals, persistentStatsDefaults);
    await saveGlobals();
    scheduleUpdateDisplay(true);
}

function isServerURL(url) {
    return url.startsWith(serverConfig.baseURL);
}

function isBoringOrServerURL(url) {
    return isBoringURL(url) || isServerURL(url);
}
