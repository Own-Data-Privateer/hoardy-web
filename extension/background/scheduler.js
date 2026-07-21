/*
 * Copyright (c) 2023-2026 Jan Malakhovski <oxij@oxij.org>
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
let scheduledInternalCancelable = new Map();
// scheduled internal functions hidden from the UI
let scheduledHidden = new Map();

// [[name, function, args]]: closures that need to be run synchronously
let synchronousClosuresA = [];
let synchronousClosuresB = [];
let synchronousClosuresC = [];

async function evalClosures(closures, updatedTabId) {
    while (closures.length > 0) {
        let [name, func, args] = closures.shift();

        if (config.logRuntime) {
            console.warn("SCHEDULER: running sync", name);
        }
        runningActions.add(name);

        await forceUpdateDisplay(true, updatedTabId);
        updatedTabId = undefined;

        try {
            let res = func(...args);
            while (res instanceof Promise) {
                res = await res;
            }
            updatedTabId = res;
        } catch (err) {
            logError(err);
        }

        runningActions.delete(name);
        if (config.logRuntime) {
            console.warn("SCHEDULER: finished sync", name, updatedTabId);
        }
    }

    return updatedTabId;
}

// syntax sugar
function runSynchronouslyA(name, func, ...args) {
    synchronousClosuresA.push([name, func, args]);
}

function runSynchronouslyB(name, func, ...args) {
    synchronousClosuresB.push([name, func, args]);
}

function runSynchronouslyC(name, func, ...args) {
    synchronousClosuresC.push([name, func, args]);
}

// tabId -> [[name, function, args]]: closures delayed until a given tabId has no in-flight reqres
let scheduledWhenNoInFlight = new Map();
// similarly, but until all tabId's reqres are processed
let scheduledWhenArchived = new Map();
// similarly, but taking `settleDelay` and `settleRetries` into account
let scheduledWhenSettled = new Map();

function scheduleSynchronouslyWhenNoInFlight(tabId, name, func, ...args) {
    let res = cacheSingleton(scheduledWhenNoInFlight, tabId, () => {
        return {};
    });
    delete res[name];
    res[name] = [name, func, args];
}

function scheduleSynchronouslyWhenArchived(tabId, name, func, ...args) {
    let res = cacheSingleton(scheduledWhenArchived, tabId, () => {
        return {};
    });
    delete res[name];
    res[name] = [name, func, args];
}

function scheduleSettleTab(tabId, settleDelay, settleRetries, retries) {
    if (synchronousClosuresA.length > 0 || getInFlightNum({ tabId }) !== 0) {
        // some relevant actions were not run yet or some reqres are still in flight
        //
        // wait for them to finish
        scheduleSynchronouslyWhenNoInFlight(
            tabId,
            `settle#${tabId}`,
            scheduleSettleTab,
            tabId,
            settleDelay,
            settleRetries,
            retries,
        );
        return;
    }

    if (retries > settleRetries) {
        scheduledWhenSettled.delete(tabId);
        browser.notifications
            .create(`error-settle-${tabId}`, {
                title: "Hoardy-Web: ERROR",
                message: escapeNotification(
                    config,
                    `Failed to settle tab #${tabId}: the number of retries exeeds \`... retry up to <N> times\` setting`,
                ),
                iconUrl: iconURL("error", 128),
                type: "basic",
            })
            .catch(logError);
        return;
    }

    let tabstate = getTabState(tabId);
    let timeout = tabstate.emitTimeStamp + settleDelay - Date.now();

    if (timeout > 0) {
        // pause for a bit to let the page's JavaScript process those reqres and retry
        scheduleActionEndgame(scheduledInternalCancelable, `settle#${tabId}`, timeout, () =>
            scheduleSettleTab(tabId, settleDelay, settleRetries, retries + 1),
        );
        scheduleUpdateDisplay(true);
        return;
    }

    scheduleActionEndgame(scheduledInternalCancelable, `settle#${tabId}`, 0, () => {
        let closures = scheduledWhenSettled.get(tabId);
        if (closures === undefined) {
            return;
        }

        let [_name, closure, left] = popObjectField(closures);
        let [name, func, args] = closure;

        if (left === 0) {
            scheduledWhenSettled.delete(tabId);
        }

        runSynchronouslyA(name, func, ...args);

        if (left !== 0) {
            scheduleSettleTab(tabId, settleDelay, settleRetries, retries);
        }
    });
    // no `scheduleUpdateDisplay` because the above will be run immediately
}

function scheduleSynchronouslyWhenSettled(tabId, settleDelay, settleRetries, name, func, ...args) {
    let res = cacheSingleton(scheduledWhenSettled, tabId, () => {
        return {};
    });
    delete res[name];
    res[name] = [name, func, args];
    scheduleSettleTab(tabId, settleDelay, settleRetries, 0);
}

// actions

function syncRunActions() {
    runSynchronouslyA("runAll0", async () => {
        //await runAllSingletonTimeouts(scheduledCancelable);
        await runAllSingletonTimeouts(scheduledRetry);
        await runAllSingletonTimeouts(scheduledDelayed);
        return null;
    });
    runSynchronouslyC("runAll2", async () => {
        await runAllSingletonTimeouts(scheduledSaveState);
        return null;
    });
}

function syncCancelActions() {
    runSynchronouslyA("cancelAll0", async () => {
        await cancelAllSingletonTimeouts(scheduledCancelable);
        await cancelAllSingletonTimeouts(scheduledInternalCancelable);
        scheduledWhenSettled = new Map();
        await cancelAllSingletonTimeouts(scheduledRetry);
        await cancelAllSingletonTimeouts(scheduledDelayed);
        return null;
    });
    runSynchronouslyC("runAll2", async () => {
        // `scheduledSaveState` mustn't ever be cancelled, so we run them instead
        await runAllSingletonTimeouts(scheduledSaveState);
        return null;
    });
}

// Stashing and archivig to browser's local storage.

// ../page/saved.js implementation
let wantBroadcastSaved = false;
let savedFilters = mkReqresFilter({ limit: 1024 });

function setSavedFilters(rrfilter) {
    savedFilters = updateFromRec(savedFilters, rrfilter);
    broadcastToSaved("setSavedFilters", savedFilters);
    broadcastToSaved("resetSaved", [null]); // invalidate UI
    wantBroadcastSaved = true;
}

// other scheduleEndgame flags
let wantCheckServer = true;
let wantSaveState = false;
let wantBucketSaveAs = false;
let wantRetryAllUnarchived = false;

// accumulated state
let seUpdatedTabId;

async function seEvalFunction(func, ...args) {
    let updatedTabId = seUpdatedTabId;
    seUpdatedTabId = undefined; // reset

    await forceUpdateDisplay(true, updatedTabId);

    updatedTabId = func();
    while (updatedTabId instanceof Promise) {
        updatedTabId = await updatedTabId;
    }
    scheduleEndgame(updatedTabId, ...args);
}

async function seEvalClosures(closures, ...args) {
    let updatedTabId = seUpdatedTabId;
    seUpdatedTabId = undefined; // reset

    updatedTabId = evalClosures(closures, updatedTabId);
    while (updatedTabId instanceof Promise) {
        updatedTabId = await updatedTabId;
    }
    scheduleEndgame(updatedTabId, ...args);
}

function sePopClosures(scheduled, target, ...args) {
    let toDelete = [];

    let numInFlight = getInFlightNum(null);

    for (let [tabId, closures] of scheduled.entries()) {
        // NB: the first part is so that `null` would be processed last, the second is so
        // that the third won't be called when `numInFlight === 0`
        if (tabId === null || (numInFlight !== 0 && getInFlightNum({ tabId }) !== 0)) {
            continue;
        }
        for (let v of Object.values(closures)) {
            target.push(v);
        }
        toDelete.push(tabId);
    }

    if (numInFlight === 0) {
        // process `null` last
        let closures = scheduled.get(null);
        if (closures !== undefined) {
            for (let v of Object.values(closures)) {
                target.push(v);
            }
            toDelete.push(null);
        }
    }

    for (let tabId of toDelete) {
        scheduled.delete(tabId);
    }

    scheduleEndgame(undefined, ...args);
}

// schedule processArchiving, processAlmostDone, etc
function scheduleEndgame(
    updatedTabId,
    notifyTimeout,
    skipScheduledWhenNoInFlight,
    skipScheduledWhenArchived,
) {
    seUpdatedTabId = mergeUpdatedTabIds(seUpdatedTabId, updatedTabId);

    if (wantCheckServer) {
        resetSingletonTimeout(scheduledHidden, "endgame", 0, async () => {
            await checkServer();
            scheduleEndgame(undefined, notifyTimeout);
        });
    } else if (synchronousClosuresA.length > 0) {
        resetSingletonTimeout(scheduledHidden, "endgame", 0, () =>
            seEvalClosures(synchronousClosuresA, notifyTimeout),
        );
    } else if (reqresAlmostDone.length > 0) {
        resetSingletonTimeout(scheduledHidden, "endgame", 0, () =>
            seEvalFunction(processAlmostDone, notifyTimeout),
        );
    } else if (!skipScheduledWhenNoInFlight && scheduledWhenNoInFlight.size > 0) {
        resetSingletonTimeout(
            scheduledHidden,
            "endgame",
            0,
            // NB: `skipScheduledWhenNoInFlight = true`
            () =>
                sePopClosures(
                    scheduledWhenNoInFlight,
                    synchronousClosuresB,
                    notifyTimeout,
                    true,
                    skipScheduledWhenArchived,
                ),
        );
    } else if (synchronousClosuresB.length > 0) {
        resetSingletonTimeout(scheduledHidden, "endgame", 0, () =>
            seEvalClosures(synchronousClosuresB, notifyTimeout),
        );
    } else if (config.archive && reqresQueue.length > 0) {
        resetSingletonTimeout(scheduledHidden, "endgame", 0, () =>
            seEvalFunction(processArchiving, notifyTimeout),
        );
    } else if (!skipScheduledWhenArchived && scheduledWhenArchived.size > 0) {
        resetSingletonTimeout(
            scheduledHidden,
            "endgame",
            0,
            // NB: `skipScheduledWhenArchived = true`
            () =>
                sePopClosures(
                    scheduledWhenArchived,
                    synchronousClosuresC,
                    notifyTimeout,
                    skipScheduledWhenNoInFlight,
                    true,
                ),
        );
    } else if (synchronousClosuresC.length > 0) {
        resetSingletonTimeout(scheduledHidden, "endgame", 0, () =>
            seEvalClosures(synchronousClosuresC, notifyTimeout),
        );
    } else {
        resetSingletonTimeout(scheduledHidden, "endgame", 0, () => {
            let updatedTabId = seUpdatedTabId;
            seUpdatedTabId = undefined; // reset

            if (wantBroadcastSaved) {
                wantBroadcastSaved = false;
                scheduleAction(
                    scheduledInternal,
                    "readSaved",
                    0,
                    loadAndBroadcastSaved(savedFilters),
                );
            }

            cleanupTabs();

            // do we have some reqres in flight?
            let haveInFlight = getInFlightNum(null) > 0;

            if (wantSaveState) {
                wantSaveState = false;

                // save immediately if we want to reload or we just wrote to local storage
                let timeout =
                    wantReloadSelf ||
                    savedState.stashedLS.number !== state.stashedLS.number ||
                    savedState.stashedIDB.number !== state.stashedIDB.number ||
                    savedState.savedLS.number !== state.savedLS.number ||
                    savedState.savedIDB.number !== state.savedIDB.number
                        ? 0
                        : 1000;
                // delay for longer if there's probably going to be more updates soon or this update is not that important
                if (
                    haveInFlight ||
                    (savedState.collectedTotal === state.collectedTotal &&
                        savedState.exportedAsTotal === state.exportedAsTotal &&
                        savedState.submittedHTTPTotal === state.submittedHTTPTotal &&
                        savedState.dumpedTotal === state.dumpedTotal &&
                        savedState.stashedTotal === state.stashedTotal &&
                        savedState.savedTotal === state.savedTotal)
                ) {
                    timeout *= 10;
                }
                scheduleSaveState(timeout);
            }

            if (wantBucketSaveAs) {
                wantBucketSaveAs = false;
                // schedule exportAs for all buckets
                scheduleBucketSaveAs(
                    haveInFlight
                        ? config.exportAsInFlightTimeout * 1000
                        : wantReloadSelf
                          ? 0
                          : config.exportAsTimeout * 1000,
                    null,
                );
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

function runThenScheduleEndgame(func, ...args) {
    let res = catchAll(func)(...args);
    if (res instanceof Promise) {
        res.then(() => scheduleEndgame());
    } else {
        scheduleEndgame();
    }
}

// Schedule a given function using `resetSingletonTimeout`. But just
// before it starts, add its name to `runningActions` and update the
// UI, after it ends, remove it from `runningActions` and run
// `scheduleEndgame` or update the UI.
//
// The scheduled function is experted to return `updatedTabId` value.
function scheduleActionExtra(map, name, priority, timeout, hurry, func, endgame) {
    let value = resetSingletonTimeout(
        map,
        name,
        timeout,
        async () => {
            if (config.logRuntime) {
                console.warn("SCHEDULER: running async", name);
            }
            runningActions.add(name);

            await forceUpdateDisplay(true);

            let updatedTabId;
            try {
                updatedTabId = func();
            } catch (err) {
                logError(err);
            }

            runningActions.delete(name);
            if (config.logRuntime) {
                console.warn("SCHEDULER: finished async", name, updatedTabId);
            }

            return updatedTabId;
        },
        priority,
        hurry,
    );

    if (value !== undefined) {
        // if newly scheduled
        // eslint-disable-next-line no-inner-declarations
        async function after(results) {
            let updatedTabId = results.reduce(mergeUpdatedTabIds, undefined);
            if (endgame) {
                scheduleEndgame(updatedTabId);
            } else {
                await forceUpdateDisplay(true, updatedTabId);
            }
        }
        value.onDelay.push(after);
        value.andThen.push(after);
    }

    return value;
}

function scheduleAction(map, name, timeout, func) {
    return scheduleActionExtra(map, name, 100, timeout, false, func, false);
}

function scheduleActionEndgame(map, name, timeout, func) {
    return scheduleActionExtra(map, name, 100, timeout, false, func, true);
}
