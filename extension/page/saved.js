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
 * The "Saved in Local Storage" page.
 */

"use strict";

// TODO: remove this
let tabId = null;

async function stateMain() {
    await commonMain();

    buttonToMessage("requeueSaved",   () => ["requeueSaved", false]);
    buttonToMessage("rearchiveSaved", () => ["requeueSaved", true]);
    buttonToAction("deleteSaved", catchAll(() => {
        if (!window.confirm("Really?"))
            return;

        browser.runtime.sendMessage(["deleteSaved"]).catch(logError);
    }));

    async function setupUI(rrfilters) {
        setUI(document, "rrfilters", rrfilters, (value, path) => {
            browser.runtime.sendMessage(["setSavedFilters", value]).catch(logError);
        });
    }

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
        case "setSavedFilters":
            setupUI(data);
            break;
        case "resetSaved":
            resetDataNode("data", data);
            break;
        default:
            await handleDefaultUpdate(update, thisTabId);
        }
    }

    await subscribeToExtension(catchAll(processUpdate), catchAll(async (willReset) => {
        await updateConfig();
    }), () => false, setPageLoading, setPageSettling);

    let rrfilters = await browser.runtime.sendMessage(["getSavedFilters"]);
    await browser.runtime.sendMessage(["setSavedFilters", rrfilters]);

    // show UI
    setPageLoaded();

    // force re-scroll
    viewHashNode();
}

document.addEventListener("DOMContentLoaded", () => stateMain().catch(setPageError), setPageError);
