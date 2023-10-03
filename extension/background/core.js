/*
 * The core code of pWebArc.
 * And WebRequest-assisted request collection (for Firefox-based browsers).
 *
 * Copyright (c) 2023 Jan Malakhovski <oxij@oxij.org>
 *
 * This file can be distributed under the terms of the GNU GPL, version 3 or later.
 */

"use strict";

let svgIcons = browser.nameVersion.startsWith("Firefox/");

let selfURL = browser.runtime.getURL("/"); // for filtering out our own requests

// for archiving
let sourceDesc = browser.nameVersion + "+pWebArc/" + manifest.version;

function iconPath(name, size) {
    if (svgIcons)
        return `/icon/${name}.svg`;
    else
        return `/icon/${size}/${name}.png`;
}

function mkIcons(what) {
    return {
        128: iconPath(what, 128),
    };
}

// default config
let configVersion = 2;
let config = {
    debugging: false,
    dumping: false,
    history: 1000,

    // are we collecting new data?
    collecting: true,
    archivePartialRequest: true,
    archiveNoResponse: false,
    archiveIncompleteResponse: false,

    // are we archiving? or temporarily paused
    archiving: true,
    archiveURLBase: "http://127.0.0.1:3210/pwebarc/dump",

    root: {
        collecting: true,
        profile: "default",
    },

    extension: {
        collecting: false,
        profile: "extension",
    },

    background: {
        collecting: true,
        profile: "background",
    },
};

// per-tab config
let tabConfig = new Map();
let tabsToDelete = new Set();
let negateConfigFor = new Set();
let negateOpenerTabIds = [];

function prefillChildren(data) {
    return assignRec({
        children: assignRec({}, data),
    }, data);
}

function getTabConfig(tabId, fromExtension) {
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
    if (useDebugger && openerTabId === undefined && negateOpenerTabIds.length > 0) {
        // On Chromium, `browser.tabs.create` with `openerTabId` specified
        // does not pass it into `openerTabId` variable here (it's a bug), so
        // we have to work around it by using `negateOpenerTabIds` variable.
        openerTabId = negateOpenerTabIds.shift();
    }

    let openercfg = getTabConfig(openerTabId);
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
    for (let v of reqresDone)
        usedTabs.add(v.tabId);
    for (let v of reqresArchiving)
        usedTabs.add(v.tabId);
    for (let [k, f] of reqresArchivingFailed.entries())
        for(let v of f.queue)
            usedTabs.add(v.tabId);

    // delete configs of unused tabs
    for (let tabId of Array.from(tabsToDelete.keys())) {
        if(!usedTabs.has(tabId)) {
            console.log("removing config of tab", tabId);
            tabConfig.delete(tabId);
            tabsToDelete.delete(tabId);
        }
    }
}

function processRemoveTab(tabId) {
    tabsToDelete.add(tabId);
    cleanupTabs();
}

// browserAction state
let oldIcon = null;
let oldBadge = null;

// archiving state
// reqres means "request + response"

// requests in-flight, indexed by requestId
let reqresInFlight = new Map();
// requests that are "completed" by the browser, but might have an unfinished filterResponseData filter
let reqresFinishingUp = [];
// completely finished requests
let reqresDone = [];
// total number of failed requests
let reqresFailedTotal = 0;
// requests in the process of being archived
let reqresArchiving = [];
// total number requests archived
let reqresArchivedTotal = 0;
// failed requests, indexed by archiveURL
let reqresArchivingFailed = new Map();

function clearStats() {
    reqresFailedTotal = 0;
    reqresArchivedTotal = 0;
}

// request log
let reqresLog = [];

function clearLog() {
    reqresLog = [];
}

// should we notify the user when the queues get empty? this flag is here so
// that the user won't get notified on extension start, only after some work
// was done
let reqresNotifyEmpty = false;
// have we notified the user yet?
let reqresNotifiedEmpty = false;

// timeout ID
let reqresNotifyTID = null;
let reqresRetryTID = null;
let saveConfigTID = null;

// produce stats of all the queues
function getStats() {
    let fails = 0;
    for (let [archiveURL, f] of reqresArchivingFailed.entries()) {
        fails += f.queue.length;
    }

    return {
        archived: reqresArchivedTotal,
        queued: reqresArchiving.length + reqresDone.length,
        inflight: Math.max(reqresInFlight.size, debugReqresInFlight.size) +
            Math.max(reqresFinishingUp.length, debugReqresFinishingUp.length),
        failedToArchive: fails,
        failedToFetch: reqresFailedTotal,
    };
}

