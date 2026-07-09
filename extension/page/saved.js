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
 * The "Saved in Local Storage" page.
 */

"use strict";

let dbody = document.body;

async function stateMain() {
    setPageLoading();

    await commonMain();

    let config;
    let rearchive = newRearchiveVars();

    function updateUI() {
        setRootClasses(config);
        implySetConditionalOff(dbody, "on-rearchive", !(config.rearchiveExportAs || config.rearchiveSubmitHTTP || rearchive.andRewrite));
    }

    setUIRec(document, "rearchive", rearchive, (newrearchive, path) => {
        updateRearchiveVars(newrearchive, path);
        updateUI();
    });

    async function updateConfig(nconfig) {
        if (nconfig === undefined)
            config = await browser.runtime.sendMessage(["getConfig"]);
        else
            config = nconfig;

        updateUI();
    }

    let savedFilters;
    let [resetSaved, appendSaved] = mkDataNodeUpdater("data", () => savedFilters);

    async function updateSavedFilters(nsavedFilters) {
        if (nsavedFilters === undefined)
            savedFilters = await browser.runtime.sendMessage(["getSavedFilters"]);
        else
            savedFilters = nsavedFilters;

        let reset = setUI(document, "rrfilters", savedFilters, (value, path, resetting) => {
            resetSingletonTimeout(
                scheduledUI,
                "setSavedFilters",
                resetting ? 300 : 0,
                () => browser.runtime.sendMessage(["setSavedFilters", value]).catch(logError)
            );
        });
        buttonToAction("reset-rrfilters", reset);
    }

    async function processUpdate(update) {
        let [what, data] = update;
        switch(what) {
        case "updateConfig":
            await updateConfig(data);
            return;
        case "setSavedFilters":
            await updateSavedFilters(data);
            return;
        case "resetSaved":
            resetSaved(data);
            return;
        // TODO: implement in background
        case "appendSaved":
            appendSaved(data);
            return;
        default:
            let res = await webextRPCHandleMessageDefault(update);
            return res;
        }
    }

    buttonToMessage("rearchiveSaved", () => ["rearchiveSaved", savedFilters, true, rearchive.andRewrite, rearchive.andDelete]);
    buttonToAction("deleteSaved", () => {
        if (!window.confirm("Really?"))
            return;

        browser.runtime.sendMessage(["deleteSaved", savedFilters]).catch(logError);
    });

    setPageSettling();

    await subscribeToExtension("saved", 3, async (isInvalid) => {
        await updateConfig();
        await updateSavedFilters();
    }, asyncNoop, processUpdate);

    await browser.runtime.sendMessage(["setSavedFilters", savedFilters]);

    if (config.debugRuntime)
        setTimeout(() => verifyLinks(document, console.error, true), 100);

    setPageDone();

    // force re-scroll
    viewHashNode();
}

document.addEventListener("DOMContentLoaded", () => stateMain().catch(setPageError), setPageError);
