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
 * Handling of captured reqres being split into a `loggable` and a `dump`.
 */

"use strict";

// State

// problematic archivables
let reqresProblematic = [];
let reqresUnproblematic = [];

function applyToReqresProblematic1(func, a) {
    for (let v of reqresProblematic)
        func(v[0], a);
}

function getProblematic() {
    return pushFirstTo(reqresProblematic, []);
}

// archivables in limbo, waiting to be either dropped or queued
let reqresLimbo = [];
let reqresLimboSize = 0;
// request log
let reqresLog = [];
// archivables in the process of being archived
let reqresQueue = [];
let reqresQueueSize = 0;

function applyToReqresNotInFlight3(func, a, b, c) {
    for (let v of reqresLimbo)
        func(v[0], a);
    for (let v of reqresLog)
        func(v, b);
    for (let v of reqresQueue)
        func(v[0], c);
}

// Logging

function getInLimbo() {
    return pushFirstTo(reqresLimbo, []);
}

function getQueued() {
    return pushFirstTo(reqresQueue, []);
}

// User-actions

function partitionArchivables(rrfilter, iterable) {
    let [rrfilter_, rrpredicate] = compileReqresFilter(rrfilter);
    rrfilter = rrfilter_;
    let [popped, unpopped] = partitionN((archivable) => rrpredicate(archivable[0]), rrfilter.limit, iterable);
    return [rrfilter.tabId, popped, unpopped];
}

function unmarkProblematic(rrfilter, newlyUnproblematic, dontBroadcast) {
    if (reqresProblematic.length == 0)
        return [undefined, 0];

    // the following is written as two loops to make it mostly atomic w.r.t. reqresProblematic

    let [tabId, popped, unpopped] = partitionArchivables(rrfilter, reqresProblematic);

    if (popped.length === 0)
        return [undefined, 0];

    let newlyRestashed = [];

    for (let archivable of popped) {
        let [loggable, dump] = archivable;
        try {
            let tabstate = getTabState(loggable.tabId, loggable.fromExtension);
            loggable.problematic = false;
            loggable.dirty = true;
            tabstate.problematicTotal -= 1;
            tabstate.problematicSize -= loggable.dumpSize;

            if (loggable.inLS !== undefined)
                // it was stashed before, re-stash it
                newlyRestashed.push(archivable);
        } catch (err) {
            logHandledError(err);
            markAsBuggedOut(err, archivable);
        }
    }

    reqresProblematic = unpopped;
    if (newlyUnproblematic !== undefined)
        newlyUnproblematic.push(...popped);

    if (dontBroadcast)
        return [tabId, popped.length];

    // since archivables in `reqresProblematic` can also be in any of these
    broadcastToState(tabId, "resetProblematic", getProblematic);
    broadcastToState(tabId, "resetInLimbo", getInLimbo);
    broadcastToState(tabId, "resetLog", reqresLog);

    if (newlyRestashed.length > 0)
        runSynchronouslyB("stash", stashMany, newlyRestashed);

    return [tabId, popped.length];
}

function syncUnmarkProblematic(...args) {
    runSynchronouslyB("unmarkProblematic", (...args) => unmarkProblematic(...args)[0], ...args);
}

function unmarkProblematicSimilarTo(loggable, allowInLimbo, newlyUnproblematic, dontBroadcast) {
    // TODO: more methods
    if (!config.autoUnmarkProblematicSimilar || loggable.method !== "GET")
        return [undefined, 0];

    return unmarkProblematic({
        sessionId: loggable.sessionId,
        tabId: config.autoUnmarkProblematicSimilarAcrossTabs ? null : loggable.tabId,
        method: loggable.method,
        url: loggable.url,
        // if the `loggable` is not `picked` it should only evict other non-`picked` reqres
        picked: loggable.picked ? null : false,
        in_limbo: allowInLimbo ?
            // if the `loggable` is `in_limbo`, then it should only evict other `in_limbo` reqres
            // since this `loggable` can still be discarded later, but setting
            // `config.autoUnmarkProblematicSimilarAcrossLimbo` will ignore this rule
            (loggable.in_limbo && !config.autoUnmarkProblematicSimilarAcrossLimbo ? true : null) :
            false,
    }, newlyUnproblematic, dontBroadcast);
}

