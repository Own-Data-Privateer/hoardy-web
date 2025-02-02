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
 * The "Changelog" page.
 */

"use strict";

document.addEventListener("DOMContentLoaded", async () => {
    let selfURL = browser.runtime.getURL("/page/changelog.html");
    let rootURL = browser.runtime.getURL("/");

    setupHistoryPopState();

    // number of rewritten internal links
    let num_links = 0;

    // style links of different kinds differently, track history state
    for (let el of document.getElementsByTagName("a")) {
        let id = `link-${num_links}`;
        num_links += 1;
        el.id = id;

        if (el.href.startsWith(selfURL))
            el.classList.add("internal");
        else if (el.href.startsWith(rootURL))
            el.classList.add("local");

        el.onclick = (event) => {
            historyFromTo({ id });
        };
    }

    async function processUpdate(update) {
        let [what, data] = update;
        switch (what) {
        case "updateConfig":
            setRootClasses(data);
            break;
        default:
            await webextRPCHandleMessageDefault(update, "changelog");
        }
    }

    // add default handlers
    await subscribeToExtensionSimple(catchAll(processUpdate));

    {
        let config = await browser.runtime.sendMessage(["getConfig"]);
        setRootClasses(config);
    }

    // show UI
    document.body.style["visibility"] = null;

    // highlight current target
    focusHashNode();
});
