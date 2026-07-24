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
 * Capture of DOM snapshots.
 */

"use strict";

async function snapshotOne(tabId, windowId, documentUrl) {
    if (config.logRuntime) {
        console.log("DOM-snapshoting tab", tabId, "url", documentUrl);
    }

    let requestTimeStamp = Date.now();

    let frames = await browser.webNavigation.getAllFrames({ tabId });

    let results = [];
    let resultsByFrame = new Map();
    let issues = [];

    for (let frame of frames) {
        let url = frame.url;
        let frameId = frame.frameId;
        let parentFrameId = frame.parentFrameId;
        let result;

        try {
            let res = await browser.tabs.executeScript(tabId, {
                frameId,
                file: "/inject/snapshot.js",
            });
            if (config.logRuntime) {
                console.log(
                    "SNAPSHOT: tab",
                    tabId,
                    "frame",
                    frameId,
                    "executeScript returned",
                    res,
                );
            }
            if (res === undefined) {
                throw new Error("access denied");
            }
            if (!(Array.isArray(res) && res.length === 1)) {
                throw new Error("unexpected result type");
            }
            result = res[0];
        } catch (err) {
            if (url !== "about:blank") {
                console.error("SNAPSHOT: executeScript:", errorMessageOf(err));
            }
            result = [
                Date.now(),
                "",
                "application/octet-stream",
                null,
                ["snapshot::capture::NO_EXEC"],
            ];
        }

        let [responseTimeStamp, referrerUrl, ct, data, errors] = result;

        if (data !== null && typeof data !== "string") {
            errors.push("snapshot::capture::UNKNOWN_DATA_TYPE");
            data = null;
        }

        let reqres = {
            sessionId,
            requestId: undefined,
            tabId,
            windowId,
            fromExtension: false,

            protocol: "SNAPSHOT",
            method: "DOM",
            url,

            documentUrl: parentFrameId !== -1 ? documentUrl : undefined,

            errors,

            requestSize: 0,
            requestTimeStamp,
            requestHeaders: isValidStr(referrerUrl)
                ? [{ name: "Referrer", value: referrerUrl }]
                : [],
            requestBody: new ChunkedBuffer(),
            requestComplete: true,

            submitted: false,
            responded: true,
            fromCache: false,

            responseSize: data !== null ? data.length : 0,
            responseTimeStamp,
            responseHeaders: [{ name: "Content-Type", value: ct }],
            responseBody: data !== null ? data : "",
            responseComplete: data !== null,

            statusCode: 200,
            reason: "OK",

            emitTimeStamp: Date.now(),

            subframes: [],
        };

        let res = [url, frameId, parentFrameId, reqres];
        results.push(res);
        resultsByFrame.set(frameId, res);

        if (errors.length > 0 && url !== "about:blank") {
            issues.push(
                `frame ${frameId} (${url.substr(0, 80)}): failed to take snapshot: ` +
                    errors.join("; "),
            );
        }
    }

    let toEmit = [];

    for (let [url, _frameId, parentFrameId, reqres] of results) {
        let parentResult = resultsByFrame.get(parentFrameId);
        if (parentResult !== undefined) {
            let [parentUrl, _parentFrameId, _parentParentFrameId, parentReqres] = parentResult;

            reqres.originUrl = parentUrl;

            if (url === "about:blank" || url === parentUrl) {
                // this is an anonymous iframe, store it as a subframe, since it can't really be
                // emitted separately
                parentReqres.subframes.push(reqres);
                continue;
            }
        }
        toEmit.push(reqres);
    }

    reqresAlmostDone.push(...toEmit);

    if (issues.length > 0) {
        await browser.notifications
            .create(`error-snapshot-${tabId}`, {
                title: "Hoardy-Web: WARNING",
                message: escapeNotification(
                    config,
                    `While taking a DOM snapshot of tab #${tabId} (${documentUrl.substr(0, 80)}):\n- ${issues.join("\n- ")}`,
                ),
                iconUrl: iconURL("problematic", 128),
                type: "basic",
            })
            .catch(logError);
    }

    return results.length > 0 ? tabId : undefined;
}

async function snapshot(query) {
    let [tabs, specific] = await getTabs(query);

    for (let tab of tabs) {
        let tabId = tab.id;
        let tabcfg = getTabConfig(tabId);
        let url = getTabURL(tab);

        if (
            (!specific && !tabcfg.snapshottable) ||
            (!config.snapshotAny && isBoringOrServerURL(url))
        ) {
            if (config.logRuntime) {
                console.log("NOT DOM-snapshoting tab", tabId, "url", url);
            }
            continue;
        }

        scheduleSynchronouslyWhenSettled(
            tabId,
            tabcfg.settleDelay * 1000,
            tabcfg.settleRetries,
            `snapshot#${tabId}`,
            snapshotOne,
            tabId,
            tab.windowId,
            url,
        );
    }
}
