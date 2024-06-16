/*
 * Debugger-assisted request collection (for Chromium-based browsers).
 *
 * Copyright (c) 2023-2024 Jan Malakhovski <oxij@oxij.org>
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
let tabsAttaching = new Map();

async function attachAndInitDebuggingTarget(tabId) {
    let debuggee = { tabId };

    let lastError = undefined;
    for (let retries = 0; retries < 10; ++retries) {
        try {
            await browser.debugger.attach(debuggee, "1.3");
        } catch (err) {
            lastError = err;
            if (typeof err !== "string")
                throw err;
            else if (err === "Cannot access a chrome:// URL"
                || err.startsWith("Cannot access contents of url"))
                throw err;
            else if (!err.startsWith("Another debugger is already attached to the tab with id:"))
                throw err;
            // otherwise, continue as normal
        }

        try {
            await browser.debugger.sendCommand(debuggee, "Network.enable", {});
            //await browser.debugger.sendCommand(debuggee, "Fetch.enable", {});
            //await browser.debugger.sendCommand(debuggee, "Page.enable", {});
        } catch (err) {
            // this could happen if the debugger gets detached immediately
            // after it gets attached, so we retry again
            lastError = err;
            await sleep(100);
            continue;
        }

        lastError = undefined;
        break;
    }

    if (lastError !== undefined)
        throw lastError;

    tabsDebugging.add(tabId);
    if (config.debugging)
        console.log("attached debugger to tab", tabId);
}

async function attachDebugger(tabId) {
    if (tabsDebugging.has(tabId))
        // nothing to do
        return;

    if (config.debugging)
        console.log("attaching debugger to tab", tabId);

    // NB: self-destructing using `tabsAttaching.delete`
    await cacheSingleton(tabsAttaching, tabId,
        (tabId) => attachAndInitDebuggingTarget(tabId).finally(() => tabsAttaching.delete(tabId)));
}

function detachDebugger(tabId) {
    let debuggee = { tabId };
    return browser.debugger.detach(debuggee).then(() => {
        tabsDebugging.delete(tabId);
        if (config.debugging)
            console.log("detached debugger from tab", tabId);
    });
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
    case "Network.dataReceived":
    case "Network.resourceChangedPriority":
        // ignore
        break;
    default:
        console.warn("debugger", debuggee, method, params);
    }
}

function handleDebugDetach(debuggee, reason) {
    if (reason !== "target_closed")
        console.warn("debugger detached", debuggee, reason);
    else if (config.debugging)
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
            setTimeout(() => attachDebugger(tabId).catch(logErrorExceptWhenStartsWith("No tab with given id")), 1);
        }
    }
}

// state

// similarly to reqresInFlight, indexed by requestId
let debugReqresInFlight = new Map();
// similarly to reqresFinishingUp
let debugReqresFinishingUp = [];

function logDebugEvent(rtype, nonExtra, e, dreqres) {
    if (config.debugging) {
        let url;
        if (e.request !== undefined)
            url = e.request.url;
        console.warn("EVENT debugRequest",
                     rtype + (nonExtra ? "" : "ExtraInfo"),
                     "drequestId", e.requestId,
                     "tabId", e.tabId,
                     "url", url,
                     "event", e,
                     "dreqres", dreqres);
    }
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

// handlers

function handleDebugRequestWillBeSent(nonExtra, e) {
    popSingletonTimeout(scheduledInternal, "debugFinishingUp");

    // don't do anything if we are globally disabled
    if (!config.collecting) return;

    logDebugEvent("requestWillBeSent", nonExtra, e, undefined);

    let dreqres = cacheSingleton(debugReqresInFlight, e.requestId, () => { return {
        requestId: e.requestId,
        tabId: e.tabId,
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
        //requestComplete: true,

        sent: false,
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
        fake: true,
    }; });

    if (nonExtra) {
        dreqres.requestTimeStamp = e.wallTime * 1000;
        dreqres.method = e.request.method;
        dreqres.url = e.request.url;
        if (e.documentURL !== undefined && e.documentURL !== null)
            dreqres.documentUrl = e.documentURL;
        dreqres.requestHeadersDebug = e.request.headers;
        if (!isBoringURL(dreqres.url))
            broadcast(["newInFlight", [shallowCopyOfReqres(dreqres)]]);
    } else {
        if (dreqres.requestTimeStamp === undefined)
            dreqres.requestTimeStamp = Date.now();
        dreqres.requestHeadersDebugExtra = e.headers;
    }

    updateDisplay(0, true, false);
}

function handleDebugResponseRecieved(nonExtra, e) {
    popSingletonTimeout(scheduledInternal, "debugFinishingUp");

    let dreqres = debugReqresInFlight.get(e.requestId);
    if (dreqres === undefined) return;

    logDebugEvent("responseReceived", nonExtra, e, dreqres);

    dreqres.sent = true;
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
    } else {
        if (dreqres.responseTimeStamp === undefined)
            dreqres.responseTimeStamp = Date.now();
        if (dreqres.statusCode === undefined)
            dreqres.statusCode = e.statusCode;
        dreqres.statusCodeExtra = e.statusCode;
        dreqres.responseHeadersDebugExtra = e.headers;
        if (redirectStatusCodes.has(e.statusCode))
            // If this is a redirect request, emit it immediately, because
            // there would be neither nonExtra, nor handleDebugCompleted event
            // for it
            emitDebugRequest(e.requestId, dreqres, false);
        // can't do the same for 304 Not Modified, because it needs to
        // accumulate both extra and non-extra data first to match to
        // reqresFinishingUp requests, and it does get handleDebugCompleted
    }
}

function handleRequestServedFromCache(e) {
    popSingletonTimeout(scheduledInternal, "debugFinishingUp");

    let dreqres = debugReqresInFlight.get(e.requestId);
    if (dreqres === undefined) return;

    logDebugEvent("requestServedFromCache", true, e, dreqres);

    dreqres.fromCache = true;
}

function handleDebugCompleted(e) {
    popSingletonTimeout(scheduledInternal, "debugFinishingUp");

    let dreqres = debugReqresInFlight.get(e.requestId);
    if (dreqres === undefined) return;

    logDebugEvent("loadingFinished", true, e, dreqres);

    emitDebugRequest(e.requestId, dreqres, true);
}

function handleDebugErrorOccuried(e) {
    popSingletonTimeout(scheduledInternal, "debugFinishingUp");

    let dreqres = debugReqresInFlight.get(e.requestId);
    if (dreqres === undefined) return;

    logDebugEvent("loadingFailed", true, e, dreqres);

    if (e.canceled === true) {
        emitDebugRequest(e.requestId, dreqres, false, "debugger::" + (e.errorText ? e.errorText : "net::ERR_CANCELED"));
    } else if (e.blockedReason !== undefined && e.blockedReason !== "") {
        emitDebugRequest(e.requestId, dreqres, false, "debugger::net::ERR_BLOCKED::" + e.blockedReason);
    } else
        emitDebugRequest(e.requestId, dreqres, true, "debugger::" + e.errorText);
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
    if (dreqres.url === undefined || isBoringURL(dreqres.url))
        return;
    // NB: We do this here, instead of any other place because Chromium
    // generates debug events in different orders for different request types.

    dreqres.emitTimeStamp = Date.now();

    if (error !== undefined) {
        if (isUnknownError(error))
            console.error("emitDebugRequest", requestId, "error", error, dreqres);
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

    if (!config.debugging) {
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
                    dreqres.errors.push("debugger::pWebArc::NO_RESPONSE_BODY::DETACHED_DEBUGGER");
                    return;
                } else if (err.startsWith("Cannot access contents of url")) {
                    dreqres.errors.push("debugger::pWebArc::NO_RESPONSE_BODY::ACCESS_DENIED");
                    return;
                }
            }
            dreqres.errors.push("debugger::pWebArc::NO_RESPONSE_BODY::OTHER");
            logError(err);
        }).finally(() => {
            debugReqresFinishingUp.push(dreqres);
            if (config.debugging)
                console.warn("CAPTURED debugRequest drequestId", dreqres.requestId,
                             "tabId", dreqres.tabId,
                             "url", dreqres.url,
                             "dreqres", dreqres);
            if (!dontFinishUp)
                processMatchFinishingUpWebRequestDebug();
        });
    } else {
        dreqres.responseComplete = error === undefined;
        debugReqresFinishingUp.push(dreqres);
        if (config.debugging)
            console.warn("CAPTURED debugRequest drequestId", dreqres.requestId,
                         "tabId", dreqres.tabId,
                         "url", dreqres.url,
                         "dreqres", dreqres);
        if (!dontFinishUp)
            processMatchFinishingUpWebRequestDebug();
    }
}

function forceEmitInFlightDebug(tabId, reason) {
    popSingletonTimeout(scheduledInternal, "debugFinishingUp");

    for (let [requestId, dreqres] of Array.from(debugReqresInFlight.entries())) {
        if (tabId === null || dreqres.tabId === tabId)
            emitDebugRequest(requestId, dreqres, false, "debugger::" + reason, true);
    }

    processMatchFinishingUpWebRequestDebug();
}

function forceFinishingUpDebug(predicate) {
    // Emit these by making up fake webRequest counterparts for them
    for (let dreqres of debugReqresFinishingUp) {
        if (predicate !== undefined && !predicate(reqres))
            continue;

        if (config.debugging)
            console.warn("UNSTUCK debugRequest drequestId", dreqres.requestId,
                         "tabId", dreqres.tabId,
                         "url", dreqres.url,
                         "dreqres", dreqres);

        dreqresToReques(dreqres);
        reqresAlmostDone.push(dreqres);
    }
    debugReqresFinishingUp = [];
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
    if (config.debugging)
        console.log("debugHeadersMatchScore", score, reqres, dreqres);
    return score;
}

// Turn debugging `dreqres` into a structure that can be used as a normal
// webRequest `reqres`. This is used when Chromium bugs out and forgets to
// produce the webRequest part. Essentially, this is a continuation of
// emitDebugRequest, which finishes it up to become a valid `reqres`.
function dreqresToReques(dreqres) {
    dreqres.requestBody = new ChunkedBuffer();
    dreqres.requestComplete = true;
    if (dreqres.responseBody === undefined)
        dreqres.responseBody = new ChunkedBuffer();
    // dreqres.responseComplete is set

    // TODO remove?
    dreqres.originUrl = getHeaderValue(dreqres.requestHeaders, "Referer");
}

// Update webRequest `reqres` with data collected in the debugging `dreqres`.
function mergeInDebugReqres(reqres, dreqres) {
    if (dreqres.documentUrl !== undefined)
        reqres.documentUrl = dreqres.documentUrl;

    if (dreqres.requestTimeStamp < reqres.requestTimeStamp)
        reqres.requestTimeStamp = dreqres.requestTimeStamp;

    for (let e of dreqres.errors)
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

function processMatchFinishingUpWebRequestDebug(forcing) {
    popSingletonTimeout(scheduledInternal, "debugFinishingUp");

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

                if (config.debugging)
                    console.log("MATCHED", dreqres, closest);

                mergeInDebugReqres(closest, dreqres);
                reqresAlmostDone.push(closest);
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
            resetSingletonTimeout(scheduledInternal, "debugFinishingUp", config.workaroundChromiumDebugTimeout * 1000, () => {
                forceFinishingUpWebRequest((r) => !r.sent);
                updateDisplay(0, true, false);
                scheduleEndgame();
            });
    }

    if (config.debugging) {
        if (debugReqresInFlight.size > 0 || reqresInFlight.size > 0)
            console.log("still in-flight", debugReqresInFlight, reqresInFlight);

        if (debugReqresFinishingUp.length > 0 || reqresFinishingUp.length > 0)
            console.log("still unmatched", debugReqresFinishingUp, reqresFinishingUp);
    }

    if (forcing)
        return;

    scheduleEndgame();
}
