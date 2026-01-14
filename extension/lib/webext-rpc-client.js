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

// Similar `connectToExtension`, but also start handling new port messages with `handleMessage`. All
// of the weirdness of `connectToExtension`, which see, applies here too.
//
// If port messages arrive while an async `init` is running, `handleMessage` can be made to return
// `true` on some of them, which would then force this function to re-run `init` from the beginning
// again after it finishes. Meanwhile, this function runs `init` with an `isInvalid` argument which
// is a function which can be called to see if any of the asynchronously handled `handleMessage`
// returned `true` yet. Finally, `init` itself can return `true`, which would force this function to
// continue without re-running it even if some `handleMessage`s returned `true`.
//
// In other words, an `init` implementation can stop prematurely by checking `isInvalid` and signal
// that it's state is valid regardless of any `handleMessage`s by returning `true`.
//
// All these features are useful if your `init` works on generating a consistent state that some
// `handleMessage`s should invalidate.
//
// `init`, `uninit`, and `handleMessage` can be simple or `async` functions.
function subscribeToExtension(name, init, uninit, handleMessage, dontPauseBetween, extensionId, connectInfo) {
    // A flag denoting if there were any state-invalidating updates while `init` was running
    // asynchronously.
    let invalid = false;

    function isInvalid() {
        return invalid;
    }

    // NB: `onMessage` will not `await` for a `Promise`. Thus, multiple updates could race, so we
    // have to run them synchronously here.
    //
    // Thus, an update queue and its async-to-sync machinery follows.
    let updateQueue = [];
    let running = false;
    let queueSyncRunning = false;

    async function doQueueSync() {
        queueSyncRunning = true;
        while (updateQueue.length > 0) {
            let update = updateQueue.shift();
            let res;
            try {
                res = catchAll(handleMessage)(update);
                if (res instanceof Promise)
                    res = await res;
                invalid = invalid || res === true;
            } catch (err) {
                invalid = true;
                logError(err);
            }
        }
        queueSyncRunning = false;
    }

    function handleMessageSync(update) {
        if (!running)
            return;

        updateQueue.push(update);
        if (queueSyncRunning)
            return;
        doQueueSync();
    }

    return connectToExtension(name, async () => {
        webextRPCPortToExtension.onMessage.addListener(handleMessageSync);

        while (true) {
            // start processing updates
            running = true;
            // reset
            invalid = false;

            // run init
            let res = init(isInvalid);
            if (res instanceof Promise)
                res = await res;

            // if `init` forces us to continue or there were no state-breaking messages, stop here
            if (res === true || !invalid)
                break;

            console.warn("received some breaking `handleMessage`s while doing async page `init`, retrying");

            if (!dontPauseBetween) {
                running = false;
                updateQueue = [];
            }

            // retry in 1s
            await sleep(1000);
        }
    }, async () => {
        webextRPCPortToExtension.onMessage.removeListener(handleMessageSync);
        let res = uninit();
        if (res instanceof Promise)
            await res;
    }, extensionId, connectInfo);
}

function subscribeToExtensionSimple(name, handleMessage, dontPauseBetween, extensionId, connectInfo) {
    if (handleMessage === undefined)
        handleMessage = webextRPCHandleMessageDefault;
    return subscribeToExtension(name, asyncNoop, asyncNoop, handleMessage, dontPauseBetween, extensionId, connectInfo);
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
