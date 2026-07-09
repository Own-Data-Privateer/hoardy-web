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

    let config;

    if (narrowTabId !== null)
        document.title = `Hoardy-Web: tab ${narrowTabId}${narrowSessionId === null || thisSessionId === narrowSessionId ? "" : " of " + narrowSessionId.toString()}: Internal State`;

    buttonToMessage("stopInFlight",         () => ["stopInFlight", rrfilters.inFlight]);
    buttonToMessage("forgetLog",            () => ["forgetLog", rrfilters.log]);
    buttonToMessage("rotateOneProblematic", () => ["rotateProblematic", assignRec({}, rrfilters.problematic, {limit: 1})]);
    buttonToMessage("unmarkOneProblematic", () => ["unmarkProblematic", assignRec({}, rrfilters.problematic, {limit: 1})]);
    buttonToMessage("unmarkAllProblematic", () => ["unmarkProblematic", rrfilters.problematic]);
    buttonToMessage("rotateOneInLimbo",     () => ["rotateInLimbo", assignRec({}, rrfilters.inLimbo, {limit: 1})]);
    buttonToMessage("discardOneInLimbo",    () => ["popInLimbo", false, assignRec({}, rrfilters.inLimbo, {limit: 1})]);
    buttonToMessage("discardAllInLimbo",    () => ["popInLimbo", false, rrfilters.inLimbo]);
    buttonToMessage("collectOneInLimbo",    () => ["popInLimbo", true, assignRec({}, rrfilters.inLimbo, {limit: 1})]);
    buttonToMessage("collectAllInLimbo",    () => ["popInLimbo", true, rrfilters.inLimbo]);
    buttonToMessage("retryUnarchived",      () => ["retryUnarchived", true, rrfilters.unarchived]);
    buttonToMessage("archiveBuggedOut",     () => ["archiveBuggedOut", rrfilters.buggedOut]);
    buttonToMessage("deleteBuggedOut",      () => ["deleteBuggedOut", rrfilters.buggedOut]);

    for (let id of Object.keys(rrfilters)) {
        let cid = capitalize(id);
        let getCid = ["get" + cid];
        let resetCid = "reset" + cid;
        let resetFunc = dataNodeUpdaters[resetCid];

        if (resetFunc === undefined) {
            console.error("no node updater for", id);
            continue;
        }

        let reset = setUI(document, "rrfilters." + id, rrfilters[id], (value, path, resetting) => {
            resetSingletonTimeout(
                scheduledUI,
                resetCid,
                resetting ? 300 : 0,
                () => browser.runtime.sendMessage(getCid).then(resetFunc).catch(logError)
            );
        });
        buttonToAction("reset-rrfilters." + id, reset);
    }

    async function updateConfig(nconfig) {
        if (nconfig === undefined)
            config = await browser.runtime.sendMessage(["getConfig"]);
        else
            config = nconfig;

        setRootClasses(config);
    }

    async function processUpdate(update) {
        let [what, data] = update;
        switch(what) {
        case "updateConfig":
            await updateConfig(data);
            return;
        default:
            let updateFunc = dataNodeUpdaters[what];
            if (updateFunc !== undefined)
                return updateFunc(data);

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
    viewHashNode((id) => id === "tail" ? scrollEndIntoView : undefined);
}

document.addEventListener("DOMContentLoaded", () => stateMain().catch(setPageError), setPageError);
