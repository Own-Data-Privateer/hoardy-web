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
 * HTTP request+response capture via `webRequest` and Chromium`s
 * `debugger` APIs.
 */

"use strict";

// Actions

function attachDebugger(tabId) {
    return attachDebuggerWithSendCommands(tabId, "1.3", [["Network.enable", {}]]);
}

async function syncDebuggersState(tabs) {
    if (tabs === undefined)
        tabs = await browser.tabs.query({});

    for (let tab of tabs) {
        let url = getTabURL(tab, "");

        let hasInFlight = false;
        for (let [requestId, dreqres] of debugReqresInFlight.entries()) {
            if (dreqres.tabId == tab.id) {
                hasInFlight = true;
                break;
            }
        }

        let attached = tabsDebugging.has(tab.id);
        let tabcfg = getOriginConfig(tab.id);
        let wantAttached = hasInFlight
            || config.collecting && tabcfg.collecting
               && (url == "about:blank" || url.startsWith("http://") || url.startsWith("https://"));

        if (!attached && wantAttached) {
            await attachDebugger(tab.id).catch(logError);
        } else if (attached && !wantAttached) {
            await detachDebugger(tab.id).catch(logError);
        }
    }
}

async function sleepResetTab(tabId, priority, resetFunc, preFunc, actionFunc) {
    scheduleActionExtra(scheduledInternal, `reset-tab#${tabId}`, priority, 100, true, async () => {
        let r;
        if (resetFunc !== undefined)
            r = await resetFunc(tabId);
        scheduleActionExtra(scheduledInternal, `reload-tab#${tabId}`, priority, 300, true, async () => {
            try {
                if (preFunc !== undefined)
                    await preFunc(tabId);
                if (actionFunc !== undefined)
                    await actionFunc(tabId, r);
            } catch (err) {
                logError(err);
            }
        }, false);
    }, false);
}

function resetAndNavigateTab(tabId, url, priority) {
    return sleepResetTab(tabId, priority,
                         navigateTabToBlank, undefined,
                         (tabId, _ignored) => navigateTabTo(tabId, url));
}

function resetAttachDebuggerAndNavigateTab(tabId, url, priority) {
    return sleepResetTab(tabId, priority,
                         navigateTabToBlank, attachDebugger,
                         (tabId, _ignored) => navigateTabTo(tabId, url));
}

function resetAttachDebuggerAndReloadTab(tabId, priority) {
    return sleepResetTab(tabId, priority,
                         getTabURLThenNavigateTabToBlank, attachDebugger,
                         navigateTabTo);
}

function attachDebuggerAndReloadTab(tabId, priority) {
    return sleepResetTab(tabId, priority,
                         undefined, attachDebugger,
                         browser.tabs.reload);
}

// State

// reqres in-flight, indexed by requestId
let reqresInFlight = new Map();
// debugger's reqres in-flight, indexed by requestId
let debugReqresInFlight = new Map();
// reqres that were "completed" by the webRequest API, but might have unfinished filterResponseData filters
let reqresFinishingUp = [];
// reqres that were "completed" by the debugger
let debugReqresFinishingUp = [];
// completely finished reqres
let reqresAlmostDone = [];

let workaroundFirstRequest = true;

// Logging

function getInFlightLog() {
    let res = [];
    for (let [k, v] of debugReqresInFlight.entries()) {
        // `.url` can be unset, see (veryEarly) in `emitDebugRequest`.
        if (v.url !== undefined && !isBoringOrServerURL(v.url))
            res.push(makeLoggable(v));
    }
    for (let [k, v] of reqresInFlight.entries())
        res.push(makeLoggable(v));
    for (let v of debugReqresFinishingUp)
        res.push(makeLoggable(v));
    for (let v of reqresFinishingUp)
        res.push(makeLoggable(v));
    for (let v of reqresAlmostDone)
        res.push(makeLoggable(v));
    return res;
}

// Reqres data structures

