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
 * Capture of DOM snapshots.
 */

"use strict";

async function snapshotOneTab(tabId, url) {
    if (config.debugRuntime)
        console.log("taking DOM snapshot of tab", tabId, url);

    let start = Date.now();
    let allErrors = [];

    try {
        let allResults = await browser.tabs.executeScript(tabId, {
            file: "/inject/snapshot.js",
            allFrames: true,
        });

        if (config.debugRuntime)
            console.log("snapshot.js returned", allResults);

        let emit = Date.now();

        for (let data of allResults) {
            if (data === undefined) {
                allErrors.push("access denied");
                continue;
            }

            let [date, documentUrl, originUrl, url, ct, result, errors] = data;

            if (!config.snapshotAny && isBoringOrServerURL(url)) {
                // skip stuff like handleBeforeRequest does, again, now for
                // sub-frames
                if (config.debugRuntime)
                    console.log("NOT taking DOM snapshot of sub-frame of tab", tabId, url);
                continue;
            } else if (errors.length > 0) {
                allErrors.push(errors.join("; "));
                continue;
            } else if (typeof result !== "string") {
                allErrors.push(`failed to snapshot a frame with \`${ct}\` content type`);
                continue;
            }

            let reqres = {
                sessionId,
                requestId: undefined,
                tabId,
                fromExtension: false,

                protocol: "SNAPSHOT",
                method: "DOM",
                url,

                documentUrl,
                originUrl,

                errors: [],

                requestTimeStamp: start,
                requestHeaders: [],
                requestBody: new ChunkedBuffer(),
                requestComplete: true,

                submitted: false,
                responded: true,
                fromCache: false,

                responseTimeStamp: date,
                responseHeaders : [
                    { name: "Content-Type", value: ct }
                ],
                responseBody: result,
                responseComplete: true,

                statusCode: 200,
                reason: "OK",

                emitTimeStamp: emit,
            };

            reqresAlmostDone.push(reqres);
        }
    } catch (err) {
        allErrors.push(err.toString());
    } finally {
        if (allErrors.length > 0)
            await browser.notifications.create(`error-snapshot-${tabId}`, {
                title: "Hoardy-Web: ERROR",
                message: escapeNotification(config, `While taking DOM snapshot of tab #${tabId} (${url.substr(0, 80)}):\n- ${allErrors.join("\n- ")}`),
                iconUrl: iconURL("error", 128),
                type: "basic",
            }).catch(logError);
    }
}

async function snapshot(tabIdNull) {
    let tabs;
    if (tabIdNull === null)
        tabs = await browser.tabs.query({});
    else {
        let tab = await browser.tabs.get(tabIdNull);
        tabs = [ tab ];
    }

    for (let tab of tabs) {
        let tabId = tab.id;
        let tabcfg = getOriginConfig(tabId);
        let url = getTabURL(tab);
        if (tabIdNull === null && !tabcfg.snapshottable
            || !config.snapshotAny && isBoringOrServerURL(url)) {
            if (config.debugRuntime)
                console.log("NOT taking DOM snapshot of tab", tabId, url);
            continue;
        }
        await snapshotOneTab(tabId, url);
    }

    scheduleEndgame(tabIdNull);
}
