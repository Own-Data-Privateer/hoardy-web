/*
 * Copyright (c) 2023-2024 Jan Malakhovski <oxij@oxij.org>
 *
 * This file can be distributed under the terms of the GNU GPL, version 3 or later.
 */

"use strict";

function showAll() {
    document.getElementById("show").style.display = "none";
    for (let node of document.getElementsByName("more"))
        node.style.removeProperty("display");
}

function hideAll() {
    document.getElementById("show").style.removeProperty("display");
    for (let node of document.getElementsByName("more"))
        node.style.display = "none";
}

function asPowers(obj) {
    for (let [k, v] of Object.entries(obj)) {
        let typ = typeof v;
        if (typ === "number") {
            if (k.endsWith("_size"))
                obj[k] = byteLengthToString(v);
            else
                obj[k] = countToString(v);
        }
    }
    return obj;
}

async function popupMain() {
    let tab = await getActiveTab();
    let windowId = tab.windowId;
    let tabId = getStateTabIdOrTabId(tab);

    // start recording tabId changes
    async function recordTabId(event) {
        if (event.windowId !== windowId)
            return;

        let tab = await browser.tabs.get(event.tabId);
        tabId = getStateTabIdOrTabId(tab);
    }
    let recordTabIdFunc = catchAll(recordTabId);
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
    versionButton.onclick = catchAll(() => resetAndOpen({ seenChangelog: true }, showChangelog));

    let helpButton = document.getElementById("help");
    helpButton.onclick = catchAll(() => resetAndOpen({ seenHelp: true }, showHelp));

    buttonToAction("showState", catchAll(() => showState("", "top", tabId)));
    buttonToAction("showTabState", catchAll(() => showState(`?tab=${tabId}`, "top", tabId)));

    buttonToMessage("forgetHistory");
    buttonToAction("unmarkAllProblematic", catchAll(() => browser.runtime.sendMessage(["unmarkProblematic", null])));
    buttonToMessage("retryAllFailedArchives");
    buttonToAction("collectAllInLimbo", catchAll(() => browser.runtime.sendMessage(["popInLimbo", true, null])));
    buttonToAction("discardAllInLimbo", catchAll(() => browser.runtime.sendMessage(["popInLimbo", false, null])));
    buttonToMessage("stopAllInFlight");

    buttonToAction("forgetTabHistory",     catchAll(() => browser.runtime.sendMessage(["forgetHistory", tabId])));
    buttonToAction("unmarkTabProblematic", catchAll(() => browser.runtime.sendMessage(["unmarkProblematic", null, tabId])));
    buttonToAction("collectTabInLimbo", catchAll(() => browser.runtime.sendMessage(["popInLimbo", true, null, tabId])));
    buttonToAction("discardTabInLimbo", catchAll(() => browser.runtime.sendMessage(["popInLimbo", false, null, tabId])));
    buttonToAction("stopTabInFlight", catchAll(() => browser.runtime.sendMessage(["stopAllInFlight", tabId])));

    buttonToMessage("resetPersistentStats");

    buttonToAction("show", catchAll(showAll));

    async function updateStats(stats) {
        if (stats === undefined)
            stats = await browser.runtime.sendMessage(["getStats"]);
        setUI(document, "stats", asPowers(stats));
    }

    async function updateTabStats(tabstats) {
        if (tabstats === undefined)
            tabstats = await browser.runtime.sendMessage(["getTabStats", tabId]);
        setUI(document, "tabstats", asPowers(tabstats));
    }

    async function updateConfig() {
        let config = await browser.runtime.sendMessage(["getConfig"]);
        setUI(document, "config", config, (newconfig, path) => {
            switch (path) {
            case "config.autoPopInLimboCollect":
                newconfig.autoPopInLimboDiscard = newconfig.autoPopInLimboDiscard && !newconfig.autoPopInLimboCollect;
                break;
            case "config.autoPopInLimboDiscard":
                newconfig.autoPopInLimboCollect = newconfig.autoPopInLimboCollect && !newconfig.autoPopInLimboDiscard;
                break;
            }
            browser.runtime.sendMessage(["setConfig", newconfig]).catch(logError);
        });

        setConditionalClass(body, !config.archiving, "disabled-archiving");
        setConditionalClass(body, !config.collecting, "disabled-collecting");
        setConditionalClass(body, !config.autoUnmarkProblematic
                            && !config.autoPopInLimboCollect
                            && !config.autoPopInLimboDiscard, "disabled-auto");
        setConditionalClass(body, !config.problematicNotify, "disabled-problematic-notify");
        setConditionalClass(body, !config.limboNotify, "disabled-limbo-notify");
        setConditionalClass(versionButton, !config.seenChangelog, "attention");
        setConditionalClass(helpButton, !config.seenHelp, "attention");
    }

    async function updateTabConfig(tabconfig) {
        if (tabconfig === undefined)
            tabconfig = await browser.runtime.sendMessage(["getOriginConfig", tabId]);
        setUI(document, "tabconfig", tabconfig, (newtabconfig, path) => {
            switch (path) {
            case "tabconfig.collecting":
                newtabconfig.children.collecting = newtabconfig.collecting;
                break;
            case "tabconfig.limbo":
                newtabconfig.children.limbo = newtabconfig.limbo;
                break;
            case "tabconfig.negLimbo":
                newtabconfig.children.negLimbo = newtabconfig.negLimbo;
                break;
            }
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
    browser.tabs.onActivated.addListener(catchAll(recordUpdateTabId));

    // set default UI state
    let hash = document.location.hash.substr(1);
    if (hash)
        showAll();
    else
        hideAll();

    async function processUpdate(update) {
        let [what, data] = update;
        switch (what) {
        case "updateStats":
            await updateStats(data);
            await updateTabStats();
            break;
        case "updateConfig":
            await updateConfig();
            break;
        case "updateTabConfig":
            if (data == tabId)
                await updateTabConfig(update[2]);
            break;
        default:
            await handleDefaultMessages(update, "popup");
        }
    }

    await subscribeToExtension(catchAll(processUpdate), catchAll(async () => {
        await updateStats();
        await updateTabStats();
        await updateConfig();
        await updateTabConfig();
    }));

    // show UI
    setPageLoaded();

    // highlight current target
    // NB: not using showAll and hideAll here, so that unhighlight will not shrink the UI
    focusHashNode();
}

document.addEventListener("DOMContentLoaded", () => popupMain().catch(setPageError), setPageError);
