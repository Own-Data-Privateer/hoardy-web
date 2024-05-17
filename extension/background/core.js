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
let configVersion = 2;
let config = {
    debugging: false,
    dumping: false,
    history: 1000,

    // are we collecting new data?
    collecting: true,

    // are we archiving? or temporarily paused
    archiving: true,
    archiveURLBase: "http://127.0.0.1:3210/pwebarc/dump",

    // problematic options
    markProblematicCanceled: false,
    markProblematicNoResponse: true,
    markProblematicIncomplete: true,
    markProblematicIncompleteFC: false,

    // collection options
    archivePartialRequest: true,
    archiveNoResponse: false,
    archiveIncompleteResponse: false,

    root: {
        collecting: true,
        limbo: false,
        profile: "default",
    },

    extension: {
        collecting: false,
        limbo: false,
        profile: "extension",
    },

    background: {
        collecting: true,
        limbo: false,
        profile: "background",
    },
};

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
    if (tabId === undefined) // root tab
        return prefillChildren(config.root);
    else if (tabId == -1) // background process
        return prefillChildren(config.background);

    let tabcfg = tabConfig.get(tabId);
    if (tabcfg === undefined) {
        tabcfg = prefillChildren(config.root);
        tabConfig.set(tabId, tabcfg);
    }
    return tabcfg;
}

function processNewTab(tabId, openerTabId) {
    openTabs.add(tabId);

    if (useDebugger && openerTabId === undefined && negateOpenerTabIds.length > 0) {
        // On Chromium, `browser.tabs.create` with `openerTabId` specified
        // does not pass it into `openerTabId` variable here (it's a bug), so
        // we have to work around it by using `negateOpenerTabIds` variable.
        openerTabId = negateOpenerTabIds.shift();
    }

    let openercfg = getOriginConfig(openerTabId);
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
    // forget problematic reqres in closed tabs
    let numProblematicBefore = reqresProblematicLog.length;
    reqresProblematicLog = reqresProblematicLog.filter((e) => openTabs.has(e.tabId));

    // TODO similar reqresLimbo cleanup goes here

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
    for (let v of reqresProblematicLog)
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

    return reqresProblematicLog.length != numProblematicBefore;
}

function processRemoveTab(tabId) {
    openTabs.delete(tabId);
    updateDisplay(cleanupTabs(), true);
}

// browserAction state
let oldIcon = null;
let oldTitle = null;
let oldBadge = null;

// archiving state
// reqres means "request + response"

// requests in-flight, indexed by requestId
let reqresInFlight = new Map();
// requests that are "completed" by the browser, but might have an unfinished filterResponseData filter
let reqresFinishingUp = [];
// completely finished requests
let reqresAlmostDone = [];
// total numbers of picked and dropped reqres
let reqresPickedTotal = 0;
let reqresDroppedTotal = 0;
// requests in limbo, waiting to be either dropped or queued for archival
let reqresLimbo = [];
// total numbers of collected and discarded reqres
let reqresCollectedTotal = 0;
let reqresDiscardedTotal = 0;
// requests in the process of being archived
let reqresQueue = [];
// total number requests archived
let reqresArchivedTotal = 0;
// failed requests, indexed by archiveURL
let reqresFailed = new Map();

// request log
let reqresLog = [];
// log of problematic reqres
let reqresProblematicLog = [];

