/*
 * Copyright (c) 2023-2024 Jan Malakhovski <oxij@oxij.org>
 *
 * This file can be distributed under the terms of the GNU GPL, version 3 or later.
 */

"use strict";

function showAll() {
    document.getElementById("show").style.display = "none";
    for (let node of document.getElementsByName("more")) {
        node.style.removeProperty("display");
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

    // generate UI
    makeUI(document.body);
    addHelp(document.body, true);

    buttonToAction("help", () => {
        window.open(browser.runtime.getURL("/page/help.html"), "_blank");
        window.close();
    });
    buttonToMessage("forgetHistory");
    buttonToMessage("forgetProblematic");
    buttonToAction("state", () => window.open(browser.runtime.getURL("/page/state.html"), "_blank"));
    buttonToMessage("retryAllFailedArchives");
    buttonToAction("takeAllInLimbo",    () => browser.runtime.sendMessage(["popInLimbo", true, null]));
    buttonToAction("discardAllInLimbo", () => browser.runtime.sendMessage(["popInLimbo", false, null]));
    buttonToMessage("stopAllInFlight");

    buttonToAction("forgetTabHistory",   () => browser.runtime.sendMessage(["forgetHistory", tabId]));
    buttonToAction("forgetTabProblematic", () => browser.runtime.sendMessage(["forgetProblematic", tabId]));
    buttonToAction("tabState", () => window.open(browser.runtime.getURL(`/page/state.html?tab=${tabId}`), "_blank"));
    buttonToAction("takeTabInLimbo",    () => browser.runtime.sendMessage(["popInLimbo", true, null, tabId]));
    buttonToAction("discardTabInLimbo", () => browser.runtime.sendMessage(["popInLimbo", false, null, tabId]));
    buttonToAction("stopTabInFlight", () => browser.runtime.sendMessage(["stopAllInFlight", tabId]));
    buttonToAction("show", () => showAll());

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

    async function updateTabStats(tabstats) {
        if (tabstats === undefined)
            tabstats = await browser.runtime.sendMessage(["getTabStats", tabId]);
        setUI("tabstats", tabstats);
    }

    let dependNodes = document.getElementsByName("depends");
    async function updateConfig() {
        let config = await browser.runtime.sendMessage(["getConfig"]);
        setUI("config", config, (newconfig, path) => {
            browser.runtime.sendMessage(["setConfig", newconfig]).catch(logError);
        });

        for (let depends of dependNodes) {
            depends.classList.remove("disabled-archiving", "disabled-collecting")
            if (!config.archiving)
                depends.classList.add("disabled-archiving");
            if (!config.collecting)
                depends.classList.add("disabled-collecting");
        }
    }

    async function updateTabConfig(tabconfig) {
        if (tabconfig === undefined)
            tabconfig = await browser.runtime.sendMessage(["getTabConfig", tabId]);
        setUI("tabconfig", tabconfig, (newtabconfig, path) => {
            if (path == "tabconfig.collecting")
                newtabconfig.children.collecting = newtabconfig.collecting;
            if (path == "tabconfig.limbo")
                newtabconfig.children.limbo = newtabconfig.limbo;
            browser.runtime.sendMessage(["setTabConfig", tabId, newtabconfig]);
        });
    }

    // replace recordTabId with this
    let recordUpdateTabId = catchAllAsync(async (event) => {
        recordTabId(event);
        await updateTabStats();
        await updateTabConfig();
    });
    browser.tabs.onActivated.removeListener(recordTabId);
    browser.tabs.onActivated.addListener(recordUpdateTabId);

    // open connection to the background script and listen for updates
    let port = browser.runtime.connect();
    port.onMessage.addListener(catchAllAsync(async (update) => {
        let [what, data] = update;
        if (what == "updateStats") {
            await updateStats(data);
            await updateTabStats();
        } else if (what == "updateConfig")
            await updateConfig();
        else if (what == "updateTabConfig" && data == tabId)
            await updateTabConfig(update[2]);
        else if (what == "highlight") {
            showAll();
            highlightNode(data);
        }
    }));

    await updateStats();
    await updateTabStats();
    await updateConfig();
    await updateTabConfig();

    // show UI
    document.body.style.display = "block";
}), (error) => {
    let body = document.createElement("body");
    body.innerHTML = "<p>Extension failed to initialize. Go to (on Firefox-based browser) <pre>about:debugging#/runtime/this-firefox</pre> or (on Chromium-based browser) <pre>chrome://extensions/</pre> click inspect \"pWebArc\", select \"Console\" and see the log there for more details.</p>"
    document.body = body;
});
