/*
 * Copyright (c) 2023-2025 Jan Malakhovski <oxij@oxij.org>
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
    if (isDefinedURL(pendingUrl))
        return pendingUrl;
    let url = tab.url;
    if (isDefinedURL(url))
        return url;
    return def;
}

async function getTabURLThenNavigateTabToBlank(tabId) {
    let tab = await browser.tabs.get(tabId);
    let url = getTabURL(tab);
    await navigateTabToBlank(tabId);
    return url;
}

async function getShortcuts() {
    if (browser.commands === undefined)
        return {};

    let shortcuts = await browser.commands.getAll();
    let res = {};
    for (let s of shortcuts)
        res[s.name] = s.shortcut;
    return res;
}

function macroShortcuts(node, shortcuts, mapShortcutFunc) {
    for (let child of node.childNodes) {
        if (child.nodeName === "#text" || child.nodeName === "#comment") continue;
        macroShortcuts(child, shortcuts, mapShortcutFunc);
    }

    let sname = node.getAttribute("data-macro-shortcut");
    if (sname === null) return;
    let shortcut = shortcuts[sname];
    node.innerHTML = microMarkdownToHTML(mapShortcutFunc(node.innerText, shortcut, sname));
}

// make a DOM node with a given id emit a `browser.runtime.sendMessage` with the same id
function buttonToMessage(id, func) {
    if (func === undefined)
        return buttonToAction(id, catchAll(() => browser.runtime.sendMessage([id])));
    else
        return buttonToAction(id, catchAll(() => browser.runtime.sendMessage(func())));
}

// activate a tab with a given document URL if exists, or open new if not
async function openOrActivateTab(url, createProperties, currentWindow) {
    if (currentWindow === undefined)
        currentWindow = true;

    let tabs = await browser.tabs.query({ currentWindow });
    let nurl = normalizedURL(url);
    for (let tab of tabs) {
        if (normalizedURL(getTabURL(tab, "about:blank")) === nurl) {
            // activate that tab instead
            await browser.tabs.update(tab.id, { active: true });
            return tab;
        }
    }

    // open new tab
    let res = await browser.tabs.create(assignRec({ url }, createProperties || {}));
    return res;
}

async function showInternalPageAtNode(url, id, tabId, spawn, scrollIntoViewOptions) {
    let rurl = browser.runtime.getURL(url + (id ? "#" + id : ""));
    if (spawn === false) {
        window.location = rurl;
        return null;
    } else {
        let tab;
        try {
            tab = await openOrActivateTab(rurl, { openerTabId: tabId });
        } catch (e) {
            // in case tabId points to a dead tab
            tab = await openOrActivateTab(rurl);
        }
        if (id !== undefined)
            broadcast(["viewNode", tab.id, id, scrollIntoViewOptions]);
        return tab.id;
    }
}
