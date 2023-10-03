/*
 * Copyright (c) 2023 Jan Malakhovski <oxij@oxij.org>
 *
 * This file can be distributed under the terms of the GNU GPL, version 3 or later.
 */

"use strict";

function showAll() {
    document.getElementById("show").style.display = "none";
    for (let node of document.getElementsByName("more")) {
        node.style.display = "block";
    }
}

document.addEventListener("DOMContentLoaded", catchAllAsync(async () => {
    let config = await browser.runtime.sendMessage(["getConfig"]);

    let updateClasses;
    makeUI("config", config, (newconfig) => {
        updateClasses(newconfig);
        browser.runtime.sendMessage(["setConfig", newconfig]).catch(logError);
    });

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
    buttonToMessage("clearStats");
    buttonToAction("help", () => {
        window.open(browser.runtime.getURL("/page/help.html"), "_blank");
        window.close();
    });
    buttonToMessage("retryAllFailedArchives");
    buttonToMessage("forceFinishRequests");
    buttonToAction("show", () => showAll());

    // open connection to the background script
    let port = browser.runtime.connect();
    // and listen for updates
    port.onMessage.addListener((update) => {
        let [what, data] = update;
        if (what == "stats")
            setUI("stats", data);
        else if (what == "highlight") {
            showAll();
            highlightNode(data);
        }
    });

    // get current windowId and tabId of the active tab
    let tabs = await browser.tabs.query({ currentWindow: true });
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
        }, logError);
    }

    // remember current value
    let oldTabId = tabId;

    // ask for current tab's config
    let tabconfig = await browser.runtime.sendMessage(["getTabConfig", tabId]);

    // generate UI from it
    makeUI("tabconfig", tabconfig, (newtabconfig, path) => {
        if (path == "tabconfig.collecting") {
            newtabconfig.children.collecting = newtabconfig.collecting;
            setUI("tabconfig", newtabconfig);
        }
        browser.runtime.sendMessage(["setTabConfig", tabId, newtabconfig]);
    });

    // add help tooltips
    addHelp(document.body, true);

    // when #hash is specified (used in the ./help.org), we don't
    // want anything hidden and we want to point user to the
    // appropriate node
    var hash = window.location.hash.substr(1);
    if (hash !== "") {
        showAll();
        highlightNode(hash);
    } else {
        // otherwise hide things under elements named "more" until showAll()
        for (let node of document.getElementsByName("more")) {
            node.style.display = "none";
        }
    }

    // replace recordTabId with updateTabUI
    browser.tabs.onActivated.removeListener(recordTabId);
    browser.tabs.onActivated.addListener(updateTabUI);

    if (tabId != oldTabId) {
        // if tabId changed while we were doing getTabConfig, update UI again
        updateTabUI();
    }

    // show UI
    document.body.style.display = "block";
}), (error) => {
    let body = document.createElement("body");
    body.innerHTML = "<p>Extension failed to initialize. Go to (on Firefox-based browser) <pre>about:debugging#/runtime/this-firefox</pre> or (on Chromium-based browser) <pre>chrome://extensions/</pre> click inspect \"pWebArc\", select \"Console\" and see the log there for more details.</p>"
    document.body = body;
});
