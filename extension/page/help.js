/*
 * The "Help" page.
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

document.addEventListener("DOMContentLoaded", async () => {
    let selfURL = browser.runtime.getURL("/page/help.html");
    let popupURL = browser.runtime.getURL("/page/popup.html");
    let rootURL = browser.runtime.getURL("/");

    let body = document.getElementById("body");
    let iframe = document.getElementById("iframe");
    let minWidth = 1355; // see ./help.template
    let columns = true;

    // setup history navigation
    window.onpopstate = (event) => {
        if (event.state === null)
            return;
        let id = event.state.id;
        if (id !== undefined)
            focusNode(id);
    };

    // allow to un-highlight currently highlighted node
    document.body.onclick = (event) => {
        highlightNode(null);
        broadcast(["highlightNode", "popup", null]);
    };

    // number of rewritten internal links
    let num_links = 0;

    // style links of different kinds differently, track history state,
    // broadcast highlight messages on mouseovers over links to popup.html
    for (let el of document.getElementsByTagName("a")) {
        let id = `link-${num_links}`;
        num_links += 1;
        el.id = id;

        if (el.href.startsWith(selfURL + "#")) {
            let target = el.href.substr(selfURL.length + 1);
            el.classList.add("internal");
            el.href = "javascript:void(0)";
            el.onclick = (event) => {
                event.cancelBubble = true;
                history.pushState({ id }, "", selfURL + `#${id}`);
                history.pushState({ id: target }, "", selfURL + `#${target}`);
                focusNode(target);
            };
            el.onmouseover = (event) => {
                if (columns)
                    broadcast(["highlightNode", "popup", null]);
            };
        } else if (el.href.startsWith(popupURL + "#")) {
            let target = el.href.substr(popupURL.length + 1);
            el.classList.add("popup");
            el.href = "javascript:void(0)";
            el.onclick = (event) => {
                event.cancelBubble = true;
                if (!columns) {
                    history.pushState({ id }, "", selfURL + `#${id}`);
                    history.pushState({}, "", popupURL + `#${target}`);
                }
                broadcast(["focusNode", "popup", target]);
            };
            el.onmouseover = (event) => {
                if (columns)
                    broadcast(["focusNode", "popup", target]);
            };
        } else {
            if (el.href.startsWith(rootURL))
                el.classList.add("local");

            el.onclick = (event) => {
                history.pushState({ id }, "", selfURL + `#${id}`);
            };
        }
    }

    // Resize elements to window. This switches between `columns` and
    // `linear` layouts depending on width. This part is not done via
    // `CSS` because we use the `columns` value above too.
    function resize() {
        let w = window.innerWidth;
        console.log("current width:", w);
        columns = w >= minWidth;

        setConditionalClass(document.body, columns, "columns");
        setConditionalClass(document.body, !columns, "linear");

        // Prevent independent scroll in `columns` layout.
        let h1 = columns ? `${window.innerHeight - 5}px` : null;
        body.style["max-height"]
            = iframe.style["max-height"]
            = h1;

        // To simplify things a bit.
        let h2 = columns ? h1 : null;
        body.style["min-height"] = h2;

        // Prevent in-iframe scroll in `linear` layout.
        let h3 = columns ? h1 : `${iframe.contentDocument.body.scrollHeight + 20}px`;
        iframe.style["min-height"] = h3;
    }

    resize();
    window.onresize = resize;

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
                    ? `bound to \`${shortcut}\` (= default)`
                    : `bound to \`${shortcut}\` (default: \`${def}\`)`
            } else
                return `unbound at the moment (default: \`${def}\`)`;
        } else if (shortcut)
            return `bound to \`${shortcut}\` (default: unbound)`
        else
            return `unbound (= default)`;
    });


    async function processUpdate(update) {
        let [what, data] = update;
        switch (what) {
        case "popupResized":
            resize();
        default:
            await handleDefaultUpdate(update, "help");
        }
    }

    // add default handlers
    await subscribeToExtension(catchAll(processUpdate));

    // show UI
    document.body.style["display"] = null;

    // highlight current target
    focusHashNode();
});
