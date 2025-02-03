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
 * Global notifications generator.
 */

"use strict";

// flags
// do we have a newly- or recently failed to be stashed or saved/archived to local storage reqres?
let gotNewSyncedOrNot = false;
// do we have a newly- or recently failed to be archived reqres?
let gotNewArchivedOrNot = false;
// do we need to show empty queue notification?
let wantArchiveDoneNotify = true;
// do we have new queued reqres?
let gotNewQueued = false;
// do we have new reqres in limbo?
let gotNewLimbo = false;
// last time we notified the user about it
let gotNewLimboLastNotification = 0;
// do we have new problematic reqres?
let gotNewProblematic = false;
// do we have new buggy reqres?
let gotNewErrored = false;

function formatFailures(why, list, recoverable) {
    let parts = [];
    let someUnrecoverable = false;
    let allUnrecoverable = true;
    for (let [reason, unarchived] of list) {
        someUnrecoverable = someUnrecoverable || !unarchived.recoverable;
        allUnrecoverable = allUnrecoverable && !unarchived.recoverable;
        parts.push(`- ${why} ${unarchived.queue.length} items because ${reason}.`);
    }
    if (someUnrecoverable && recoverable) {
        let recoverHow = `to retry them you will have to press the "Retry" button on the "Queued/Failed" line in the popup`;
        if (allUnrecoverable)
            parts.push(`\nNone of these will be retried automatically, ${recoverHow}.`)
        else
            parts.push(`\nSome of these will not be retried automatically, ${recoverHow}.`)
    }
    return parts.join("\n");
}

