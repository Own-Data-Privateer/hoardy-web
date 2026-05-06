/*
 * Copyright (c) 2023-2025 Jan Malakhovski <oxij@oxij.org>
 *
 * This file is a part of `hoardy-web` project.
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

/*
 * The settings popup page.
 */

"use strict";

let dbody = document.body;

const tagNames = ["common", "main", "bg", "this", "class", "pr", "rt", "ui", "all"];

function showTab(name) {
    //implySetConditionalClass(dbody, "more", "hidden", !condition);
    //implySetConditionalClass(dbody, "less", "hidden", condition);

    for (let node of document.getElementById("tags").getElementsByClassName("active"))
        node.classList.remove("active");
    document.getElementById(`showTag-${name}`).classList.add("active");

    if (name == "all") {
        for (let tn of tagNames)
            for (let node of document.getElementsByClassName(`tag-${tn}`))
                node.classList.remove("hidden");
    } else {
        for (let tn of tagNames)
            for (let node of document.getElementsByClassName(`tag-${tn}`))
                node.classList.add("hidden");

        for (let node of document.getElementsByClassName(`tag-${name}`))
            node.classList.remove("hidden");
    }

    if (name !== "common")
        for (let node of dbody.getElementsByTagName("input")) {
            let ti = node.getAttribute("tabindex");
            if (ti !== null && ti != -1) {
                node.removeAttribute("tabindex");
                node.setAttribute("less-tabindex", ti);
            }
        }
    else
        for (let node of dbody.getElementsByTagName("input")) {
            let ti = node.getAttribute("less-tabindex");
            if (ti !== null)
                node.setAttribute("tabindex", ti);
        }
}

