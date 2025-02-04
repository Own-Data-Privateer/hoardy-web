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
// archivables in limbo, waiting to be either dropped or queued
let reqresLimbo = [];
let reqresLimboSize = 0;
// request log
let reqresLog = [];
// archivables in the process of being archived
let reqresQueue = [];
let reqresQueueSize = 0;

// Logging

function getProblematicLog() {
    return pushFirstTo(reqresProblematic, []);
}

function getInLimboLog() {
    return pushFirstTo(reqresLimbo, []);
}

function getQueuedLog() {
    return pushFirstTo(reqresQueue, []);
}

// User-actions

function isAcceptedLoggable(tabId, rrfilter, loggable) {
    return (tabId === null || loggable.sessionId === sessionId && loggable.tabId === tabId)
        && (rrfilter === null || isAcceptedBy(rrfilter, loggable));
}

function unmarkProblematic(num, tabId, rrfilter) {
    if (reqresProblematic.length == 0)
        return;
    if (rrfilter === undefined)
        rrfilter = null;

    let [popped, unpopped] = partitionN((archivable) => {
        let [loggable, dump] = archivable;
        return isAcceptedLoggable(tabId, rrfilter, loggable);
    }, num, reqresProblematic);

    if (popped.length === 0)
        return 0;

    // this is written as a separate loop to make it mostly atomic w.r.t. reqresProblematic

    for (let archivable of popped) {
        let [loggable, dump] = archivable;
        try {
            let info = getOriginState(loggable.tabId, loggable.fromExtension);
            loggable.problematic = false;
            loggable.dirty = true;
            info.problematicTotal -= 1;
        } catch (err) {
            logHandledError(err);
            markAsErrored(err, archivable);
        }
    }

    reqresProblematic = unpopped;

    // reset all the logs, since some statuses may have changed
    broadcastToState(tabId, "resetProblematicLog", getProblematicLog);
    broadcastToState(tabId, "resetInLimboLog", getInLimboLog);
    broadcastToState(tabId, "resetLog", reqresLog);

    scheduleEndgame(tabId, 0);

    return popped.length;
}

function rotateProblematic(num, tabId, rrfilter) {
    if (reqresProblematic.length == 0)
        return;
    if (rrfilter === undefined)
        rrfilter = null;

    let [popped, unpopped] = partitionN((archivable) => {
        let [loggable, dump] = archivable;
        return isAcceptedLoggable(tabId, rrfilter, loggable);
    }, num, reqresProblematic);

    // append them to the end
    unpopped.push(...popped);
    reqresProblematic = unpopped;

    broadcastToState(tabId, "resetProblematicLog", getProblematicLog);
}

function popInLimbo(collect, num, tabId, rrfilter) {
    if (reqresLimbo.length == 0)
        return;
    if (rrfilter === undefined)
        rrfilter = null;

    let [popped, unpopped] = partitionN((archivable) => {
        let [loggable, dump] = archivable;
        return isAcceptedLoggable(tabId, rrfilter, loggable);
    }, num, reqresLimbo);

    if (popped.length === 0)
        return 0;

    // this is written as a separate loop to make it mostly atomic w.r.t. reqresLimbo

    let minusSize = 0;
    let newlyQueued = [];
    let newlyLogged = [];
    let newlyStashed = [];
    let newlyUnstashed = [];

    for (let archivable of popped) {
        let [loggable, dump] = archivable;
        try {
            let dumpSize = loggable.dumpSize;
            minusSize += dumpSize;

            let info = getOriginState(loggable.tabId, loggable.fromExtension);
            loggable.in_limbo = false;
            loggable.dirty = true;
            if (loggable.sessionId === sessionId) {
                info.inLimboTotal -= 1;
                info.inLimboSize -= dumpSize;
            }
            processNonLimbo(collect, info, archivable, newlyQueued, newlyLogged, newlyStashed, newlyUnstashed);
        } catch (err) {
            logHandledError(err);
            markAsErrored(err, archivable);
        }
    }

    reqresLimbo = unpopped;
    reqresLimboSize -= minusSize;
    truncateLog();
    wantSaveGlobals = true;

    // reset problematic, since reqres statuses have changed
    broadcastToStateWhen(popped.some((r) => r.problematic === true), tabId, "resetProblematicLog", getProblematicLog);
    // since (popped.length > 0)
    broadcastToState(tabId, "resetInLimboLog", getInLimboLog);
    broadcastToStateWhen(newlyQueued.length > 0, tabId, "newQueued", newlyQueued);
    broadcastToStateWhen(newlyLogged.length > 0, tabId, "newLog", newlyLogged);

    runSynchronouslyWhen(newlyStashed.length > 0, "stash", stashMany, newlyStashed);
    runSynchronouslyWhen(newlyUnstashed.length > 0, "unstash", unstashMany, newlyUnstashed);

    scheduleEndgame(tabId, 0);

    return popped.length;
}

function rotateInLimbo(num, tabId, rrfilter) {
    if (reqresLimbo.length == 0)
        return;
    if (rrfilter === undefined)
        rrfilter = null;

    let [popped, unpopped] = partitionN((archivable) => {
        let [loggable, dump] = archivable;
        return isAcceptedLoggable(tabId, rrfilter, loggable);
    }, num, reqresLimbo);

    // append them to the end
    unpopped.push(...popped);
    reqresLimbo = unpopped;

    broadcastToState(tabId, "resetInLimboLog", getInLimboLog);
}

