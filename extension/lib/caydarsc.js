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
 * "Chromium, Attach Your Debugger and Atomically Run these Send Command(s)."
 *
 * Chromium's Debugger API is incredibly hard to use:
 *
 * - debugger can detach, making all subsequent API calls start failing, even
 *   while you are configuring it (!), requiring you retry from the beginning;
 *
 * - double-attachment will not work, so if you want to attach from concurrent
 *   tasks, you'll have to track your attachment and configuration progress
 *   yourself, and then generate and join
 *   attach-and-configure-the-debugger-for-my-debugee `Promise`s.
 *
 * This tiny wrapper solves all of the above, making Chromium's Debugger API
 * actually usable.
 *
 * Depends on `./base.js`.
 */

"use strict";

// Set to enable debugging.
let DEBUG_CAYDARSC = false;

async function attachDebuggerWithSendCommandsUnsafe(tabId, version, commands, pre, post) {
    let debuggee = { tabId };

    let lastError = undefined;
    let retry = 0;
    for (; retry < 10; ++retry) {
        if (pre !== undefined)
            pre(tabId, retry);

        try {
            await chrome.debugger.attach(debuggee, version);
        } catch (err) {
            lastError = err;
            if (typeof err !== "string")
                throw err;
            else if (err === "Cannot access a chrome:// URL"
                || err.startsWith("Cannot access contents of url"))
                throw err;
            else if (!err.startsWith("Another debugger is already attached to the tab with id:"))
                throw err;
            // otherwise, continue as normal
        }

        try {
            for (let args of commands)
                 await chrome.debugger.sendCommand(debuggee, ...args);
        } catch (err) {
            // this could happen if the debugger gets detached immediately
            // after it gets attached, so we retry again
            lastError = err;
            await sleep(100);
            continue;
        }

        lastError = undefined;
        break;
    }

    if (lastError !== undefined)
        throw lastError;

    if (DEBUG_CAYDARSC)
        console.debug("CAYDARSC: attached debugger to tab", tabId, "on retry", retry);

    if (post !== undefined)
        post(tabId, retry);
}

// Tabs we are debugging.
let tabsDebugging = new Set();
// Tabs we are attaching the debugger to.
let tabsAttaching = new Map();

function attachDebuggerWithSendCommands(tabId, version, commands, pre, post) {
    if (tabsDebugging.has(tabId))
        // nothing to do
        return;

    // NB: self-destructing using `tabsAttaching.delete`
    return cacheSingleton(tabsAttaching, tabId,
                          (tabId) => attachDebuggerWithSendCommandsUnsafe(tabId, version, commands, pre, post)
                                     .then(() => tabsDebugging.add(tabId))
                                     .finally(() => tabsAttaching.delete(tabId)));
}

function detachDebugger(tabId, post) {
    let debuggee = { tabId };
    return chrome.debugger.detach(debuggee).then(() => {
        tabsDebugging.delete(tabId);

        if (DEBUG_CAYDARSC)
            console.debug("CAYDARSC: detached debugger from tab", tabId);

        if (post !== undefined)
            post(tabId);
    });
}