function present(obj) {
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
    setPageLoading();

    implySetConditionalOff(dbody, "on-firefox", useDebugger);
    implySetConditionalOff(dbody, "on-chromium", !useDebugger);
    implySetConditionalOff(dbody, "on-desktop", isMobile);
    implySetConditionalOff(dbody, "on-mobile", !isMobile);

    // should this view be narrowed?
    let narrow = true;
    // this view should be narrowed to
    let narrowSessionId = await browser.runtime.sendMessage(["getSessionId"]);
    let narrowWindowId;
    let narrowTabId;

    let hash = document.location.hash.substr(1);
    if (hash)
        document.getElementById("tags").style.display = "none";

    if (hash === "options") {
        document.getElementById("this-tab-options").style.display = "none";
        document.getElementById("this-tab-children-options").style.display = "none";
        document.body.style.border = "none";
        document.body.style.color = "inherit"; // to work-around Firefox default CSS
        narrow = false;
    } else {
        let tab = await getActiveTab();
        if (tab !== null) {
            narrowWindowId = tab.windowId;
            narrowTabId = getStateTabIdOrTabId(tab);
        } else {
            // This happens when the user opens the "Help" page from the
            // settings menu on Fenix. Disabling `narrow` will make the page
            // useless, so we fake these values instead.
            narrowWindowId = 0;
            narrowTabId = 0;
        }
    }

    // generate UI
    let body = document.getElementById("body");
    makeUI(body);

    let shortcuts = await getShortcuts();
    addHelp(body, shortcuts
            , (help, shortcut) => shortcut ? `(\`${shortcut}\`) ${help}` : `(unbound) ${help}`);

    // allow to un-highlight currently highlighted node
    dbody.addEventListener("click", (event) => {
        highlightNode(null);
    });

    // emoji labels for the UI buttons
    let emojiButtons = {
        reloadSelf: "（🌟ω🌟）",
        snapshotAll: "📸",
        replayAll: "⏏",
        forgetAllLog: "🧹",
        showState: "📜",
        runActions: "🟢",
        cancelActions: "🟥",
        exportAsAll: "💾",
        retryAllFailed: "♻",
        retryAllUnarchived: "♻",
        stashAll: "💾",
        retryAllUnstashed: "♻",
        collectAllInLimbo: "✔",
        discardAllInLimbo: "✖",
        unmarkAllProblematic: "🧹",
        stopAllInFlight: "⏹",
        snapshotTab: "📸",
        replayTabBack: "⏮",
        //replayTabForward: "⏭",
        forgetAllTabLog: "🧹",
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

    // Config-dependent UI

    let config;
    let rearchive = newRearchiveVars();

    // sync config state and UI state
    let pureTextState = true;
    function resetPureText() {
        if (pureTextState == config.pureText)
            return;

        if (config.pureText)
            setUI(document, undefined, emojiButtonsOriginals);
        else
            setUI(document, undefined, emojiButtons);

        pureTextState = config.pureText;
    }

    async function replaceWith(isHelp, open, ...args) {
        if (isMobile) {
            let spawn = config.spawnNewTabs;
            await open(...args, narrowTabId, spawn);
            if (spawn && config.invisibleUINotify)
                // Firefox on Android does not switch to new tabs opened from the settings
                browser.notifications.create("pageSpawnedAway", {
                    title: "Hoardy-Web: REMINDER",
                    message: escapeNotification(config, "The newly spawned page might be hidden. See the list of open tabs or the list open private tabs, depending on the browser's mode." + annoyingNotification(config, "Generate notifications about > ... mobile UI quirks")),
                    iconUrl: iconURL("main", 128),
                    type: "basic",
                }).catch(logError);
            else if (!spawn && isHelp && config.invisibleUINotify)
                // Firefox on Android does not switch to new tabs opened from the settings
                browser.notifications.create("pageNotSpawnedAway", {
                    title: "Hoardy-Web: REMINDER",
                    message: escapeNotification(config, `To make the search work on the "Help" page, enable "User Interface and Accessibility > Spawn internal pages in new tabs" option, open the "Help" page again, and then switch to the newly spawned tab.` + annoyingNotification(config, "Generate notifications about > ... mobile UI quirks")),
                    iconUrl: iconURL("main", 128),
                    type: "basic",
                }).catch(logError);
        } else {
            await open(...args, narrowTabId);
            window.close();
        }
    }

    async function resetAndReplace(isHelp, reset, open, ...args) {
        // reset given config setting
        await browser.runtime.sendMessage(["setConfig", reset]);
        // and then replace this page with
        await replaceWith(isHelp, open, ...args);
    }

    // Setup buttons.

    for (let tn of tagNames)
      buttonToAction(`showTag-${tn}`, () => {
          showTab(tn);
          broadcastToHelp("popupResized");
      });

    let versionButton = document.getElementById("version");
    versionButton.value = "v" + manifest.version;
    versionButton.onclick = catchAll(() => resetAndReplace(false, { seenChangelog: true }, showChangelog, ""));

    let helpButton = document.getElementById("showHelp");
    helpButton.onclick = catchAll(() => resetAndReplace(true, { seenHelp: true }, showHelp, ""));
    // NB: `spawn = true` here because otherwise on Fenix a large chunk of the
    // page will be taken by the navigation toolbar and there will be no
    // search function, which is very useful there.

    let reloadSelfButton = document.getElementById("reloadSelf");
    buttonToAction("showState",    () => replaceWith(false, showState, null, null, "top"));
    buttonToAction("showTabState", () => replaceWith(false, showState, narrowSessionId, narrowTabId, "top"));
    buttonToAction("showSaved",    () => replaceWith(false, showSaved, "top"));
    buttonToAction("resetPersistentStats", () => {
        if (!window.confirm("Really?"))
            return;

        browser.runtime.sendMessage(["resetPersistentStats"]).catch(logError);
    });
    buttonToAction("resetConfig", () => {
        if (!window.confirm("Really?"))
            return;

        browser.runtime.sendMessage(["resetConfig"]).catch(logError);
    });

    buttonToMessage("rearchiveAllSaved",     () => ["rearchiveSaved", {}, true, rearchive.andRewrite, rearchive.andDelete]);
    buttonToMessage("rearchiveAdjunctSaved", () => ["rearchiveSaved", {}, false, rearchive.andRewrite, rearchive.andDelete]);

    let shortcutButtons = [
        "reloadSelf", "cancelReloadSelf",
        "runActions", "cancelActions",
        "forgetAllLog", "forgetAllTabLog",
        "deleteAllBuggedOut",
        "retryAllFailed", "retryAllUnstashed", "retryAllUnarchived",
        "exportAsAll", "stashAll",
        "stopAllInFlight", "stopAllTabInFlight",
        "unmarkAllProblematic", "unmarkAllTabProblematic",
        "collectAllInLimbo", "collectAllTabInLimbo",
        "discardAllInLimbo", "discardAllTabInLimbo",
        "snapshotAll", "snapshotTab",
        "replayAll", "replayTabBack", // "replayTabForward"
    ];
    for (let id of shortcutButtons) {
        buttonToMessage(id, () => [id, narrowTabId]);
    }

    function updateUI() {
        setRootClasses(config);
        resetPureText();
        setConditionalClass(versionButton, "attention", !config.seenChangelog);
        setConditionalClass(helpButton, "attention", !config.seenHelp);

        implySetConditionalOff(dbody, "on-seasonal", !config.seasonal);
        implySetConditionalOff(dbody, "on-collecting", !(config.collecting && (!config.workOffline || config.collectingWorkOffline)));
        implySetConditionalOff(dbody, "on-stash", !config.stash);
        implySetConditionalOff(dbody, "on-archive", !config.archive);
        implySetConditionalClass(dbody, "on-unsafe-archive", "hidden", !(config.archive && config.archiveExportAs && !config.archiveSubmitHTTP && !config.archiveSaveLS));
        implySetConditionalOff(dbody, "on-rearchive", !(config.rearchiveExportAs || config.rearchiveSubmitHTTP || rearchive.andRewrite));
        implySetConditionalClass(dbody, "on-rearchive-carefully", "hidden", !((config.rearchiveExportAs || config.rearchiveSubmitHTTP) && rearchive.andDelete));
        implySetConditionalClass(dbody, "on-rearchive-unsafe", "hidden", !(config.rearchiveExportAs && !config.rearchiveSubmitHTTP && rearchive.andDelete));
        implySetConditionalOff(dbody, "on-exportAs", !(config.archive && config.archiveExportAs
                                                      || config.rearchiveExportAs));
        implySetConditionalOff(dbody, "on-exportAsBundle", !config.exportAsBundle);
        implySetConditionalOff(dbody, "on-useHTTP", !(config.archive && config.archiveSubmitHTTP
                                                      || config.rearchiveSubmitHTTP
                                                      || config.replaySubmitHTTP));
        implySetConditionalOff(dbody, "on-LS", !(config.stash || config.archive && config.archiveSaveLS));
        implySetConditionalOff(dbody, "on-auto", !config.autoPopInLimboCollect && !config.autoPopInLimboDiscard);
        implySetConditionalOff(dbody, "on-autoUnmarkProblematicSimilar", !config.autoUnmarkProblematicSimilar);
        implySetConditionalOff(dbody, "on-problematicNotify", config.problematicNotify === false);
        implySetConditionalOff(dbody, "on-limboNotify", !config.limboNotify);
    }

    setUIRec(document, "rearchive", rearchive, (newrearchive, path) => {
        updateRearchiveVars(newrearchive, path);
        updateUI();
    });

    async function updateConfig(nconfig) {
        if (nconfig === undefined)
            config = await browser.runtime.sendMessage(["getConfig"]);
        else
            config = nconfig;

        setUI(document, "config", config, (newconfig, path) => {
            browser.runtime.sendMessage(["setConfig", newconfig]).catch(logError);
        });

        updateUI();
    }

    async function updateStats(stats) {
        if (stats === undefined)
            stats = await browser.runtime.sendMessage(["getStats"]);
        setUI(document, "stats", present(stats));

        setConditionalClass(reloadSelfButton, "attention", stats.update_available);
        implySetConditionalClass(dbody, "on-reload",  "hidden", !hash && !(stats.update_available || config.debugRuntime));
        implySetConditionalClass(dbody, "on-pending", "hidden", !stats.reload_pending);
        implySetConditionalOff(dbody, "on-replay", !(config.replaySubmitHTTP !== false && stats.can_replay));
    }

    async function updateTabConfig(tabconfig) {
        if (tabconfig === undefined)
            tabconfig = await browser.runtime.sendMessage(["getTabConfig", narrowTabId]);

        setUI(document, "tabconfig", tabconfig, (newtabconfig, path) => {
            browser.runtime.sendMessage(["setTabConfig", narrowTabId, newtabconfig]).catch(logError);
        });
    }

    async function updateTabStats(tabstats) {
        if (tabstats === undefined)
            tabstats = await browser.runtime.sendMessage(["getTabStats", narrowTabId]);

        setUI(document, "tabstats", present(tabstats));
    }

    // set default UI state
    showTab(hash ? "all" : "common");

    async function processUpdate(update) {
        let [what, arg1, arg2] = update;
        switch (what) {
        case "updateConfig":
            await updateConfig(arg1);
            return true;
        case "updateStats":
            await updateStats(arg1);
            return true;
        case "updateTabConfig":
            if (narrow && arg1 === narrowTabId)
                await updateTabConfig(arg2);
            return true;
        case "updateTabStats":
            if (narrow && arg1 === narrowTabId)
                await updateTabStats(arg2);
            return true;
        case "switchTab":
            // the tab was switched
            if (arg1 === narrowWindowId)
                narrowTabId = arg2;
            return true;
        default:
            let res = await webextRPCHandleMessageDefault(update, () => showTab("all"));
            return res;
        }
    }

    setPageSettling();

    await subscribeToExtension("popup", 3, async (isInvalid) => {
        await updateConfig();
        await updateStats();
        if (isInvalid()) return;
        if (narrow) {
            await updateTabConfig();
            await updateTabStats();
        }
    }, asyncNoop, processUpdate);

    setPageDone();

    // highlight current target
    // NB: not using showAll and hideAll here, so that unhighlight will not shrink the UI
    focusHashNode();

    // notify the others we are done here
    broadcastToHelp("popupResized");
}

document.addEventListener("DOMContentLoaded", () => popupMain().catch(setPageError), setPageError);