function truncateLog() {
    while (reqresLog.length > config.history)
        reqresLog.shift();
}

function forgetHistory(tabId, rrfilter) {
    if (reqresLog.length == 0)
        return;
    if (rrfilter === undefined)
        rrfilter = null;

    let [popped, unpopped] = partitionN((loggable) => {
        return isAcceptedLoggable(tabId, rrfilter, loggable);
    }, null, reqresLog);

    if (popped.length === 0)
        return;

    reqresLog = unpopped;
    broadcastToState(tabId, "resetLog", reqresLog);
    scheduleUpdateDisplay(true, tabId);
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

    let options = getOriginConfig(loggable.tabId, loggable.fromExtension);
    if (loggable.bucket !== options.bucket) {
        loggable.bucket = options.bucket;
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

    if (isDefinedURL(reqres.documentUrl))
        rest.document_url = reqres.documentUrl;

    if (isDefinedURL(reqres.originUrl))
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

function processNonLimbo(collect, info, archivable, newlyQueued, newlyLogged, newlyStashed, newlyUnstashed) {
    let [loggable, dump] = archivable;
    let dumpSize = loggable.dumpSize;
    if (collect) {
        loggable.collected = true;
        reqresQueue.push(archivable);
        reqresQueueSize += dumpSize;
        newlyQueued.push(loggable);
        gotNewQueued = true;

        globals.collectedTotal += 1;
        globals.collectedSize += dumpSize;
        info.collectedTotal += 1;
        info.collectedSize += dumpSize;

        if (!config.archive && config.stash)
            // stuck queue, stash it
            newlyStashed.push(archivable);
    } else {
        loggable.collected = false;
        globals.discardedTotal += 1;
        globals.discardedSize += dumpSize;
        info.discardedTotal += 1;
        info.discardedSize += dumpSize;

        if (loggable.inLS !== undefined)
            // it was stashed before, unstash it
            newlyUnstashed.push(archivable);
    }

    reqresLog.push(loggable);
    newlyLogged.push(loggable);
}

async function processOneAlmostDone(reqres, newlyProblematic, newlyLimboed, newlyQueued, newlyLogged, newlyStashed, newlyUnstashed) {
    if (reqres.tabId === undefined)
        // just in case
        reqres.tabId = -1;

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

    let options = getOriginConfig(updatedTabId, reqres.fromExtension);
    let info = getOriginState(updatedTabId, reqres.fromExtension);

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

    let in_limbo = picked && options.limbo || !picked && options.negLimbo;

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
            "bucket", options.bucket,
            reqres);

    let loggable = makeLoggable(reqres);
    loggable.bucket = options.bucket;
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

    if (picked) {
        globals.pickedTotal += 1;
        info.pickedTotal += 1;
    } else {
        globals.droppedTotal += 1;
        info.droppedTotal += 1;
    }

    if (in_limbo) {
        reqresLimbo.push(archivable);
        reqresLimboSize += dumpSize;
        info.inLimboTotal += 1;
        info.inLimboSize += dumpSize;
        newlyLimboed.push(loggable);
        if (config.stash && options.stashLimbo)
            newlyStashed.push(archivable);
        gotNewLimbo = true;
    } else
        processNonLimbo(picked, info, archivable, newlyQueued, newlyLogged, newlyStashed, newlyUnstashed);

    if (problematic) {
        reqresProblematic.push(archivable);
        info.problematicTotal += 1;
        newlyProblematic.push(loggable);
        if (options.problematicNotify)
            gotNewProblematic = true;
    }

    wantSaveGlobals = true;
}

async function processAlmostDone(updatedTabId) {
    let newlyProblematic = [];
    let newlyLimboed = [];
    let newlyQueued = [];
    let newlyLogged = [];
    let newlyStashed = [];
    let newlyUnstashed = [];

    while (reqresAlmostDone.length > 0) {
        let reqres = reqresAlmostDone.shift();
        try {
            await processOneAlmostDone(reqres, newlyProblematic, newlyLimboed, newlyQueued, newlyLogged, newlyStashed, newlyUnstashed);
        } catch (err) {
            logHandledError(err);
            markAsErrored(err, [reqres, null]);
        }
        let tabId = reqres.tabId;
        updatedTabId = mergeUpdatedTabIds(updatedTabId, tabId);
        scheduleUpdateDisplay(true, tabId, false, getGoodEpisodic(reqresAlmostDone.length));
    }

    truncateLog();

    broadcastToState(updatedTabId, "resetInFlight", getInFlightLog);

    broadcastToStateWhen(newlyProblematic.length > 0, updatedTabId, "newProblematic", newlyProblematic);
    broadcastToStateWhen(newlyLimboed.length > 0, updatedTabId, "newLimbo", newlyLimboed);
    broadcastToStateWhen(newlyQueued.length > 0, updatedTabId, "newQueued", newlyQueued);
    broadcastToStateWhen(newlyLogged.length > 0, updatedTabId, "newLog", newlyLogged);

    runSynchronouslyWhen(newlyStashed.length > 0, "stash", stashMany, newlyStashed);
    runSynchronouslyWhen(newlyUnstashed.length > 0, "unstash", unstashMany, newlyUnstashed);

    return updatedTabId;
}