function rotateProblematic(rrfilter) {
    if (reqresProblematic.length == 0)
        return;

    let [tabId, popped, unpopped] = partitionArchivables(rrfilter, reqresProblematic);

    // append them to the end
    unpopped.push(...popped);
    reqresProblematic = unpopped;

    broadcastToState(tabId, "resetProblematic", getProblematic);

    return tabId;
}

function syncRotateProblematic(...args) {
    runSynchronouslyB("rotateProblematic", rotateProblematic, ...args);
}

function popInLimbo(collect, rrfilter) {
    if (reqresLimbo.length == 0)
        return [undefined, 0];

    let [tabId, popped, unpopped] = partitionArchivables(rrfilter, reqresLimbo);

    if (popped.length === 0)
        return [undefined, 0];

    // this is written as a separate loop to make it mostly atomic w.r.t. reqresLimbo

    let minusSize = 0;
    let someProblematic = false;
    let newlyUnproblematic = [];
    let newlyQueued = [];
    let newlyLogged = [];
    let newlyStashed = [];
    let newlyUnstashed = [];

    for (let archivable of popped) {
        let [loggable, dump] = archivable;
        someProblematic = someProblematic || loggable.problematic;
        try {
            let dumpSize = loggable.dumpSize;
            minusSize += dumpSize;

            let tabstate = getTabState(loggable.tabId, loggable.fromExtension);

            unmarkProblematicSimilarTo(loggable, false, newlyUnproblematic, true);

            loggable.in_limbo = false;
            loggable.dirty = true;
            if (loggable.sessionId === sessionId) {
                tabstate.inLimboTotal -= 1;
                tabstate.inLimboSize -= dumpSize;
            }

            processNonLimbo(archivable, collect, tabstate, newlyQueued, newlyLogged, newlyStashed, newlyUnstashed);
        } catch (err) {
            logHandledError(err);
            markAsBuggedOut(err, archivable);
        }
    }

    reqresLimbo = unpopped;
    reqresLimboSize -= minusSize;

    truncateLog();

    if (newlyUnproblematic.length > 0) {
        // TODO mergeUpdatedTabIds?
        broadcastToState(null, "resetProblematic", getProblematic);
        reqresUnproblematic.push(...newlyUnproblematic);
    } else if (someProblematic)
        // since reqres statuses have changed
        broadcastToState(tabId, "resetProblematic", getProblematic);
    // since (popped.length > 0)
    broadcastToState(tabId, "resetInLimbo", getInLimbo);
    if (newlyQueued.length > 0)
        broadcastToState(tabId, "appendQueued", newlyQueued);
    if (newlyLogged.length > 0)
        broadcastToState(tabId, "appendLog", newlyLogged);

    if (newlyStashed.length > 0)
        runSynchronouslyB("stash", stashMany, newlyStashed);
    if (newlyUnstashed.length > 0)
        runSynchronouslyB("unstash", deleteMany, newlyUnstashed);

    return [tabId, popped.length];
}

function syncPopInLimbo(...args) {
    runSynchronouslyB("popInLimbo", (...args) => popInLimbo(...args)[0], ...args);
}

function rotateInLimbo(rrfilter) {
    if (reqresLimbo.length == 0)
        return;

    let [tabId, popped, unpopped] = partitionArchivables(rrfilter, reqresLimbo);

    // append them to the end
    unpopped.push(...popped);
    reqresLimbo = unpopped;

    broadcastToState(tabId, "resetInLimbo", getInLimbo);

    return tabId;
}