function shallowCopyOfReqres(reqres) {
    return {
        sessionId: reqres.sessionId,
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
        requestBuggy: reqres.requestBuggy,

        submitted: reqres.submitted,
        responded: reqres.responded,

        responseTimeStamp: reqres.responseTimeStamp,
        statusLine: reqres.statusLine,
        statusCode: reqres.statusCode,
        reason: reqres.reason,
        fromCache: reqres.fromCache,
        responseComplete: reqres.responseComplete,
        responseBuggy: reqres.responseBuggy,

        redirectUrl: reqres.redirectUrl,

        emitTimeStamp: reqres.emitTimeStamp,
    };
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

function fillResponse(reqres, e) {
    reqres.responded = true;
    reqres.responseTimeStamp = e.timeStamp;
    reqres.fromCache = e.fromCache;
    reqres.statusCode = e.statusCode;
    reqres.statusLine = e.statusLine;
    reqres.responseHeaders = e.responseHeaders;
}

// In-flight reqres handling

// flush reqresFinishingUp into the reqresAlmostDone, interrupting filters
function forceFinishingUpWebRequest(predicate, updatedTabId) {
    let notFinished = [];

    for (let reqres of reqresFinishingUp) {
        if (predicate !== undefined && !predicate(reqres)) {
            notFinished.push(reqres);
            continue;
        }

        // disconnect the filter, if not disconnected already
        if (reqres.filter !== undefined) {
            try {
                reqres.filter.disconnect()
            } catch (e) {
                //ignore
            }
            delete reqres["filter"];
        }

        if (config.debugCaptures)
            console.warn("CAPTURE: FORCE-UNSTUCK webRequest requestId", reqres.requestId,
                         "tabId", reqres.tabId,
                         "url", reqres.url,
                         "reqres", reqres);

        reqresAlmostDone.push(reqres);
        updatedTabId = mergeUpdatedTabIds(updatedTabId, reqres.tabId);
    }

    reqresFinishingUp = notFinished;
    return updatedTabId;
}

// flush debugReqresFinishingUp into the reqresAlmostDone
function forceFinishingUpDebug(predicate, updatedTabId) {
    let notFinished = [];

    // Emit these by making up fake webRequest counterparts for them
    for (let dreqres of debugReqresFinishingUp) {
        if (predicate !== undefined && !predicate(dreqres)) {
            notFinished.push(dreqres);
            continue;
        }

        if (config.debugCaptures)
            console.warn("CAPTURE: FORCE-UNSTUCK debugRequest drequestId", dreqres.requestId,
                         "tabId", dreqres.tabId,
                         "url", dreqres.url,
                         "dreqres", dreqres);

        // Turn debugging `dreqres` into a structure that can be used as a normal
        // webRequest `reqres`. This is used when Chromium bugs out and forgets to
        // produce the webRequest part. Essentially, this is a continuation of
        // emitDebugRequest, which finishes it up to become a valid `reqres`.
        dreqres.requestBuggy = true;
        dreqres.requestBody = new ChunkedBuffer();
        dreqres.requestComplete = dreqres.fromCache;
        if (dreqres.responseBody === undefined)
            dreqres.responseBody = new ChunkedBuffer();
        // dreqres.responseComplete is set by emitDebugRequest

        reqresAlmostDone.push(dreqres);
        updatedTabId = mergeUpdatedTabIds(updatedTabId, dreqres.tabId);
    }

    debugReqresFinishingUp = notFinished;
    return updatedTabId;
}

// wait up for reqres filters to finish
function processFinishingUpWebRequest(forcing, updatedTabId) {
    let notFinished = [];

    for (let reqres of reqresFinishingUp) {
        if (reqres.filter === undefined) {
            // this reqres finished even before having a filter
            reqresAlmostDone.push(reqres);
            updatedTabId = mergeUpdatedTabIds(updatedTabId, reqres.tabId);
            continue;
        }

        let fs = reqres.filter.status;
        if (fs == "disconnected" || fs == "closed" || fs == "failed") {
            // the filter is done, remove it
            delete reqres["filter"];
            reqresAlmostDone.push(reqres);
            updatedTabId = mergeUpdatedTabIds(updatedTabId, reqres.tabId);
            continue;
        }

        // the filter of this reqres is not finished yet
        // try again later
        notFinished.push(reqres);
    }

    reqresFinishingUp = notFinished;

    if (!forcing)
        scheduleEndgame(updatedTabId);

    return updatedTabId;
}

// schedule processFinishingUpWebRequest
function scheduleProcessFinishingUpWebRequest() {
    if (reqresFinishingUp.length == 0 && debugReqresFinishingUp.length == 0)
        // nothing to do
        return;

    scheduleAction(scheduledInternal, "finishingUp", 100, () => processFinishingUpWebRequest(false));
    scheduleUpdateDisplay(true);
}

function debugHeadersMatchScore(reqres, dreqres) {
    let matching = 0;
    let unmatching = 0;

    function match(headers, dheaders) {
        for (let dheader of dheaders) {
            let name = dheader.name.toLowerCase();
            let found = false;
            let foundWrong = false;
            for (let header of headers) {
                if (header.name.toLowerCase() == name) {
                    if (getHeaderString(header) == getHeaderString(dheader)) {
                        found = true;
                        break;
                    } else
                        foundWrong = true;
                }
            }
            if (found)
                matching += 1;
            else if (foundWrong)
                unmatching += 1;
        }
    }

    match(reqres.requestHeaders, dreqres.requestHeaders);
    match(reqres.responseHeaders, dreqres.responseHeaders);

    let score = matching - unmatching * 1000;
    if (config.debugCaptures)
        console.debug("CAPTURE: debugHeadersMatchScore", score, reqres, dreqres);

    return score;
}

// Update webRequest `reqres` with data collected in the debugging `dreqres`.
function mergeInDebugReqres(reqres, dreqres) {
    if (dreqres.documentUrl !== undefined)
        reqres.documentUrl = dreqres.documentUrl;

    if (dreqres.requestTimeStamp < reqres.requestTimeStamp)
        reqres.requestTimeStamp = dreqres.requestTimeStamp;

    for (let e of dreqres.errors)
        if (reqres.errors.every((v) => v !== e))
            reqres.errors.push(e);

    mergeInHeaders(reqres.requestHeaders, dreqres.requestHeaders);

    if (!dreqres.responded)
        return;

    if (dreqres.responseTimeStamp < reqres.responseTimeStamp)
        reqres.responseTimeStamp = dreqres.responseTimeStamp;
    if (dreqres.protocol !== undefined)
        reqres.protocol = dreqres.protocol;
    if (dreqres.statusCode !== undefined)
        reqres.statusCode = dreqres.statusCode;
    if (dreqres.reason !== undefined)
        reqres.reason = dreqres.reason;
    if (dreqres.fromCache)
        reqres.fromCache = true;

    mergeInHeaders(reqres.responseHeaders, dreqres.responseHeaders);

    if (dreqres.statusCodeExtra == 304) {
        // handle 304 Not Modified cached result by submitting this request twice,
        // first time with 304 code and with no response body
        let creqres = completedCopyOfReqres(reqres);
        creqres.statusCode = 304;
        reqresAlmostDone.push(creqres);
        // and then, again, normally
    }

    if (dreqres.responseBody !== undefined)
        reqres.responseBody = dreqres.responseBody;
    reqres.responseComplete = dreqres.responseComplete;
}

function processMatchFinishingUpWebRequestDebug(forcing, updatedTabId) {
    if (debugReqresFinishingUp.length > 0 && reqresFinishingUp.length > 0) {
        // match elements from debugReqresFinishingUp to elements from
        // reqresFinishingUp, attach the former to the best-matching latter,
        // and then push the latter to reqresAlmostDone
        let notFinished = [];

        for (let dreqres of debugReqresFinishingUp) {
            let nurl = normalizedURL(dreqres.url);

            let matching = [];
            let notMatching = [];
            for (let reqres of reqresFinishingUp) {
                if (dreqres.tabId === reqres.tabId
                    && dreqres.statusCode === reqres.statusCode
                    && dreqres.method === reqres.method
                    && nurl === normalizedURL(reqres.url))
                    matching.push(reqres);
                else
                    notMatching.push(reqres);
            }

            if (matching.length > 0) {
                let closest = matching.shift();
                let score = debugHeadersMatchScore(closest, dreqres);
                let diff = Math.abs(dreqres.requestTimeStamp - closest.requestTimeStamp);
                while (matching.length > 0) {
                    let next = matching.shift();
                    let nscore = debugHeadersMatchScore(next, dreqres);
                    let ndiff = Math.abs(dreqres.requestTimeStamp - next.requestTimeStamp);
                    if (nscore > score || nscore == score && ndiff < diff) {
                        notMatching.push(closest);
                        closest = next;
                        score = nscore;
                        diff = ndiff;
                    }
                    else
                        notMatching.push(next);
                }

                if (config.debugCaptures)
                    console.info("CAPTURE: MATCHED", dreqres, closest);

                mergeInDebugReqres(closest, dreqres);
                reqresAlmostDone.push(closest);
                updatedTabId = mergeUpdatedTabIds(updatedTabId, closest.tabId);
            } else
                notFinished.push(dreqres);

            reqresFinishingUp = notMatching;
        }

        debugReqresFinishingUp = notFinished;
    }

    if (!forcing && reqresInFlight.size === 0 && debugReqresInFlight.size === 0) {
        // NB: It is totally possible for a reqres to finish and get emitted
        // from reqresInFlight while the corresponding dreqres didn't even
        // start.
        //
        // So, forcefully emitting `reqresFinishingUp` at this point is likely
        // to lose data.
        //
        // However, `debugReqresFinishingUp` are safe to emit.
        if (debugReqresFinishingUp.length > 0)
            // This means Chromium generated some debug events without
            // generating the corresponding webRequest events. This actually
            // happens sometimes when loading a tab in background. Chromium
            // has a surprising number of bugs...
            updatedTabId = forceFinishingUpDebug(undefined, updatedTabId);

        if (reqresFinishingUp.length > 0) {
            // This means Chromium generated some webRequests but did not
            // generate corresponding debug events. This happens all the time
            // as described in the NB above, but those webRequests will get
            // their debug events generated later. However, when a webRequest
            // is an in-browser redirect (like when uBlock Origin redirecting
            // a Google Analytics .js URL to its own version) or gets
            // canceled, or just at random times sometimes, no debug events
            // will be emmited for it. So, to get these out of in-flight
            // state, we run following.
            let updatedTabId2 = updatedTabId;
            scheduleActionEndgame(scheduledCancelable, "debugFinishingUp", config.workaroundChromiumDebugTimeout * 1000 + 500, () => {
                // First, finish up unsent requests (which are usually redirects).
                let olderThan1 = Date.now() - config.workaroundChromiumDebugTimeout * 1000;
                updatedTabId2 = forceFinishingUpWebRequest((r) => !r.submitted && r.emitTimeStamp <= olderThan1, updatedTabId2);

                // Then, eventually, finish up the rest.
                scheduleActionEndgame(scheduledCancelable, "debugFinishingUp", config.workaroundChromiumDebugTimeout * 2000 + 500, () => {
                    let olderThan2 = Date.now() - config.workaroundChromiumDebugTimeout * 2000;
                    return forceFinishingUpWebRequest((r) => r.emitTimeStamp <= olderThan2, updatedTabId2);
                });

                return updatedTabId2;
            });
            // NB: not doing scheduleUpdateDisplay here, because scheduleEndgame
            // below (or the function `forcing` this one) will
        }
    }

    if (config.debugCaptures) {
        if (debugReqresInFlight.size > 0 || reqresInFlight.size > 0)
            console.debug("CAPTURE: still in-flight", debugReqresInFlight, reqresInFlight);

        if (debugReqresFinishingUp.length > 0 || reqresFinishingUp.length > 0)
            console.debug("CAPTURE: still unmatched", debugReqresFinishingUp, reqresFinishingUp);
    }

    if (!forcing)
        scheduleEndgame(updatedTabId);

    return updatedTabId;
}

function scheduleProcessMatchFinishingUpWebRequestDebug() {
    scheduleAction(scheduledCancelable, "debugFinishingUp", config.workaroundChromiumDebugTimeout * 1000,
                   processMatchFinishingUpWebRequestDebug);
}

let processFinishingUp = processFinishingUpWebRequest;
if (useDebugger)
    processFinishingUp = processMatchFinishingUpWebRequestDebug;

function emitRequest(requestId, reqres, error, dontFinishUp) {
    reqresInFlight.delete(requestId);

    reqres.emitTimeStamp = Date.now();

    if (reqres.formData !== undefined) {
        // recover requestBody from formData
        let contentType = getHeaderValue(reqres.requestHeaders, "Content-Type") || "";
        let parts = contentType.split(";");
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

            if (config.debugCaptures)
                console.debug("CAPTURE: formData", reqres.formData);

            let enc = new TextEncoder("utf-8", { fatal: true });

            if (boundary !== undefined) {
                for (const [name, value] of Object.entries(reqres.formData)) {
                    let data = enc.encode("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + encodeURIComponent(name) + "\"\r\n\r\n" + value.join("") + "\r\n")
                    reqres.requestBody.push(data);
                }

                let epilog = enc.encode("--" + boundary + "--\r\n");
                reqres.requestBody.push(epilog);
            } else
                console.warn("CAPTURE: can't recover requestBody from formData, unknown Content-Type format", contentType);
        } else
            console.warn("CAPTURE: can't recover requestBody from formData, unknown Content-Type format", contentType);
        delete reqres["formData"];
    }

    if (error !== undefined) {
        if (isUnknownError(error))
            console.error("CAPTURE: emitRequest", requestId, "error", error, reqres);
        reqres.errors.push(error);
    }

    reqresFinishingUp.push(reqres);
    if (!dontFinishUp)
        processFinishingUp(false);
}

