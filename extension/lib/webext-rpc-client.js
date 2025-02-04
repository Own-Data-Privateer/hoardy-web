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

let webextRPCHandleMessageDefaultIgnore = new Set();

function webextRPCHandleMessageDefault(request, showAllFunc, hideAllFunc) {
    let [cmd, data1, data2] = request;

    if (webextRPCHandleMessageDefaultIgnore.has(cmd))
        return;

    hideHelp();

    switch (cmd) {
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
    default:
        console.error("WEBEXT_RPC: unknown request", request);
        throw new Error(`unknown request`);
    }
}

// this goes here to prevent GC freeing this
let webextRPCPortToExtension;

// Open port to extension asynchronously, running async init and uninit
// functions properly in the correct order. Reconnect, if the connection
// closes unexpectedly.
async function connectToExtension(name, init, uninit, extensionId, connectInfo) {
    function retry() {
        setTimeout(catchAll(
            () => connectToExtension(name, init, uninit, extensionId, connectInfo)
        ), 1000)
    }

    let doUninit = false;
    let ready = false;

    webextRPCPortToExtension = browser.runtime.connect(extensionId, assignRec({name}, connectInfo));
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

function subscribeToExtension(name, handleMessage, reinit, isUnsafe, markLoading, markSettling, extensionId, connectInfo) {
    // onMessage will not wait for an Promises. Thus, multiple updates could
    // race, so we have to run them synchronously here.
    let updateQueue = [];
    let running = false;
    let queueSyncRunning = false;

    async function doQueueSync() {
        queueSyncRunning = true;
        while (updateQueue.length > 0) {
            let update = updateQueue.shift();
            await handleMessage(update);
        }
        queueSyncRunning = false;
    }

    function handleMessageSync(event) {
        if (!running)
            return;

        updateQueue.push(event);
        if (queueSyncRunning)
            return;
        doQueueSync();
    }

    return connectToExtension(name, async () => {
        if (reinit === undefined) {
            // the boring use case, no inconsistencies possible here
            running = true;
            webextRPCPortToExtension.onMessage.addListener(handleMessageSync);
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
        function handleMessageSmartly(event) {
            shouldReset = shouldReset || isUnsafe(event);
            // apparently, this event can be processed synchronously
            handleMessageSync(event);
        }

        // delay `markLoading` a bit so that it would not be called if
        // the rest of this happens fast enough
        let markLoadingTID;
        function clearLoading() {
            if (markLoadingTID !== undefined) {
                clearTimeout(markLoadingTID);
                markLoadingTID = undefined;
            }
        }

        webextRPCPortToExtension.onMessage.addListener(handleMessageSmartly);

        try {
            if (markLoading !== undefined)
                markLoadingTID = setTimeout(markLoading, 300);

            while (true) {
                // reset and start processing updates
                updateQueue = [];
                shouldReset = false;
                running = true;

                // run reinit
                let done = await reinit(willReset);

                // if it run ok and there were no consistency-breaking messages,
                // stop here
                if (done || !shouldReset)
                    break;

                // if there were consistency-breaking messages, async reinit
                // could have resulted in an inconsistent state, retry in 1s
                console.warn("received some breaking async state updates while doing async page init, the result is probably inconsistent, retrying");

                // stop processing updates
                running = false;

                if (markSettling !== undefined) {
                    clearLoading();
                    markSettling();
                }

                await sleep(1000);
            }
        } finally {
            // cleanup
            clearLoading();
            webextRPCPortToExtension.onMessage.removeListener(handleMessageSmartly);
        }

        webextRPCPortToExtension.onMessage.addListener(handleMessageSync);
    }, async () => {
        webextRPCPortToExtension.onMessage.removeListener(handleMessageSync);
    }, extensionId, connectInfo);
}

function subscribeToExtensionSimple(name, handleMessage, extensionId, connectInfo) {
    if (handleMessage === undefined)
        handleMessage = catchAll(webextRPCHandleMessageDefault);
    return subscribeToExtension(name, handleMessage, undefined, () => false, undefined, undefined, extensionId, connectInfo);
}

function sendMessageWithLazyArgs(lazy, args, ...prefix) {
    if (lazy)
        args = evalFunctionsAway(args);
    browser.runtime.sendMessage([...prefix, ...args]);
    return [false, args];
}

function broadcast(lazy, ...args) {
    return sendMessageWithLazyArgs(lazy, args, "broadcast");
}

function broadcastToURL(lazy, url, ...args) {
    return sendMessageWithLazyArgs(lazy, args, "broadcastToURL", url);
}

function broadcastToURLPrefix(lazy, url, ...args) {
    return sendMessageWithLazyArgs(lazy, args, "broadcastToURLPrefix", url);
}

function broadcastToName(lazy, name, ...args) {
    return sendMessageWithLazyArgs(lazy, args, "broadcastToName", name);
}

function broadcastToNamePrefix(lazy, name, ...args) {
    return sendMessageWithLazyArgs(lazy, args, "broadcastToNamePrefix", name);
}
