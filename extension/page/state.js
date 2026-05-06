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
 * The "Internal State" page.
 */

"use strict";

narrowSessionId = getMapURLParam(statePageURL, "session", document.location, toNumber, null, null);
narrowTabId = getMapURLParam(statePageURL, "tab", document.location, toNumber, null, null);

let defRRFilter = {sessionId: narrowSessionId, tabId: narrowTabId};
let rrfilters = {
    inFlight: mkReqresFilter(defRRFilter),
    problematic: mkReqresFilter(defRRFilter),
    inLimbo: mkReqresFilter(defRRFilter),
    log: mkReqresFilter(defRRFilter),
    queued: mkReqresFilter(defRRFilter),
    unarchived: mkReqresFilter(defRRFilter),
    buggedOut: mkReqresFilter(defRRFilter),
};
let dataNodeUpdaters = mkDataNodeUpdaters(rrfilters);

async function stateMain() {
    setPageLoading();

    await commonMain();

    if (narrowTabId !== null)
        document.title = `Hoardy-Web: tab ${narrowTabId}${narrowSessionId === null || thisSessionId === narrowSessionId ? "" : " of " + narrowSessionId.toString()}: Internal State`;

    buttonToMessage("forgetLog",            () => ["forgetLog", rrfilters.log]);
    buttonToMessage("rotateOneProblematic", () => ["rotateProblematic", assignRec({}, rrfilters.problematic, {limit: 1})]);
    buttonToMessage("unmarkOneProblematic", () => ["unmarkProblematic", assignRec({}, rrfilters.problematic, {limit: 1})]);
    buttonToMessage("unmarkAllProblematic", () => ["unmarkProblematic", rrfilters.problematic]);
    buttonToMessage("rotateOneInLimbo",     () => ["rotateInLimbo", assignRec({}, rrfilters.inLimbo, {limit: 1})]);
    buttonToMessage("discardOneInLimbo",    () => ["popInLimbo", false, assignRec({}, rrfilters.inLimbo, {limit: 1})]);
    buttonToMessage("discardAllInLimbo",    () => ["popInLimbo", false, rrfilters.inLimbo]);
    buttonToMessage("collectOneInLimbo",    () => ["popInLimbo", true, assignRec({}, rrfilters.inLimbo, {limit: 1})]);
    buttonToMessage("collectAllInLimbo",    () => ["popInLimbo", true, rrfilters.inLimbo]);
    buttonToMessage("stopAllInFlight",      () => ["stopInFlight", narrowTabId]);
    buttonToMessage("retryUnarchived",      () => ["retryUnarchived", true, rrfilters.unarchived]);
    buttonToMessage("archiveBuggedOut",     () => ["archiveBuggedOut", rrfilters.buggedOut]);
    buttonToMessage("deleteBuggedOut",      () => ["deleteBuggedOut", rrfilters.buggedOut]);

    setUI(document, "rrfilters", rrfilters, (value, path) => {
        let cid = capitalize(path.split(".")[1]);
        let resetFunc = dataNodeUpdaters["reset" + cid];
        if (resetFunc !== undefined)
            browser.runtime.sendMessage(["get" + cid]).then(resetFunc).catch(logError);
        else
            console.warn("unknown update", path, value);
    });

    async function updateConfig(config) {
        if (config === undefined)
            config = await browser.runtime.sendMessage(["getConfig"]);
        setRootClasses(config);
    }

    async function processUpdate(update) {
        let [what, data] = update;

        let updateFunc = dataNodeUpdaters[what];
        if (updateFunc !== undefined)
            return updateFunc(data);

        switch(what) {
        case "updateConfig":
            await updateConfig(data);
            return;
        default:
            let res = await webextRPCHandleMessageDefault(update);
            return res;
        }
    }

    setPageSettling();

    await subscribeToExtension("state" + (narrowTabId !== null ? `#${narrowTabId}` : ""), 3, async (isInvalid) => {
        await updateConfig();
        let res = {};
        for (let id of Object.keys(rrfilters)) {
            res[id] = await browser.runtime.sendMessage(["get" + capitalize(id)]);
            if (isInvalid()) return;
        }

        for (let id of Object.keys(rrfilters))
            dataNodeUpdaters["reset" + capitalize(id)](res[id]);
    }, asyncNoop, processUpdate);

    setPageDone();

    // force re-scroll
    viewHashNode();
}

document.addEventListener("DOMContentLoaded", () => stateMain().catch(setPageError), setPageError);