function setIcons(tabChanged) {
    let stats = getStats();
    let todo = stats.queued + stats.failedToArchive;
    let total = stats.inflight + todo;

    let newIcon;
    let state;
    if (stats.failedToArchive > 0) {
        newIcon = "error";
        state = `have ${todo} reqres to archive, failed to archive ${stats.failedToArchive} reqres`;
        if (!config.archiving)
            state += ", not archiving";
    } else if (stats.queued > 0) {
        newIcon = "archiving";
        state = `have ${todo} reqres to archive`;
        if (!config.archiving)
            state += ", not archiving";
    } else if (stats.inflight > 0) {
        newIcon = "tracking";
        state = `still tracking ${stats.inflight} reqres`;
        if (!config.archiving)
            state += ", not archiving";
    } else if (!config.collecting) {
        newIcon = "off";
        state = "off";
    } else {
        newIcon = "idle";
        state = "all good, all queues empty";
    }

    let newTitle = `pWebArc: ${state}`;
    let newBadge = "";
    if (total > 0)
        newBadge = total.toString();

    if (tabChanged || oldIcon !== newIcon || oldBadge !== newBadge) {
        if (config.debugging)
            console.log("new badge", newIcon, newBadge);

        oldIcon = newIcon;
        oldBadge = newBadge;

        async function updateBrowserAction() {
            let tabs = await browser.tabs.query({ active: true }).catch(logError);

            await browser.browserAction.setBadgeText({ text: newBadge }).catch(logError);

            for (let tab of tabs) {
                let tabcfg = getTabConfig(tab.id);

                let icon = newIcon;
                let title = newTitle;
                if (newIcon == "idle" && !tabcfg.collecting) {
                    icon = "off";
                    title += ", disabled in this tab";
                }

                if (useDebugger) {
                    // Chromium does not support per-window browserActions, so
                    // we have to update per-tab, this is inefficient
                    let tabId = tab.id;
                    await browser.browserAction.setIcon({ tabId, path: mkIcons(icon) }).catch(logError);
                    await browser.browserAction.setTitle({ tabId, title }).catch(logError);
                } else {
                    let windowId = tab.windowId;
                    await browser.browserAction.setIcon({ windowId, path: mkIcons(icon) }).catch(logError);
                    await browser.browserAction.setTitle({ windowId, title }).catch(logError);
                }
            }
        }

        updateBrowserAction();
    }

    broadcast(["updateStats", stats]);
}

// mark this archiveURL as failing
function markArchiveAsFailed(archiveURL, when, reason) {
    let v = reqresArchivingFailed.get(archiveURL);
    if (v === undefined) {
        v = {
            when,
            reason,
            queue: [],
        };
        reqresArchivingFailed.set(archiveURL, v);
    } else {
        v.when = when;
        v.reason = reason;
    }

    return v;
}

function retryFailedArchive(archiveURL) {
    let failed = reqresArchivingFailed.get(archiveURL);
    if (failed === undefined)
        return false;
    reqresArchivingFailed.delete(archiveURL);
    for (let e of failed.queue) {
        reqresArchiving.push(e);
    }
    return true;
}

function retryAllFailedArchives() {
    // we don't just delete items from reqresArchivingFailed here, because
    // allok depends on knowing this archiveURL was broken before; they will
    // be cleaned up in allok via retryFailedArchive, and then the rest
    // will be cleaned up after reqresArchiving gets empty again in
    // (noteCleanupArchiving)
    for (let [archiveURL, failed] of reqresArchivingFailed.entries()) {
        for (let e of failed.queue) {
            reqresArchiving.push(e);
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
        setIcons();
        setTimeout(processArchiving, 1);
    }, msec);
}