function syncRotateInLimbo(...args) {
    runSynchronouslyB("rotateInLimbo", rotateInLimbo, ...args);
}

function truncateLog() {
    while (reqresLog.length > config.history)
        reqresLog.shift();
}

function forgetLog(rrfilter) {
    if (reqresLog.length == 0)
        return;

    let [rrfilter_, rrpredicate] = compileReqresFilter(rrfilter);
    rrfilter = rrfilter_;
    let tabId = rrfilter.tabId;
    let [popped, unpopped] = partitionN((loggable) => !loggable.problematic && rrpredicate(loggable), rrfilter.limit, reqresLog);

    if (popped.length === 0)
        return;

    reqresLog = unpopped;

    broadcastToState(tabId, "resetLog", reqresLog);

    return tabId;
}

function syncForgetLog(...args) {
    runSynchronouslyB("forgetLog", forgetLog, ...args);
}

// (Re-)creation of loggable reqres.

function addLoggableFields(loggable) {
    // status in `hoardy-web`
    loggable.status = (loggable.requestComplete ? "C" : "I") +
        (loggable.responded
         ? loggable.statusCode.toString() + (loggable.responseComplete ? "C" : "I")
         : "N");
}

function makeLoggable(reqres) {
    let loggable = shallowCopyOfReqres(reqres);
    addLoggableFields(loggable);
    return loggable;
}

function updateLoggable(loggable) {
    if (loggable.sessionId !== sessionId)
        return;

    let tabcfg = getTabConfig(loggable.tabId, loggable.fromExtension);
    if (loggable.bucket !== tabcfg.bucket) {
        loggable.bucket = tabcfg.bucket;
        loggable.dirty = true;
    }
}

function deserializeLoggable(loggable) {
    // fixup various things
    function rename(from, to) {
        let old = loggable[from];
        if (old === undefined)
            return;
        delete loggable[from];
        loggable[to] = old;
    }

    rename("sent", "submitted");
    rename("fake", "requestBuggy");
    if (loggable.requestBuggy)
        loggable.requestComplete = loggable.fromCache;

    if (loggable.errors !== undefined) {
        let [popped, unpopped] = partitionN(
            (err) => err == "webRequest::capture::RESPONSE::BROKEN" || err == "webRequest::pWebArc::RESPONSE::BROKEN",
            null, loggable.errors);

        if (popped.length !== 0) {
            loggable.responseBuggy = true;
            loggable.errors = unpopped;
        }
    }

    addLoggableFields(loggable);
}

// Reqres processing.

// get header value as string
function getHeaderString(header) {
    if (header.binaryValue !== undefined) {
        let dec = new TextDecoder("utf-8", { fatal: false });
        return dec.decode(header.binaryValue);
    } else {
        return header.value;
    }
}

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

let sourceDesc = browser.nameVersion + "+Hoardy-Web/" + manifest.version;

// render reqres structure into a CBOR dump
function renderReqres(encoder, reqres) {
    let rest = {};

    if (isValidStr(reqres.documentUrl))
        rest.document_url = reqres.documentUrl;

    if (isValidStr(reqres.originUrl))
        rest.origin_url = reqres.originUrl;

    if (reqres.errors.length > 0)
        rest.errors = reqres.errors;

    if (reqres.fromCache)
        rest.from_cache = true;

    if (!reqres.submitted)
        rest.submitted = false;

    // buggy metadata capture
    if (reqres.requestBuggy)
        rest.request_buggy = true;

    if (reqres.responseBuggy)
        rest.response_buggy = true;

    // response was genererated by another extension or a service/shared worker
    if (reqres.generated)
        rest.generated = true;

    let response = null;
    if (reqres.responded) {
        response = [
            Math.floor(reqres.responseTimeStamp),
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
            Math.floor(reqres.requestTimeStamp),
            reqres.method,
            reqres.url,
            encodeHeaders(reqres.requestHeaders),
            reqres.requestComplete,
            reqres.requestBody,
        ],
        response,
        Math.floor(reqres.emitTimeStamp),
        rest,
    ], {
        allowNull: true,
        allowUndefined: false,
    });
}

