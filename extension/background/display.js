/*
 * Copyright (c) 2024-2025 Jan Malakhovski <oxij@oxij.org>
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
 * Toolbar button/icon (aka `browserAction`) handling, as well as
 * other stuff related to UI display.
 */

"use strict";

// Chromium does not support per-window browserActions, so we have to
// update them per-tab. Fenix does support them, but updates appear to
// be rather inconsistent, while this works perfectly.
let perWindowUpdates = !useDebugger && !isMobile;

function setTitle(windowId, tabId, title) {
    if (!isMobile)
        // mobile browsers don't have that much space there
        title = "Hoardy-Web: " + title;

    let attrs = perWindowUpdates
        ? { windowId, title }
        : { tabId, title };
    return browser.browserAction.setTitle(attrs).catch(logErrorExceptWhenStartsWith("No tab with id:"));
}

let windowIdIcon = new Map();

// `browser.browserAction.setIcon` but with multiple icons. The given
// icons will be rotated in a loop N times, and then the process will
// stop at the very first icon.
async function setIcons(windowId, tabId, active, icons, force) {
    let clen = icons.length;
    if (clen === 0)
        throw new Error("need at least one icon to rotate");

    if (perWindowUpdates) {
        if (!active)
            // nothing to do
            return;
        else if (!force) {
            // NB: `force` happens when `scheduleUpdateDisplay` is called from
            // `handleTabActivated` or `handleTabUpdated`.
            let wicons = windowIdIcon.get(windowId);
            if (equalRec(wicons, icons))
                // nothing to do
                return;
        }
        windowIdIcon.set(windowId, icons);
    }

    let attrs = icons.map((v) => perWindowUpdates
                          ? { windowId, path: mkIcons(v) }
                          : { tabId, path: mkIcons(v) });

    let rotatingName = `rotateIcons-${windowId}`;
    let settingName = `setIcon-${tabId}`;

    if (!perWindowUpdates && active)
        // wait for the previous setter to this tab to finish
        await popSingletonTimeout(scheduledHidden, settingName, false, true);

    // set or rotate icons
    resetSingletonTimeout(scheduledHidden, active ? rotatingName : settingName, 0, async (wantStop) => {
        try {
            if (active && clen > 1) {
                // when on active tab, and with more than one frame, animate.
                for (let i = 0; i < 20; ++i) {
                    for (let j = 0; j < clen; ++j) {
                        if (wantStop())
                            throw new StopIteration();
                        await browser.browserAction.setIcon(attrs[j]);
                        await sleep(config.animateIcon);
                    }
                }
            }
            // freeze on the first frame
            await browser.browserAction.setIcon(attrs[0]);
        } catch (err) {
            if (!(err instanceof StopIteration))
                logErrorExceptWhenStartsWith("No tab with id:")(err);
        }
    });
}

// Stats counting.

function sumStats(f, m) {
    let number = 0;
    let size = 0;
    for (let e of m) {
        let [n, s] = f(e);
        number += n;
        size += s;
    }
    return [number, size];
}

function sumIssueAccByReasonStats(m) {
    return sumStats((f) => [f.queue.length, f.size], m);
}

function pushNotRunning(m, actions) {
    for (let key of m) {
        if (runningActions.has(key))
            continue;
        actions.push(key);
    }
}

