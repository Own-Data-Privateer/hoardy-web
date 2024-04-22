/*
 * Debugger-assisted request collection (for Chromium-based browsers).
 *
 * Copyright (c) 2023 Jan Malakhovski <oxij@oxij.org>
 *
 * This file can be distributed under the terms of the GNU GPL, version 3 or later.
 */

"use strict";

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
        let tabcfg = getTabConfig(tab.id);
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
    switch (method) {
    case "Network.requestWillBeSent":
        params.tabId = debuggee.tabId;
        handleDebugRequestWillBeSent(params, false);
        break;
    case "Network.requestWillBeSentExtraInfo":
        params.tabId = debuggee.tabId;
        handleDebugRequestWillBeSent(params, true);
        break;
    case "Network.responseReceived":
        params.tabId = debuggee.tabId;
        handleDebugResponseRecieved(params, false);
        break;
    case "Network.responseReceivedExtraInfo":
        params.tabId = debuggee.tabId;
        handleDebugResponseRecieved(params, true);
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
    if (debuggee.tabId !== undefined) {
        tabsDebugging.delete(debuggee.tabId);
        if (config.collecting && reason !== "target_closed")
            // In Chrome, it's pretty easy to click the notification or press
            // Escape while doing Control+F and detach the debugger, so let's
            // reattach it immediately
            setTimeout(() => attachDebugger(debuggee.tabId), 1);
    }
}

// state

// similarly to reqresInFlight, indexed by requestId
let debugReqresInFlight = new Map();
// similarly to reqresFinishingUp
let debugReqresFinishingUp = [];

function logDebugRequest(rtype, extra, e) {
    if (config.debugging) {
        let url;
        if (e.request !== undefined)
            url = e.request.url;
        console.log("debug.Network.request " + rtype, extra, e.tabId, e.requestId, url, e);
    }
}

// handlers

function handleDebugRequestWillBeSent(e, extra) {
    // don't do anything if we are globally disabled
    if (!config.collecting) return;

    let dreqres = debugReqresInFlight.get(e.requestId);
    if (dreqres === undefined) {
        dreqres = {
            responseComplete: false,
            responseBody: "",
        };
        debugReqresInFlight.set(e.requestId, dreqres)
    }

    logDebugRequest("request will be sent", extra, e);

    dreqres.tabId = e.tabId;

    if (!extra) {
        dreqres.requestTimeStamp = e.wallTime * 1000;
        dreqres.method = e.request.method;
        dreqres.url = e.request.url;
        if (e.documentURL !== undefined && e.documentURL !== null)
            dreqres.documentUrl = e.documentURL;
        dreqres.requestHeaders = e.request.headers;
    } else {
        if (dreqres.requestTimeStamp === undefined)
            dreqres.requestTimeStamp = Date.now();
        dreqres.requestHeadersExtra = e.headers;
    }
}

function handleDebugResponseRecieved(e, extra) {
    let dreqres = debugReqresInFlight.get(e.requestId);
    if (dreqres === undefined) return;

    logDebugRequest("responce recieved", extra, e);

    if (!extra) {
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
        if (e.statusCode == 301) {
            // if this is a 301 Redirect request, emit it immediately, because
            // there would be neither !extra, nor handleDebugCompleted event
            // for it
            dreqres.statusCode = e.statusCode;
            emitDebugRequest(e.requestId, dreqres, true);
        }
        // can't do the same for 304 Not Modified, because it needs to
        // accumulate both extra and non-extra data first to match to
        // reqresFinishingUp requests, and it does get handleDebugCompleted,
        // so that gets done in processFinishingUp
    }
}

function handleDebugCompleted(e) {
    let dreqres = debugReqresInFlight.get(e.requestId);
    if (dreqres === undefined) return;

    logDebugRequest("completed", false, e);

    emitDebugRequest(e.requestId, dreqres, false);
}

function handleDebugErrorOccuried(e) {
    let dreqres = debugReqresInFlight.get(e.requestId);
    if (dreqres === undefined) return;

    logDebugRequest("error", false, e);

    emitDebugRequest(e.requestId, dreqres, false, "debugger::" + e.errorText);
}

