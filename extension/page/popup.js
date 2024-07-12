/*
 * The settings popup page.
 *
 * Copyright (c) 2023-2024 Jan Malakhovski <oxij@oxij.org>
 *
 * This file is a part of pwebarc project.
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

function showAll() {
    document.getElementById("showAll").style.display = "none";
    for (let node of document.getElementsByName("more"))
        node.style.removeProperty("display");

    for (let node of document.getElementsByTagName("input")) {
        let ti = node.getAttribute("tabindex");
        if (ti !== null && ti != -1)
            node.removeAttribute("tabindex");
    }
}

function hideAll() {
    document.getElementById("showAll").style.removeProperty("display");
    for (let node of document.getElementsByName("more"))
        node.style.display = "none";
}

function present(obj) {
    for (let [k, v] of Object.entries(obj)) {
        let typ = typeof v;
        if (v instanceof Array)
            obj[k] = v.join(", ");
        else if (typ === "number") {
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

    let shortcuts = await getShortcuts();
    addHelp(body, shortcuts
            , (help, shortcut) => shortcut ? `(\`${shortcut}\`) ${help}` : `(unbound) ${help}`);

    // emoji labels for the UI buttons
    let emojiButtons = {
        snapshotAll: "📸",
        forgetHistory: "🧹",
        showState: "📜",
        runAllActions: "🟢",
        cancelCleanupActions: "🟥",
        retryFailed: "♻",
        collectAllInLimbo: "✔",
        discardAllInLimbo: "✖",
        unmarkAllProblematic: "🧹",
        stopAllInFlight: "⏹",
        snapshotTab: "📸",
        forgetTabHistory: "🧹",
        showTabState: "📜",
        collectAllTabInLimbo: "✔",
        discardAllTabInLimbo: "✖",
        unmarkAllTabProblematic: "🧹",
        stopAllTabInFlight: "⏹",
    };

    // populate with the original values from the ./popup.html
    let emojiButtonsOriginals = {};
    for (let k of Object.keys(emojiButtons)) {
        let node = document.getElementById(k);
        emojiButtonsOriginals[k] = node.value;
    }

    // sync config state and UI state
    let pureTextState = true;
    function resetPureText(config) {
        if (pureTextState == config.pureText)
            return;

        if (config.pureText)
            setUI(document, undefined, emojiButtonsOriginals);
        else
            setUI(document, undefined, emojiButtons);

        pureTextState = config.pureText;
    }

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
    buttonToMessage("forgetHistory",           () => ["forgetHistory", null]);
    buttonToMessage("snapshotAll",             () => ["snapshotTab", null]);
    buttonToMessage("collectAllInLimbo",       () => ["popInLimbo", true, null, null]);
    buttonToMessage("discardAllInLimbo",       () => ["popInLimbo", false, null, null]);
    buttonToMessage("unmarkAllProblematic",    () => ["unmarkProblematic", null, null]);
    buttonToMessage("stopAllInFlight",         () => ["stopAllInFlight", null]);

    buttonToAction("showTabState", catchAll(() => showState(`?tab=${tabId}`, "top", tabId)));
    buttonToMessage("forgetTabHistory",        () => ["forgetHistory", tabId]);
    buttonToMessage("snapshotTab",             () => ["snapshotTab", tabId]);
    buttonToMessage("collectAllTabInLimbo",    () => ["popInLimbo", true, null, tabId]);
    buttonToMessage("discardAllTabInLimbo",    () => ["popInLimbo", false, null, tabId]);
    buttonToMessage("unmarkAllTabProblematic", () => ["unmarkProblematic", null, tabId]);
    buttonToMessage("stopAllTabInFlight",      () => ["stopAllInFlight", tabId]);

    buttonToMessage("runAllActions");
    buttonToMessage("cancelCleanupActions");
    buttonToMessage("forgetErrored");
    buttonToMessage("retryFailed");

    buttonToAction("resetPersistentStats", catchAll(() => {
        if (!window.confirm("Really?"))
            return;

        browser.runtime.sendMessage(["resetPersistentStats"]).catch(logError);
    }));
    buttonToAction("resetConfig", catchAll(() => {
        if (!window.confirm("Really?"))
            return;

        browser.runtime.sendMessage(["resetConfig"]).catch(logError);
    }));

    buttonToAction("showAll", catchAll(showAll));

    async function updateStats(stats) {
        if (stats === undefined)
            stats = await browser.runtime.sendMessage(["getStats"]);
        setUI(document, "stats", present(stats));
    }

    async function updateTabStats(tabstats) {
        if (tabstats === undefined)
            tabstats = await browser.runtime.sendMessage(["getTabStats", tabId]);
        setUI(document, "tabstats", present(tabstats));
    }

    async function updateConfig(config) {
        if (config === undefined)
            config = await browser.runtime.sendMessage(["getConfig"]);

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

        setConditionalClass(body, config.colorblind, "colorblind");
        setConditionalClass(body, config.pureText, "pure-text");
        resetPureText(config);
        setConditionalClass(body, !config.archive, "disabled-archive");
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
            browser.runtime.sendMessage(["setOriginConfig", tabId, false, newtabconfig]).catch(logError);
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
            await updateConfig(data);
            break;
        case "updateOriginConfig":
            if (data == tabId)
                await updateTabConfig(update[2]);
            break;
        default:
            await handleDefaultUpdate(update, "popup");
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
