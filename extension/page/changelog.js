/*
 * The "Changelog" page.
 *
 * Copyright (c) 2024 Jan Malakhovski <oxij@oxij.org>
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

document.addEventListener("DOMContentLoaded", async () => {
    let config = await browser.runtime.sendMessage(["getConfig"]);
    setRootClasses(config);

    let selfURL = browser.runtime.getURL("/page/changelog.html");
    let rootURL = browser.runtime.getURL("/");

    // setup history navigation
    window.onpopstate = (event) => {
        if (event.state === null)
            return;
        let id = event.state.id;
        if (id !== undefined)
            focusNode(id);
    };

    // style links of different kinds differently, track history state
    for (let el of document.getElementsByTagName("a")) {
        if (el.href.startsWith(selfURL))
            el.classList.add("internal");
        else if (el.href.startsWith(rootURL))
            el.classList.add("local");

        el.onclick = (event) => {
            history.pushState({ id }, "", selfURL + `#${id}`);
        };
    }

    async function processUpdate(update) {
        let [what, data] = update;
        switch (what) {
        case "updateConfig":
            setRootClasses(data);
            break;
        default:
            await handleDefaultUpdate(update, "changelog");
        }
    }

    // add default handlers
    await subscribeToExtension(catchAll(processUpdate));

    // show UI
    document.body.style["display"] = null;

    // highlight current target
    focusHashNode();
});