function getInFlightLog() {
    let res = [];
    for (let v of reqresAlmostDone) {
        res.push(shallowCopyOfReqres(v));
    }
    for (let [k, v] of reqresInFlight.entries()) {
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

// per-tab state
let tabState = new Map();

function getOriginStats(tabId, fromExtension) {
    // NB: not tracking extensions separately here, unlike with configs
    if (fromExtension || tabId === undefined)
        tabId = -1;

    let res = tabState.get(tabId);
    if (res === undefined) {
        res = {
            problematicTotal: 0,
            pickedTotal: 0,
            droppedTotal: 0,
            inLimboTotal: 0,
            collectedTotal: 0,
            discardedTotal: 0,
        };
        tabState.set(tabId, res);
    }
    return res;
}

// should we notify the user when the queues get empty? this flag is here so
// that the user won't get notified on extension start, only after some work
// was done
let reqresNotifyEmpty = false;
// have we notified the user yet?
let reqresNotifiedEmpty = false;

// timeout ID
let finishingUpTID = null;
let endgameTID = null;
let reqresNotifyTID = null;
let reqresRetryTID = null;
let saveConfigTID = null;

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

    let unarchived = in_flight + reqresLimbo.length + reqresQueue.length + archive_failed;

    return {
        version: manifest.version,
        in_flight,
        problematic: reqresProblematicLog.length,
        picked: reqresPickedTotal,
        dropped: reqresDroppedTotal,
        in_limbo: reqresLimbo.length,
        in_queue: reqresQueue.length,
        collected: reqresCollectedTotal,
        discarded: reqresDiscardedTotal,
        archive_ok: reqresArchivedTotal,
        archive_failed,
        unarchived,
    };
}

// Produce a value similar to that of `getStats`, but for a single tab.
// Used in the UI.
function getTabStats(tabId) {
    if (tabId === undefined)
        tabId = -1;

    let info = tabState.get(tabId);

    if (info === undefined)
        return {
            in_flight: 0,
            problematic: 0,
            picked: 0,
            dropped: 0,
            in_limbo: 0,
            collected: 0,
            discarded: 0,
        };

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
        collected: info.collectedTotal,
        discarded: info.discardedTotal,
    };
}

function forgetHistory(tabId) {
    if (tabId === undefined) {
        reqresLog = [];
        reqresCollectedTotal = 0;
        reqresDiscardedTotal = 0;
        for (let info of tabState.values()) {
            info.collectedTotal = 0;
            info.discardedTotal = 0;
        }
    } else {
        reqresLog = reqresLog.filter((e) => e.tabId != tabId);
        let info = getOriginStats(tabId);
        reqresCollectedTotal -= info.collectedTotal;
        reqresDiscardedTotal -= info.discardedTotal;
        info.collectedTotal = 0;
        info.discardedTotal = 0;
    }
    broadcast(["resetLog", reqresLog]);
    updateDisplay(true, false, tabId);
}

function forgetProblematic(tabId) {
    if (tabId === undefined) {
        reqresProblematicLog = [];
        for (let info of tabState.values())
            info.problematicTotal = 0;
    } else {
        reqresProblematicLog = reqresProblematicLog.filter((e) => e.tabId != tabId);
        let info = getOriginStats(tabId);
        info.problematicTotal = 0;
    }
    broadcast(["resetProblematicLog", reqresProblematicLog]);
    updateDisplay(true, false, tabId);
}

