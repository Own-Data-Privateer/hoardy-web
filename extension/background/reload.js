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

    let badReqres = (
        reqresUnstashedIssueAcc[0].size +
        // reqresUnarchivedIssueAcc[0].size // will be caught below
        reqresBuggedOutIssueAcc[0].size
    );

    if (badReqres > 0) {
        browser.notifications.create("error-noReload", {
            title: "Hoardy-Web: ERROR",
            message: escapeNotification(config, `\`Hoardy-Web\` can NOT be reloaded while some \`unstashed\` and/or \`buggedOut\` reqres are present.`),
            iconUrl: iconURL("error", 128),
            type: "basic",
        }).catch(logError);

        cancelReloadSelf();
        return;
    }

    let notDoneTasks = (
        scheduledCancelable.size +
        // scheduledRetry is ignored here
        scheduledDelayed.size +
        scheduledSaveState.size +
        scheduledInternal.size +
        // scheduledHidden is ignored here
        synchronousClosuresA.length +
        synchronousClosuresB.length +
        synchronousClosuresC.length +
        scheduledWhenNoInFlight.size +
        scheduledWhenArchived.size +
        runningActions.size
    );

    if (notDoneTasks > 0) {
        console.warn("reload blocked by unfinished tasks");
        return;
    }

    let archivingReqres = config.archive ? reqresQueue.length : 0;
    let notDoneReqres = getInFlightNum(null) + reqresBundledAs.size + archivingReqres;

    if (notDoneReqres > 0) {
        console.warn("reload blocked by unfinished and/or unarchived reqres");
        return;
    }

    function isInSyncWithLS(archivable) {
        let [loggable, dump] = archivable;
        return loggable.inLS !== undefined && !loggable.dirty;
    }

    let allInSyncWithLS = (
        reqresLimbo.every(isInSyncWithLS) &&
        reqresQueue.every(isInSyncWithLS) &&
        Array.from(reqresUnarchivedIssueAcc[0]).every(isInSyncWithLS)
    );

    if (!allInSyncWithLS) {
        console.warn("reload blocked by unstashed reqres");
        syncStashAll(true);
        scheduleEndgame(null);
        return;
    }

    console.warn("reloading!");

    let savedTabs = {};

    let currentTabs = await browser.tabs.query({});
    for (let tab of currentTabs) {
        let tabId = tab.id;
        savedTabs[tabId] = {
            url: getTabURL(tab),
            cfg: tabConfig.get(tabId),
            state: tabState.get(tabId),
        };
    }

    let session = {
        id: sessionId,
        tabs: savedTabs,
        bg: tabState.get(-1),
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
    syncRunActions();
    // NB: keep this here here instead of wrapping this function using `runThenScheduleEndgame` so
    // that this function could be called from the debug console
    scheduleEndgame(null);
}

function cancelReloadSelf() {
    wantReloadSelf = false;
    // NB: similarly
    scheduleEndgame(null);
}
