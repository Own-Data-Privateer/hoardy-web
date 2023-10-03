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
    // get current windowId and tabId of the active tab
    let windowId;
    let tabId;

    let tabs = await browser.tabs.query({ active: true, currentWindow: true });
    for (let tab of tabs) {
        windowId = tab.windowId;
        tabId = tab.id;
    }

    if (tabId === undefined || windowId === undefined)
        throw new Error("failed to get tabId or windowId");

    // start recording tabId changes
    let recordTabId = catchAll((event) => {
        if (event.windowId == windowId)
            tabId = event.tabId;
    });
    browser.tabs.onActivated.addListener(recordTabId);

    // get config and generate UI from it
    let config = await browser.runtime.sendMessage(["getConfig"]);
    makeUI("config", config, (newconfig) => {
        browser.runtime.sendMessage(["setConfig", newconfig]).catch(logError);
    });

    buttonToAction("log", () => window.open(browser.runtime.getURL("/page/log.html"), "_blank"));
    buttonToMessage("clearStats");
    buttonToAction("help", () => {
        window.open(browser.runtime.getURL("/page/help.html"), "_blank");
        window.close();
    });
    buttonToMessage("retryAllFailedArchives");
    buttonToMessage("forceFinishRequests");
    buttonToAction("show", () => showAll());

    // get tabconfig and generate UI from it
    let tabconfig = await browser.runtime.sendMessage(["getTabConfig", tabId]);
    makeUI("tabconfig", tabconfig, (newtabconfig, path) => {
        if (path == "tabconfig.collecting")
            newtabconfig.children.collecting = newtabconfig.collecting;
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

    async function updateStats(stats) {
        if (stats === undefined)
            stats = await browser.runtime.sendMessage(["getStats"]);
        setUI("stats", stats);
    }

    let dependNodes = document.getElementsByName("depends");
    async function updateConfig() {
        let config_ = await browser.runtime.sendMessage(["getConfig"]);
        assignRec(config, config_);
        setUI("config", config);

        for (let depends of dependNodes) {
            depends.classList.remove("disabled-archiving", "disabled-collecting")
            if (!config.archiving)
                depends.classList.add("disabled-archiving");
            if (!config.collecting)
                depends.classList.add("disabled-collecting");
        }
    }

    async function updateTabConfig() {
        let tabconfig_ = await browser.runtime.sendMessage(["getTabConfig", tabId]);
        assignRec(tabconfig, tabconfig_);
        setUI("tabconfig", tabconfig);
    }

    // replace recordTabId with this
    let recordUpdateTabId = catchAllAsync (async (event) => {
        recordTabId(event);
        await updateTabConfig();
    });
    browser.tabs.onActivated.removeListener(recordTabId);
    browser.tabs.onActivated.addListener(recordUpdateTabId);

    // open connection to the background script and listen for updates
    let port = browser.runtime.connect();
    port.onMessage.addListener(catchAllAsync (async (update) => {
        let [what, data] = update;
        if (what == "updateStats")
            await updateStats(data);
        else if (what == "updateConfig")
            await updateConfig();
        else if (what == "updateTabConfig" && data == tabId)
            await updateTabConfig();
        else if (what == "highlight") {
            showAll();
            highlightNode(data);
        }
    }));

    await updateStats();
    await updateConfig();
    await updateTabConfig();

    // show UI
    document.body.style.display = "block";
}), (error) => {
    let body = document.createElement("body");
    body.innerHTML = "<p>Extension failed to initialize. Go to (on Firefox-based browser) <pre>about:debugging#/runtime/this-firefox</pre> or (on Chromium-based browser) <pre>chrome://extensions/</pre> click inspect \"pWebArc\", select \"Console\" and see the log there for more details.</p>"
    document.body = body;
});