// Encode debugger's headers structure into the one used by webRequest API.
function debugHeadersToHeaders(dheaders) {
    if (dheaders === undefined)
        return [];

    let res = [];
    for (let [k, v] of Object.entries(dheaders)) {
        res.push({ name: k, value: v });
    }
    return res;
}

// update `headers` with headers from `dheaders`
function mergeInHeaders(headers, dheaders) {
    for (let dheader of dheaders) {
        let name = dheader.name.toLowerCase();
        let found = false;
        for (let header of headers) {
            if (header.name.toLowerCase() == name) {
                if (getHeaderString(header) == getHeaderString(dheader)) {
                    found = true;
                    break;
                }
            }
        }
        if (!found)
            headers.push(dheader);
    }
    return headers;
}

function emitDebugRequest(requestId, dreqres, withResponse, error, dontFinishUp) {
    debugReqresInFlight.delete(requestId);

    // First case: happens when a debugger gets detached very early, after
    // `handleDebugRequestWillBeSent(false, ...)` but before
    // `handleDebugRequestWillBeSent(true, ...)`.
    //
    // Also see (veryEarly) in `getInFlightLog`.
    //
    // Second case: ignore data, file, end extension URLs.
    if (dreqres.url === undefined || isBoringOrServerURL(dreqres.url)) {
        if (!dontFinishUp)
            processMatchFinishingUpWebRequestDebug(false, dreqres.tabId);
        return;
    }
    // NB: We do this here, instead of any other place because Chromium
    // generates debug events in different orders for different request types.

    dreqres.emitTimeStamp = Date.now();

    if (error !== undefined) {
        if (isUnknownError(error))
            console.error("CAPTURE: emitDebugRequest", requestId, "error", error, dreqres);
        dreqres.errors.push(error);
    }

    dreqres.requestHeaders = [];
    mergeInHeaders(dreqres.requestHeaders, debugHeadersToHeaders(dreqres.requestHeadersDebug));
    mergeInHeaders(dreqres.requestHeaders, debugHeadersToHeaders(dreqres.requestHeadersDebugExtra));

    dreqres.responseHeaders = [];
    if (dreqres.responded) {
        mergeInHeaders(dreqres.responseHeaders, debugHeadersToHeaders(dreqres.responseHeadersDebug));
        mergeInHeaders(dreqres.responseHeaders, debugHeadersToHeaders(dreqres.responseHeadersDebugExtra));
    }

    if (!config.debugCaptures) {
        delete dreqres["requestHeadersDebug"];
        delete dreqres["requestHeadersDebugExtra"];
        delete dreqres["responseHeadersDebug"];
        delete dreqres["responseHeadersDebugExtra"];
    }

    if (withResponse === true) {
        browser.debugger.sendCommand({ tabId: dreqres.tabId }, "Network.getResponseBody", { requestId }).then((res) => {
            if (res.base64Encoded)
                dreqres.responseBody = unBase64(res.body);
            else
                dreqres.responseBody = res.body;
            dreqres.responseComplete = error === undefined;
        }, (err) => {
            if (typeof err === "string") {
                if (err.startsWith("Debugger is not attached to the tab with id:")
                    || err.startsWith("Detached while handling command.")) {
                    dreqres.errors.push("debugger::capture::NO_RESPONSE_BODY::DETACHED_DEBUGGER");
                    return;
                } else if (err.startsWith("Cannot access contents of url")) {
                    dreqres.errors.push("debugger::capture::NO_RESPONSE_BODY::ACCESS_DENIED");
                    return;
                }
            }
            dreqres.errors.push("debugger::capture::NO_RESPONSE_BODY::OTHER");
            logError(err);
        }).finally(() => {
            debugReqresFinishingUp.push(dreqres);
            if (config.debugCaptures)
                console.info("CAPTURE: CAPTURED debugRequest drequestId", dreqres.requestId,
                             "tabId", dreqres.tabId,
                             "url", dreqres.url,
                             "dreqres", dreqres);
            if (!dontFinishUp)
                processMatchFinishingUpWebRequestDebug(false, dreqres.tabId);
        });
    } else {
        dreqres.responseComplete = error === undefined;
        debugReqresFinishingUp.push(dreqres);
        if (config.debugCaptures)
            console.info("CAPTURE: CAPTURED debugRequest drequestId", dreqres.requestId,
                         "tabId", dreqres.tabId,
                         "url", dreqres.url,
                         "dreqres", dreqres);
        if (!dontFinishUp)
            processMatchFinishingUpWebRequestDebug(false, dreqres.tabId);
    }
}