function processNonLimbo(archivable, collect, tabstate, newlyQueued, newlyLogged, newlyStashed, newlyUnstashed) {
    let [loggable, dump] = archivable;
    let dumpSize = loggable.dumpSize;

    loggable.collected = collect;
    if (collect) {
        reqresQueue.push(archivable);
        reqresQueueSize += dumpSize;
        newlyQueued.push(loggable);
        gotNewQueued = true;

        tabstate.collectedTotal += 1;
        tabstate.collectedSize += dumpSize;

        if (!config.archive && config.stash)
            // stuck queue, stash it
            newlyStashed.push(archivable);
    } else {
        tabstate.discardedTotal += 1;
        tabstate.discardedSize += dumpSize;

        if (loggable.inLS !== undefined)
            // it was stashed before, unstash it
            newlyUnstashed.push(archivable);
    }

    reqresLog.push(loggable);
    newlyLogged.push(loggable);
}

async function processOneAlmostDone(reqres, newlyProblematic, newlyUnproblematic, newlyLimboed, newlyQueued, newlyLogged, newlyStashed, newlyUnstashed) {
    if (reqres.tabId === undefined)
        // just in case
        reqres.tabId = TAB_ID_NONE;

    if (!useDebugger && reqres.generated && !reqres.responded) {
        if (reqres.errors.length === 1 && reqres.errors[0].startsWith("webRequest::NS_ERROR_NET_ON_")) {
            // (raceCondition)
            //
            // This happens when the networking code in Firefox gets
            // interrupted by a service/shared worker fulfilling the request.
            //
            // See the top of
            // `devtools/shared/network-observer/NetworkObserver.sys.mjs` and
            // `activityErrorsMap` function in
            // `toolkit/components/extensions/webrequest/WebRequest.sys.mjs` in
            // Firefox sources for how those error codes get emitted.
            //
            // Ideally, `onErrorOccurred` would simply specify all the fields
            // `onCompleted` does in this case, but it does not, so we have to
            // handle it specially here.
            reqres.responded = true;
            reqres.responseTimeStamp = reqres.emitTimeStamp;
            reqres.statusCode = 200;
            reqres.reason = "Assumed OK";
            reqres.responseBuggy = true;
        } else
            // This was a normal error, not a race between the response
            // generator and the networking code.
            reqres.generated = false;
    }

    if (!useDebugger && reqres.responseComplete && reqres.errors.some(isIncompleteError))
        // Apparently, sometimes Firefox calls `filter.onstop` for aborted
        // requests as if nothing out of the ordinary happened. It is a
        // bug, yes.
        //
        // Our `filter.onstop` marks requests as complete. So, we have to
        // undo that.
        //
        // We are doing that here instead of in `emitRequest` because the
        // `filter` is guaranteed to be finished here.
        reqres.responseComplete = false;

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
        if (lineProtocol !== undefined && lineProtocol !== "")
            reqres.protocol = lineProtocol;
        else if (getHeaderValue(reqres.requestHeaders, ":authority") !== undefined)
            reqres.protocol = "HTTP/2.0";
        else
            reqres.protocol = "HTTP/1.0";
    }

    if (reqres.reason === undefined) {
        if (lineReason !== undefined)
            reqres.reason = lineReason;
        else
            reqres.reason = "";
    }

    let updatedTabId = reqres.tabId;
    let statusCode = reqres.statusCode;

    let tabcfg = getTabConfig(updatedTabId, reqres.fromExtension);
    let tabstate = getTabState(updatedTabId, reqres.fromExtension);

    let state = "complete";
    let problematic = false;
    let picked = true;

    if (reqres.protocol === "SNAPSHOT") {
        // it's a snapshot
        state = "snapshot";
    } else if (!reqres.submitted) {
        // it failed somewhere before handleSendHeaders or was redirected
        // internally (e.g. by an extension)
        state = "canceled";
        problematic = config.markProblematicCanceled;
        picked = config.archiveCanceled;
    } else if (!reqres.responded) {
        // no response after sending headers
        state = "no_response";
        problematic = config.markProblematicNoResponse;
        picked = config.archiveNoResponse;
        // filter.onstop might have set it to true
        reqres.responseComplete = false;
    } else if (!reqres.responseComplete) {
        state = "incomplete";
        problematic = config.markProblematicIncomplete;
        picked = config.archiveIncompleteResponse;
    } else if (!useDebugger && statusCode === 200 && reqres.fromCache && reqres.responseBody.byteLength == 0) {
        let clength = getHeaderValue(reqres.responseHeaders, "Content-Length")
        if (clength !== undefined && clength !== 0) {
            // Under Firefox, filterResponseData filters will get empty response data for some
            // cached objects. We use a special state for these, as this is not really an error,
            // and reloading the page will not help in archiving that data, as those requests
            // will be answered from cache again. (But reloading the page with cache disabled
            // with Control+F5 will.)
            state = "incomplete_fc";
            problematic = config.markProblematicIncompleteFC;
            picked = config.archiveIncompleteResponse;
            // filter.onstop will have set it to true
            reqres.responseComplete = false;
        } else
            state = "complete_fc";
    } else if (reqres.fromCache)
        state = "complete_fc";

    let sent = reqres.submitted && !reqres.fromCache;

    if (!reqres.requestComplete) {
        // requestBody recovered from formData
        problematic = problematic || sent && config.markProblematicPartialRequest;
        picked = picked && config.archivePartialRequest;
    }

    if (reqres.requestBuggy || reqres.responseBuggy) {
        // buggy metadata capture
        problematic = problematic || sent && config.markProblematicBuggy;
        picked = picked && config.archiveBuggy;
    }

    if (!reqres.responded || statusCode >= 200 && statusCode < 300) {
        // do nothing
    } else if (statusCode >= 100 && statusCode < 200)
        picked = picked && config.archive1xxCodes;
    else if (statusCode >= 300 && statusCode < 400)
        picked = picked && config.archive3xxCodes;
    else if (transientStatusCodes.has(statusCode)) {
        picked = picked && config.archiveTransientCodes;
        problematic = problematic || config.markProblematicTransientCodes;
    } else if (statusCode >= 400 && statusCode < 600) {
        picked = picked && config.archivePermanentCodes;
        problematic = problematic || config.markProblematicPermanentCodes;
    } else
        // a weird status code, mark it!
        problematic = true;

    if (!reqres.errors.every(isTrivialError)) {
        // it had some potentially problematic errors
        picked = picked && config.archiveWithErrors;
        problematic = problematic
            || (config.markProblematicWithImportantErrors
                && reqres.errors.some(isImportantError))
            || (picked ? config.markProblematicPickedWithErrors
                       : config.markProblematicDroppedWithErrors);
    }

    let in_limbo = picked && tabcfg.limbo || !picked && tabcfg.negLimbo;

    // dump it to console when debugging
    if (config.debugCaptures || config.dumpCaptures)
        console.warn(
            picked ? "PICKED" : "DROPPED",
            in_limbo ? "LIMBO" : "QUEUED",
            reqres.requestId,
            "state", state,
            reqres.protocol, reqres.method, reqres.url,
            "tabId", updatedTabId,
            "req", reqres.requestComplete,
            "res", reqres.responseComplete,
            "result", statusCode, reqres.reason, reqres.statusLine,
            "errors", reqres.errors,
            "bucket", tabcfg.bucket,
            reqres);

    let loggable = makeLoggable(reqres);
    loggable.bucket = tabcfg.bucket;
    loggable.net_state = state;
    loggable.was_problematic = loggable.problematic = problematic;
    loggable.picked = picked;
    loggable.was_in_limbo = loggable.in_limbo = in_limbo;

    let dump;
    let dumpSize;
    {
        let encoder = new CBOREncoder();
        renderReqres(encoder, reqres);

        if (in_limbo || picked) {
            dump = encoder.result();
            dumpSize = dump.byteLength;

            if (config.dumpCaptures)
                dumpToConsole(dump);
        } else {
            dump = null;
            dumpSize = encoder.resultByteLength;
        }
    }

    loggable.dumpSize = dumpSize;
    let archivable = [loggable, dump];

    unmarkProblematicSimilarTo(loggable, true, newlyUnproblematic, true);

    if (picked) {
        tabstate.pickedTotal += 1;
        tabstate.pickedSize += dumpSize;
    } else {
        tabstate.droppedTotal += 1;
        tabstate.droppedSize += dumpSize;
    }

    if (in_limbo) {
        reqresLimbo.push(archivable);
        reqresLimboSize += dumpSize;
        tabstate.inLimboTotal += 1;
        tabstate.inLimboSize += dumpSize;
        newlyLimboed.push(loggable);
        if (config.stash && tabcfg.stashLimbo)
            newlyStashed.push(archivable);
        gotNewLimbo = true;
    } else
        processNonLimbo(archivable, picked, tabstate, newlyQueued, newlyLogged, newlyStashed, newlyUnstashed);

    if (problematic) {
        reqresProblematic.push(archivable);
        tabstate.problematicTotal += 1;
        tabstate.problematicSize += dumpSize;
        newlyProblematic.push(loggable);
        if (tabcfg.problematicNotify)
            gotNewProblematic = true;
    }
}

