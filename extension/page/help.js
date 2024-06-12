/*
 * Copyright (c) 2023-2024 Jan Malakhovski <oxij@oxij.org>
 *
 * This file can be distributed under the terms of the GNU GPL, version 3 or later.
 */

"use strict";

document.addEventListener("DOMContentLoaded", () => {
    let popupURL = browser.runtime.getURL("/page/popup.html");

    // show settings as iframe
    let iframe = document.createElement("iframe");
    iframe.src = popupURL + "#all";
    iframe.setAttribute("title", "The Settings Popup.");
    document.body.appendChild(iframe);

    // a flag making the highlight stick around
    let sticky = false;

    // broadcast highlight messages on mouseovers over links to popup.html
    for (let el of document.getElementsByTagName("a")) {
        if (!el.href.startsWith(popupURL + "#")) continue;
        let target = el.href.substr(popupURL.length + 1);
        el.classList.add("pointer");
        el.href = "javascript:void(0)";
        el.onclick = (event) => {
            sticky = !sticky;
        };
        el.onmouseover = (event) => {
            broadcast(["focusNode", "popup", target]);
        };
        el.onmouseleave = (event) => {
            if (!sticky)
                broadcast(["focusNode", "popup", null]);
        };
    }

    // resize elements to window
    // have to do this because we want body and settings iframe to have independent scroll
    let body = document.getElementById("body");
    function resize() {
        let h = window.innerHeight - 5;
        body.style.setProperty("max-height", `${h}px`)
        iframe.style.setProperty("max-height", `${h}px`)
    }
    resize();
    window.onresize = (event) => resize();

    subscribeToExtensionSimple("help");

    // highlight current target
    focusHashNode();
});