// Compute total sizes of all queues and similar.
// Used in the UI.
function getStats() {
    let [bundledAs, bundledAsSize] = sumIssueAccByReasonStats(reqresBundledAs.values());

    let [errored, erroredSize] = sumIssueAccByReasonStats(reqresErroredIssueAcc[1].values());

    let [stashFailed, stashFailedSize] = sumIssueAccByReasonStats(reqresUnstashedIssueAcc[1].values());

    let [archiveFailed, archiveFailedSize] = sumStats((m) => sumIssueAccByReasonStats(m.values()), reqresUnarchivedIssueAcc[1].values());

    let in_flight = Math.max(reqresInFlight.size, debugReqresInFlight.size);

    let finishing_up = Math.max(reqresFinishingUp.length, debugReqresFinishingUp.length) + reqresAlmostDone.length;

    let actions = [];
    pushNotRunning(scheduledCancelable.keys(), actions);
    pushNotRunning(scheduledRetry.keys(), actions);
    pushNotRunning(scheduledDelayed.keys(), actions);
    pushNotRunning(scheduledSaveState.keys(), actions);
    let low_prio = actions.length;
    pushNotRunning(scheduledInternal.keys(), actions);
    // scheduledHidden are not shown to the UI
    pushNotRunning(synchronousClosures, actions);

    return {
        update_available: updateAvailable,
        reload_pending: wantReloadSelf,
        running: runningActions.size,
        running_actions: Array.from(runningActions.values()).sort().join(", "),
        scheduled_low: low_prio,
        scheduled: actions.length,
        scheduled_actions: actions.join(", "),
        in_flight,
        finishing_up,
        problematic: reqresProblematic.length,
        picked: globals.pickedTotal,
        dropped: globals.droppedTotal,
        in_limbo: reqresLimbo.length,
        in_limbo_size: reqresLimboSize,
        collected: globals.collectedTotal,
        collected_size: globals.collectedSize,
        discarded: globals.discardedTotal,
        discarded_size: globals.discardedSize,
        queued: reqresQueue.length,
        queued_size: reqresQueueSize,
        stashed: globals.stashedLS.number + globals.stashedIDB.number,
        stashed_size: globals.stashedLS.size + globals.stashedIDB.size,
        unstashed: stashFailed,
        unstashed_size: stashFailedSize,
        exportedAs: globals.exportedAsTotal,
        exportedAs_size: globals.exportedAsSize,
        bundledAs,
        bundledAs_size: bundledAsSize,
        submittedHTTP: globals.submittedHTTPTotal,
        submittedHTTP_size: globals.submittedHTTPSize,
        can_replay: serverConfig.canReplay,
        saved: globals.savedLS.number + globals.savedIDB.number,
        saved_size: globals.savedLS.size + globals.savedIDB.size,
        unarchived: archiveFailed,
        unarchived_size: archiveFailedSize,
        failed: stashFailed + archiveFailed,
        failed_size: stashFailedSize + archiveFailedSize,
        errored,
        errored_size: erroredSize,
        issues: in_flight
            + finishing_up
            + reqresProblematic.length
            + reqresLimbo.length
            + reqresQueue.length
            + stashFailed
            + archiveFailed
            + errored,
    };
}

// Produce a value similar to that of `getStats`, but for a single tab.
// Used in the UI.
function getTabStats(tabId) {
    let info = tabState.get(tabId);
    if (info === undefined)
        info = tabStateDefaults;

    let in_flight = 0;
    let in_flight_debug = 0;
    for (let [k, v] of reqresInFlight.entries())
        if (v.tabId === tabId)
            in_flight += 1;
    for (let [k, v] of debugReqresInFlight.entries())
        if (v.tabId === tabId)
            in_flight_debug += 1;

    let finishing_up = 0;
    let finishing_up_debug = 0;
    for (let v of reqresFinishingUp)
        if (v.tabId === tabId)
            finishing_up += 1;
    for (let v of debugReqresFinishingUp)
        if (v.tabId === tabId)
            finishing_up_debug += 1;

    let almost_done = 0;
    for (let v of reqresAlmostDone)
        if (v.tabId === tabId)
            almost_done += 1;

    return {
        in_flight: Math.max(in_flight, in_flight_debug),
        finishing_up: Math.max(finishing_up, finishing_up_debug) + almost_done,
        problematic: info.problematicTotal,
        picked: info.pickedTotal,
        dropped: info.droppedTotal,
        in_limbo: info.inLimboTotal,
        in_limbo_size: info.inLimboSize,
        collected: info.collectedTotal,
        collected_size: info.collectedSize,
        discarded: info.discardedTotal,
        discarded_size: info.discardedSize,
    };
}

// browserAction state
let udStats = null;
let udBadge = null;
let udColor = null;
let udGTitle = null;