async function processAlmostDone() {
    let updatedTabId;

    let newlyProblematic = [];
    let newlyUnproblematic = [];
    let newlyLimboed = [];
    let newlyQueued = [];
    let newlyLogged = [];
    let newlyStashed = [];
    let newlyUnstashed = [];

    while (reqresAlmostDone.length > 0) {
        let reqres = reqresAlmostDone.shift();
        let tabId = reqres.tabId;

        try {
            await processOneAlmostDone(reqres, newlyProblematic, newlyUnproblematic, newlyLimboed, newlyQueued, newlyLogged, newlyStashed, newlyUnstashed);
        } catch (err) {
            logHandledError(err);
            markAsBuggedOut(err, [reqres, null]);
        }

        let tabstate = getTabState(tabId, reqres.fromExtension);
        tabstate.emitTimeStamp = reqres.emitTimeStamp;

        updatedTabId = mergeUpdatedTabIds(updatedTabId, tabId);
        scheduleUpdateDisplay(true, tabId, false, getGoodEpisodic(reqresAlmostDone.length));
    }

    truncateLog();

    broadcastToState(updatedTabId, "resetInFlight", () => getInFlight(null));

    if (newlyUnproblematic.length > 0) {
        // TODO mergeUpdatedTabIds?
        broadcastToState(null, "resetProblematic", getProblematic);
        reqresUnproblematic.push(...newlyUnproblematic);
    } else if (newlyProblematic.length > 0)
        broadcastToState(updatedTabId, "appendProblematic", newlyProblematic);
    if (newlyLimboed.length > 0)
        broadcastToState(updatedTabId, "appendInLimbo", newlyLimboed);
    if (newlyQueued.length > 0)
        broadcastToState(updatedTabId, "appendQueued", newlyQueued);
    if (newlyLogged.length > 0)
        broadcastToState(updatedTabId, "appendLog", newlyLogged);

    if (newlyStashed.length > 0)
        runSynchronouslyB("stash", stashMany, newlyStashed);
    if (newlyUnstashed.length > 0)
        runSynchronouslyB("unstash", deleteMany, newlyUnstashed);

    // scheduleEndgame by the caller

    return updatedTabId;
}