function emitTabInFlightWebRequest(tabId, reason) {
    for (let [requestId, reqres] of Array.from(reqresInFlight.entries())) {
        if (tabId === null || reqres.tabId === tabId)
            emitRequest(requestId, reqres, "webRequest::" + reason, true);
    }
}

function emitTabInFlightDebug(tabId, reason) {
    for (let [requestId, dreqres] of Array.from(debugReqresInFlight.entries())) {
        if (tabId === null || dreqres.tabId === tabId)
            emitDebugRequest(requestId, dreqres, false, "debugger::" + reason, true);
    }
}

function stopInFlight(tabId, reason, updatedTabId) {
    if (useDebugger)
        emitTabInFlightDebug(tabId, reason);
    emitTabInFlightWebRequest(tabId, reason);

    updatedTabId = processFinishingUp(true, tabId);

    if (useDebugger)
        updatedTabId = forceFinishingUpDebug((r) => tabId === null || r.tabId === tabId, updatedTabId);
    updatedTabId = forceFinishingUpWebRequest((r) => tabId === null || r.tabId === tabId, updatedTabId);

    return updatedTabId;
    // NB: needs scheduleEndgame after
}

function syncStopInFlight(tabId) {
    let updatedTabId = stopInFlight(tabId, "capture::EMIT_FORCED::BY_USER");
    scheduleEndgame(updatedTabId);
}

