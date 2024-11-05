/*
 * The "Internal State" page.
 *
 * Copyright (c) 2023-2024 Jan Malakhovski <oxij@oxij.org>
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

"use strict";

let rrfilters = {
    problematic: assignRec({}, rrfilterDefaults),
    in_limbo: assignRec({}, rrfilterDefaults),
    log: assignRec({}, rrfilterDefaults),
    queued: assignRec({}, rrfilterDefaults),
    unarchived: assignRec({}, rrfilterDefaults),
};

let tabId = getMapURLParam(stateURL, "tab", document.location, toNumber, null, null);
if (tabId !== null)
    document.title = `Hoardy-Web: tab ${tabId}: Internal State`;

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
    await commonMain();

    buttonToMessage("forgetHistory",        () => ["forgetHistory", tabId, rrfilters.log]);
    buttonToMessage("rotateOneProblematic", () => ["rotateProblematic", 1, tabId, rrfilters.problematic]);
    buttonToMessage("unmarkOneProblematic", () => ["unmarkProblematic", 1, tabId, rrfilters.problematic]);
    buttonToMessage("unmarkAllProblematic", () => ["unmarkProblematic", null, tabId, rrfilters.problematic]);
    buttonToMessage("rotateOneInLimbo",     () => ["rotateInLimbo", 1, tabId, rrfilters.in_limbo]);
    buttonToMessage("discardOneInLimbo",    () => ["popInLimbo", false, 1, tabId, rrfilters.in_limbo]);
    buttonToMessage("discardAllInLimbo",    () => ["popInLimbo", false, null, tabId, rrfilters.in_limbo]);
    buttonToMessage("collectOneInLimbo",    () => ["popInLimbo", true, 1, tabId, rrfilters.in_limbo]);
    buttonToMessage("collectAllInLimbo",    () => ["popInLimbo", true, null, tabId, rrfilters.in_limbo]);
    buttonToMessage("stopAllInFlight",      () => ["stopInFlight", tabId]);

    buttonToMessage("retryUnarchived");

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
            break;
        case "resetInFlight":
            resetInFlight(data);
            break;
        case "resetProblematicLog":
            resetProblematic(data);
            break;
        case "resetInLimboLog":
            resetInLimbo(data);
            break;
        case "resetLog":
            resetLog(data);
            break;
        case "resetQueued":
            resetQueued(data);
            break;
        case "resetUnarchived":
            resetUnarchived(data);
            break;
        // incrementally add new rows
        case "newInFlight":
            appendToLog(document.getElementById("data_in_flight"), data);
            break;
        case "newProblematic":
            appendToLog(document.getElementById("data_problematic"), data, (loggable) => isAcceptedBy(rrfilters.problematic, loggable));
            break;
        case "newLimbo":
            appendToLog(document.getElementById("data_in_limbo"), data, (loggable) => isAcceptedBy(rrfilters.in_limbo, loggable));
            break;
        case "newLog":
            appendToLog(document.getElementById("data_log"), data, (loggable) => isAcceptedBy(rrfilters.log, loggable));
            break;
        case "newQueued":
            appendToLog(document.getElementById("data_queued"), data, (loggable) => isAcceptedBy(rrfilters.queued, loggable));
            break;
        default:
            await handleDefaultUpdate(update, thisTabId);
        }
    }

    await subscribeToExtension(catchAll(processUpdate), catchAll(async (willReset) => {
        await updateConfig();
        let inFlightLog = await browser.runtime.sendMessage(["getInFlightLog"]);
        let problematicLog = await browser.runtime.sendMessage(["getProblematicLog"]);
        if (willReset()) return;
        let inLimboLog = await browser.runtime.sendMessage(["getInLimboLog"]);
        if (willReset()) return;
        let log = await browser.runtime.sendMessage(["getLog"]);
        if (willReset()) return;
        let queuedLog = await browser.runtime.sendMessage(["getQueuedLog"]);
        if (willReset()) return;
        let unarchivedLog = await browser.runtime.sendMessage(["getUnarchivedLog"]);
        if (willReset()) return;

        resetInFlight(inFlightLog);
        resetProblematic(problematicLog);
        resetInLimbo(inLimboLog);
        resetLog(log);
        resetQueued(queuedLog);
        resetUnarchived(unarchivedLog);
    }), (event) => {
        let cmd = event[0];
        return !(cmd.startsWith("reset") || cmd.startsWith("new"));
    }, setPageLoading, setPageSettling);

    // show UI
    setPageLoaded();

    // force re-scroll
    viewHashNode();
}

document.addEventListener("DOMContentLoaded", () => stateMain().catch(setPageError), setPageError);
