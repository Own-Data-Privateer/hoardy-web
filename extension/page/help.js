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

    // show settings as iframe
    let iframe = document.createElement("iframe");
    iframe.src = popupURL + "#all";
    iframe.setAttribute("title", "The Settings Popup.");
    document.body.appendChild(iframe);

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
                broadcast(["highlightNode", "popup", null]);
            };
        } else if (el.href.startsWith(popupURL + "#")) {
            let target = el.href.substr(popupURL.length + 1);
            el.classList.add("local");
            el.href = "javascript:void(0)";
            el.onclick = (event) => {
                event.cancelBubble = true;
                if (isMobile) {
                    history.pushState({ id }, "", selfURL + `#${id}`);
                    history.pushState({}, "", popupURL + `#${target}`);
                }
                broadcast(["focusNode", "popup", target]);
            };
            el.onmouseover = (event) => {
                broadcast(["focusNode", "popup", target]);
            };
        }
    }

    // Resize elements to window. We have to do this because we want body and
    // settings iframe to have independent scroll on Desktop browsers.
    let body = document.getElementById("body");

    if (isMobile) {
        iframe.style["border"] = "0px solid black";
        iframe.style["width"] = "100%";
    } else {
        document.body.style["display"] = "flex";

        body.style["width"] = "auto";
        body.style["max-height"] = "500px";
        body.style["overflow-y"] = "scroll";

        iframe.style["max-height"] = "500px";
        iframe.style["min-width"] = "450px";
        iframe.style["overflow-y"] = "scroll";
    }

    // show UI
    if (isMobile)
        body.style["display"] = "block";
    else
        body.style["display"] = "inline-block";

    function resize() {
        if (isMobile) {
            // to prevent internal scroll
            let h = iframe.contentDocument.body.scrollHeight + 20;
            iframe.style["min-height"] = `${h}px`;
        } else {
            // to prevent external scroll
            let h = window.innerHeight - 5;
            body.style["max-height"] = `${h}px`;
            iframe.style["max-height"] = `${h}px`;
        }
    }

    resize();

    if (!isMobile)
        window.onresize = (event) => resize();

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
            if (isMobile)
                resize();
        default:
            await handleDefaultUpdate(update, "help");
        }
    }

    // add default handlers
    await subscribeToExtension(catchAll(processUpdate));

    // highlight current target
    focusHashNode();
});
