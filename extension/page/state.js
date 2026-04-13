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

let tabId = getMapURLParam(statePageURL, "tab", document.location, toNumber, null, null);
if (tabId !== null)
    document.title = `Hoardy-Web: tab ${tabId}: Internal State`;

let rrfilters = {
    problematic: mkReqresFilter({tabId}),
    in_limbo: mkReqresFilter({tabId}),
    log: mkReqresFilter({tabId}),
    queued: mkReqresFilter({tabId}),
    unarchived: mkReqresFilter({tabId}),
};

function resetInFlight(log_data) {
    resetDataNode("data_in_flight", log_data);
}

function resetProblematic(log_data) {
    resetDataNode("data_problematic", log_data, (loggable) => isAcceptedBy(rrfilters.problematic, loggable));
}

function resetInLimbo(log_data) {
    resetDataNode("data_in_limbo", log_data, (loggable) => isAcceptedBy(rrfilters.in_limbo, loggable));
}

function resetLog(log_data) {
    resetDataNode("data_log", log_data, (loggable) => isAcceptedBy(rrfilters.log, loggable));
}

function resetQueued(log_data) {
    resetDataNode("data_queued", log_data, (loggable) => isAcceptedBy(rrfilters.queued, loggable));
}

function resetUnarchived(log_data) {
    resetDataNode("data_unarchived", log_data, (loggable) => isAcceptedBy(rrfilters.unarchived, loggable));
}

async function stateMain() {
    setPageLoading();

    await commonMain();

    buttonToMessage("forgetHistory",        () => ["forgetHistory", rrfilters.log]);
    buttonToMessage("rotateOneProblematic", () => ["rotateProblematic", assignRec({}, rrfilters.problematic, {limit: 1})]);
    buttonToMessage("unmarkOneProblematic", () => ["unmarkProblematic", assignRec({}, rrfilters.problematic, {limit: 1})]);
    buttonToMessage("unmarkAllProblematic", () => ["unmarkProblematic", rrfilters.problematic]);
    buttonToMessage("rotateOneInLimbo",     () => ["rotateInLimbo", assignRec({}, rrfilters.in_limbo, {limit: 1})]);
    buttonToMessage("discardOneInLimbo",    () => ["popInLimbo", false, assignRec({}, rrfilters.in_limbo, {limit: 1})]);
    buttonToMessage("discardAllInLimbo",    () => ["popInLimbo", false, rrfilters.in_limbo]);
    buttonToMessage("collectOneInLimbo",    () => ["popInLimbo", true, assignRec({}, rrfilters.in_limbo, {limit: 1})]);
    buttonToMessage("collectAllInLimbo",    () => ["popInLimbo", true, rrfilters.in_limbo]);
    buttonToMessage("stopAllInFlight",      () => ["stopInFlight", tabId]);

    buttonToMessage("retryAllUnarchived");

    setUI(document, "rrfilters", rrfilters, (value, path) => {
        if (path.startsWith("rrfilters.problematic."))
            browser.runtime.sendMessage(["getProblematicLog"]).then(resetProblematic).catch(logError);
        else if (path.startsWith("rrfilters.in_limbo."))
            browser.runtime.sendMessage(["getInLimboLog"]).then(resetInLimbo).catch(logError);
        else if (path.startsWith("rrfilters.log."))
            browser.runtime.sendMessage(["getLog"]).then(resetLog).catch(logError);
        else if (path.startsWith("rrfilters.queued."))
            browser.runtime.sendMessage(["getQueuedLog"]).then(resetQueued).catch(logError);
        else if (path.startsWith("rrfilters.unarchived."))
            browser.runtime.sendMessage(["getUnarchivedLog"]).then(resetUnarchived).catch(logError);
        else
            console.warn("unknown rrfilters update", path, value);
    });

    async function updateConfig(config) {
        if (config === undefined)
            config = await browser.runtime.sendMessage(["getConfig"]);
        setRootClasses(config);
    }

    async function processUpdate(update) {
        let [what, data] = update;
        switch(what) {
        case "updateConfig":
            await updateConfig(data);
            return;
        case "resetInFlight":
            resetInFlight(data);
            return true;
        case "resetProblematicLog":
            resetProblematic(data);
            return true;
        case "resetInLimboLog":
            resetInLimbo(data);
            return true;
        case "resetLog":
            resetLog(data);
            return true;
        case "resetQueued":
            resetQueued(data);
            return true;
        case "resetUnarchived":
            resetUnarchived(data);
            return true;
        // incrementally add new rows
        case "newInFlight":
            appendToLog(document.getElementById("data_in_flight"), data);
            return true;
        case "newProblematic":
            appendToLog(document.getElementById("data_problematic"), data, (loggable) => isAcceptedBy(rrfilters.problematic, loggable));
            return true;
        case "newLimbo":
            appendToLog(document.getElementById("data_in_limbo"), data, (loggable) => isAcceptedBy(rrfilters.in_limbo, loggable));
            return true;
        case "newLog":
            appendToLog(document.getElementById("data_log"), data, (loggable) => isAcceptedBy(rrfilters.log, loggable));
            return true;
        case "newQueued":
            appendToLog(document.getElementById("data_queued"), data, (loggable) => isAcceptedBy(rrfilters.queued, loggable));
            return true;
        default:
            let res = await webextRPCHandleMessageDefault(update);
            return res;
        }
    }

    setPageSettling();

    await subscribeToExtension("state" + (tabId !== null ? `#${tabId}` : ""), 3, async (isInvalid) => {
        await updateConfig();
        let inFlightLog = await browser.runtime.sendMessage(["getInFlightLog"]);
        let problematicLog = await browser.runtime.sendMessage(["getProblematicLog"]);
        if (isInvalid()) return;
        let inLimboLog = await browser.runtime.sendMessage(["getInLimboLog"]);
        if (isInvalid()) return;
        let log = await browser.runtime.sendMessage(["getLog"]);
        if (isInvalid()) return;
        let queuedLog = await browser.runtime.sendMessage(["getQueuedLog"]);
        if (isInvalid()) return;
        let unarchivedLog = await browser.runtime.sendMessage(["getUnarchivedLog"]);
        if (isInvalid()) return;

        resetInFlight(inFlightLog);
        resetProblematic(problematicLog);
        resetInLimbo(inLimboLog);
        resetLog(log);
        resetQueued(queuedLog);
        resetUnarchived(unarchivedLog);
    }, asyncNoop, processUpdate);

    setPageDone();

    // force re-scroll
    viewHashNode();
}

document.addEventListener("DOMContentLoaded", () => stateMain().catch(setPageError), setPageError);
