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
    let hash = document.location.hash.substr(1);
    let tabId;
    let windowId;

    let tabbing = false;
    if (hash !== "options") {
        let tab = await getActiveTab();
        windowId = tab.windowId;
        tabId = getStateTabIdOrTabId(tab);
        tabbing = true;
    } else {
        document.getElementById("this-tab-options").style.display = "none";
        document.getElementById("this-tab-children-options").style.display = "none";
    }

    // start recording tabId changes
    async function recordTabId(event) {
        if (event.windowId !== windowId)
            return;

        let tab = await browser.tabs.get(event.tabId);
        tabId = getStateTabIdOrTabId(tab);
    }
    let recordTabIdFunc = catchAll(recordTabId);

    if (tabbing)
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
        runActions: "🟢",
        cancelActions: "🟥",
        exportAsAll: "💾",
        retryFailed: "♻",
        stashAll: "💾",
        retryUnstashed: "♻",
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
        stopTabInFlight: "⏹",
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

    async function replaceWith(open, prefix, id) {
        await open(prefix, id, tabId);
        if (isMobile) {
            let config = await browser.runtime.sendMessage(["getConfig"]);
            if (config.invisibleUINotify)
                // Firefox on Android does not switch to new tabs opened from the settings
                browser.notifications.create("pageSpawnedAway", {
                    title: "pWebArc: REMINDER",
                    message: "The newly spawned page might be hidden. See the list of open tabs." + annoyingNotification(config, "Generate desktop notifications about > ... actions invisible in the UI"),
                    iconUrl: iconURL("main", 128),
                    type: "basic",
                }).catch(logError);
        } else
            window.close();
    }

    async function resetAndReplace(reset, open) {
        // reset given config setting
        await browser.runtime.sendMessage(["setConfig", reset]);
        // and then replace this page with
        await replaceWith(open, "", "");
    }

    let versionButton = document.getElementById("version");
    versionButton.value = "v" + manifest.version;
    versionButton.onclick = catchAll(() => resetAndReplace({ seenChangelog: true }, showChangelog));

    let helpButton = document.getElementById("help");
    helpButton.onclick = catchAll(() => resetAndReplace({ seenHelp: true }, showHelp));

    buttonToAction("showState", catchAll(() => replaceWith(showState, "", "top")));
    buttonToMessage("forgetHistory",           () => ["forgetHistory", null]);
    buttonToMessage("snapshotAll",             () => ["snapshot", null]);
    buttonToMessage("exportAsAll",             () => ["exportAs", null]);
    buttonToMessage("collectAllInLimbo",       () => ["popInLimbo", true, null, null]);
    buttonToMessage("discardAllInLimbo",       () => ["popInLimbo", false, null, null]);
    buttonToMessage("unmarkAllProblematic",    () => ["unmarkProblematic", null, null]);
    buttonToMessage("stopAllInFlight",         () => ["stopInFlight", null]);

    buttonToAction("showTabState", catchAll(() => replaceWith(showState, `?tab=${tabId}`, "top")));
    buttonToMessage("forgetTabHistory",        () => ["forgetHistory", tabId]);
    buttonToMessage("snapshotTab",             () => ["snapshot", tabId]);
    buttonToMessage("collectAllTabInLimbo",    () => ["popInLimbo", true, null, tabId]);
    buttonToMessage("discardAllTabInLimbo",    () => ["popInLimbo", false, null, tabId]);
    buttonToMessage("unmarkAllTabProblematic", () => ["unmarkProblematic", null, tabId]);
    buttonToMessage("stopTabInFlight",         () => ["stopInFlight", tabId]);

    buttonToMessage("runActions");
    buttonToMessage("cancelActions");
    buttonToMessage("forgetErrored");
    buttonToMessage("retryFailed");
    buttonToMessage("stashAll");
    buttonToMessage("retryUnstashed");
    buttonToAction("showSaved",    catchAll(() => replaceWith(showSaved, "", "top")));

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

    async function updateConfig(config) {
        if (config === undefined)
            config = await browser.runtime.sendMessage(["getConfig"]);

        setUI(document, "config", config, (newconfig, path) => {
            browser.runtime.sendMessage(["setConfig", newconfig]).catch(logError);
        });

        setConditionalClass(body, config.colorblind, "colorblind");
        setConditionalClass(body, config.pureText, "pure-text");
        resetPureText(config);
        setConditionalClass(body, !config.collecting, "disabled-collecting");
        setConditionalClass(body, !config.stash, "disabled-stash");
        setConditionalClass(body, !config.archive, "disabled-archive");
        setConditionalClass(body, !config.archiveExportAs, "disabled-exportas");
        setConditionalClass(body, !config.archiveSubmitHTTP, "disabled-submit");
        setConditionalClass(body, !config.stash && !config.archiveSaveLS, "disabled-localstorage");
        setConditionalClass(body, !config.autoUnmarkProblematic
                            && !config.autoPopInLimboCollect
                            && !config.autoPopInLimboDiscard, "disabled-auto");
        setConditionalClass(body, !config.problematicNotify, "disabled-problematic-notify");
        setConditionalClass(body, !config.limboNotify, "disabled-limbo-notify");
        setConditionalClass(versionButton, !config.seenChangelog, "attention");
        setConditionalClass(helpButton, !config.seenHelp, "attention");
    }

    async function updateTabStats(tabstats) {
        if (tabstats === undefined)
            tabstats = await browser.runtime.sendMessage(["getTabStats", tabId]);
        setUI(document, "tabstats", present(tabstats));
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

    if (tabbing) {
        browser.tabs.onActivated.removeListener(recordTabIdFunc);
        browser.tabs.onActivated.addListener(catchAll(recordUpdateTabId));
    }

    // set default UI state
    if (hash)
        showAll();
    else
        hideAll();

    async function processUpdate(update) {
        let [what, data] = update;
        switch (what) {
        case "updateStats":
            await updateStats(data);
            if (tabbing)
                await updateTabStats();
            break;
        case "updateConfig":
            await updateConfig(data);
            break;
        case "updateOriginConfig":
            if (tabbing && data == tabId)
                await updateTabConfig(update[2]);
            break;
        default:
            await handleDefaultUpdate(update, "popup");
        }
    }

    await subscribeToExtension(catchAll(processUpdate), catchAll(async () => {
        await updateStats();
        await updateConfig();
        if (tabbing) {
            await updateTabStats();
            await updateTabConfig();
        }
    }));

    // show UI
    setPageLoaded();

    // highlight current target
    // NB: not using showAll and hideAll here, so that unhighlight will not shrink the UI
    focusHashNode();
}

document.addEventListener("DOMContentLoaded", () => popupMain().catch(setPageError), setPageError);
