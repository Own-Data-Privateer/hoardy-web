/*
 * Debugger-assisted request collection (for Chromium-based browsers).
 *
 * Copyright (c) 2023-2024 Jan Malakhovski <oxij@oxij.org>
 *
 * This file can be distributed under the terms of the GNU GPL, version 3 or later.
 */

"use strict";

// delayed cleanup hook
let debugFinishingUpTID = null;

function cancelDebugFinishingUp() {
    if (debugFinishingUpTID !== null)
        clearTimeout(debugFinishingUpTID);
}

async function initDebugger(tabs) {
    browser.debugger.onDetach.addListener(handleDebugDetach);
    browser.debugger.onEvent.addListener(handleDebugEvent);
    await syncDebuggersState(tabs);
}

// tabs we are debugging in Chrome
let tabsDebugging = new Set();

function attachDebugger(tabId) {
    let debuggee = { tabId };
    return browser.debugger.attach(debuggee, "1.3").then(async () => {
        await browser.debugger.sendCommand(debuggee, "Network.enable", {});
        //await browser.debugger.sendCommand(debuggee, "Fetch.enable", {});
        //await browser.debugger.sendCommand(debuggee, "Page.enable", {});
        tabsDebugging.add(tabId);
        console.log("attached debugger to tab", tabId);
    });
}

function detachDebugger(tabId) {
    let debuggee = { tabId };
    return browser.debugger.detach(debuggee).then(() => {
        tabsDebugging.delete(tabId);
        console.log("detached debugger from tab", tabId);
    });
}

function attachDebuggerAndReloadIn(tabId, msec) {
    setTimeout(() => attachDebugger(tabId).then(
        () => setTimeout(() => browser.tabs.reload(tabId), msec), logError), msec);
}