function processArchiving() {
    if (!config.archiving) {
        setIcons();
        return;
    }

    if (reqresArchiving.length > 0) {
        let archivable = reqresArchiving.shift();
        let reqres = archivable.reqres;
        let options = getTabConfig(reqres.tabId, reqres.fromExtension);
        let archiveURL = config.archiveURLBase + "?profile=" + encodeURIComponent(options.profile);

        let failed = reqresArchivingFailed.get(archiveURL);
        if (failed !== undefined && (Date.now() - failed.when) < 1000) {
            // this archiveURL is marked broken, and we just had a failure there, fail this reqres immediately
            failed.queue.push(archivable);
            setIcons();
            setTimeout(processArchiving, 1);
            return;
        }

        function broken(reason) {
            let failed = markArchiveAsFailed(archiveURL, Date.now(), reason);
            failed.queue.push(archivable);
            reqresNotifyEmpty = true;
            reqresNotifiedEmpty = false; // force another archivingOK notification later
            setIcons();
            setTimeout(processArchiving, 1);
        }

        function allok() {
            reqres.archivedToProfile = options.profile;

            let previouslyBroken = retryFailedArchive(archiveURL);
            reqresArchivedTotal += 1;
            reqresNotifyEmpty = true;
            setIcons();

            if (!previouslyBroken) {
                setTimeout(processArchiving, 1);
                return;
            }

            // clear all-ok notification
            browser.notifications.clear("archivingOK");
            // notify about it being fixed
            browser.notifications.create(`archiving-${archiveURL}`, {
                title: "pWebArc is working OK",
                message: `with the archive at\n${archiveURL}`,
                iconUrl: browser.runtime.getURL(iconPath("archiving", 128)),
                type: "basic",
            });

            setTimeout(processArchiving, 1);
        }

        if (config.debugging)
            console.log("trying to archive", reqres);

        const req = new XMLHttpRequest();
        req.open("POST", archiveURL, true);
        req.responseType = "text";
        req.setRequestHeader("Content-Type", "application/cbor");
        req.onabort = (event) => {
            //console.log("archiving aborted", event);
            broken(`request to \n${archiveURL}\n was aborted`);
        }
        req.onerror = (event) => {
            //console.log("archiving error", event);
            broken(`it can't establish a connection to the archive at\n${archiveURL}`);
        }
        req.onload = (event) => {
            //console.log("archiving loaded", event);
            if (req.status == 200)
                allok();
            else
                broken(`requests to\n${archiveURL}\nfail with:\n${req.status} ${req.statusText}: ${req.responseText}`);
        };
        req.send(archivable.data);
    } else if (reqresArchivingFailed.size > 0) {
        // (noteCleanupArchiving): cleanup empty reqresArchivingFailed
        // entries; usually, this does nothing, but it is needed in case the
        // user changed settings, making some of the archiveURLs obsolete
        for (let [archiveURL, failed] of Array.from(reqresArchivingFailed.entries())) {
            if (failed.queue.length == 0)
                reqresArchivingFailed.delete(archiveURL);
        }

        setIcons();
        cleanupTabs();

        if (reqresArchivingFailed.size == 0) {
            // nothing else to do in this branch, try again
            setTimeout(processArchiving, 1);
            return;
        }

        // retry archiving everything in 60s
        retryAllFailedArchivesIn(60000);

        // and show a message per broken archiveURL
        if (reqresNotifyTID !== null)
            clearTimeout(reqresNotifyTID);

        reqresNotifyTID = setTimeout(() => {
            reqresNotifyTID = null;
            if (reqresArchivingFailed.size === 0)
                // we got outdated
                return;

            browser.notifications.clear("archivingOK");
            for (let [archiveURL, failed] of reqresArchivingFailed.entries()) {
                browser.notifications.create(`archiving-${archiveURL}`, {
                    title: "pWebArc FAILED",
                    message: `to archive ${failed.queue.length} items in the queue because ${failed.reason}`,
                    iconUrl: browser.runtime.getURL(iconPath("error", 128)),
                    type: "basic",
                });
            }
        }, 1000);
    } else { // if all queues are empty
        cancelRetryAll();
        setIcons();
        cleanupTabs();

        if (reqresNotifyEmpty && !reqresNotifiedEmpty) {
            reqresNotifiedEmpty = true;
            browser.notifications.create("archivingOK", {
                title: "pWebArc is working OK",
                message: "successfully archived everything!\n\nNew archivals won't be reported unless something breaks.",
                iconUrl: browser.runtime.getURL(iconPath("idle", 128)),
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
    if (reqres.responseTimeStamp !== undefined) {
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

    return {
        reqres,
        data: encoder.result(),
    }
}

function processDone() {
    if (reqresDone.length > 0) {
        let reqres = reqresDone.shift()

        if (reqres.responseHeaders !== undefined) {
            let clength = getHeaderValue(reqres.responseHeaders, "Content-Length")
            if (clength !== undefined && clength != 0 && reqres.responseBody.byteLength == 0) {
                // Under Firefox, filterResponseData for cached images receives no
                // response data.
                if (config.debugging)
                    console.log("fake complete reqres", reqres);
                // Let's mark all such things as incomplete.
                reqres.responseComplete = false;
            }
        }

        let state = "complete";
        let archiving = true;
        if (reqres.requestHeaders === undefined) {
            // it failed somewhere before handleSendHeaders
            state = "canceled";
            archiving = false;
        } else if (reqres.responseTimeStamp === undefined) {
            // no response after sending headers
            state = "noresponse";
            archiving = config.archiveNoResponse;
            // filter.onstop might have set it to true
            reqres.responseComplete = false;
        } else if (!reqres.responseComplete) {
            state = "incomplete";
            archiving = config.archiveIncompleteResponse;
        }

        if (archiving && !reqres.requestComplete)
            // requestBody recovered from formData
            archiving = config.archivePartialRequest;

        reqres.archiving = archiving;
        reqres.state = state;

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

        if (config.debugging)
            console.log(archiving ? "QUEUED" : "DISCARDED", reqres.requestId,
                        "state", state,
                        reqres.protocol, reqres.method, reqres.url,
                        "tabId", reqres.tabId,
                        "req", reqres.requestComplete,
                        "res", reqres.responseComplete,
                        "result", reqres.statusCode, reqres.reason, reqres.statusLine,
                        "errors", reqres.errors,
                        reqres);

        if (archiving) {
            let archivable = renderReqres(reqres);
            reqresArchiving.push(archivable);

            if (config.dumping) {
                let dec = new TextDecoder("utf-8", { fatal: false });
                console.log("dump:")
                console.log(dec.decode(archivable.data));
            }
        } else
            reqresFailedTotal += 1;

        if (!config.debugging) {
            // free some memory
            delete reqres["requestHeaders"];
            delete reqres["requestBody"];
            delete reqres["responseHeaders"];
            delete reqres["responseBody"];
        }

        // log it
        reqresLog.push(reqres);
        broadcast(["newReqres", reqres]);
        while (reqresLog.length > config.history)
            reqresLog.shift();
    }

    setIcons();
    if (reqresDone.length > 0)
        setTimeout(processDone, 10);
    else
        setTimeout(processArchiving, 1);
}

function forceFinishRequests() {
    forceEmitAll();
    if (useDebugger)
        forceEmitAllDebug();
    forceFinishingUp();
    setTimeout(processDone, 1);
}

// flush reqresFinishingUp into the reqresDone, interrupting filters
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

        reqresDone.push(reqres);
    }

    reqresFinishingUp = [];
    setIcons();
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
                reqresDone.push(reqres);
                continue;
            }

            let fs = reqres.filter.status;
            if (fs !== "disconnected" && fs !== "closed" && fs !== "failed") {
                // the filter of this reqres is not finished yet
                // try again later
                notFinished.push(reqres);
                continue;
            }

            // the filter is done, remove it
            delete reqres["filter"];
            reqresDone.push(reqres);
        }

        reqresFinishingUp = notFinished;
    }

    setIcons();
    setTimeout(processDone, 1);
}