// webRequest handlers

function logEvent(rtype, e, reqres) {
    if (config.debugCaptures)
        console.info("CAPTURE: EVENT webRequest",
                     rtype,
                     "requestId", e.requestId,
                     "tabId", e.tabId,
                     "url", e.url,
                     "event", e,
                     "reqres", reqres);
}

function handleBeforeRequest(e) {
    let url = e.url;

    // Ignore data, file, and extension URLs as wel as all request to the
    // archiving/replay server.
    //
    // NB: `file:` URLs only happen on Chromium, Firefox does not emit any
    // `webRequest` events for those.
    if (isBoringOrServerURL(url))
        return;

    let initiator;
    if (isDefinedURL(e.documentUrl))
        initiator = e.documentUrl; // Firefox
    else if (isDefinedURL(e.initiator) && e.initiator !== "null")
        initiator = e.initiator; // Chromium

    let fromExtension = false;
    if (initiator !== undefined) {
        // ignore our own requests
        if (initiator.startsWith(selfURL) // Firefox
            || (initiator + "/") == selfURL) // Chromium
            return;

        // request originates from another extension
        if (isExtensionURL(initiator))
            fromExtension = true;
    }

    let options = getOriginConfig(e.tabId, fromExtension);
    let workOffline = config.workOffline || options.workOffline;

    // ignore this request if archiving is disabled
    if (!config.collecting || !options.collecting) {
        if (workOffline)
            return { cancel: true };
        return;
    }

    logEvent("BeforeRequest", e, undefined);

    // Should we generate and then immediately cancel this reqres?
    let reject = false;

    // On Chromium, cancel all requests from a tab that is not yet debugged,
    // start debugging, and then reload the tab.
    if (useDebugger && e.tabId !== -1
        && !tabsDebugging.has(e.tabId)
        && (url.startsWith("http://") || url.startsWith("https://"))) {
        if (config.debugRuntime)
            console.warn("CAPTURE: canceling and restarting request to", url, "as tab", e.tabId, "is not managed yet");
        if (e.type == "main_frame") {
            // attach debugger and reload the main frame
            attachDebuggerAndReloadTab(e.tabId).catch(logError);
            // not using
            //   resetAttachDebuggerAndNavigateTab(e.tabId, url).catch(logError);
            // or
            //   resetAttachDebuggerAndReloadTab(e.tabId).catch(logError);
            // bacause they reset the referrer
            return { cancel: true };
        } else
            // cancel it, but generate a reqres for it, so that it would be
            // logged
            reject = true;
    }

    // On Firefox, cancel the very first navigation request, redirect the tab
    // to `about:blank`, and then reload the tab with the original URL to
    // work-around a Firefox bug where it will fail to run `onstop` for the
    // `filterResponseData` of the very first request, thus breaking it.
    if (!useDebugger && workaroundFirstRequest && !workOffline) {
        workaroundFirstRequest = false;
        if (config.workaroundFirefoxFirstRequest
            && e.tabId !== -1
            && initiator === undefined
            && e.type == "main_frame"
            && (url.startsWith("http://") || url.startsWith("https://"))) {
            if (config.debugRuntime)
                console.warn("CAPTURE: canceling and restarting request to", url, "to workaround a bug in Firefox");
            resetAndNavigateTab(e.tabId, url).catch(logError);
            return { cancel: true };
        }
    }

    let tabId = e.tabId;
    let requestId = e.requestId;
    let reqres = {
        sessionId,
        requestId,
        tabId,
        fromExtension,

        method: e.method,
        url,

        errors: [],

        requestTimeStamp: e.timeStamp,
        requestHeaders: [],
        requestBody: new ChunkedBuffer(),
        requestComplete: true,

        submitted: false,
        responded: false,

        responseHeaders : [],
        responseBody: new ChunkedBuffer(),
        responseComplete: false,
        fromCache: false,
    };

    if (isDefinedURL(e.documentUrl)
        && !e.documentUrl.startsWith(selfURL)) // just in case
        reqres.documentUrl = e.documentUrl;

    if (isDefinedURL(e.originUrl)
        && !e.originUrl.startsWith(selfURL)) // do not leak extension id when using config.workaroundFirefoxFirstRequest
        reqres.originUrl = e.originUrl; // Firefox
    else if (isDefinedURL(e.initiator)
             && e.initiator !== "null"
             && !e.initiator.startsWith(selfURL)) // just in case
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

    if (reject || workOffline) {
        if (reject)
            reqres.errors.push("webRequest::capture::CANCELED::NO_DEBUGGER")
        if (workOffline)
            reqres.errors.push("webRequest::capture::CANCELED::BY_WORK_OFFLINE")
        reqresAlmostDone.push(reqres);
        scheduleEndgame(tabId);
        return { cancel: true };
    }

    if (!useDebugger) {
        // Firefox
        let filter = browser.webRequest.filterResponseData(requestId);
        filter.onstart = (event) => {
            if (config.debugCaptures)
                console.info("CAPTURE: filterResponseData", requestId, "started");
        };
        filter.ondata = (event) => {
            if (config.debugCaptures)
                console.info("CAPTURE: filterResponseData", requestId, "chunk", event.data);
            reqres.responseBody.push(new Uint8Array(event.data));
            filter.write(event.data);
        };
        filter.onstop = (event) => {
            if (config.debugCaptures)
                console.info("CAPTURE: filterResponseData", requestId, "finished");
            reqres.responseComplete = true;
            filter.disconnect();
            scheduleProcessFinishingUpWebRequest(); // in case we were waiting for this filter
        };
        filter.onerror = (event) => {
            if (filter.error !== "Invalid request ID") {
                // if filter was actually started
                let error = "filterResponseData::" + filter.error;
                if (isUnknownError(error))
                    console.error("CAPTURE: filterResponseData", requestId, "error", error);
                reqres.errors.push(error);
            }
            scheduleProcessFinishingUpWebRequest(); // in case we were waiting for this filter
        };

        reqres.filter = filter;
    }

    reqresInFlight.set(requestId, reqres);
    broadcastToState(tabId, "newInFlight", () => [makeLoggable(reqres)]);
    scheduleUpdateDisplay(true, tabId);
}