async function syncDebuggersState(tabs) {
    if (tabs === undefined)
        tabs = await browser.tabs.query({});

    for (let tab of tabs) {
        let url = tab.url;
        if (url == "" && tab.pendingUrl !== undefined && tab.pendingUrl !== "")
            url = tab.pendingUrl;

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

function handleDebugEvent(debuggee, method, params) {
    cancelDebugFinishingUp();

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
    case "Network.loadingFinished":
        params.tabId = debuggee.tabId;
        handleDebugCompleted(params);
        break;
    case "Network.loadingFailed":
        params.tabId = debuggee.tabId;
        handleDebugErrorOccuried(params);
        break;
    //case "Fetch.requestPaused":
    //    console.warn("FETCH", params);
    //    browser.debugger.sendCommand(debuggee, "Fetch.continueRequest", { requestId: params.requestId });
    //    break;
    case "Inspector.detached":
    case "Network.requestServedFromCache":
    case "Network.dataReceived":
    case "Network.resourceChangedPriority":
        // ignore
        break;
    default:
        console.warn("debugger", debuggee, method, params);
    }
}

function handleDebugDetach(debuggee, reason) {
    console.log("debugger detached", debuggee, reason);
    let tabId = debuggee.tabId;
    if (tabId !== undefined) {
        tabsDebugging.delete(tabId);
        // Unfortunately, this means all debugReqresInFlight of this tab are broken now
        forceEmitInFlightDebug(tabId, "pWebArc::EMIT_FORCED_BY_DETACHED_DEBUGGER");
        if (config.collecting && reason !== "target_closed") {
            // In Chrome, it's pretty easy to click the notification or press
            // Escape while doing Control+F and detach the debugger, so let's
            // reattach it immediately
            setTimeout(() => attachDebugger(tabId), 1);
        }
    }
}

// state

// similarly to reqresInFlight, indexed by requestId
let debugReqresInFlight = new Map();
// similarly to reqresFinishingUp
let debugReqresFinishingUp = [];

function logDebugRequest(rtype, nonExtra, e) {
    if (config.debugging) {
        let url;
        if (e.request !== undefined)
            url = e.request.url;
        console.log("debug.Network.request " + rtype, nonExtra, e.tabId, e.requestId, url, e);
    }
}

// handlers

function handleDebugRequestWillBeSent(nonExtra, e) {
    // don't do anything if we are globally disabled
    if (!config.collecting) return;

    logDebugRequest("request will be sent", nonExtra, e);

    let dreqres = debugReqresInFlight.get(e.requestId);
    if (dreqres === undefined) {
        dreqres = {
            errors: [],
            responseComplete: false,
            responseBody: "",
            sent: true,
        };
        debugReqresInFlight.set(e.requestId, dreqres)
    }

    dreqres.tabId = e.tabId;

    if (nonExtra) {
        dreqres.requestTimeStamp = e.wallTime * 1000;
        dreqres.method = e.request.method;
        dreqres.url = e.request.url;
        if (e.documentURL !== undefined && e.documentURL !== null)
            dreqres.documentUrl = e.documentURL;
        dreqres.requestHeaders = e.request.headers;
        if (!isBoringURL(dreqres.url))
            broadcast(["newInFlight", [shallowCopyOfReqres(dreqres)]]);
    } else {
        if (dreqres.requestTimeStamp === undefined)
            dreqres.requestTimeStamp = Date.now();
        dreqres.requestHeadersExtra = e.headers;
    }
}

function handleDebugResponseRecieved(nonExtra, e) {
    let dreqres = debugReqresInFlight.get(e.requestId);
    if (dreqres === undefined) return;

    logDebugRequest("responce recieved", nonExtra, e);

    if (nonExtra) {
        dreqres.responseTimeStamp = e.response.responseTime;
        dreqres.protocol = e.response.protocol.toUpperCase();
        if (dreqres.protocol == "H3" || dreqres.protocol == "H3C")
            dreqres.protocol = "HTTP/3.0";
        else if (dreqres.protocol == "H2" || dreqres.protocol == "H2C")
            dreqres.protocol = "HTTP/2.0";
        dreqres.statusCode = e.response.status;
        dreqres.reason = e.response.statusText;
        dreqres.responseHeaders = e.response.headers;
    } else {
        if (dreqres.responseTimeStamp === undefined)
            dreqres.responseTimeStamp = Date.now();
        dreqres.statusCodeExtra = e.statusCode;
        dreqres.responseHeadersExtra = e.headers;
        if (redirectStatusCodes.has(e.statusCode)) {
            // If this is a redirect request, emit it immediately, because
            // there would be neither nonExtra, nor handleDebugCompleted event
            // for it
            dreqres.statusCode = e.statusCode;
            emitDebugRequest(e.requestId, dreqres, false);
        }
        // can't do the same for 304 Not Modified, because it needs to
        // accumulate both extra and non-extra data first to match to
        // reqresFinishingUp requests, and it does get handleDebugCompleted
    }
}

function handleDebugCompleted(e) {
    let dreqres = debugReqresInFlight.get(e.requestId);
    if (dreqres === undefined) return;

    logDebugRequest("completed", false, e);

    emitDebugRequest(e.requestId, dreqres, true);
}

function handleDebugErrorOccuried(e) {
    let dreqres = debugReqresInFlight.get(e.requestId);
    if (dreqres === undefined) return;

    logDebugRequest("error", false, e);

    if (e.canceled === true) {
        dreqres.sent = false;
        emitDebugRequest(e.requestId, dreqres, false, "debugger::net::ERR_CANCELED");
    } else if (e.blockedReason !== undefined && e.blockedReason !== "") {
        dreqres.sent = false;
        emitDebugRequest(e.requestId, dreqres, false, "debugger::net::ERR_BLOCKED::" + e.blockedReason);
    } else
        emitDebugRequest(e.requestId, dreqres, true, "debugger::" + e.errorText);
}

function emitDebugRequest(requestId, dreqres, withResponse, error, dontFinishUp) {
    debugReqresInFlight.delete(requestId)

    // ignore data, file, end extension URLs
    if (isBoringURL(dreqres.url))
        return;
    // NB: We do this here, instead of any other place because Chromium
    // generates debug events in different orders for different request types.

    dreqres.emitTimeStamp = Date.now();
    dreqres.requestId = requestId;

    if (error !== undefined) {
        if (importantError(error))
            console.error("emitDebugRequest", requestId, "error", error, dreqres);
        dreqres.errors.push(error);
    }

    if (withResponse === true) {
        browser.debugger.sendCommand({ tabId: dreqres.tabId }, "Network.getResponseBody", { requestId }).then((res) => {
            if (res.base64Encoded)
                dreqres.responseBody = unBase64(res.body);
            else
                dreqres.responseBody = res.body;
            dreqres.responseComplete = error === undefined;
        }, () => {}).finally(() => {
            debugReqresFinishingUp.push(dreqres);
            if (!dontFinishUp)
                processMatchFinishingUpWebRequestDebug();
        });
        return;
    } else {
        dreqres.responseComplete = error === undefined;
        debugReqresFinishingUp.push(dreqres);
        if (!dontFinishUp)
            processMatchFinishingUpWebRequestDebug();
    }
}

function forceEmitInFlightDebug(tabId, reason) {
    for (let [requestId, dreqres] of Array.from(debugReqresInFlight.entries())) {
        if (tabId === null || dreqres.tabId === tabId)
            emitDebugRequest(requestId, dreqres, false, "debugger::" + reason, true);
    }
}

function forceFinishingUpDebug(predicate) {
    // Emit these by making up fake webRequest counterparts for them
    for (let dreqres of debugReqresFinishingUp) {
        if (config.debugging)
            console.log("STUCK debug.Network.request", dreqres);

        emitDone(undefined, dreqres);
    }
    debugReqresFinishingUp = [];
}

function debugHeadersMatchScore(dreqres, reqres) {
    let matching = [];
    let unmatching = [];

    function match(headers, dheaders) {
        for (let [k, v] of Object.entries(dheaders)) {
            let name = k.toLowerCase();
            let found = false;
            let foundWrong = false;
            for (let header of headers) {
                if (header.name.toLowerCase() == name) {
                    if (getHeaderString(header) == v) {
                        found = true;
                        break;
                    } else
                        foundWrong = true;
                }
            }
            if (found)
                matching.push(name);
            else if (foundWrong)
                unmatching.push(name);
        }
    }

    if (dreqres.requestHeadersExtra !== undefined)
        match(reqres.requestHeaders, dreqres.requestHeadersExtra);
    else if (dreqres.requestHeaders !== undefined)
        match(reqres.requestHeaders, dreqres.requestHeaders);

    if (dreqres.responseHeadersExtra !== undefined)
        match(reqres.responseHeaders, dreqres.responseHeadersExtra);
    else if (dreqres.responseHeaders !== undefined)
        match(reqres.responseHeaders, dreqres.responseHeaders);

    let score = matching.length - unmatching.length * 1000;
    if (config.debugging)
        console.log("debugHeadersMatchScore", score, dreqres, reqres);
    return score;
}

function addMissingDebugHeaders(headers, obj) {
    if (obj === undefined) return;

    for (let [k, v] of Object.entries(obj)) {
        let name = k.toLowerCase();
        let found = false;
        for (let header of headers) {
            if (header.name.toLowerCase() == name) {
                if (getHeaderString(header) == v) {
                    // update the name to the original one
                    header.name = k;
                    found = true;
                    break;
                }
            }
        }
        if (!found)
            headers.push({ name: k, value: v });
    }
}

function emitDone(closest, dreqres) {
    if (closest === undefined) {
        closest = {
            tabId: dreqres.tabId,
            fromExtension: false, // most likely

            method: dreqres.method,
            url: dreqres.url,

            errors: [],

            requestTimeStamp: dreqres.requestTimeStamp,
            requestHeaders: [],
            requestComplete: true,
            requestBody: new ChunkedBuffer(),

            sent: dreqres.sent,

            responseTimeStamp: dreqres.responseTimeStamp,
            statusCode: dreqres.statusCode,
            responseHeaders: [],
            responseComplete: false,
            responseBody: new ChunkedBuffer(),

            emitTimeStamp: dreqres.emitTimeStamp,

            fake: true,
        };
    }

    for (let error of dreqres.errors)
        closest.errors.push(error);

    closest.protocol = dreqres.protocol;
    closest.reason = dreqres.reason;

    if (dreqres.documentUrl !== undefined)
        closest.documentUrl = dreqres.documentUrl;

    if (closest.fake)
        closest.originUrl = getHeaderValue(closest.requestHeaders, "Referer");

    // round timestamps to int
    closest.requestTimeStamp = Math.floor(closest.requestTimeStamp);
    if (closest.responseTimeStamp !== undefined)
        closest.responseTimeStamp = Math.floor(closest.responseTimeStamp);

    addMissingDebugHeaders(closest.requestHeaders, dreqres.requestHeaders);
    addMissingDebugHeaders(closest.requestHeaders, dreqres.requestHeadersExtra);
    addMissingDebugHeaders(closest.responseHeaders, dreqres.responseHeaders);
    addMissingDebugHeaders(closest.responseHeaders, dreqres.responseHeadersExtra);

    if (dreqres.statusCodeExtra !== undefined && dreqres.statusCodeExtra == 304) {
        // handle 304 Not Modified cached result by submitting this request twice,
        // first time with 304 code and with no response body
        let creqres = completedCopyOfReqres(closest);
        creqres.statusCode = 304;
        reqresAlmostDone.push(creqres);
        // and then, again, normally
    }

    closest.responseBody = dreqres.responseBody;
    closest.responseComplete = dreqres.responseComplete;
    reqresAlmostDone.push(closest);
}

function processMatchFinishingUpWebRequestDebug(forcing) {
    if (debugReqresFinishingUp.length > 0 && reqresFinishingUp.length > 0) {
        // match elements from debugReqresFinishingUp to elements from
        // reqresFinishingUp, attach the former to the best-matching latter,
        // and then push the latter to reqresAlmostDone
        let notFinished = [];

        for (let dreqres of debugReqresFinishingUp) {
            let nurl = normalizeURL(dreqres.url);

            let matching = [];
            let notMatching = [];
            for (let reqres of reqresFinishingUp) {
                if (dreqres.tabId == reqres.tabId
                    && dreqres.statusCode === reqres.statusCode
                    && dreqres.method == reqres.method
                    && nurl == normalizeURL(reqres.url))
                    matching.push(reqres);
                else
                    notMatching.push(reqres);
            }

            if (matching.length > 0) {
                let closest = matching.shift();
                let score = debugHeadersMatchScore(dreqres, closest);
                let diff = Math.abs(dreqres.requestTimeStamp - closest.requestTimeStamp);
                while (matching.length > 0) {
                    let next = matching.shift();
                    let nscore = debugHeadersMatchScore(dreqres, next);
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

                if (config.debugging)
                    console.log("MATCHED", dreqres, closest);

                emitDone(closest, dreqres);
            } else
                notFinished.push(dreqres);

            reqresFinishingUp = notMatching;
        }

        debugReqresFinishingUp = notFinished;
    }

    cancelDebugFinishingUp();

    if(!forcing && reqresInFlight.size === 0 && debugReqresInFlight.size === 0) {
        // NB: It is totally possible for a reqres to finish and get emitted
        // from reqresInFlight while the corresponding dreqres didn't even
        // start.

        // So, forcefully emitting `reqresFinishingUp` at this point is likely
        // to lose data.

        // However, `debugReqresFinishingUp` are safe to emit.
        if (debugReqresFinishingUp.length > 0)
            // This means Chromium generated some debug events without
            // generating the corresponding webRequest events. This actually
            // happens sometimes when loading a tab in background. Chromium
            // has a surprising number of bugs...
            forceFinishingUpDebug();

        if (reqresFinishingUp.length > 0)
            // This means Chromium generated some webRequests but did not
            // generate corresponding debug events. This happens all the time
            // as described in the NB above, but those webRequests will get
            // their debug events generated later. However, when a webRequest
            // is an in-browser redirect (like when uBlock Origin redirecting
            // a Google Analytics .js URL to its own version) no debug events
            // will be emmited for it. So, to get these out of in-flight
            // state, we run following `forceFinishingUpWebRequest` limited to
            // the unsent requests only (and delayed for 10s because of the NB
            // above, it should not really make a difference, but we pause
            // just in case Chromium decides to emit some of those debug
            // events after all).
            debugFinishingUpTID = setTimeout(() => {
                debugFinishingUpTID = null;
                forceFinishingUpWebRequest((r) => !r.sent);
                updateDisplay(true, false);
                scheduleEndgame();
            }, 10000);
    }

    if (config.debugging) {
        if (debugReqresInFlight.size > 0 || reqresInFlight.size > 0)
            console.log("still in-flight", debugReqresInFlight, reqresInFlight);

        if (debugReqresFinishingUp.length > 0 || reqresFinishingUp.length > 0)
            console.log("still unmatched", debugReqresFinishingUp, reqresFinishingUp);
    }

    if (forcing)
        return;

    updateDisplay(true, false);
    scheduleEndgame();
}
