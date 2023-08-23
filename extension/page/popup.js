/*
 * Copyright (c) 2023 Jan Malakhovski <oxij@oxij.org>
 *
 * This file can be distributed under the terms of the GNU GPL, version 3 or later.
 */

"use strict";

let highlightedNode = null;
function highlight(target) {
    document.getElementById("show").style.display = "none";
    document.getElementById("more").style.display = "block";

    if (highlightedNode !== null) {
        highlightedNode.classList.remove("target");
    }

    let el = document.getElementById(target);
    if (el !== null) {
        el.classList.add("target");
        el.scrollIntoView();
        highlightedNode = el;
    }
}

document.addEventListener("DOMContentLoaded", () => {
    browser.runtime.sendMessage(["getConfig"]).then((config) => {
        let updateClasses;
        makeUI("config", config, (newconfig) => {
            updateClasses(newconfig);
            browser.runtime.sendMessage(["setConfig", newconfig]);
        });

        // when #hash is specified (used in the ./help.org), we don't
        // want anything hidden and we want to point user to the
        // appropriate node
        var hash = window.location.hash.substr(1);
        if (hash !== "")
            highlight(hash);

        // make id=depends's classes depend on config
        let dependNodes = document.getElementsByName("depends");
        updateClasses = (config) => {
            for (let depends of dependNodes) {
                depends.classList.remove("disabled-archiving", "disabled-collecting")
                if (!config.archiving)
                    depends.classList.add("disabled-archiving");
                if (!config.collecting)
                    depends.classList.add("disabled-collecting");
            }
        }
        updateClasses(config);

        buttonToAction("log", () => window.open(browser.runtime.getURL("/page/log.html"), "_blank"));
        buttonToAction("help", () => {
            window.open(browser.runtime.getURL("/page/help.html"), "_blank");
            window.close();
        });
        buttonToMessage("retryAllFailedArchives");
        buttonToMessage("forceFinishRequests");
        buttonToAction("show", () => {
            document.getElementById("show").style.display = "none";
            document.getElementById("more").style.display = "block";
        });

        // open connection to the background script
        let port = browser.runtime.connect();
        // and listen for updates
        port.onMessage.addListener((update) => {
            let [what, data] = update;
            if (what == "stats")
                setUI("stats", data);
            else if (what == "highlight")
                highlight(data);
        });

        // get current windowId and tabId of the active tab
        browser.tabs.query({ currentWindow: true }).then((tabs) => {
            let windowId;
            let tabId;

            for (let tab of tabs) {
                if (tab.active) {
                    windowId = tab.windowId;
                    tabId = tab.id;
                    break;
                }
            }

            if (tabId === undefined || windowId === undefined)
                throw new Error("failed to get tabId or windowId");

            // start recording tabId changes
            function recordTabId(event) {
                if (event.windowId == windowId)
                    tabId = event.tabId;
            }
            browser.tabs.onActivated.addListener(recordTabId);

            // this does what recordTabId does, but also updates tabconfig UI
            function updateTabUI(event) {
                if (event !== undefined && event.windowId == windowId)
                    tabId = event.tabId;

                browser.runtime.sendMessage(["getTabConfig", tabId]).then((tabconfig) => {
                    setUI("tabconfig", tabconfig);
                });
            }

            // remember current value
            let oldTabId = tabId;

            // ask for current tab's config
            browser.runtime.sendMessage(["getTabConfig", tabId]).then((tabconfig) => {
                // generate UI from it
                makeUI("tabconfig", tabconfig, (newtabconfig) => {
                    browser.runtime.sendMessage(["setTabConfig", tabId, newtabconfig]);
                });

                // replace recordTabId with updateTabUI
                browser.tabs.onActivated.removeListener(recordTabId);
                browser.tabs.onActivated.addListener(updateTabUI);

                if (tabId != oldTabId) {
                    // if tabId changed while we were doing getTabConfig, update UI again
                    updateTabUI();
                }

                // show UI
                document.body.style.display = "block";
            });
        });
    }, (error) => {
        let body = document.createElement("body");
        body.innerHTML = "<p>Extension failed to initialize. Go to <pre>about:debugging#/runtime/this-firefox</pre> click inspect on \"pWebArc\", select \"Console\" and see the log there for more details.</p>"
        document.body = body;
    });
});