function handleBeforeSendHeaders(e) {
    let reqres = reqresInFlight.get(e.requestId);
    if (reqres === undefined) return;

    logEvent("BeforeSendHeaders", e, reqres);
}

function handleSendHeaders(e) {
    let reqres = reqresInFlight.get(e.requestId);
    if (reqres === undefined) return;

    logEvent("SendHeaders", e, reqres);
    reqres.submitted = true;
    reqres.requestHeaders = e.requestHeaders;
}

function handleHeadersRecieved(e) {
    let reqres = reqresInFlight.get(e.requestId);
    if (reqres === undefined) return;

    logEvent("HeadersRecieved", e, reqres);

    if (reqres.responded) {
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

    fillResponse(reqres, e);
}

function handleBeforeRedirect(e) {
    let reqres = reqresInFlight.get(e.requestId);
    if (reqres === undefined) return;

    logEvent("BeforeRedirect", e, reqres);

    reqres.redirectUrl = e.redirectUrl;
    reqres.responseComplete = true;

    if (!reqres.responded) {
        // This happens when a request gets redirected right after
        // `handleBeforeRequest` by the browser itself, by another extension,
        // or a service/shared worker.
        let firefoxInternalRedirect = !useDebugger && e.statusCode === 0;
        let firefoxExtensionRedirectToSelf = !useDebugger && (e.statusCode < 300 || e.statusCode >= 400) && isExtensionURL(e.redirectUrl);
        if (firefoxInternalRedirect || firefoxExtensionRedirectToSelf) {
            // Work around internal Firefox redirects giving no codes and
            // statuses or extensions redirecting to their local files under
            // Firefox.
            reqres.generated = true;
            reqres.responded = true;
            reqres.responseTimeStamp = e.timeStamp;
            reqres.fromCache = false;
            reqres.statusCode = 307;
            reqres.reason = "Internal Redirect";
            reqres.responseHeaders = [
                { name: "Location", value: e.redirectUrl }
            ];
            // these give no data, usually
            if (firefoxExtensionRedirectToSelf)
                reqres.responseComplete = false;
        } else
            fillResponse(reqres, e);
    }

    emitRequest(e.requestId, reqres);

    // after this it will go back to handleBeforeRequest, so we don't need to
    // copy anything here
}

function handleAuthRequired(e) {
    let reqres = reqresInFlight.get(e.requestId);
    if (reqres === undefined) return;

    logEvent("AuthRequired", e, reqres);

    // similarly to above
    let creqres = completedCopyOfReqres(reqres);
    emitRequest(e.requestId, creqres);

    // after this it will goto back to handleBeforeSendHeaders, so
    reqresInFlight.set(e.requestId, reqres);
}

function handleCompleted(e) {
    let reqres = reqresInFlight.get(e.requestId);
    if (reqres === undefined) return;

    logEvent("Completed", e, reqres);

    if (!reqres.responded) {
        // This happens when a request gets fulfilled by another extension or
        // a service/shared worker.
        reqres.generated = true;
        fillResponse(reqres, e);
    }

    emitRequest(e.requestId, reqres);
}

function handleErrorOccurred(e) {
    let reqres = reqresInFlight.get(e.requestId);
    if (reqres === undefined) return;

    logEvent("ErrorOccured", e, reqres);

    if (!reqres.responded) {
        // This happens when a request gets started as normal, but then the
        // loading gets interrupted by another extension or a service/shared
        // worker.
        reqres.generated = true;
        reqres.fromCache = e.fromCache;
        // NB: Not setting `reqres.responded`, nor `reqres.responseTimeStamp` here.
        // NB: This then continues to (raceCondition).
    }

    emitRequest(e.requestId, reqres, "webRequest::" + e.error);
}

function initCapture() {
    let filterAllR = { urls: ["<all_urls>"] };
    if (useBlocking)
        browser.webRequest.onBeforeRequest.addListener(catchAll(handleBeforeRequest), filterAllR, ["blocking", "requestBody"]);
    else
        browser.webRequest.onBeforeRequest.addListener(catchAll(handleBeforeRequest), filterAllR, ["requestBody"]);
    browser.webRequest.onBeforeSendHeaders.addListener(catchAll(handleBeforeSendHeaders), filterAllR);
    browser.webRequest.onSendHeaders.addListener(catchAll(handleSendHeaders), filterAllR, ["requestHeaders"]);
    browser.webRequest.onHeadersReceived.addListener(catchAll(handleHeadersRecieved), filterAllR, ["responseHeaders"]);
    browser.webRequest.onBeforeRedirect.addListener(catchAll(handleBeforeRedirect), filterAllR, ["responseHeaders"]);
    browser.webRequest.onAuthRequired.addListener(catchAll(handleAuthRequired), filterAllR);
    browser.webRequest.onCompleted.addListener(catchAll(handleCompleted), filterAllR, ["responseHeaders"]);
    browser.webRequest.onErrorOccurred.addListener(catchAll(handleErrorOccurred), filterAllR);
}

// Debugger handlers

function logDebugEvent(rtype, nonExtra, e, dreqres) {
    if (config.debugCaptures) {
        let url;
        if (e.request !== undefined)
            url = e.request.url;
        console.info("CAPTURE: EVENT debugRequest",
                     rtype + (nonExtra ? "" : "ExtraInfo"),
                     "drequestId", e.requestId,
                     "tabId", e.tabId,
                     "url", url,
                     "event", e,
                     "dreqres", dreqres);
    }
}

function handleDebugRequestWillBeSent(nonExtra, e) {
    // don't do anything if we are globally disabled
    if (!config.collecting) return;

    popSingletonTimeout(scheduledCancelable, "debugFinishingUp");

    logDebugEvent("requestWillBeSent", nonExtra, e, undefined);

    let tabId = e.tabId;
    let dreqres = cacheSingleton(debugReqresInFlight, e.requestId, () => { return {
        sessionId,
        requestId: e.requestId,
        tabId,
        fromExtension: false, // most likely

        //method: undefined,
        //url: undefined,

        //documentUrl: undefined,
        //originUrl: undefined,

        errors: [],

        //requestTimeStamp: Date.now(),
        //requestHeaders: undefined,
        //requestHeadersDebug: undefined,
        //requestHeadersDebugExtra: undefined,
        //requestBody: undefined,
        //requestComplete: false,

        submitted: false,
        responded: false,

        //responseTimeStamp: undefined,
        //protocol: undefined, // on Chromium is a part of the response, not the request
        //statusCode: undefined,
        //reason: undefined,
        //responseHeaders : undefined,
        //responseHeadersDebug: undefined,
        //responseHeadersDebugExtra: undefined,
        //responseBody: undefined,
        responseComplete: false,

        fromCache: false,
    }; });

    if (nonExtra) {
        dreqres.requestTimeStamp = e.wallTime * 1000;
        dreqres.method = e.request.method;
        dreqres.url = e.request.url;
        if (isDefinedURL(e.documentURL))
            dreqres.documentUrl = e.documentURL;
        dreqres.requestHeadersDebug = e.request.headers;
        broadcastToStateWhen(!isBoringOrServerURL(dreqres.url), tabId, "newInFlight", () => [makeLoggable(dreqres)]);
    } else {
        if (dreqres.requestTimeStamp === undefined)
            dreqres.requestTimeStamp = Date.now();
        dreqres.requestHeadersDebugExtra = e.headers;
    }

    scheduleProcessMatchFinishingUpWebRequestDebug();
    scheduleUpdateDisplay(true, tabId);
}

function handleDebugResponseRecieved(nonExtra, e) {
    let dreqres = debugReqresInFlight.get(e.requestId);
    if (dreqres === undefined) return;

    popSingletonTimeout(scheduledCancelable, "debugFinishingUp");

    logDebugEvent("responseReceived", nonExtra, e, dreqres);

    dreqres.submitted = true;
    dreqres.responded = true;

    if (nonExtra) {
        dreqres.responseTimeStamp = e.response.responseTime;
        let protocol = e.response.protocol.toUpperCase();
        if (protocol == "H3" || protocol == "H3C")
            dreqres.protocol = "HTTP/3.0";
        else if (protocol == "H2" || protocol == "H2C")
            dreqres.protocol = "HTTP/2.0";
        else
            dreqres.protocol = protocol;
        dreqres.statusCode = e.response.status;
        dreqres.reason = e.response.statusText;
        dreqres.responseHeadersDebug = e.response.headers;
        scheduleProcessMatchFinishingUpWebRequestDebug();
    } else {
        if (dreqres.responseTimeStamp === undefined)
            dreqres.responseTimeStamp = Date.now();
        if (dreqres.statusCode === undefined)
            dreqres.statusCode = e.statusCode;
        dreqres.statusCodeExtra = e.statusCode;
        dreqres.responseHeadersDebugExtra = e.headers;
        if (redirectStatusCodes.has(e.statusCode))
            // If this is a redirect request, emit it immediately, because
            // there would be neither nonExtra, nor handleDebugLoadingFinished event
            // for it
            emitDebugRequest(e.requestId, dreqres, false);
        else
            scheduleProcessMatchFinishingUpWebRequestDebug();
        // can't do the same for 304 Not Modified, because it needs to
        // accumulate both extra and non-extra data first to match to
        // reqresFinishingUp requests, and it does get handleDebugLoadingFinished
    }
}

function handleRequestServedFromCache(e) {
    let dreqres = debugReqresInFlight.get(e.requestId);
    if (dreqres === undefined) return;

    popSingletonTimeout(scheduledCancelable, "debugFinishingUp");

    logDebugEvent("requestServedFromCache", true, e, dreqres);

    dreqres.fromCache = true;

    scheduleProcessMatchFinishingUpWebRequestDebug();
}

function handleDebugLoadingFinished(e) {
    let dreqres = debugReqresInFlight.get(e.requestId);
    if (dreqres === undefined) return;

    popSingletonTimeout(scheduledCancelable, "debugFinishingUp");

    logDebugEvent("loadingFinished", true, e, dreqres);

    emitDebugRequest(e.requestId, dreqres, true);
}

function handleDebugLoadingFailed(e) {
    let dreqres = debugReqresInFlight.get(e.requestId);
    if (dreqres === undefined) return;

    popSingletonTimeout(scheduledCancelable, "debugFinishingUp");

    logDebugEvent("loadingFailed", true, e, dreqres);

    if (e.canceled === true) {
        emitDebugRequest(e.requestId, dreqres, false, "debugger::" + (e.errorText ? e.errorText : "net::ERR_CANCELED"));
    } else if (e.blockedReason !== undefined && e.blockedReason !== "") {
        emitDebugRequest(e.requestId, dreqres, false, "debugger::net::ERR_BLOCKED::" + e.blockedReason);
    } else
        emitDebugRequest(e.requestId, dreqres, true, "debugger::" + e.errorText);
}

function handleDebugEvent(debuggee, method, params) {
    switch (method) {
    case "Network.requestWillBeSent":
        params.tabId = debuggee.tabId;
        handleDebugRequestWillBeSent(true, params);
        break;
    case "Network.requestWillBeSentExtraInfo":
        params.tabId = debuggee.tabId;
        handleDebugRequestWillBeSent(false, params);
        break;
    case "Network.responseReceived":
        params.tabId = debuggee.tabId;
        handleDebugResponseRecieved(true, params);
        break;
    case "Network.responseReceivedExtraInfo":
        params.tabId = debuggee.tabId;
        handleDebugResponseRecieved(false, params);
        break;
    case "Network.requestServedFromCache":
        params.tabId = debuggee.tabId;
        handleRequestServedFromCache(params);
        break;
    case "Network.loadingFinished":
        params.tabId = debuggee.tabId;
        handleDebugLoadingFinished(params);
        break;
    case "Network.loadingFailed":
        params.tabId = debuggee.tabId;
        handleDebugLoadingFailed(params);
        break;
    //case "Fetch.requestPaused":
    //    console.warn("CAPTURE: FETCH", params);
    //    browser.debugger.sendCommand(debuggee, "Fetch.continueRequest", { requestId: params.requestId });
    //    break;
    case "Inspector.detached":
    case "Network.dataReceived":
    case "Network.resourceChangedPriority":
        // ignore
        break;
    default:
        console.warn("CAPTURE: debugger said", debuggee, method, params);
    }
}

function handleDebugDetach(debuggee, reason) {
    let logfunc = reason !== "target_closed" ? console.warn : (config.debugRuntime ? console.debug : undefined);
    if (logfunc !== undefined)
        logfunc("CAPTURE: debugger detached unexpectedly from", debuggee, "reason", reason);

    let tabId = debuggee.tabId;
    if (tabId !== undefined) {
        tabsDebugging.delete(tabId);
        // Unfortunately, this means all in-flight reqres of this tab are broken now
        let updatedTabId = stopInFlight(tabId, "capture::EMIT_FORCED::BY_DETACHED_DEBUGGER");
        if (config.collecting && reason !== "target_closed")
            // In Chrome, it's pretty easy to click the notification or press
            // Escape while doing Control+F and detach the debugger, so let's
            // reattach it immediately
            setTimeout(() => attachDebugger(tabId).catch(logErrorExceptWhenStartsWith("No tab with given id")), 1);
        scheduleEndgame(updatedTabId);
    }
}

async function initDebugCapture(tabs) {
    browser.debugger.onDetach.addListener(handleDebugDetach);
    browser.debugger.onEvent.addListener(handleDebugEvent);
    await syncDebuggersState(tabs);
}