// Update toolbar button state and tab states visible in popups.
//
// - `updatedTabId === undefined` means that no tabs were updated;
// - `updatedTabId === null` means that the `config` changed or any tab could
//   have been updated;
// - `updatedTabId is int` is a `tabId` of the tab that was updated;
// - `tabChanged === true` means that one of the windows changed its currently
//   active tab or `updatedTabId`'s tab info (e.g., `.url`) was updated; we
//   conflate these two cases because updated `tab.url` could change the result
//   of `getStateTabIdOrTabId`, which will then effectively "switch" the tab
//   under display.
async function updateDisplay(statsChanged, updatedTabId, tabChanged) {
    statsChanged = statsChanged || udStats === null;
    let wantUpdate = updatedTabId === null;

    let stats = udStats;
    let badge = udBadge;
    let color = udColor;
    let gtitle = udGTitle;

    if (statsChanged || wantUpdate) {
        stats = getStats();

        badge = "";
        color = 0;
        let chunks = [];

        if (stats.running > 0) {
            badge += "^";
            color = Math.max(color, 1);
            chunks.push(`${stats.running} running actions`);
        }

        if (stats.issues > 0)
            badge += stats.issues.toString();

        if (stats.errored > 0) {
            badge += "!";
            color = Math.max(color, 2);
            chunks.push(`internal errors on ${stats.errored} reqres`);
        }
        if (stats.unstashed > 0) {
            badge += "F";
            color = Math.max(color, 2);
            chunks.push(`failed to stash ${stats.unstashed} reqres`);
        }
        if (stats.unarchived > 0) {
            badge += "F";
            color = Math.max(color, 2);
            chunks.push(`failed to archive ${stats.unarchived} reqres`);
        }
        if (stats.in_flight > 0) {
            badge += "T";
            color = Math.max(color, 1);
            chunks.push(`tracking ${stats.in_flight} in-flight reqres`);
        }
        if (stats.finishing_up > 0) {
            badge += "T";
            color = Math.max(color, 1);
            chunks.push(`tracking ${stats.finishing_up} finishing-up reqres`);
        }
        if (stats.queued > 0) {
            badge += "Q";
            chunks.push(`${stats.queued} queued reqres`);
        }
        if (stats.bundledAs > 0) {
            badge += "B";
            color = Math.max(color, 1);
            chunks.push(`${stats.bundledAs} reqres bundled for export`);
        }
        if (stats.problematic > 0) {
            badge += "P";
            color = Math.max(color, 1);
            chunks.push(`${stats.problematic} problematic reqres`);
        }
        if (stats.in_limbo > 0) {
            badge += "L";
            color = Math.max(color, 1);
            chunks.push(`${stats.in_limbo} in-limbo reqres`);
        }
        if (config.workOffline) {
            badge += "O";
            chunks.push("work offline");
        }
        if (!config.collecting) {
            badge += "I";
            chunks.push("ignore new requests");
        }
        if (!config.stash && !config.archive) {
            badge += "?";
            color = Math.max(color, 1);
            chunks.push("ephemeral collection");
        }
        if (config.autoPopInLimboDiscard) {
            badge += "/L";
            color = Math.max(color, 2);
            chunks.push("auto-discard in-limbo");
        }
        if (config.discardAll) {
            badge += "/Q";
            color = Math.max(color, 2);
            chunks.push("auto-discard queued");
        }
        if (config.ephemeral) {
            badge += "/C";
            color = Math.max(color, 1);
            chunks.push("ephemeral config");
        }
        if (config.debugCaptures || config.dumpCaptures) {
            badge += "D";
            color = Math.max(color, 1);
            chunks.push("debug log (slow!)");
        }

        if (stats.in_flight + stats.finishing_up
            + stats.queued + stats.bundledAs === 0)
            chunks.push("idle");

        if (stats.scheduled > stats.scheduled_low) {
            badge += "~";
            color = Math.max(color, 1);
            chunks.push(`${stats.scheduled} scheduled actions`);
        }
        if (stats.scheduled == stats.scheduled_low && stats.scheduled_low > 0) {
            badge += ".";
            chunks.push(`${stats.scheduled_low} low-priority scheduled actions`);
        }

        gtitle = chunks.join(", ");

        wantUpdate = wantUpdate
            || udBadge !== badge || udColor !== color || udGTitle !== gtitle
            || udStats === null
            // because these global stats influence the tab's icon
            || stats.errored !== udStats.errored
            || stats.failed !== udStats.failed
            || stats.queued != udStats.queued
            || stats.bundledAs !== udStats.bundledAs;

        if (statsChanged)
            broadcastToPopup("updateStats", stats);

        if (config.debugRuntime && !statsChanged && !equalRec(udStats, stats))
            logError("`statsChanged` value is incorrect");

        udStats = stats;
    }

    if (updatedTabId === undefined && !wantUpdate && !tabChanged)
        // no tab-specific stuff needs updating, skip the rest of this
        return;

    if (udBadge !== badge) {
        await browser.browserAction.setBadgeText({ text: badge });
        udBadge = badge;
        if (config.debugRuntime)
            console.info(`browserAction: badge: "${badge}"`);
    }

    if (udColor !== color) {
        let backgroundRGB;
        let colorRGB;
        switch (color) {
        case 0:
            backgroundRGB = "#777";
            colorRGB = "#fff";
            break;
        case 1:
            backgroundRGB = "#e0e020";
            colorRGB = "#000";
            break;
        default:
            backgroundRGB = "#e02020";
            colorRGB = "#fff";
        }
        await browser.browserAction.setBadgeBackgroundColor({ color: backgroundRGB });
        await browser.browserAction.setBadgeTextColor({ color: colorRGB });
        udColor = color;
        if (config.debugRuntime)
            console.info(`browserAction: color: ${color} (bg ${backgroundRGB}, fg ${colorRGB})`);
    }

    if (udGTitle !== gtitle)
        udGTitle = gtitle;

    let tabs;
    if (useDebugger && updatedTabId == null)
        // On Chromium, when updating all tabs, actually update all tabs,
        // otherwise switching to those tabs for the first time will
        // display the `main` icon at first and then blink-switch to the
        // target icon, which is ugly.
        tabs = await browser.tabs.query({});
    else
        // On Firefox and when updating a select tab, we need only update
        // for active tabs. This is more efficient.
        tabs = await browser.tabs.query({ active: true });

    if (updatedTabId === undefined)
        // to simplify the logic below
        updatedTabId = null;

    let iconSlots = ["wicon", "icon", "sicon", "ricon"];

    function addIconsAndChunks(prev, icons, chunks, cfg, child) {
        let now = {};

        if (config.workOffline || cfg.workOffline) {
            now.wicon = "work_offline";
            chunks.push("work offline");
        }

        if (!config.collecting || !cfg.collecting) {
            now.icon = "off";
            chunks.push("ignore new requests");
        } else if (cfg.limbo && cfg.negLimbo) {
            now.icon = "bothlimbo";
            chunks.push("pick and drop into limbo");
        } else if (cfg.limbo) {
            now.icon = "limbo";
            chunks.push("pick into limbo");
        } else if (cfg.negLimbo) {
            now.icon = "neglimbo";
            chunks.push("drop into limbo");
        } else {
            now.icon = "idle";
            chunks.push("queue normally");
        }

        if (!cfg.snapshottable) {
            now.sicon = "unsnapshottable";
            chunks.push("not snapshottable");
        }
        if (!cfg.replayable) {
            now.ricon = "unreplayable";
            chunks.push("not replayable");
        }

        if (iconSlots.some((k) => now[k] !== prev[k])) {
            if (child)
                // add a separator
                icons.push("bar");
            for (let k of iconSlots) {
                let v = now[k];
                if (v !== undefined)
                    icons.push(v);
            }
            if (child)
                icons.push("dot");
        }

        return now;
    }

    for (let tab of tabs) {
        let windowId = tab.windowId;
        let tabId = tab.id;
        let stateTabId = getStateTabIdOrTabId(tab);

        // skip updates for unchanged tabs, when specified
        if (updatedTabId !== null && updatedTabId !== tabId && updatedTabId !== stateTabId)
            continue;

        // we don't use `getOriginConfig` here to not introduced new `tabConfig`
        // elements for yet-unprocessed tabs
        let tabcfg = tabConfig.get(stateTabId);
        if (tabcfg === undefined)
            tabcfg = prefillChildren(config.root);
        // this one, handle like usual
        let tabstats = getTabStats(stateTabId);

        if (tab.active) {
            // update popup UI
            if (tabChanged) {
                broadcastToPopup("switchTab", windowId, stateTabId);
                broadcastToPopup("updateTabConfig", stateTabId, tabcfg);
                broadcastToPopup("updateTabStats", stateTabId, tabstats);
            } else if (statsChanged)
                broadcastToPopup("updateTabStats", stateTabId, tabstats);
        }

        // compute toolbar button state
        let icons = [];

        if (stats.errored > 0)
            icons.push("error");
        if (stats.failed > 0)
            icons.push("failed");
        if (stats.queued + stats.bundledAs > 0)
            icons.push("archiving");

        let tchunks = [];
        let cchunks = [];

        if (tabstats.in_flight > 0) {
            icons.push("tracking");
            tchunks.push(`${tabstats.in_flight} in-flight reqres`);
        }
        if (tabstats.finishing_up > 0) {
            icons.push("tracking");
            tchunks.push(`${tabstats.finishing_up} finishing-up reqres`);
        }
        if (tabstats.problematic > 0) {
            icons.push("problematic");
            tchunks.push(`${tabstats.problematic} problematic reqres`);
        }
        if (tabstats.in_limbo > 0) {
            icons.push("in_limbo");
            tchunks.push(`${tabstats.in_limbo} in-limbo reqres`);
        }

        let prev = addIconsAndChunks({}, icons, tchunks, tabcfg);
        addIconsAndChunks(prev, icons, cchunks, tabcfg.children, true);

        let ttitle = tchunks.join(", ");
        let ctitle = cchunks.join(", ");
        if (ctitle === ttitle)
            ctitle = "same";

        let title = `${badge}${badge ? ": " : ""}${gtitle}; this tab: ${ttitle}; its new children: ${ctitle}`;

        // update browserAction
        await setTitle(windowId, tabId, title);
        await setIcons(windowId, tabId, tab.active, icons, tabChanged);

        if (config.debugRuntime) {
            console.info(`browserAction of tab ${tabId}: icons: [${icons.join(", ")}]`);
            console.info(`browserAction of tab ${tabId}: title: "${title}"`);
        }
    }
}

