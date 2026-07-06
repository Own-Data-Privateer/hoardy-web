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
 * The "Help" page.
 */

"use strict";

let minWidth = 1355; // see ./help.template
let columns = true;

// Resize elements to window. This switches between `columns` and `linear` layouts depending on
// width. This part is not done via `CSS` because we use the `columns` value above too.
function resize() {
    let w = window.innerWidth;
    let h = window.innerHeight;

    console.log("current viewport:", w, h);
    columns = w >= minWidth;

    setConditionalClass(document.body, "columns", columns);
    setConditionalClass(document.body, "linear", !columns);

    // Prevent independent scroll in `columns` layout.
    let h1 = columns ? `${h - 5}px` : null;
    body.style["min-height"]
        = body.style["max-height"]
        = body.style["height"]
        = h1;

    let ib = iframe.contentDocument.body;
    if (ib === null)
        // not yet loaded
        return;

    // Prevent in-iframe scroll in `linear` layout.
    let h2 = columns ? h1 : `${ib.scrollHeight + 20}px`;
    iframe.style["min-height"]
        = iframe.style["max-height"]
        = iframe.style["height"]
        = h2;
}

function updateLinks(node) {
    classifyDocumentLinks(node, [
        ["/page/help.html", "internal"],
        ["/page/popup.html", "popup"],
        ["/", "local"],
    ], (link, info) => {
        let klass = info.klass;
        if (klass !== undefined)
            link.classList.add(klass);

        switch (info.klass) {
        case "internal":
            link.onclick = (event) => {
                event.stopPropagation();
                event.preventDefault();
                historyFromTo({ id: info.id }, { id: info.target });
                focusNode(info.target);
            };
            link.onmouseover = (event) => {
                if (columns)
                    broadcastToPopup("highlightNode", null);
            };
            break;
        case "popup":
            link.onclick = (event) => {
                event.stopPropagation();
                event.preventDefault();
                if (!columns)
                    historyFromTo({ id: info.id }, info.href);
                broadcastToPopup("focusNode", info.target);
            };
            link.onmouseover = (event) => {
                if (columns)
                    broadcastToPopup("focusNode", info.target);
            };
            break;
        case "local":
        default:
            link.onclick = (event) => {
                event.stopPropagation();
                historyFromTo({ id: info.id });
            };
            link.onmouseover = (event) => {
                if (columns)
                    broadcastToPopup("highlightNode", null);
            };
        }
    });
}

// no corresponding popup UI elements
let noPopup = new Set(["_execute_browser_action", "showLog", "showTabLog"]);

async function updatePage(initial) {
    // generate shortcuts table
    let rows = [];

    let shortcuts = await getShortcuts();
    for (let [name, shortcut] of Object.entries(shortcuts)) {
        if (name.startsWith("toggleTabConfig"))
            name = mapShortcutName((name, children) => "div-tabconfig." + (children ? "children." : "") + name, name);

        let desc = shortcut.description;
        let [sdesc, ldesc] = desc.split(": ");

        let cur = shortcut.shortcut;
        let def = shortcut.suggested_key ? shortcut.suggested_key.default || "" : "";

        let tr = document.createElement("tr");
        appendElements(tr, "td", cur ? cur : "unbound");
        appendElements(tr, "td", cur === def ? "ditto" : (def ? def : "unbound"));
        if (noPopup.has(name))
            appendElements(tr, "td", desc);
        else
            appendElements(tr, "td", [
                [(e) => {
                    e.href = `./popup.html#${name}`;
                    return e;
                }, "a", sdesc],
                [": " + ldesc],
            ]);

        rows.push(tr);
    }

    let tbody = document.getElementById("tbody-sk");
    tbody.replaceChildren(...rows);

    if (!initial)
        updateLinks(tbody);
}

async function helpMain () {
    setPageLoading();

    let body = document.getElementById("body");
    let iframe = document.getElementById("iframe");

    // allow to un-highlight currently highlighted node
    document.body.addEventListener("click", (event) => {
        highlightNode(null);
        broadcastToPopup("highlightNode", null);
    });

    setupHistoryPopState();

    if (browser.commands !== undefined && browser.commands.onChanged !== undefined)
        browser.commands.onChanged.addListener(() => {
            resetSingletonTimeout(scheduledUI, "updatePage", 300, () => updatePage(false));
        });
    await updatePage(true);

    updateLinks(document);

    async function processUpdate(update) {
        let [what, data] = update;
        switch (what) {
        case "updateConfig":
            setRootClasses(data);
            break;
        case "popupResized":
            resize();
            break;
        default:
            await webextRPCHandleMessageDefault(update);
        }
    }

    // add default handlers
    await subscribeToExtensionSimple("help", 3, processUpdate);

    {
        let config = await browser.runtime.sendMessage(["getConfig"]);
        setRootClasses(config);
    }

    window.onresize = catchAll(resize);
    catchAll(resize)();

    // give it a chance to re-compute the layout
    await sleep(1);

    // show UI
    body.style["visibility"] = null;
    document.getElementById("container").style["visibility"] = null;

    // finish
    setPageDone();

    // highlight current target
    focusHashNode();
}

document.addEventListener("DOMContentLoaded", () => helpMain().catch(setPageError), setPageError);