let processFinishingUp = processFinishingUpSimple;
if (useDebugger)
    processFinishingUp = processFinishingUpDebug;

function forceEmitAll() {
    for (let [requestId, reqres] of Array.from(reqresInFlight.entries())) {
        emitRequest(requestId, reqres, "webRequest::pWebArc::EMIT_FORCED_BY_USER", true);
    }
}

function importantError(error) {
    if (useDebugger && (error === "webRequest::net::ERR_ABORTED"
                     || error === "debugger::net::ERR_ABORTED"))
        // Chromium
        return false;
    else if (!useDebugger && error === "webRequest::NS_ERROR_ABORT")
        // Firefox
        return false;
    return true;
}

function emitRequest(requestId, reqres, error, dontFinishUp) {
    reqresInFlight.delete(requestId);

    reqres.emitTimeStamp = Date.now();
    reqres.requestId = requestId;

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
    let options = getTabConfig(e.tabId, fromExtension);
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

    let reqres = {
        tabId: e.tabId,
        fromExtension,

        method: e.method,
        url: e.url,

        errors: [],

        requestTimeStamp: e.timeStamp,
        requestComplete: true,
        requestBody: new ChunkedBuffer(),

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

    let requestId = e.requestId;

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
            setTimeout(processFinishingUp, 1); // in case we were waiting for this filter
        };
        filter.onerror = (event) => {
            if (filter.error !== "Invalid request ID") {
                // if filter was actually started
                let error = "filterResponseData::" + filter.error;
                if (importantError(error))
                    console.error("filterResponseData", requestId, "error", error);
                reqres.errors.push(error);
            }
            setTimeout(processFinishingUp, 1); // in case we were waiting for this filter
        };

        reqres.filter = filter;
    }

    reqresInFlight.set(requestId, reqres);
    setIcons();
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
    reqres.requestHeaders = e.requestHeaders;
}

