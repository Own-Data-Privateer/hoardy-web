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
 * Self-reload support.
 */

"use strict";

let wantReloadSelf = false;

async function performReloadSelf() {
    if (!wantReloadSelf)
        return;

    let notGood
        = reqresErroredIssueAcc[0].size
        + reqresUnstashedIssueAcc[0].size;
        //+ reqresUnarchivedIssueAcc[0].size // these will be caught below

    if (notGood !== 0) {
        browser.notifications.create("error-noReload", {
            title: "Hoardy-Web: ERROR",
            message: escapeNotification(config, `\`Hoardy-Web\` can NOT be reloaded while some \`unstashed\` and/or \`errored\` reqres are present.`),
            iconUrl: iconURL("error", 128),
            type: "basic",
        }).catch(logError);

        wantReloadSelf = false;
        return;
    }

    let notDoneReqres
        = reqresInFlight.size
        + debugReqresInFlight.size
        + reqresFinishingUp.length
        + debugReqresFinishingUp.length
        + reqresAlmostDone.length
        + reqresBundledAs.size;

    let notDoneTasks
        = synchronousClosures.length
        + runningActions.size
        + scheduledCancelable.size
        // scheduledRetry is ignored here
        + scheduledDelayed.size
        + scheduledSaveState.size
        + scheduledInternal.size;
        // scheduledHidden is ignored here;

    function isInSyncWithLS(archivable) {
        let [loggable, dump] = archivable;
        return loggable.inLS !== undefined && !loggable.dirty;
    }

    let allInSyncWithLS
        = reqresLimbo.every(isInSyncWithLS)
        && reqresQueue.every(isInSyncWithLS)
        && Array.from(reqresUnarchivedIssueAcc[0]).every(isInSyncWithLS);

    let reloadAllowed
        = notDoneReqres === 0
        && notDoneTasks === 0
        && allInSyncWithLS;

    if (!reloadAllowed) {
        let stats = getStats()
        console.warn("reload blocked,",
                     "#reqres", notDoneReqres,
                     "running", stats.running_actions,
                     "scheduled", stats.scheduled_actions,
                     "LS?", allInSyncWithLS);
        return;
    }

    console.warn("reloading!");

    let tabs = {};
    let currentTabs = await browser.tabs.query({});

    for (let tab of currentTabs) {
        let tabId = tab.id;
        tabs[tabId] = {
            url: getTabURL(tab),
            tabcfg: tabConfig.get(tabId),
        };
    }

    let session = {
        id: sessionId,
        tabs,
        log: reqresLog,
        // queue and others are stashed
    };

    await browser.storage.local.set({ session });

    if (useDebugger && currentTabs.every((tab) => tab.url === "about:blank" || isExtensionURL(tab.url)))
        // Chromium will close all such tabs on extension reload, meaning, in
        // this case, the whole browser window will close
        await browser.tabs.create({ url: "chrome://extensions/" });

    browser.runtime.reload();
}

function reloadSelf() {
    wantReloadSelf = true;
    syncStashAll(true);
    syncRunActions();
    scheduleEndgame(null);
}

function cancelReloadSelf() {
    wantReloadSelf = false;
    scheduleEndgame(null);
}
