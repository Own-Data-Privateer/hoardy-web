/*
 * Copyright (c) 2024-2025 Jan Malakhovski <oxij@oxij.org>
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
 * Minimal page infrastructure.
 */

"use strict";

let pageName = document.location.pathname.substr(6).split(".")[0];

document.addEventListener("DOMContentLoaded", async () => {
    setupHistoryPopState();
    classifyDocumentLinks(document, [
        [`/page/${pageName}.html`, "internal"],
        ["/", "local"],
    ]);

    async function processUpdate(update) {
        let [what, data] = update;
        switch (what) {
        case "updateConfig":
            setRootClasses(data);
            break;
        default:
            await webextRPCHandleMessageDefault(update);
        }
    }

    // add default handlers
    await subscribeToExtensionSimple(pageName, catchAll(processUpdate));

    {
        let config = await browser.runtime.sendMessage(["getConfig"]);
        setRootClasses(config);
    }

    // show UI
    document.body.style["visibility"] = null;

    // highlight current target
    focusHashNode();
});