function emptyCopyOfReqres(reqres) {
    return {
        tabId: reqres.tabId,

        protocol: reqres.protocol,

        method: reqres.method,
        url: reqres.url,

        documentUrl: reqres.documentUrl,
        originUrl: reqres.originUrl,
        errors: Array.from(reqres.errors),

        requestTimeStamp: reqres.requestTimeStamp,
        requestComplete: reqres.requestComplete,
        requestBody: reqres.requestBody,
        formData: reqres.formData,

        requestHeaders: reqres.requestHeaders,

        responseTimeStamp: reqres.responseTimeStamp,
        statusLine: reqres.statusLine,
        statusCode: reqres.statusCode,
        reason: reqres.reason,
        responseHeaders: reqres.responseHeaders,
        fromCache: reqres.fromCache,

        responseComplete: true,
        responseBody: new ChunkedBuffer(),

        emitTimeStamp: reqres.emitTimeStamp,

        // note we do not copy the filter
    };
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
        let creqres = emptyCopyOfReqres(reqres);
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
    reqres.responseComplete = true;
    emitRequest(e.requestId, reqres);

    // after this it will go back to handleBeforeRequest, so we don't need to
    // copy anything here
}

function handleAuthRequired(e) {
    let reqres = reqresInFlight.get(e.requestId);
    if (reqres === undefined) return;

    logRequest("auth required", e);

    // similarly to above
    let creqres = emptyCopyOfReqres(reqres);
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
    if (reqresArchivingFailed.size === 0) return;

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
    setIcons(true);
}

function handleTabUpdatedChromium(tabId, changeInfo, tabInfo) {
    if (config.debugging)
        console.log("tab updated", tabId);
    // Chromium resets the browserAction icon when tab chages state, so we
    // have to update icons after each one
    setIcons(true);
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
        setIcons();

        if (oldconfig.archiving !== config.archiving) {
            if (!config.archiving) {
                cancelRetryAll();

                // clear all notifications
                browser.notifications.clear("archivingOK");
                for (let archiveURL of reqresArchivingFailed.keys()) {
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
        break;
    case "getTabConfig":
        sendResponse(getTabConfig(request[1]));
        break;
    case "setTabConfig":
        tabConfig.set(request[1], request[2]);
        if (useDebugger)
            // Chromium does not provide `browser.menus.onShown` event
            updateMenu(request[1]);
        setIcons(true);
        if (useDebugger)
            syncDebuggersState();
        broadcast(["updateTabConfig", request[1]]);
        break;
    case "retryAllFailedArchives":
        retryAllFailedArchivesIn(100);
        break;
    case "forceFinishRequests":
        forceFinishRequests();
        break;
    case "getStats":
        sendResponse(getStats());
        break;
    case "clearStats":
        clearStats();
        setIcons();
        break;
    case "clearLog":
        clearLog();
        broadcast(["setLog", []]);
        break;
    case "getLog":
        sendResponse(reqresLog);
        break;
    case "broadcast":
        broadcast(request[1]);
        break;
    default:
        console.log("what?", request);
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
    let cfg = getTabConfig(tabId);
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

async function init(storage) {
    let showHelp = false;
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
            showHelp = true;

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
        showHelp = true;

    if (useBlocking)
        browser.webRequest.onBeforeRequest.addListener(catchAll(handleBeforeRequest), {urls: ["<all_urls>"]}, ["blocking", "requestBody"]);
    else
        browser.webRequest.onBeforeRequest.addListener(catchAll(handleBeforeRequest), {urls: ["<all_urls>"]}, ["requestBody"]);
    browser.webRequest.onBeforeSendHeaders.addListener(catchAll(handleBeforeSendHeaders), {urls: ["<all_urls>"]});
    browser.webRequest.onSendHeaders.addListener(catchAll(handleSendHeaders), {urls: ["<all_urls>"]}, ["requestHeaders"]);
    browser.webRequest.onHeadersReceived.addListener(catchAll(handleHeadersRecieved), {urls: ["<all_urls>"]}, ["responseHeaders"]);
    browser.webRequest.onBeforeRedirect.addListener(catchAll(handleBeforeRedirect), {urls: ["<all_urls>"]});
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

    let tabs = await browser.tabs.query({});
    // compute and cache configs for all open tabs
    for (let tab of tabs) {
        getTabConfig(tab.id);
    }

    browser.runtime.onMessage.addListener(catchAll(handleMessage));
    browser.runtime.onConnect.addListener(catchAll(handleConnect));

    initMenus();
    setIcons();

    if (useDebugger)
        await initDebugger(tabs);

    console.log(`initialized pWebArc with source of '${sourceDesc}'`);
    console.log("runtime options are", { useBlocking, useDebugger });
    console.log("config is", config);

    if (showHelp)
        await browser.tabs.create({
            url: browser.runtime.getURL("/page/help.html"),
        });
}

browser.storage.local.get(null).then(init, (error) => init({}));