async function doGlobalNotify() {
    // record the current state, because the rest of this chunk is async
    let rrErrored = Array.from(reqresErroredIssueAcc[1].entries());
    let rrUnstashed = Array.from(reqresUnstashedIssueAcc[1].entries());
    let rrUnarchived = Array.from(reqresUnarchivedIssueAcc[1].entries());

    if (gotNewErrored && rrErrored.length > 0) {
        gotNewErrored = false;

        await browser.notifications.create("error-errored", {
            title: "Hoardy-Web: ERROR",
            message: escapeNotification(config, `Some internal errors:\n${formatFailures("Failed to process", rrErrored)}`),
            iconUrl: iconURL("error", 128),
            type: "basic",
        });
    } else if (rrErrored.length === 0)
        // clear stale
        await browser.notifications.clear("error-errored");

    if (gotNewQueued && reqresQueue.length > 0) {
        gotNewQueued = false;

        if (config.archiveStuckNotify && !config.archive && !config.stash) {
            await browser.notifications.create("warning-notSaving", {
                title: "Hoardy-Web: WARNING",
                message: escapeNotification(config, "Some reqres are waiting in the archival queue, but both reqres stashing and archiving are disabled."),
                iconUrl: iconURL("archiving", 128),
                type: "basic",
            });
        }
    } else if (config.archive || config.stash)
        // clear stale
        await browser.notifications.clear("warning-notSaving");

    if (gotNewSyncedOrNot && rrUnstashed.length > 0) {
        gotNewSyncedOrNot = false;

        if (config.archiveFailedNotify) {
            // generate a new one
            await browser.notifications.create("error-unstashed", {
                title: "Hoardy-Web: FAILED",
                message: escapeNotification(config, `For browser's local storage:\n${formatFailures("Failed to stash", rrUnstashed, true)}`),
                iconUrl: iconURL("failed", 128),
                type: "basic",
            });
        }
    } else if (rrUnstashed.length === 0)
        // clear stale
        await browser.notifications.clear("error-unstashed");

    if (gotNewArchivedOrNot) {
        gotNewArchivedOrNot = false;

        // get shown notifications
        let all_ = await browser.notifications.getAll();
        let all = Object.keys(all_);

        // clear stale
        for (let label in all) {
            if (!label.startsWith("error-unarchived-"))
                continue;
            let storeID = label.substr(17);
            if (rrUnarchived.every((e) => e[0] !== storeID))
                await browser.notifications.clear(label);
        }

        if (config.archiveFailedNotify) {
            // generate new ones
            for (let [storeID, byReasonMap] of rrUnarchived) {
                let where;
                if (storeID === "exportAs")
                    where = "Export via `saveAs`";
                else if (storeID === "localStorage")
                    where = "Browser's local storage";
                else
                    where = `Archiving server at ${storeID}`;
                await browser.notifications.create(`error-unarchived-${storeID}`, {
                    title: "Hoardy-Web: FAILED",
                    message: escapeNotification(config, `${where}:\n${formatFailures("Failed to archive", byReasonMap.entries(), true)}`),
                    iconUrl: iconURL("failed", 128),
                    type: "basic",
                });
            }
        }

        let isDone = rrUnstashed.length === 0 && rrUnarchived.length === 0;

        if (wantArchiveDoneNotify && isDone && reqresQueue.length === 0) {
            wantArchiveDoneNotify = false;

            if (config.archiveDoneNotify) {
                // generate a new one
                await browser.notifications.create("ok-done", {
                    title: "Hoardy-Web: OK",
                    message: escapeNotification(config, "Archiving appears to work OK!\n\nThis message won't be repeated unless something breaks." + annoyingNotification(config, "Generate notifications about > ... newly empty archival queue")),
                    iconUrl: iconURL("idle", 128),
                    type: "basic",
                });
            }
        }
    }

    let now = Date.now();
    let fatLimbo = reqresLimbo.length > config.limboMaxNumber
                || reqresLimboSize > config.limboMaxSize * MEGABYTE;

    if (fatLimbo && gotNewLimbo && (now - gotNewLimboLastNotification) > config.limboNotifyInterval * 1000) {
        gotNewLimbo = false;

        if (config.limboNotify) {
            gotNewLimboLastNotification = now;

            // generate a new one
            await browser.notifications.create("warning-fatLimbo", {
                title: "Hoardy-Web: WARNING",
                message: escapeNotification(config, `Too much stuff in limbo, collect or discard some of those reqres to reduce memory consumption and improve browsing performance.` + annoyingNotification(config, "Generate notifications about > ... too much stuff in limbo")),
                iconUrl: iconURL("limbo", 128),
                type: "basic",
            });
        }
    } else if (!fatLimbo)
        // clear stale
        await browser.notifications.clear("warning-fatLimbo");

    if (gotNewProblematic && reqresProblematic.length > 0) {
        gotNewProblematic = false;

        if (config.problematicNotify) {
            // generate a new one
            //
            // make a log of no more than `problematicNotifyNumber`
            // elements, merging those referencing the same URL
            let latest = new Map();
            for (let i = reqresProblematic.length - 1; i >= 0; --i) {
                let loggable = reqresProblematic[i][0];
                let tabcfg = getOriginConfig(loggable.tabId, loggable.fromExtension);
                if (!tabcfg.problematicNotify)
                    continue;

                let desc = (loggable.method ? loggable.method : "?") + " " + loggable.url;
                let l = latest.get(desc);
                if (l === undefined) {
                    if (latest.size < config.problematicNotifyNumber)
                        latest.set(desc, 1);
                    else
                        break;
                } else
                    latest.set(desc, l + 1);
            }
            if (latest.size > 0) {
                let latestDesc = [];
                for (let [k, v] of latest.entries()) {
                    if (k.length < 80)
                        latestDesc.push(`${v}x ${k}`);
                    else
                        latestDesc.push(`${v}x ${k.substr(0, 80)}\u2026`);
                }
                latestDesc.reverse();
                await browser.notifications.create("warning-problematic", {
                    title: "Hoardy-Web: WARNING",
                    message: escapeNotification(config, `Have ${reqresProblematic.length} reqres marked as problematic:\n` + latestDesc.join("\n") + annoyingNotification(config, "Generate notifications about > ... new 'problematic' reqres")),
                    iconUrl: iconURL("problematic", 128),
                    type: "basic",
                });
            }
        }
    } else if (reqresProblematic.length === 0)
        // clear stale
        await browser.notifications.clear("warning-problematic");
}

function scheduleGlobalNotifications(timeout) {
    resetSingletonTimeout(scheduledHidden, "notify", timeout, doGlobalNotify);
    // NB: needs scheduleUpdateDisplay after
}
