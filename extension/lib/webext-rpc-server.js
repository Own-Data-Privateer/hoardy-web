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
 * A tiny library for WebExtension server-side RPC handling.
 *
 * Depends on `./webext.js`.
 */

"use strict";

let WEBEXT_RPC_MODE = 0;

// Set to enable debugging.
let DEBUG_WEBEXT_RPC = false;

// open client tab ports
let webextRPCOpenPorts = new Map();

function webextRPCHandleConnect(port) {
    let portId;
    if (useDebugger) {
        if (port.sender.tab !== undefined)
            portId = port.sender.tab.id;
        else
            portId = port.sender.url;
    } else
        portId = port.sender.contextId;

    if (DEBUG_WEBEXT_RPC)
        console.debug("WEBEXT_RPC: port opened", portId, port);

    webextRPCOpenPorts.set(portId, port);
    port.onDisconnect.addListener(catchAll(() => {
        if (DEBUG_WEBEXT_RPC)
            console.debug("WEBEXT_RPC: port disconnected", portId);

        webextRPCOpenPorts.delete(portId);
    }));
}

function initWebextRPC(handleMessage) {
    browser.runtime.onMessage.addListener(catchAll((request, ...args) => {
        if (DEBUG_WEBEXT_RPC)
            console.debug("WEBEXT_RPC: message", request);
        handleMessage(request, ...args)
    }));
    browser.runtime.onConnect.addListener(catchAll(webextRPCHandleConnect));
}

function broadcast(data) {
    if (DEBUG_WEBEXT_RPC)
        console.debug("WEBEXT_RPC: broadcasting", data);

    for (let [portId, port] of webextRPCOpenPorts.entries()) {
        port.postMessage(data);
    }
}
