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
 * Internal action scheduler.
 */

"use strict";

let runningActions = new Set();

// scheduled cancelable functions
let scheduledCancelable = new Map();
// scheduled retries
let scheduledRetry = new Map();
// scheduled delayed functions
let scheduledDelayed = new Map();
// scheduled save state functions
let scheduledSaveState = new Map();
// scheduled internal functions
let scheduledInternal = new Map();
// scheduled internal functions hidden from the UI
let scheduledHidden = new Map();

// a list of [function, args] pairs; these are closures that need to be run synchronously
let synchronousClosures = [];

async function evalClosures(closures, updatedTabId) {
    while (closures.length > 0) {
        let [name, func, args] = closures.shift();

        if (config.debugRuntime)
            console.warn("SCHEDULER: running sync", name);
        runningActions.add(name);

        await forceUpdateDisplay(true, updatedTabId, getGoodEpisodic(closures.length));
        updatedTabId = undefined;

        try {
            let res = func(...args);
            while (res instanceof Promise)
                res = await res;
        } catch (err) {
            logError(err);
        }

        runningActions.delete(name);
        if (config.debugRuntime)
            console.warn("SCHEDULER: finished sync", name);
    }
}

// syntax sugar
function runSynchronously(name, func, ...args) {
    synchronousClosures.push([name, func, args]);
}

// actions

function syncRunActions() {
    runSynchronously("runAll", async () => {
        //await runAllSingletonTimeouts(scheduledCancelable);
        await runAllSingletonTimeouts(scheduledRetry);
        await runAllSingletonTimeouts(scheduledDelayed);
        await runAllSingletonTimeouts(scheduledSaveState);
    });
}

function syncCancelActions() {
    runSynchronously("cancelAll", async () => {
        await cancelAllSingletonTimeouts(scheduledCancelable);
        await cancelAllSingletonTimeouts(scheduledRetry);
        await cancelAllSingletonTimeouts(scheduledDelayed);
        // `scheduledSaveState` mustn't ever be cancelled, so we run them instead
        await runAllSingletonTimeouts(scheduledSaveState);
    });
}

// Stashing and archivig to browser's local storage.

// ../page/saved.js implementation
let wantBroadcastSaved = false;
let savedFilters = mkReqresFilter({limit: 1024});

function setSavedFilters(rrfilter) {
    savedFilters = updateFromRec(savedFilters, rrfilter);
    broadcastToSaved("setSavedFilters", savedFilters);
    broadcastToSaved("resetSaved", [null]); // invalidate UI
    wantBroadcastSaved = true;
}

// other scheduleEndgame flags
let wantCheckServer = true;
let wantSaveGlobals = false;
let wantBucketSaveAs = false;
let wantRetryAllUnarchived = false;

// accumulated state
let seUpdatedTabId;

