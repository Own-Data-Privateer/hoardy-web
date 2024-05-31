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

async function popupMain() {
    // get current windowId and tabId of the active tab
    let windowId;
    let tabId;

    let tabs = await browser.tabs.query({ active: true, currentWindow: true });
    for (let tab of tabs) {
        windowId = tab.windowId;
        tabId = getStateTabIdOrTabId(tab);
        break;
    }

    if (tabId === undefined || windowId === undefined)
        throw new Error("failed to get tabId or windowId");

    // start recording tabId changes
    async function recordTabId(event) {
        if (event.windowId !== windowId)
            return;

        let tab = await browser.tabs.get(event.tabId);
        tabId = getStateTabIdOrTabId(tab);
    }
    let recordTabIdFunc = catchAllAsync(recordTabId);
    browser.tabs.onActivated.addListener(recordTabIdFunc);

    // generate UI
    let body = document.getElementById("body");
    makeUI(body);
    addHelp(body, true);

    async function resetAndOpen(reset, open) {
        // reset given config setting
        await browser.runtime.sendMessage(["setConfig", reset]);
        // and then open this
        await open("", "", tabId);
        window.close();
    }

    let versionButton = document.getElementById("version");
    versionButton.value = "v" + manifest.version;
    versionButton.onclick = catchAllAsync(() => resetAndOpen({ seenChangelog: true }, showChangelog));

    let helpButton = document.getElementById("help");
    helpButton.onclick = catchAllAsync(() => resetAndOpen({ seenHelp: true }, showHelp));

    buttonToAction("showState", catchAllAsync(() => showState("", "", tabId)));
    buttonToAction("showTabState", catchAllAsync(() => showState(`?tab=${tabId}`, "", tabId)));

    buttonToMessage("forgetHistory");
    buttonToMessage("unmarkProblematic");
    buttonToMessage("retryAllFailedArchives");
    buttonToAction("collectAllInLimbo", catchAllAsync(() => browser.runtime.sendMessage(["popInLimbo", true, null])));
    buttonToAction("discardAllInLimbo", catchAllAsync(() => browser.runtime.sendMessage(["popInLimbo", false, null])));
    buttonToMessage("stopAllInFlight");

    buttonToAction("forgetTabHistory",     catchAllAsync(() => browser.runtime.sendMessage(["forgetHistory", tabId])));
    buttonToAction("unmarkTabProblematic", catchAllAsync(() => browser.runtime.sendMessage(["unmarkProblematic", tabId])));
    buttonToAction("collectTabInLimbo", catchAllAsync(() => browser.runtime.sendMessage(["popInLimbo", true, null, tabId])));
    buttonToAction("discardTabInLimbo", catchAllAsync(() => browser.runtime.sendMessage(["popInLimbo", false, null, tabId])));
    buttonToAction("stopTabInFlight", catchAllAsync(() => browser.runtime.sendMessage(["stopAllInFlight", tabId])));
    buttonToAction("show", catchAll(showAll));

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

    async function updateConfig() {
        let config = await browser.runtime.sendMessage(["getConfig"]);
        setUI("config", config, (newconfig, path) => {
            browser.runtime.sendMessage(["setConfig", newconfig]).catch(logError);
        });

        setConditionalClass(body, !config.archiving, "disabled-archiving");
        setConditionalClass(body, !config.collecting, "disabled-collecting");
        setConditionalClass(versionButton, !config.seenChangelog, "attention");
        setConditionalClass(helpButton, !config.seenHelp, "attention");
    }

    async function updateTabConfig(tabconfig) {
        if (tabconfig === undefined)
            tabconfig = await browser.runtime.sendMessage(["getOriginConfig", tabId]);
        setUI("tabconfig", tabconfig, (newtabconfig, path) => {
            if (path == "tabconfig.collecting")
                newtabconfig.children.collecting = newtabconfig.collecting;
            if (path == "tabconfig.limbo")
                newtabconfig.children.limbo = newtabconfig.limbo;
            if (path == "tabconfig.negLimbo")
                newtabconfig.children.negLimbo = newtabconfig.negLimbo;
            browser.runtime.sendMessage(["setTabConfig", tabId, newtabconfig]);
        });
    }

    // replace recordTabId with this
    async function recordUpdateTabId (event) {
        await recordTabId(event);
        await updateTabStats();
        await updateTabConfig();
    }
    browser.tabs.onActivated.removeListener(recordTabIdFunc);
    browser.tabs.onActivated.addListener(catchAllAsync(recordUpdateTabId));

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
    setPageLoaded();
}

document.addEventListener("DOMContentLoaded", () => popupMain().catch(setPageError), setPageError);
