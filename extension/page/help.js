/*
 * Copyright (c) 2023 Jan Malakhovski <oxij@oxij.org>
 *
 * This file can be distributed under the terms of the GNU GPL, version 3 or later.
 */

"use strict";

document.addEventListener("DOMContentLoaded", () => {
    // highlight current target
    var hash = window.location.hash.substr(1);
    if (hash !== "")
        highlightNode(hash);

    let popupURL = browser.runtime.getURL("/page/popup.html");

    // show settings as iframe
    let iframe = document.createElement("iframe");
    iframe.src = popupURL + "#all";
    document.body.appendChild(iframe);

    // a flag making the highlight stick around
    let sticky = false;

    // broadcast highlight messages on mouseovers over links to popup.html
    for (let el of document.getElementsByTagName("a")) {
        if (!el.href.startsWith(popupURL + "#")) continue;
        let target = el.href.substr(popupURL.length + 1);
        el.href = "#";
        el.onclick = (event) => {
            sticky = !sticky;
        };
        el.onmouseover = (event) => {
            browser.runtime.sendMessage(["broadcast", ["highlight", target]]);
        };
        el.onmouseleave = (event) => {
            if (!sticky)
                browser.runtime.sendMessage(["broadcast", ["highlight", "all"]]);
        };
    }

    // resize elements to window
    // have to do this because we want main and settings iframe to have independent scroll
    let main = document.getElementById("main");
    function resize() {
        let h = window.innerHeight - 5;
        main.style.setProperty("max-height", `${h}px`)
        iframe.style.setProperty("max-height", `${h}px`)
    }
    resize();
    window.onresize = (event) => resize();
});