// accumulated state
let udStatsChanged = false;
let udUpdatedTabId;
let udTabChanged = false;
let udEpisode = 1;

function scheduleUpdateDisplay(statsChanged, updatedTabId, tabChanged, episodic, timeout) {
    // merge succesive arguments
    statsChanged = udStatsChanged = udStatsChanged || statsChanged;
    updatedTabId = udUpdatedTabId = mergeUpdatedTabIds(udUpdatedTabId, updatedTabId);
    tabChanged = udTabChanged = udTabChanged || tabChanged;

    // only run the rest every `episodic` updates, when it's set
    if (udEpisode < episodic) {
        udEpisode += 1;
        return;
    }
    udEpisode = 1;

    resetSingletonTimeout(scheduledHidden, "updateDisplay", timeout !== undefined ? timeout : 200, async () => {
        // reset
        udStatsChanged = false;
        udUpdatedTabId = undefined;
        udTabChanged = false;

        await updateDisplay(statsChanged, updatedTabId, tabChanged);

        // we schedule this here because otherwise we will have to schedule it
        // almost everywhere `scheduleUpdateDisplay` is used
        if (wantReloadSelf)
            resetSingletonTimeout(scheduledHidden, "reload", 300, performReloadSelf);
    }, undefined, true);
}

async function forceUpdateDisplay(statsChanged, updatedTabId, episodic) {
    scheduleUpdateDisplay(statsChanged, updatedTabId, false, episodic, 0);
    await popSingletonTimeout(scheduledHidden, "updateDisplay", true, true);
}

function getGoodEpisodic(num) {
    if (num > 200)
        return 100;
    else if (num > 20)
        return 10;
    else
        return 1;
}