function updateDisplay(statsChanged, switchedTab, updatedTabId) {
    let stats = getStats();

    let newIcon;
    if (stats.archive_failed > 0)
        newIcon = "error";
    else if (stats.problematic > 0)
        newIcon = "error";
    else if (stats.in_limbo > 0)
        newIcon = "archiving";
    else if (stats.in_queue > 0)
        newIcon = "archiving";
    else if (stats.in_flight > 0)
        newIcon = "tracking";
    else if (!config.collecting)
        newIcon = "off";
    else
        newIcon = "idle";

    let chunks = [];
    if (stats.archive_failed > 0)
        chunks.push(`failed to archive ${stats.archive_failed} reqres`);
    if (stats.in_limbo > 0)
        chunks.push(`have ${stats.in_limbo} reqres in limbo`);
    if (stats.in_queue > 0)
        chunks.push(`have ${stats.in_queue} reqres more to archive`);
    if (stats.in_flight > 0)
        chunks.push(`still tracking ${stats.in_flight} reqres`);
    if (!config.archiving)
        chunks.push("not archiving");
    if (!config.collecting)
        chunks.push("off");

    let newTitle = "pWebArc: idle";
    if (chunks.length != 0)
        newTitle = "pWebArc: " + chunks.join(", ");

    let newBadge = "";
    if (stats.unarchived > 0)
        newBadge = stats.unarchived.toString();
    if (stats.problematic > 0) {
        newBadge += "!";
        newTitle += `, ${stats.problematic} problematic reqres`
    }

    let changed = switchedTab;
    if (oldIcon !== newIcon || oldTitle != newTitle || oldBadge !== newBadge) {
        changed = true;
        oldIcon = newIcon;
        oldTitle = newTitle;
        oldBadge = newBadge;
        if (config.debugging)
            console.log("updated browserAction", oldIcon, oldTitle, oldBadge);
    }

    if (changed || updatedTabId !== undefined) {
        async function updateBrowserAction() {
            let tabs = await browser.tabs.query({ active: true });

            await browser.browserAction.setBadgeText({ text: newBadge });

            for (let tab of tabs) {
                let tabId = getStateTabIdOrTabId(tab);

                // skip updates for unchanged tabs, when specified
                if (!changed && updatedTabId !== undefined && updatedTabId != tabId)
                    continue;

                let tabcfg = getOriginConfig(tabId);

                let icon = newIcon;
                let title = newTitle;
                let tchunks = [];

                let info = tabState.get(tabId);
                if (info !== undefined && info.problematicTotal > 0)
                    tchunks.push(`${info.problematicTotal} problematic reqres`);

                if (!tabcfg.collecting) {
                    if (icon == "idle")
                        icon = "off";
                    tchunks.push("disabled");
                } else if (tabcfg.limbo) {
                    if (icon == "idle")
                        icon = "archiving";
                    tchunks.push("limbo mode");
                }

                if (tchunks.length != 0)
                    title += "; this tab: " + tchunks.join(", ");

                if (useDebugger) {
                    // Chromium does not support per-window browserActions, so we have to update them per-tab.
                    await browser.browserAction.setIcon({ tabId: tab.id, path: mkIcons(icon) });
                    await browser.browserAction.setTitle({ tabId: tab.id, title });
                } else {
                    let windowId = tab.windowId;
                    await browser.browserAction.setIcon({ windowId, path: mkIcons(icon) });
                    await browser.browserAction.setTitle({ windowId, title });
                }
            }
        }

        updateBrowserAction().catch(logError);
    }

    if (statsChanged)
        broadcast(["updateStats", stats]);
}

// schedule processFinishingUp
function scheduleFinishingUp() {
    if (finishingUpTID !== null)
        clearTimeout(finishingUpTID);

    finishingUpTID = setTimeout(() => {
        finishingUpTID = null;
        processFinishingUp();
    }, 1);
}