// schedule processArchiving, processAlmostDone, etc
function scheduleEndgame(updatedTabId, notifyTimeout) {
    updatedTabId = seUpdatedTabId = mergeUpdatedTabIds(seUpdatedTabId, updatedTabId);

    if (wantCheckServer) {
        resetSingletonTimeout(scheduledHidden, "endgame", 0, async () => {
            await checkServer();
            scheduleEndgame(updatedTabId, notifyTimeout);
        });
    } else if (synchronousClosures.length > 0) {
        resetSingletonTimeout(scheduledHidden, "endgame", 0, async () => {
            await evalClosures(synchronousClosures, updatedTabId);
            scheduleEndgame(undefined, notifyTimeout);
        });
    } else if (config.archive && reqresQueue.length > 0) {
        resetSingletonTimeout(scheduledHidden, "endgame", 0, async () => {
            // reset
            seUpdatedTabId = undefined;

            await forceUpdateDisplay(true, updatedTabId);
            updatedTabId = await processArchiving(updatedTabId);
            scheduleEndgame(updatedTabId, notifyTimeout);
        });
    } else if (reqresAlmostDone.length > 0) {
        resetSingletonTimeout(scheduledHidden, "endgame", 0, async () => {
            // reset
            seUpdatedTabId = undefined;

            await forceUpdateDisplay(true, updatedTabId);
            updatedTabId = await processAlmostDone(updatedTabId);
            scheduleEndgame(updatedTabId, notifyTimeout);
        });
    } else /* if (!config.archive || reqresQueue.length == 0) */ {
        resetSingletonTimeout(scheduledHidden, "endgame", 0, async () => {
            // reset
            seUpdatedTabId = undefined;

            if (wantBroadcastSaved) {
                wantBroadcastSaved = false;
                scheduleAction(scheduledInternal, "readSaved", 0, loadAndBroadcastSaved(savedFilters));
            }

            cleanupTabs();

            // do we have some reqres in flight?
            let haveInFlight = reqresInFlight.size + debugReqresInFlight.size + reqresFinishingUp.length + debugReqresFinishingUp.length > 0;

            if (wantSaveGlobals) {
                wantSaveGlobals = false;

                // save immediately if we want to reload or we just wrote to local storage
                let timeout = (
                    wantReloadSelf ||
                    savedGlobals.stashedLS.number !== globals.stashedLS.number ||
                    savedGlobals.stashedIDB.number !== globals.stashedIDB.number ||
                    savedGlobals.savedLS.number !== globals.savedLS.number ||
                    savedGlobals.savedIDB.number !== globals.savedIDB.number
                ) ? 0 : 1000;
                // delay for longer if there's probably going to be more updates soon or this update is not that important
                if (haveInFlight || (
                    savedGlobals.collectedTotal === globals.collectedTotal &&
                    savedGlobals.submittedHTTPTotal === globals.submittedHTTPTotal &&
                    savedGlobals.exportedAsTotal === globals.exportedAsTotal
                ))
                    timeout *= 10;
                scheduleSaveGlobals(timeout);
            }

            if (wantBucketSaveAs) {
                wantBucketSaveAs = false;
                // schedule exportAs for all buckets
                scheduleBucketSaveAs(haveInFlight
                                     ? config.exportAsInFlightTimeout * 1000
                                     : (wantReloadSelf ? 0 : config.exportAsTimeout * 1000)
                                     , null);
            }

            if (wantRetryAllUnarchived) {
                wantRetryAllUnarchived = false;
                // retry unarchived in 60s
                scheduleRetryAllUnarchived(60000);
            }

            scheduleGlobalNotifications(notifyTimeout !== undefined ? notifyTimeout : 1000);

            scheduleUpdateDisplay(true, updatedTabId);
        });
    }
}

// Schedule a given function using `resetSingletonTimeout`. But just
// before it starts, add its name to `runningActions` and update the
// UI, after it ends, remove it from `runningActions` and run
// `scheduleEndgame` or update the UI.
//
// The scheduled function is experted to return `updatedTabId` value.
function scheduleActionExtra(map, name, priority, timeout, hurry, func, endgame) {
    let value = resetSingletonTimeout(map, name, timeout, func, priority, hurry);
    if (value === undefined)
        // it was already scheduled (and might have been re-scheduled), no nothing
        return;

    value.before.push(async () => {
        if (config.debugRuntime)
            console.warn("SCHEDULER: running async", name);
        runningActions.add(name);
        await forceUpdateDisplay(true);
    });
    value.after.push(async (results) => {
        runningActions.delete(name);
        if (config.debugRuntime)
            console.warn("SCHEDULER: finished async", name, results);

        // merge results of all performed updates
        let updatedTabId;
        for (let res of results)
            updatedTabId = mergeUpdatedTabIds(updatedTabId, res)

        if (endgame)
            scheduleEndgame(updatedTabId);
        else
            await forceUpdateDisplay(true, updatedTabId);
    });
    return value;
}

function scheduleAction(map, name, timeout, func) {
    return scheduleActionExtra(map, name, 100, timeout, false, func, false);
}

function scheduleActionEndgame(map, name, timeout, func) {
    return scheduleActionExtra(map, name, 100, timeout, false, func, true);
}