function emitDebugRequest(requestId, dreqres, noResponse, error, dontFinishUp) {
    debugReqresInFlight.delete(requestId)

    // ignore data and file URLs
    if (dreqres.url.startsWith("data:") || dreqres.url.startsWith("file:")) return;

    dreqres.emitTimeStamp = Date.now();
    dreqres.requestId = requestId;

    if (error !== undefined) {
        if (importantError(error))
            console.error("emitDebugRequest", requestId, "error", error, dreqres);
        dreqres.error = error;
    }

    if (!noResponse) {
        browser.debugger.sendCommand({ tabId: dreqres.tabId }, "Network.getResponseBody", { requestId }).then((res) => {
            if (res.base64Encoded)
                dreqres.responseBody = unBase64(res.body);
            else
                dreqres.responseBody = res.body;
            dreqres.responseComplete = error === undefined;
        }, () => {}).finally(() => {
            debugReqresFinishingUp.push(dreqres);
            if (!dontFinishUp)
                processFinishingUpDebug();
        });
        return;
    } else {
        dreqres.responseComplete = true;
        debugReqresFinishingUp.push(dreqres);
        if (!dontFinishUp)
            processFinishingUpDebug();
    }
}

function forceEmitAllDebug(tabId) {
    for (let [requestId, dreqres] of Array.from(debugReqresInFlight.entries())) {
        if (tabId === undefined || tabId === dreqres.tabId)
            emitDebugRequest(requestId, dreqres, false, "debugger::pWebArc::EMIT_FORCED_BY_USER", true);
    }
}

function forceFinishingUpDebug() {
    // match what can be matched
    processFinishingUpDebug();
    // and drop the rest
    reqresFinishingUp = [];
    debugReqresFinishingUp = [];
    updateDisplay(true, false);
}

function debugHeadersMatchScore(dreqres, reqres) {
    let matching = [];
    let unmatching = [];

    function count(headers, dheaders) {
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
        return matching;
    }

    if (dreqres.requestHeadersExtra !== undefined)
        count(reqres.requestHeaders, dreqres.requestHeadersExtra);
    else if (dreqres.requestHeaders !== undefined)
        count(reqres.requestHeaders, dreqres.requestHeaders);

    if (dreqres.responseHeadersExtra !== undefined)
        count(reqres.responseHeaders, dreqres.responseHeadersExtra);
    else if (dreqres.responseHeaders !== undefined)
        count(reqres.responseHeaders, dreqres.responseHeaders);

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

            responseTimeStamp: dreqres.responseTimeStamp,
            statusCode: dreqres.statusCode,
            responseHeaders: [],
            responseComplete: false,
            responseBody: new ChunkedBuffer(),

            emitTimeStamp: dreqres.emitTimeStamp,

            fake: true,
        };
    }

    if (dreqres.error !== undefined)
        closest.errors.push(dreqres.error);

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
        let creqres = emptyCopyOfReqres(closest);
        creqres.statusCode = 304;
        creqres.responseBody = "";
        creqres.responseComplete = true;
        reqresDone.push(creqres);
        // and then, again, normally
    }

    closest.responseBody = dreqres.responseBody;
    closest.responseComplete = dreqres.responseComplete;
    reqresDone.push(closest);
}

function processFinishingUpDebug() {
    if (debugReqresFinishingUp.length > 0 && reqresFinishingUp.length > 0) {
        // match elements from debugReqresFinishingUp to elements from
        // reqresFinishingUp, attach the former to the best-matching latter,
        // and then push the latter to reqresDone
        let notFinished = [];

        for (let dreqres of debugReqresFinishingUp) {
            let matching = [];
            let notMatching = [];
            for (let reqres of reqresFinishingUp) {
                if (dreqres.tabId == reqres.tabId
                    && dreqres.method == reqres.method
                    && dreqres.url == reqres.url
                    && dreqres.statusCode === reqres.statusCode)
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

    if (debugReqresFinishingUp.length > 0
        && reqresFinishingUp.length === 0 && reqresInFlight.size === 0) {
        // This means Chromium generated some debug events without generating
        // WebRequest events. This actually happens sometimes when loading a
        // tab in background. Chromium has a surprising number of bugs...
        //
        // Anyway, we can't do anything about it, except emit these by making
        // up fake WebRequest counterparts for them.

        for (let dreqres of debugReqresFinishingUp) {
            if (config.debugging)
                console.log("STUCK", dreqres);

            emitDone(undefined, dreqres);
        }

        debugReqresFinishingUp = [];
    }

    if (config.debugging) {
        if (debugReqresFinishingUp.length + reqresFinishingUp.length == 0)
            console.log("matched everything");
        else
            console.log("still unmatched", debugReqresFinishingUp, reqresFinishingUp);
    }

    updateDisplay(true, false);
    setTimeout(processDone, 1);
}