// schedule processArchiving and processAlmostDone
function scheduleEndgame() {
    if (endgameTID !== null)
        clearTimeout(endgameTID);

    if (config.archiving && reqresQueue.length > 0
        || reqresAlmostDone.length == 0)
        endgameTID = setTimeout(() => {
            endgameTID = null;
            processArchiving();
        }, 1);
    else if (reqresAlmostDone.length > 0)
        endgameTID = setTimeout(() => {
            endgameTID = null;
            processAlmostDone();
        }, 1);
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

function retryFailedArchive(archiveURL) {
    let failed = reqresFailed.get(archiveURL);
    if (failed === undefined)
        return false;
    reqresFailed.delete(archiveURL);
    for (let e of failed.queue) {
        reqresQueue.push(e);
    }
    return true;
}

function retryAllFailedArchives() {
    // we don't just delete items from reqresFailed here, because
    // allok depends on knowing this archiveURL was broken before; they will
    // be cleaned up in allok via retryFailedArchive, and then the rest
    // will be cleaned up after reqresQueue gets empty again in
    // (noteCleanupArchiving)
    for (let [archiveURL, failed] of reqresFailed.entries()) {
        for (let e of failed.queue) {
            reqresQueue.push(e);
        }
        failed.queue = [];
    }
}

function cancelRetryAll() {
    if (reqresRetryTID !== null)
        clearTimeout(reqresRetryTID);
}

function retryAllFailedArchivesIn(msec) {
    cancelRetryAll();

    reqresRetryTID = setTimeout(() => {
        reqresRetryTID = null;
        retryAllFailedArchives();
        updateDisplay(true, false);
        scheduleEndgame();
    }, msec);
}

function processArchiving() {
    if (!config.archiving) {
        updateDisplay(false, false);
        return;
    }

    if (reqresQueue.length > 0) {
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
            updateDisplay(true, false);
            scheduleEndgame();
            return;
        }

        function broken(reason) {
            let failed = markArchiveAsFailed(archiveURL, Date.now(), reason);
            failed.queue.push(archivable);

            reqresNotifyEmpty = true;
            reqresNotifiedEmpty = false; // force another archivingOK notification later

            broadcast(["newFailed", [shallow]]);
            updateDisplay(true, false);

            scheduleEndgame();
        }

        function allok() {
            let previouslyBroken = retryFailedArchive(archiveURL);

            reqresArchivedTotal += 1;
            reqresNotifyEmpty = true;

            broadcast(["newArchived", [shallow]]);
            updateDisplay(true, false);

            if (previouslyBroken) {
                // clear all-ok notification
                browser.notifications.clear("archivingOK");
                // notify about it being fixed
                browser.notifications.create(`archiving-${archiveURL}`, {
                    title: "pWebArc: WORKING",
                    message: `Now archiving reqres via ${archiveURL}`,
                    iconUrl: iconURL("archiving", 128),
                    type: "basic",
                });
            }

            scheduleEndgame();
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
    } else if (reqresFailed.size > 0) {
        // (noteCleanupArchiving): cleanup empty reqresFailed
        // entries; usually, this does nothing, but it is needed in case the
        // user changed settings, making some of the archiveURLs obsolete
        for (let [archiveURL, failed] of Array.from(reqresFailed.entries())) {
            if (failed.queue.length == 0)
                reqresFailed.delete(archiveURL);
        }

        updateDisplay(cleanupTabs(), false);

        if (reqresFailed.size == 0) {
            // nothing else to do in this branch, try again
            scheduleEndgame();
            return;
        }

        // retry archiving everything in 60s
        retryAllFailedArchivesIn(60000);

        // and show a message per broken archiveURL
        if (reqresNotifyTID !== null)
            clearTimeout(reqresNotifyTID);

        reqresNotifyTID = setTimeout(() => {
            reqresNotifyTID = null;
            if (reqresFailed.size === 0)
                // failed elements were cleared while we slept, nothing to do
                return;

            browser.notifications.clear("archivingOK");
            for (let [archiveURL, failed] of reqresFailed.entries()) {
                browser.notifications.create(`archiving-${archiveURL}`, {
                    title: "pWebArc: FAILED",
                    message: `Failed to archive ${failed.queue.length} items in the queue because ${failed.reason}`,
                    iconUrl: iconURL("error", 128),
                    type: "basic",
                });
            }
        }, 1000);
    } else { // if all queues are empty
        cancelRetryAll();
        updateDisplay(cleanupTabs(), false);

        if (reqresNotifyEmpty && !reqresNotifiedEmpty) {
            reqresNotifiedEmpty = true;
            for (let archiveURL of reqresFailed.keys()) {
                browser.notifications.clear(`archiving-${archiveURL}`);
            }
            browser.notifications.create("archivingOK", {
                title: "pWebArc: OK",
                message: "Archiving appears to work OK!\nThis message won't be repeated unless something breaks.",
                iconUrl: iconURL("idle", 128),
                type: "basic",
            });
        }
    }
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

function processFinishedReqres(info, collect, shallow, dump, do_broadcast) {
    shallow.collected = collect;

    if (collect) {
        reqresQueue.push([shallow, dump]);
        reqresCollectedTotal += 1;
        info.collectedTotal += 1;
    } else {
        reqresDiscardedTotal += 1;
        info.discardedTotal += 1;
    }

    reqresLog.push(shallow);
    while (reqresLog.length > config.history)
        reqresLog.shift();

    if (do_broadcast !== false)
        broadcast(["newLog", [shallow], true]);
}

function popInLimbo(collect, num, tabId) {
    if (reqresLimbo.length == 0)
        return;

    let info = undefined;
    if (tabId !== undefined)
        info = getOriginStats(tabId);

    let popped = [];
    let skipped = [];
    let limboLog = [];
    for (let el of reqresLimbo) {
        let [shallow, dump] = el;

        if (num !== null && popped.length >= num) {
            skipped.push(el);
            limboLog.push(shallow);
            continue;
        }

        if (tabId === undefined || shallow.tabId == tabId) {
            processFinishedReqres(info, collect, shallow, dump, false);
            popped.push(shallow);
        } else {
            skipped.push(el);
            limboLog.push(shallow);
        }
    }

    if (popped.length > 0) {
        reqresLimbo = skipped;
        if (tabId !== undefined)
            info.inLimboTotal -= popped.length;
        cleanupTabs();
        broadcast(["newLog", popped, false]);
        updateDisplay(true, false);
    }

    scheduleEndgame();
}

function processAlmostDone() {
    let updatedTabId = undefined;

    if (reqresAlmostDone.length > 0) {
        let reqres = reqresAlmostDone.shift()
        if (reqres.tabId === undefined)
            reqres.tabId = -1;

        updatedTabId = reqres.tabId;

        let options = getOriginConfig(updatedTabId, reqres.fromExtension);
        let info = getOriginStats(updatedTabId, reqres.fromExtension);

        let state = "complete";
        let problematic = false;
        let collect = true;

        if (!reqres.sent) {
            // it failed somewhere before handleSendHeaders
            state = "canceled";
            problematic = config.markProblematicCanceled;
            collect = false;
        } else if (reqres.responseTimeStamp === undefined) {
            // no response after sending headers
            state = "no_response";
            problematic = config.markProblematicNoResponse;
            collect = config.archiveNoResponse;
            // filter.onstop might have set it to true
            reqres.responseComplete = false;
        } else if (!reqres.responseComplete) {
            state = "incomplete";
            problematic = config.markProblematicIncomplete;
            collect = config.archiveIncompleteResponse;
        } else if (reqres.statusCode === 200 && reqres.fromCache && reqres.responseHeaders !== undefined) {
            let clength = getHeaderValue(reqres.responseHeaders, "Content-Length")
            if (clength !== undefined && clength != 0 && reqres.responseBody.byteLength == 0) {
                // Under Firefox, filterResponseData filters will get empty response data for some
                // cached objects. We use a special state for these, as this is not really an error,
                // and reloading the page will not help in archiving that data, as those requests
                // will be answered from cache again. (But reloading the page with cache disabled
                // with Control+F5 will.)
                state = "incomplete_fc";
                problematic = config.markProblematicIncompleteFC;
                collect = config.archiveIncompleteResponse;
                // filter.onstop will have set it to true
                reqres.responseComplete = false;
            } else
                state = "complete_fc";
        } else if (reqres.fromCache)
            state = "complete_fc";

        if (collect && !reqres.requestComplete)
            // requestBody recovered from formData
            collect = config.archivePartialRequest;

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
            if (reqres.requestHeaders !== undefined && getHeaderValue(reqres.requestHeaders, ":authority") !== undefined)
                reqres.protocol = "HTTP/2.0";
            else if (lineProtocol !== undefined)
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
            console.log(collect ? "PICKED" : "DROPPED", reqres.requestId,
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
        shallow.problematic = problematic;
        shallow.picked = collect;

        if (problematic) {
            reqresProblematicLog.push(shallow);
            info.problematicTotal += 1;
        }

        if (collect) {
            reqresPickedTotal += 1;
            info.pickedTotal += 1;
        } else {
            reqresDroppedTotal += 1;
            info.droppedTotal += 1;
        }

        if (collect) {
            let dump = renderReqres(reqres);

            if (config.dumping)
                dumpToConsole(dump);

            if (options.limbo) {
                reqresLimbo.push([shallow, dump]);
                info.inLimboTotal += 1;
                broadcast(["newLimbo", [shallow]]);
            } else
                processFinishedReqres(info, true, shallow, dump);
        } else
            processFinishedReqres(info, false, shallow, undefined);
    }

    updateDisplay(true, false, updatedTabId);
    scheduleEndgame();
}

function stopAllInFlight(tabId) {
    for (let [requestId, reqres] of Array.from(reqresInFlight.entries())) {
        if (tabId === undefined || reqres.tabId == tabId)
            emitRequest(requestId, reqres, "webRequest::pWebArc::EMIT_FORCED_BY_USER", true);
    }
    if (useDebugger)
        forceEmitAllDebug(tabId);
    forceFinishingUp();
    updateDisplay(true, false);
    scheduleEndgame();
}

// flush reqresFinishingUp into the reqresAlmostDone, interrupting filters
function forceFinishingUpSimple() {
    for (let reqres of reqresFinishingUp) {
        // disconnect the filter, if not disconnected already
        if (reqres.filter !== undefined) {
            try {
                reqres.filter.disconnect()
            } catch (e) {
                //ignore
            }
            delete reqres["filter"];
        }

        reqresAlmostDone.push(reqres);
    }

    reqresFinishingUp = [];
}

let forceFinishingUp = forceFinishingUpSimple;
if (useDebugger)
    forceFinishingUp = forceFinishingUpDebug;

// wait up for reqres filters to finish
function processFinishingUpSimple() {
    if (reqresFinishingUp.length > 0) {
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
    }

    updateDisplay(true, false);
    scheduleEndgame();
}

let processFinishingUp = processFinishingUpSimple;
if (useDebugger)
    processFinishingUp = processFinishingUpDebug;

function importantError(error) {
    if (useDebugger && (error === "webRequest::net::ERR_ABORTED"
                     || error === "webRequest::net::ERR_BLOCKED_BY_CLIENT"
                     || error === "debugger::net::ERR_ABORTED"
                     || error === "debugger::net::ERR_CANCELED"
                     || error === "debugger::pWebArc::EMIT_FORCED_BY_USER"
                     || error.startsWith("debugger::net::ERR_BLOCKED::")))
        // Chromium
        return false;
    else if (!useDebugger && (error === "webRequest::NS_ERROR_ABORT"
                           || error === "webRequest::pWebArc::EMIT_FORCED_BY_USER"
                           || error === "filterResponseData::Channel redirected"))
        // Firefox
        return false;
    return true;
}

function emitRequest(requestId, reqres, error, dontFinishUp) {
    reqresInFlight.delete(requestId);

    reqres.emitTimeStamp = Date.now();

    if (reqres.formData !== undefined) {
        // recover requestBody from formData
        let contentType = getHeaderValue(reqres.requestHeaders, "Content-Type") || "";
        let parts = contentType.split("; ");
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
        if (importantError(error))
            console.error("emitRequest", requestId, "error", error, reqres);
        reqres.errors.push(error);
    }

    reqresFinishingUp.push(reqres);
    if (!dontFinishUp)
        processFinishingUp();
}

function logRequest(rtype, e) {
    if (config.debugging)
        console.log("webRequest", e.requestId, rtype, e.timeStamp, e.tabId, e.method, e.url, e.statusCode, e.statusLine, e);
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

function handleBeforeRequest(e) {
    // don't do anything if we are globally disabled
    if (!config.collecting) return;

    // ignore data and file URLs
    if (e.url.startsWith("data:") // Firefox and Chromium
        || e.url.startsWith("file:")) // only Chromium, Firefox does not emit those
        return;

    // ignore requests to extension pages
    if (e.url.startsWith("moz-extension://") // Firefox
        || e.url.startsWith("chrome-extension://")) // Chromium
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
        if (initiator.startsWith("moz-extension://") // Firefox
            || initiator.startsWith("chrome-extension://")) // Chromium
            fromExtension = true;
    }

    // ignore this request if archiving is disabled for this tab or extension
    let options = getOriginConfig(e.tabId, fromExtension);
    if (!options.collecting) return;

    // on Chromium, cancel all network requests from tabs that are not
    // yet debugged, start debugging, and then reload the tab
    if (useDebugger && e.tabId !== -1 && !tabsDebugging.has(e.tabId)
        && (e.url.startsWith("http://") || e.url.startsWith("https://"))) {
        console.log("canceling request to", e.url, "as tab", e.tabId, "is not managed yet", e);
        attachDebuggerAndReloadIn(e.tabId, 1000);
        return { cancel: true };
    }

    logRequest("before request", e);

    let requestId = e.requestId;
    let reqres = {
        requestId: requestId,
        tabId: e.tabId,
        fromExtension,

        method: e.method,
        url: e.url,

        errors: [],

        requestTimeStamp: e.timeStamp,
        requestComplete: true,
        requestBody: new ChunkedBuffer(),

        sent: false,

        fromCache: false,
        responseComplete: false,
        responseBody: new ChunkedBuffer(),
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
                if (importantError(error))
                    console.error("filterResponseData", requestId, "error", error);
                reqres.errors.push(error);
            }
            scheduleFinishingUp(); // in case we were waiting for this filter
        };

        reqres.filter = filter;
    }

    reqresInFlight.set(requestId, reqres);
    broadcast(["newInFlight", [shallowCopyOfReqres(reqres)]]);
    updateDisplay(true, false);
}

function handleBeforeSendHeaders(e) {
    let reqres = reqresInFlight.get(e.requestId);
    if (reqres === undefined) return;

    logRequest("before send headers", e);
}

function handleSendHeaders(e) {
    let reqres = reqresInFlight.get(e.requestId);
    if (reqres === undefined) return;

    logRequest("send headers", e);
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

    logRequest("headers recieved", e);

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

    logRequest("before redirect", e);

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

    logRequest("auth required", e);

    // similarly to above
    let creqres = completedCopyOfReqres(reqres);
    emitRequest(e.requestId, creqres);

    // after this it will goto back to handleBeforeSendHeaders, so
    reqresInFlight.set(e.requestId, reqres);
}

function handleCompleted(e) {
    let reqres = reqresInFlight.get(e.requestId);
    if (reqres === undefined) return;

    logRequest("completed", e);
    emitRequest(e.requestId, reqres);
}

function handleErrorOccurred(e) {
    let reqres = reqresInFlight.get(e.requestId);
    if (reqres === undefined) return;

    logRequest("error", e);
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
    if (config.debugging)
        console.log("tab activated", e.tabId);
    if (useDebugger)
        // Chromium does not provide `browser.menus.onShown` event
        updateMenu(e.tabId);
    // This will do nothing on Chromium, see handleTabUpdatedChromium
    updateDisplay(false, true);
}

function handleTabUpdatedChromium(tabId, changeInfo, tabInfo) {
    if (config.debugging)
        console.log("tab updated", tabId);
    // Chromium resets the browserAction icon when tab chages state, so we
    // have to update icons after each one
    updateDisplay(false, true);
}

// open client tab ports
let openPorts = new Map();

function broadcast(data) {
    if (config.debugging)
        console.log("broadcasting", data);

    for (let [portId, port] of openPorts.entries()) {
        port.postMessage(data);
    }
}

function handleConnect(port) {
    //console.log("new port", port);
    openPorts.set(port.sender.contextId, port);
    port.onDisconnect.addListener((p) => {
        //console.log("del port", port);
        openPorts.delete(port.sender.contextId);
    });
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
        config = request[1];
        updateDisplay(false, false);

        if (oldconfig.archiving !== config.archiving) {
            if (!config.archiving) {
                cancelRetryAll();

                // clear all notifications
                browser.notifications.clear("archivingOK");
                for (let archiveURL of reqresFailed.keys()) {
                    browser.notifications.clear(`archiving-${archiveURL}`);
                }
            } else {
                // retry in 1s
                retryAllFailedArchivesIn(1000);
            }
        }

        if (useDebugger)
            syncDebuggersState();

        // save config in 2s to give the user some time to change more settings
        let eConfig = assignRec({ version: configVersion }, config);

        if (saveConfigTID !== null)
            clearTimeout(saveConfigTID);

        saveConfigTID = setTimeout(() => {
            saveConfigTID = null;
            console.log("saving config", eConfig);
            browser.storage.local.set({ config: eConfig }).catch(logError);
        }, 500);

        broadcast(["updateConfig"]);
        sendResponse(null);
        break;
    case "getOriginConfig":
        sendResponse(getOriginConfig(request[1]));
        break;
    case "setTabConfig":
        tabConfig.set(request[1], request[2]);
        if (useDebugger)
            // Chromium does not provide `browser.menus.onShown` event
            updateMenu(request[1]);
        if (useDebugger)
            syncDebuggersState();
        broadcast(["updateTabConfig", request[1], request[2]]);
        updateDisplay(false, true);
        sendResponse(null);
        break;
    case "retryAllFailedArchives":
        retryAllFailedArchivesIn(100);
        sendResponse(null);
        break;
    case "getStats":
        sendResponse(getStats());
        break;
    case "getTabStats":
        sendResponse(getTabStats(request[1]));
        break;
    case "getLog":
        sendResponse(reqresLog);
        break;
    case "forgetHistory":
        forgetHistory(request[1]);
        sendResponse(null);
        break;
    case "getProblematicLog":
        sendResponse(reqresProblematicLog);
        break;
    case "forgetProblematic":
        forgetProblematic(request[1]);
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
        popInLimbo(request[1], request[2], request[3]);
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
    let tabId = undefined;
    let tabs = await browser.tabs.query({ active: true, currentWindow: true });
    for (let tab of tabs) {
        tabId = getStateTabIdOrTabId(tab);
        break;
    }
    if (tabId === undefined)
        return;

    let tabcfg = undefined;
    switch (command) {
    case "show-tab-state":
        showState(`?tab=${tabId}`, "", tabId);
        return;
    case "toggle-tabconfig-tracking":
        tabcfg = getOriginConfig(tabId);
        tabcfg.collecting = !tabcfg.collecting;
        tabcfg.children.collecting = tabcfg.collecting;
        break;
    case "toggle-tabconfig-children-tracking":
        tabcfg = getOriginConfig(tabId);
        tabcfg.children.collecting = !tabcfg.children.collecting;
        break;
    case "toggle-tabconfig-limbo":
        tabcfg = getOriginConfig(tabId);
        tabcfg.limbo = !tabcfg.limbo;
        tabcfg.children.limbo = tabcfg.limbo;
        break;
    case "toggle-tabconfig-children-limbo":
        tabcfg = getOriginConfig(tabId);
        tabcfg.children.limbo = !tabcfg.children.limbo;
        break;
    case "collect-all-tab-inlimbo":
        popInLimbo(true, null, tabId);
        return;
    case "discard-all-tab-inlimbo":
        popInLimbo(false, null, tabId);
        return;
    default:
        console.error(`unknown command ${command}`);
        return;
    }

    updateDisplay(false, true);
    broadcast(["updateTabConfig", tabId]);
}

async function init(storage) {
    let do_showHelp = false;
    if (storage.config !== undefined) {
        let oldConfig = storage.config;
        function rename(from, to) {
            let old = oldConfig[from];
            delete oldConfig[from];
            oldConfig[to] = old;
        }

        let version = oldConfig.version;
        delete oldConfig["version"];

        // show help when config version changes
        if (version !== configVersion)
            do_showHelp = true;

        if (version == 1) {
            console.log("Using old config version " + version);
            rename("collectPartialRequests", "archivePartialRequest");
            rename("collectNoResponse", "archiveNoResponse");
            rename("collectIncompleteResponses", "archiveIncompleteResponse")
        } else if (version == 2) {
            console.log("Using config version " + version);
        } else {
            console.log("Unknwon old config version " + version);
            oldConfig = undefined;
        }

        config = updateFromRec(config, oldConfig);
    } else
        do_showHelp = true;

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
    updateDisplay(true, true);

    if (useDebugger)
        await initDebugger(tabs);

    browser.commands.onCommand.addListener(catchAllAsync(handleCommand));

    console.log(`initialized pWebArc with source of '${sourceDesc}'`);
    console.log("runtime options are", { useSVGIcons, useBlocking, useDebugger });
    console.log("config is", config);

    if (do_showHelp)
        showHelp();
}

browser.storage.local.get(null).then(init, (error) => init({}));
