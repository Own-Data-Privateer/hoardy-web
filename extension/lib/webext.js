/*
 * Copyright (c) 2023-2026 Jan Malakhovski <oxij@oxij.org>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/*
 * Utility functions for making in WebExtensions.
 *
 * Depends on `./base.js`, `./compat.js`, and `./ui.js`.
 */

"use strict";

const TAB_ID_NONE = browser.tabs.TAB_ID_NONE;
const WINDOW_ID_NONE = browser.windows.WINDOW_ID_NONE;

async function getTab(tabId) {
    let tabs = await browser.tabs.query({ active: true, currentWindow: true });
    for (let tab of tabs) {
        if (tab.id === tabId)
            return tab;
    }
    return null;
}

async function getActiveTab() {
    let tabs = await browser.tabs.query({ active: true, currentWindow: true });
    for (let tab of tabs) {
        return tab;
    }
    return null;
}

function navigateTabTo(tabId, url) {
    return browser.tabs.update(tabId, { url });
}

function navigateTabToBlank(tabId) {
    return navigateTabTo(tabId, "about:blank");
}

function getTabURL(tab, def) {
    let pendingUrl = tab.pendingUrl;
    if (isValidStr(pendingUrl))
        return pendingUrl;
    let url = tab.url;
    if (isValidStr(url))
        return url;
    return def;
}

async function getTabURLThenNavigateTabToBlank(tabId) {
    let tab = await browser.tabs.get(tabId);
    let url = getTabURL(tab);
    await navigateTabToBlank(tabId);
    return url;
}

async function getShortcuts(...args) {
    // NB: these are set in this order because, on Firefox,
    // `manifest.commands._execute_browser_action.description == null`.
    let res = assignRec({}, ...args, manifest.commands, {
        _execute_browser_action: {
            description: "Open extension's popup."
        },
    });
    if (browser.commands !== undefined) {
        let shortcuts = await browser.commands.getAll();
        for (let s of shortcuts)
            res[s.name].shortcut = s.shortcut;
    }
    return res;
}

// make a DOM node with a given id emit a `browser.runtime.sendMessage` with the same id
function buttonToMessage(id, func) {
    if (func === undefined)
        return buttonToAction(id, () => browser.runtime.sendMessage([id]));
    else
        return buttonToAction(id, () => browser.runtime.sendMessage(func()));
}

// activate a tab with a given document URL if exists, or open new if not
async function spawnOrActivateTab(url, createProperties, currentWindow) {
    if (currentWindow === undefined)
        currentWindow = true;

    let tabs = await browser.tabs.query({ currentWindow });
    let nurl = normalizedURL(url);
    for (let tab of tabs) {
        if (normalizedURL(getTabURL(tab, "about:blank")) === nurl) {
            // activate that tab instead
            await browser.tabs.update(tab.id, { active: true });
            return [tab, false];
        }
    }

    // open new tab
    let res = await browser.tabs.create(assignRec({ url }, createProperties || {}));
    return [res, true];
}

async function showInternalPageAtNode(url, id, openerTabId, spawn, scrollIntoViewOptions) {
    let rurl = url + (id ? "#" + id : "");
    if (spawn === false) {
        window.location = rurl;
        return null;
    } else {
        let tab, spawned;
        try {
            [tab, spawned] = await spawnOrActivateTab(rurl, { openerTabId });
        } catch (e) {
            // in case openerTabId points to a dead tab
            [tab, spawned] = await spawnOrActivateTab(rurl);
        }
        if (!spawned && id !== undefined)
            broadcastToURL(false, url, "viewNode", id, scrollIntoViewOptions);
        return tab.id;
    }
}

// For a given list of `tabs`, split them by `windowId`, then run `func` for each `windowId` and its
// tabs.
function mapTabsPerWindow(func, tabs) {
    let byWindow = new Map();
    for (let tab of tabs)
        cacheSingleton(byWindow, tab.windowId, () => []).push(tab);

    let out = [];
    for (let [windowId, windowTabs] of byWindow.entries())
        out.push(func(windowId, windowTabs));
    return out;
}

// For a given list of `tabs`, split them by `windowId`, round-robin the list within each `windowId`
// so that the tab following the currently active tab would be at the beggining fo the list and the
// currently active tab would be at its the end, then run `func` for each `windowId` and its
// round-robin'ed tabs.
function mapRoundRobinTabsPerWindow(func, tabs) {
    return mapTabsPerWindow((windowId, windowTabs) => {
        let seenActive = false;
        let rrTabs = [];
        let rrTabsBefore = [];
        for (let tab of windowTabs) {
            if (seenActive)
                rrTabs.push(tab);
            else
                rrTabsBefore.push(tab);
            if (tab.active)
                seenActive = true;
        }
        rrTabs.push(...rrTabsBefore);

        return func(windowId, rrTabs);
    }, tabs);
}
