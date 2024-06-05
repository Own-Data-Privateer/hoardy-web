/*
 * Copyright (c) 2023-2024 Jan Malakhovski <oxij@oxij.org>
 *
 * This file can be distributed under the terms of the GNU GPL, version 3 or later.
 */

"use strict";

function parseUA() {
    let result = null;
    let UA = window.navigator.userAgent;
    for (let e of UA.split(" ")) {
        if (e.startsWith("Firefox/")) {
            result = e;
            break;
        } else if (e.startsWith("Chrome/")) {
            result = e;
            break;
        }
    }
    if (result === null)
        throw new Error("unknown/unsupported User-Agent: " + UA);
    return result;
}

function makePromiseAPIConst(data) {
    return () => {
        return new Promise((resolve, reject) => {
            resolve(data);
        });
    };
}

function makePromiseAPI0(old, nthis) {
    return () => {
        return new Promise((resolve, reject) => {
            old.apply(nthis, [(data) => {
                if (browser.runtime.lastError === undefined)
                    resolve(data);
                else {
                    reject(browser.runtime.lastError.message);
                }
            }]);
        });
    };
}

function makePromiseAPI(old, nthis) {
    return (arg) => {
        return new Promise((resolve, reject) => {
            old.apply(nthis, [arg, (data) => {
                if (browser.runtime.lastError === undefined)
                    resolve(data);
                else {
                    reject(browser.runtime.lastError.message);
                }
            }]);
        });
    };
}

function makePromiseAPI2(old, nthis) {
    return (arg1, arg2) => {
        return new Promise((resolve, reject) => {
            old.apply(nthis, [arg1, arg2, (data) => {
                if (browser.runtime.lastError === undefined)
                    resolve(data);
                else {
                    reject(browser.runtime.lastError.message);
                }
            }]);
        });
    };
}

function makePromiseAPI3(old, nthis) {
    return (arg1, arg2, arg3) => {
        return new Promise((resolve, reject) => {
            old.apply(nthis, [arg1, arg2, arg3, (data) => {
                if (browser.runtime.lastError === undefined)
                    resolve(data);
                else {
                    reject(browser.runtime.lastError.message);
                }
            }]);
        });
    };
}

function makeFirefoxish(browser) {
    // Okay, so the probem here is that with manifest V3 nothing works, but
    // with manifest V2 Chromium requires the use of callback-based APIs
    // instead of Promise-based ones, which is annoying.
    //
    // So we wrap the functions we use and turn them into Promise-based ones.

    browser.browserAction.setBadgeText = makePromiseAPI(browser.browserAction.setBadgeText);
    browser.browserAction.setIcon = makePromiseAPI(browser.browserAction.setIcon);
    browser.browserAction.setTitle = makePromiseAPI(browser.browserAction.setTitle);
    browser.browserAction.setBadgeTextColor = makePromiseAPIConst(undefined);
    // TODO on V3 do this instead:
    //browser.browserAction.setBadgeTextColor = makePromiseAPI(browser.action.setBadgeTextColor);
    browser.browserAction.setBadgeBackgroundColor = makePromiseAPI(browser.browserAction.setBadgeBackgroundColor);
    browser.notifications.clear = makePromiseAPI(browser.notifications.clear);
    browser.notifications.create = makePromiseAPI2(browser.notifications.create);
    browser.notifications.getAll = makePromiseAPI0(browser.notifications.getAll);
    browser.runtime.sendMessage = makePromiseAPI(browser.runtime.sendMessage);
    browser.tabs.create = makePromiseAPI(browser.tabs.create);
    browser.tabs.get = makePromiseAPI(browser.tabs.get);
    browser.tabs.query = makePromiseAPI(browser.tabs.query);
    browser.tabs.update = makePromiseAPI2(browser.tabs.update);
    browser.windows.create = makePromiseAPI(browser.windows.create);

    browser.menus = browser.contextMenus;
    browser.menus.create = makePromiseAPI(browser.contextMenus.create);
    browser.menus.update = makePromiseAPI2(browser.contextMenus.update);
    browser.menus.refresh = makePromiseAPI0(browser.contextMenus.refresh);

    let old_local = browser.storage.local;
    browser.storage.local = {
        get: makePromiseAPI(old_local.get, old_local),
        set: makePromiseAPI(old_local.set, old_local)
    };

    browser.debugger.attach = makePromiseAPI2(browser.debugger.attach);
    browser.debugger.detach = makePromiseAPI(browser.debugger.detach);
    browser.debugger.sendCommand = makePromiseAPI3(browser.debugger.sendCommand, browser.debugger);

    return browser;
}

var browser;
if (browser === undefined) {
    browser = makeFirefoxish(chrome);
}
browser.nameVersion = parseUA();

let manifest = browser.runtime.getManifest();
let permissions = new Set(manifest.permissions);
// are SVG icons supported?
let useSVGIcons = browser.nameVersion.startsWith("Firefox/");
let useDebugger = permissions.has("debugger");
let useBlocking = permissions.has("webRequestBlocking");
