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
 * A tiny library for WebExtension client-side RPC handling.
 *
 * Depends on `./webext.js`.
 */

"use strict";

let WEBEXT_RPC_MODE = 1;

// Set to enable debugging.
let DEBUG_WEBEXT_RPC = false;

function webextRPCHandleMessageDefault(update, thisTabId, showAllFunc, hideAllFunc) {
    let [what, reqTabId, data1, data2] = update;
    if (reqTabId !== thisTabId)
        return;

    hideHelp();

    switch (what) {
    case "showAll":
        if (showAllFunc !== undefined)
            showAllFunc();
        return;
    case "hideAll":
        if (hideAllFunc !== undefined)
            hideAllFunc();
        return;
    case "viewNode":
        viewNode(data1, data2 ? data2 : {}, showAllFunc, hideAllFunc);
        return;
    case "highlightNode":
        highlightNode(data1);
        return;
    case "focusNode":
        focusNode(data1, data2 ? data2 : {}, showAllFunc, hideAllFunc);
        return;
    }
}

// this goes here to prevent GC freeing this
let webextRPCPortToExtension;

// Open port to extension asynchronously, running async init and uninit
// functions properly in the correct order. Reconnect, if the connection
// closes unexpectedly.
async function connectToExtension(init, uninit, extensionId, connectInfo) {
    function retry() {
        setTimeout(catchAll(
            () => connectToExtension(init, uninit, extensionId, connectInfo)
        ), 1000)
    }

    let doUninit = false;
    let ready = false;

    webextRPCPortToExtension = browser.runtime.connect(extensionId, connectInfo);
    webextRPCPortToExtension.onDisconnect.addListener(async () => {
        if (ready) {
            await uninit();
            retry();
        } else
            doUninit = true;
    });

    if (doUninit)
        return;
    await init();
    if (doUninit) {
        await uninit();
        retry();
    } else
        ready = true;
}

function subscribeToExtension(processUpdate, reinit, isUnsafe, markLoading, markSettling, extensionId, connectInfo) {
    // onMessage will not wait for an Promises. Thus, multiple updates could
    // race, so we have to run them synchronously here.
    let updateQueue = [];
    let queueSyncRunning = false;

    async function doQueueSync() {
        queueSyncRunning = true;
        while (updateQueue.length > 0) {
            let update = updateQueue.shift();
            await processUpdate(update);
        }
        queueSyncRunning = false;
    }

    function processUpdateSync(event) {
        updateQueue.push(event);
        if (queueSyncRunning)
            return;
        doQueueSync();
    }

    return connectToExtension(async () => {
        if (reinit === undefined) {
            // the boring use case, no inconsistencies possible here
            webextRPCPortToExtension.onMessage.addListener(processUpdateSync);
            return;
        }

        // by default, all async events mark the internal state to be
        // inconsistent
        if (isUnsafe === undefined)
            isUnsafe = () => true;

        // a flag which remembers if there were any updates while
        // reinit was running asynchronously
        let shouldReset = false;
        function willReset() {
            return shouldReset;
        }
        function processUpdateSmartly(event) {
            shouldReset = shouldReset || isUnsafe(event);
            // apparently, this event can be processed synchronously
            processUpdateSync(event);
        }
        webextRPCPortToExtension.onMessage.addListener(processUpdateSmartly);

        // delay `markLoading` a bit so that it would not be called if
        // the rest of this happens fast enough
        let markLoadingTID = null;
        if (markLoading !== undefined)
            markLoadingTID = setTimeout(markLoading, 300);

        function clearLoading() {
            if (markLoadingTID === undefined)
                return;

            clearTimeout(markLoadingTID);
            markLoadingTID = undefined;
        }

        while (true) {
            // start processing updates
            updateQueue = [];
            shouldReset = false;
            webextRPCPortToExtension.onMessage.addListener(processUpdateSmartly);

            // run full update
            let done = await reinit(willReset);

            if (done || !shouldReset)
                break;

            // if there were messages in-between, async reinit
            // could have resulted in an inconsistent state, retry in 1s
            console.warn("received some breaking async state updates while doing async page init, the result is probably inconsistent, retrying");

            // stop processing updates
            webextRPCPortToExtension.onMessage.removeListener(processUpdateSmartly);

            if (markSettling !== undefined) {
                clearLoading();
                markSettling();
            }

            await sleep(1000);
        }

        clearLoading();

        // cleanup
        webextRPCPortToExtension.onMessage.removeListener(processUpdateSmartly);
        webextRPCPortToExtension.onMessage.addListener(processUpdateSync);
    }, async () => {
        webextRPCPortToExtension.onMessage.removeListener(processUpdateSync);
    }, extensionId, connectInfo);
}

function subscribeToExtensionSimple(processUpdate, extensionId, connectInfo) {
    if (processUpdate === undefined)
        processUpdate = catchAll(
            (update) => webextRPCHandleMessageDefault(update, normalizedURL(document.location.href)));
    return subscribeToExtension(processUpdate, undefined, () => false, undefined, undefined, extensionId, connectInfo);
}

// Ask WebExtension RPC server to broadcast this `args` to all open
// pages belonging to this extension.
function broadcast(data) {
    return browser.runtime.sendMessage(["broadcast", data]);
}
