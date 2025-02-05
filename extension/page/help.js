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
 * The "Help" page.
 */

"use strict";

document.addEventListener("DOMContentLoaded", async () => {
    let body = document.getElementById("body");
    let iframe = document.getElementById("iframe");
    let minWidth = 1355; // see ./help.template
    let columns = true;

    // allow to un-highlight currently highlighted node
    document.body.addEventListener("click", (event) => {
        highlightNode(null);
        broadcastToPopup("highlightNode", null);
    });

    setupHistoryPopState();
    classifyDocumentLinks(document, [
        ["/page/help.html", "internal"],
        ["/page/popup.html", "popup"],
        ["/", "local"],
    ], (link, info) => {
        let klass = info.klass;
        if (klass !== undefined)
            link.classList.add(klass);

        switch (info.klass) {
        case "internal":
            link.href = "javascript:void(0)";
            link.onclick = (event) => {
                event.cancelBubble = true;
                historyFromTo({ id: info.id }, { id: info.target });
                focusNode(info.target);
            };
            link.onmouseover = (event) => {
                if (columns)
                    broadcastToPopup("highlightNode", null);
            };
            break;
        case "popup":
            link.href = "javascript:void(0)";
            link.onclick = (event) => {
                event.cancelBubble = true;
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
                historyFromTo({ id: info.id });
            };
            link.onmouseover = (event) => {
                if (columns)
                    broadcastToPopup("highlightNode", null);
            };
        }
    });

    // Resize elements to window. This switches between `columns` and
    // `linear` layouts depending on width. This part is not done via
    // `CSS` because we use the `columns` value above too.
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

    // expand shortcut macros
    let shortcuts = await getShortcuts();
    macroShortcuts(body, shortcuts, (inner, shortcut, sname) => {
        let sk = manifest.commands[sname];
        let def;
        if (sk.suggested_key && sk.suggested_key.default)
            def = sk.suggested_key.default;
        if (def) {
            if (shortcut) {
                return (shortcut === def)
                    ? `currently bound to \`${shortcut}\` (= default)`
                    : `currently bound to \`${shortcut}\` (default: \`${def}\`)`
            } else
                return `unbound at the moment (default: \`${def}\`)`;
        } else if (shortcut)
            return `currently bound to \`${shortcut}\` (default: unbound)`
        else
            return `unbound at the moment (= default)`;
    });

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
    await subscribeToExtensionSimple("help", catchAll(processUpdate));

    {
        let config = await browser.runtime.sendMessage(["getConfig"]);
        setRootClasses(config);
    }

    window.onresize = catchAll(resize);
    catchAll(resize)();

    // give it a chance to re-compute the layout
    await sleep(1);

    // show UI
    document.body.style["visibility"] = null;

    // highlight current target
    focusHashNode();
});
