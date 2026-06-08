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
let noPopup = new Set([
    "_execute_browser_action",
    "showLog",
    "showWindowLog",
    "showTabLog",
]);

// only set on Chromium
let firefoxCommands;

async function updatePage(initial) {
    // generate shortcuts table
    let rows = [];

    let shortcuts = await getShortcuts(firefoxCommands);
    for (let [name, shortcut] of Object.entries(shortcuts)) {
        let pointer = name.startsWith("toggleTabConfig") ?
            mapShortcutName((name, children) => "genui-tabconfig." + (children ? "children." : "") + name, name) :
            name;

        let desc = shortcut.description;
        let [sdesc, ldesc] = desc.split(" : ");
        shortcut.sdesc = sdesc;
        shortcut.ldesc = ldesc;

        let cur = shortcut.shortcut || "unbound";
        let def = shortcut.default = shortcut.suggested_key ? shortcut.suggested_key.default || "unbound" : "unbound";

        let tr = document.createElement("tr");
        tr.id = `shortcut-${name}`;
        let s = document.createElement("span");

        if (noPopup.has(name)) {
            if (ldesc !== undefined)
                s.innerHTML = sdesc + ": " + microMarkdownToHTML(ldesc);
            else
                s.innerHTML = microMarkdownToHTML(desc);
            appendElements(tr, "td", s);
        } else {
            s.innerHTML = ": " + microMarkdownToHTML(ldesc);
            appendElements(tr, "td", [
                [(e) => {
                    e.href = `./popup.html#${pointer}`;
                    return e;
                }, "a", sdesc],
                [s],
            ]);
        }
        appendElements(tr, "td", cur);
        appendElements(
            tr, "td", "div",
            cur === def ? "ditto" : browser.commands !== undefined && browser.commands.update !== undefined ?
                createButton(def, "Reset to default", async () => {
                    await browser.commands.update({name, shortcut: def});
                    await updatePage(false);
                }) :
                def,
        );

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

    if (useDebugger)
        firefoxCommands = await fetch(browser.runtime.getURL("/manifest-commands-firefox.json")).then((result) => result.json());

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

        if (config.debugRuntime)
            setTimeout(
                () => verifyLinks(document, console.error, true, undefined, (hashlessHref, id) => {
                    if (hashlessHref === popupPageURL && id.startsWith("genui-"))
                        return id.substr(6);
                    return id;
                }),
                100,
            );
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
