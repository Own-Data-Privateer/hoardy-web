/*
 * Some utility functions.
 *
 * Copyright (c) 2023-2024 Jan Malakhovski <oxij@oxij.org>
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

"use strict";

function errorMessageOf(err) {
    if (typeof err === "string")
        return err;
    let msg = err.message;
    if (msg === undefined)
        return err.toString();
    else
        return msg.replace(/\.$/, "");
}

function logError(err) {
    console.error("Uncaught error:", err);
    console.trace();
}

function logErrorExceptWhenStartsWith(prefix) {
    return (err) => {
        if (typeof err === "string" && err.startsWith(prefix))
            return;
        logError(err);
    };
}

function logHandledError(err) {
    console.warn("Handled error:", err);
    console.trace();
}

// turn all uncaught exceptions into console.error
function catchAll(func) {
    return (...args) => {
        let res;
        try {
            res = func(...args);
        } catch (err) {
            logError(err);
            return;
        }

        if (res instanceof Promise)
            return new Promise((resolve, reject) => res.catch(logError).then(resolve));
        else
            return res;
    };
}

async function asyncEvalSequence(list, ...args) {
    while (list.length > 0) {
        let func = list.shift();
        try {
            let res = func(...args);
            if (res instanceof Promise)
                await res;
        } catch (err) {
            logError(err);
        }
    }
}

// based on https://stackoverflow.com/questions/13405129/create-and-save-a-file-with-javascript
function saveAs(chunks, mime, fileName) {
    var file = new Blob(chunks, { type: mime ? mime : "application/octet-stream" });
    var fileURL = URL.createObjectURL(file);
    var el = document.createElement("a");
    el.href = fileURL;
    if (fileName)
        el.download = fileName;
    el.dispatchEvent(new MouseEvent("click"));
    setTimeout(function() {
        URL.revokeObjectURL(fileURL);
    }, 0);
}

function toNumber(x) {
    return Number(x).valueOf();
}

function clamp(min, max, value) {
    return Math.min(max, Math.max(min, value));
}

function getFirstDefined(...args) {
    for (let a of args)
        if (a !== undefined)
            return a;
}

function getFirstOk(...args) {
    for (let a of args)
        if (a)
            return a;
}

// convert milliseconds since UNIX epoch to "YYYY-mm-DD HH:MM:SS"
function dateToString(epoch) {
    if (epoch === undefined || typeof epoch !== "number")
        return "undefined";
    let str = new Date(epoch).toISOString();
    let pos = str.indexOf(".");
    if (pos != -1)
        str = str.substr(0, pos);
    return str.replace("T", " ");
}

// partition a list via a predicate, but stop after num elements
function partitionN(predicate, num, list) {
    let total = 0;
    let first = [];
    let second = [];
    for (let e of list) {
        if ((num === null || total < num)
            && (predicate === undefined || predicate(e))) {
            total += 1;
            first.push(e);
        } else
            second.push(e);
    }

    return [first, second];
}

// Use a Map as a singleton storage/mutable cache.
function cacheSingleton(map, key, func) {
    let value = map.get(key);
    if (value === undefined) {
        value = func(key);
        map.set(key, value);
    }
    return value;
}

// An overridable and 1-chainable task scheduled to execute after a given timeout.
function makeSingletonTimeout(priority, timeout, func) {
    let value = {
        priority: priority,
        task: func,
        when: Date.now() + timeout,
        stop: false,
        results: [],
        before: [],
        after: [],
    };
    value.tid = setTimeout(() => evalSingletonTimeout(value, true), timeout);
    return value;
}

// Create or update singletonTimeout.
// Returns a new `makeSingletonTimeout` if given `value === undefined`.
// Otherwiss, returns `undefined`.
function setSingletonTimeout(value, priority, timeout, func, hurry) {
    if (value !== undefined) {
        let oldPriority = value.priority;
        if (oldPriority < priority)
            // the scheduled/running task has a higher (smaller) priority, do
            // nothing regardless of it executing or not.
            return

        let now = Date.now();
        if (value.tid !== null) {
            // it's not running, cancel it
            clearTimeout(value.tid);
            // hurry it up, meaning, do not move the target execution time
            // any more into the future
            if (hurry)
                timeout = clamp(0, value.when - now, timeout);
        }

        // update the scheduled task
        value.priority = priority;
        value.task = func;
        value.when = now + timeout;

        if (value.tid !== null)
            // re-schedule
            value.tid = setTimeout(() => evalSingletonTimeout(value, true), timeout);
        else if (timeout === 0)
            // ask the running task to stop, if possible
            value.stop = true;

        return;
    }

    return makeSingletonTimeout(priority, timeout, func);
}

// Run a task stored in a given singletonTimeout value.
async function evalSingletonTimeout(value, run) {
    if (value.tid === undefined)
        throw new Error("called evalSingletonTimeout on a finished task");

    if (value.tid === null)
        // already running
        return;

    // mark as running
    value.tid = null;

    await asyncEvalSequence(value.before);

    let first = true;
    while (run) {
        let task = value.task;
        if (task === undefined)
            // all done
            break;

        if (!first) {
            let when = value.when;
            let now = Date.now();
            let ntimeout = when - now;
            if (ntimeout > 0) {
                // this task should not be running yet, re-schedule it
                value.tid = setTimeout(() => evalSingletonTimeout(value, true), ntimeout);
                return;
            }
        }
        first = false;

        // clear
        value.task = undefined;
        value.when = undefined;
        value.stop = false;

        try {
            let res = task(() => { return value.stop; });
            if (res instanceof Promise)
                res = await res;
            value.results.push(res);
        } catch (err) {
            logError(err);
        }
    }

    // cleanup
    value.priority = undefined;
    value.task = undefined;
    value.when = undefined;
    value.stop = true;
    value.tid = undefined;

    await asyncEvalSequence(value.after, value.results);
}

// Immediately run or cancel a given singletonTimeout.
async function emitSingletonTimeout(value, run, synchronous) {
    if (value.tid === undefined)
        // it's already finished
        return;
    else if (value.tid === null) {
        // it is already running
        if (!run)
            // but we don't want it to
            value.stop = true;
        if (synchronous)
            // wait for it to finish
            await new Promise((resolve, reject) => {
                value.after.push(resolve);
            });
    } else {
        // it's not yet running
        clearTimeout(value.tid);
        // eval immediately
        let res = evalSingletonTimeout(value, run);
        if (synchronous)
            await res;
    }
}

// Use a Map as directory for delayed overridable and chainable functions.
function resetSingletonTimeout(map, key, timeout, func, priority, hurry) {
    if (priority === undefined)
        priority = 100;

    let value = map.get(key);
    value = setSingletonTimeout(value, priority, timeout, func, hurry);
    if (value !== undefined) {
        // a newly created one
        value.after.push(() => map.delete(key));
        map.set(key, value);
    }
    return value;
}

async function popSingletonTimeout(map, key, run, synchronous) {
    let value = map.get(key);
    if (value === undefined)
        return;
    await emitSingletonTimeout(value, !!run, !!synchronous);
}

async function runAllSingletonTimeouts(map) {
    for (let key of Array.from(map.keys()))
        await popSingletonTimeout(map, key, true, true);
}

async function cancelAllSingletonTimeouts(map) {
    // quickly cancel all that can be canceled immediately
    for (let key of Array.from(map.keys()))
        await popSingletonTimeout(map, key, false, false);

    // wait for the rest to finish
    for (let key of Array.from(map.keys()))
        await popSingletonTimeout(map, key, false, true);
}

// recursive equality comparison
function equalRec(a, b) {
    if (a === undefined && b !== undefined || a !== undefined && b === undefined)
        return false;
    else if (a === null && b !== null || a !== null && b === null)
        return false;

    let typ = typeof a;
    if (typ == "boolean" || typ == "number" || typ == "string")
        return a === b;

    if (a instanceof Array && b instanceof Array)
        return a.length === b.length && a.every((v, i) => equalRec(v, b[i]));
    else if (a instanceof Object && b instanceof Object) {
        let ae = Array.from(Object.entries(a));
        let be = Array.from(Object.entries(b));
        if (ae.length !== be.length)
            return false;

        let res = true;
        for (let [k, v] of ae)
            if (!equalRec(v, b[k])) {
                res = false;
                break;
            }
        return res;
    }

    return false;
}

// recursively assign fields in target from fields in value
// i.e. `assignRec({}, value)` would just copy `value`
function assignRec(target, value) {
    if (value === undefined)
        return target;

    if (value === null)
        return value;

    let typ = typeof value;
    if (typ == "boolean" || typ == "number" || typ == "string" || value instanceof Array)
        return value;

    if (value instanceof Object) {
        if (target === undefined)
            target = {};
        for (let [k, v] of Object.entries(value)) {
            target[k] = assignRec(target[k], v);
        }
        return target;
    } else {
        console.error("assignRec", typ, target, value);
        throw new Error("what?");
    }
}

// like `assignRec`, but only updates fields that already exist in target
function updateFromRec(target, value) {
    if (target === undefined || value === undefined)
        return target;

    if (target === null || value === null)
        return value;

    let typ = typeof value;
    if (typeof target !== typ)
        return target;

    if (typ == "boolean" || typ == "number" || typ == "string")
        return value;

    if (value instanceof Object) {
        for (let k of Object.keys(target)) {
            target[k] = updateFromRec(target[k], value[k]);
        }
        return target;
    } else {
        console.error("updateFromRec", typ, target, value);
        throw new Error("what?");
    }
}

function numberToPowerString(n, powers) {
    function mk(pow, psuf) {
        let v = n / pow;
        let vs = v.toString();
        let dot = vs.indexOf(".");
        if (dot >= 3)
            vs = vs.substr(0, dot);
        else if (dot != -1)
            vs = vs.substr(0, dot + 2);
        return vs + psuf;
    }

    let res;
    for (let [pow, psuf] of powers) {
        if (n > pow) {
            res = mk(pow, psuf);
            break;
        }
    }
    if (res !== undefined)
        return res;
    else
        return n.toString();
}

let countPowers = [
    [Math.pow(1000, 5), "P"],
    [Math.pow(1000, 4), "T"],
    [Math.pow(1000, 3), "G"],
    [Math.pow(1000, 2), "M"],
    [1000, "K"],
];

function countToString(n) {
    return numberToPowerString(n, countPowers);
}

let KILOBYTE = 1024;
let MEGABYTE = KILOBYTE * 1024;
let GIGABYTE = MEGABYTE * 1024;
let TERABYTE = GIGABYTE * 1024;
let PETABYTE = TERABYTE * 1024;

let byteLengthPowers = [
    [PETABYTE, "Pi"],
    [TERABYTE, "Ti"],
    [GIGABYTE, "Gi"],
    [MEGABYTE, "Mi"],
    [KILOBYTE, "Ki"],
];

function byteLengthToString(n) {
    return numberToPowerString(n, byteLengthPowers) + "B";
}

// decode base64 into Uint8Array
function unBase64(data) {
    return Uint8Array.from(atob(data), (x) => x.codePointAt(0));
}

// dump Uint8Array into a String, replacing unprintable characters
function binaryToText(dump) {
    let dec = new TextDecoder("utf-8", { fatal: false });
    return dec.decode(dump);
}

// dump Uint8Array to console.log
function dumpToConsole(dump) {
    console.log("dump:");
    console.log(binaryToText(dump));
}

// return mapped ?`param`= parameter when the URL starts with `op`
function getMapURLParam(op, param, purl, f, def1, def2) {
    if (purl.origin + purl.pathname == op) {
        let params = new URLSearchParams(purl.search);
        let id = params.get(param);
        if (id !== null)
            return f(id);
        else
            return def1;
    }
    return def2;
}

// remove #.* from the end of the URL
function removeURLHash(url) {
    if (url === undefined) return url;

    let pos = url.indexOf("#");
    if (pos !== -1)
        url = url.substring(0, pos);
    return url;
}

// given a URL, return its canonical version
function canonicalizeURL(url) {
    let parsed = new URL(url);
    return parsed.href;
}

// given a URL, return its normalized, i.e. minimal HTTP-wire-level
// equal, version
function normalizeURL(url) {
    return canonicalizeURL(removeURLHash(url));
}

function isDefinedURL(url) {
    return url !== undefined && url !== null && url !== "";
}

function isLocalURL(url) {
    if (url.startsWith("about:") || url.startsWith("chrome:")
        || url.startsWith("data:") || url.startsWith("file:"))
        return true;
    return false;
}

function isExtensionURL(url) {
    if (url.startsWith("moz-extension://") // Firefox
        || url.startsWith("chrome-extension://")) // Chromium
        return true;
    return false;
}

function isBoringURL(url) {
    return isLocalURL(url) || isExtensionURL(url);
}

function escapeHTMLTags(text) {
    return text
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

function escapeHTML(text) {
    return escapeHTMLTags(text)
        .replaceAll("&", "&amp;")
        .replaceAll("\"", "&quot;")
        .replaceAll("'", "&#039;");
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

// Ask ../background/core.js to broadcast this `data` to all open
// pages belonging to this extension.
function broadcast(data) {
    return browser.runtime.sendMessage(["broadcast", data]);
}

function getRootNode(document) {
    return Array.from(document.children).filter((e) => e.tagName === "HTML")[0];
}

// attach function to `onclick` of DOM node with a given id
function buttonToAction(id, action) {
    let el = document.getElementById(id);
    if (el === null) {
        console.error(`failed to attach an action to button id "${id}"`);
        console.trace();
        return;
    }
    el.onclick = action;
    return el;
}

// make a DOM node with a given id emit a `browser.runtime.sendMessage` with the same id
function buttonToMessage(id, func) {
    if (func === undefined)
        return buttonToAction(id, catchAll(() => browser.runtime.sendMessage([id])));
    else
        return buttonToAction(id, catchAll(() => browser.runtime.sendMessage(func())));
}

// activate a tab with a given document URL if exists, or open new if not
async function openOrActivateTab(target, createProperties, currentWindow) {
    if (currentWindow === undefined)
        currentWindow = true;

    let tabs = await browser.tabs.query({ currentWindow });
    let targetNoHash = removeURLHash(target);
    for (let tab of tabs) {
        if (removeURLHash(tab.url) == targetNoHash) {
            // activate that tab instead
            await browser.tabs.update(tab.id, { active: true });
            return tab;
        }
    }

    // open new tab
    let res = await browser.tabs.create(assignRec({ url: target }, createProperties || {}));
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

// add or remove a class based on condition
function setConditionalClass(node, className, condition) {
    if (condition)
        node.classList.add(className);
    else
        node.classList.remove(className);
}

function implySetConditionalClass(node, className, impliedClass, condition) {
    for (let e of node.getElementsByClassName(className))
        setConditionalClass(e, impliedClass, condition);
}

function implySetConditionalOff(node, className, condition) {
    return implySetConditionalClass(node, className, "off", condition);
}

let defaultScrollIntoViewOptionsStart = { behavior: "smooth", block: "start" };
let defaultScrollIntoViewOptionsCenter = { behavior: "smooth", block: "center" };

function viewHTMLNode(el, scrollIntoViewOptions, showAllFunc, hideAllFunc) {
    if (el !== null) {
        if (showAllFunc !== undefined)
            showAllFunc();
        let defopts = el.tagName.startsWith("H") ? defaultScrollIntoViewOptionsStart : defaultScrollIntoViewOptionsCenter;
        // give the page a chance to redraw, in case the code just before this call changed styles
        setTimeout(() => {
            // and then scroll
            el.scrollIntoView(scrollIntoViewOptions ? updateFromRec(assignRec({}, defopts), scrollIntoViewOptions) : defopts);
        }, 0);
    } else if (hideAllFunc !== undefined)
        hideAllFunc();
}

function viewNode(id, scrollIntoViewOptions, showAllFunc, hideAllFunc) {
    let el = id ? document.getElementById(id) : null;
    viewHTMLNode(el, scrollIntoViewOptions, showAllFunc, hideAllFunc);
}

// currently highlighted node
let targetNode = null;

// Highlight DOM node with the given id by adding "target" to its class list.
// It also un-highlights previously highlighted one, if any.
function highlightNode(id) {
    if (targetNode !== null)
        targetNode.classList.remove("target");

    let el = id ? document.getElementById(id) : null;
    if (el !== null) {
        targetNode = el;
        el.classList.add("target");
    }

    return el;
}

// highlightNode followed by viewNode, essentially
function focusNode(id, scrollIntoViewOptions, showAllFunc, hideAllFunc) {
    let el = highlightNode(id);
    viewHTMLNode(el, scrollIntoViewOptions, showAllFunc, hideAllFunc);
}

function viewHashNode(scrollIntoViewOptions, showAllFunc, hideAllFunc) {
    let hash = document.location.hash.substr(1);
    let el = hash ? document.getElementById(hash) : null;
    // no-smooth scrolling by default here
    viewHTMLNode(el, scrollIntoViewOptions, showAllFunc, hideAllFunc);
}

function focusHashNode(scrollIntoViewOptions, showAllFunc, hideAllFunc) {
    let hash = document.location.hash.substr(1);
    // no-smooth scrolling by default here
    focusNode(hash, scrollIntoViewOptions, showAllFunc, hideAllFunc);
}

// setup history navigation
function setupHistoryPopState() {
    window.onpopstate = (event) => {
        let state = event.state;
        if (state === null)
            return;
        let id = state.id;
        if (id !== undefined)
            focusNode(id);
    };
}

function historyFromTo(fromState, to) {
    if (equalRec(history.state, fromState))
        return;

    let fromURL = "#" + fromState.id;
    history.pushState(fromState, "", fromURL);

    if (typeof to === "string")
        history.pushState({ skip: true }, "", to);
    else if (to !== undefined) {
        let toURL = "#" + to.id;
        history.pushState(to, "", toURL);
    }
}

function handleDefaultUpdate(update, thisTabId, showAllFunc, hideAllFunc) {
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

function sleep(timeout) {
    return new Promise((resolve, reject) => setTimeout(resolve, timeout));
}

// this goes here to prevent GC freeing this
let portToExtension;

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

    portToExtension = browser.runtime.connect(extensionId, connectInfo);
    portToExtension.onDisconnect.addListener(async () => {
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

function subscribeToExtension(processUpdate, reinit, isSafe, markLoading, markSettling, extensionId, connectInfo) {
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
            portToExtension.onMessage.addListener(processUpdateSync);
            return;
        }

        // by default, all async events mark the internal state to be
        // inconsistent
        if (isSafe === undefined)
            isSafe = () => false;

        // a flag which remembers if there were any updates while
        // reinit was running asynchronously
        let shouldReset = false;
        function willReset() {
            return shouldReset;
        }
        function processUpdateSmartly(event) {
            shouldReset = shouldReset || !isSafe(event);
            // apparently, this event can be processed synchronously
            processUpdateSync(event);
        }
        portToExtension.onMessage.addListener(processUpdateSmartly);

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
            portToExtension.onMessage.addListener(processUpdateSmartly);

            // run full update
            let done = await reinit(willReset);

            if (done || !shouldReset)
                break;

            // if there were messages in-between, async reinit
            // could have resulted in an inconsistent state, retry in 1s
            console.warn("received some breaking async state updates while doing async page init, the result is probably inconsistent, retrying");

            // stop processing updates
            portToExtension.onMessage.removeListener(processUpdateSmartly);

            if (markSettling !== undefined) {
                clearLoading();
                markSettling();
            }

            await sleep(1000);
        }

        clearLoading();

        // cleanup
        portToExtension.onMessage.removeListener(processUpdateSmartly);
        portToExtension.onMessage.addListener(processUpdateSync);
    }, async () => {
        portToExtension.onMessage.removeListener(processUpdateSync);
    }, extensionId, connectInfo);
}

function subscribeToExtensionSimple(name, showAllFunc, hideAllFunc) {
    return subscribeToExtension(catchAll((update) => handleDefaultUpdate(update, name, showAllFunc, hideAllFunc)));
}

// set values of DOM elements from a given object
function setUI(node, prefix, value, update) {
    let typ = typeof value;

    if (typ === "object" && value !== null) {
        if (update === undefined) {
            for (let k of Object.keys(value)) {
                setUI(node, prefix ? prefix + "." + k : k, value[k]);
            }
        } else {
            for (let k of Object.keys(value)) {
                setUI(node, prefix ? prefix + "." + k : k, value[k], (newvalue, path) => {
                    value[k] = newvalue;
                    update(value, path);
                });
            }
        }
        return;
    }

    let el = node.getElementById(prefix);
    if (el === null)
        return;

    let div = node.getElementById("div-" + prefix);
    if (div !== null) {
        if (div.classList.contains("tristate"))
            typ = "tristate";
        else if (div.classList.contains("omega"))
            typ = "omega";
    }

    //console.log("setting UI", prefix, typ, el, value);

    if (typ === "boolean" && el.tagName === "INPUT" && el.type === "checkbox") {
        el.checked = value;
        if (update !== undefined)
            el.onchange = () => {
                update(el.checked, prefix);
            };
    } else if (typ === "tristate" && el.tagName === "INPUT" && el.type === "checkbox") {
        // emulating tristate using a checkbox:
        // - true -> true,
        // - false -> null,
        // - false + .false class -> false
        el.checked = value === true;
        if (value === false)
            el.classList.add("false");
        if (update !== undefined)
            el.onchange = () => {
                // switch it like this:
                // null -> true -> false -> null
                let nvalue = el.checked;
                if (el.classList.contains("false")) {
                    nvalue = null;
                    el.checked = false;
                    el.classList.remove("false");
                } else if (!nvalue)
                    el.classList.add("false");
                update(nvalue, prefix);
            };
    } else if ((typ === "number" || typ === "string") && el.tagName === "INPUT"
               && (el.type === "number" || el.type === "text" || el.type === "button")) {
        el.value  = value;
        if (update !== undefined && el.type != "button")
            el.onchange = () => {
                let nvalue = el.value;
                if (typ === "number")
                    nvalue = Number(nvalue).valueOf();
                else if (typ === "string")
                    nvalue = String(nvalue).valueOf();
                update(nvalue, prefix);
            };
    } else if (typ === "omega" && el.tagName === "INPUT" && el.type === "number") {
        let checkbox = node.getElementById(prefix + "-omega");
        checkbox.checked = value !== null;
        el.disabled = value === null;
        if (update !== undefined) {
            let onchange = () => {
                let isNull = !checkbox.checked;
                if (isNull)
                    div.classList.add("null");
                else
                    div.classList.remove("null");
                el.disabled = isNull;
                update(isNull ? null : Number(el.value).valueOf(), prefix);
            };
            checkbox.onchange = onchange;
            el.onchange = onchange;
        }
    } else
        el.innerText = value;
}

// given a DOM node, replace <ui> nodes with corresponding UI elements
function makeUI(node) {
    for (let child of node.childNodes) {
        if (child.nodeName === "#text" || child.nodeName === "#comment") continue;
        makeUI(child);
    }

    if (node.tagName !== "UI") return;

    let id = node.getAttribute("id");
    let typ = node.getAttribute("type");
    let tabindex = node.getAttribute("tabindex");
    let defvalue = node.getAttribute("data-default");

    let res = document.createElement("div");
    res.id = "div-" + id;
    // copy other attributes
    for (let attr of node.attributes) {
        let name = attr.name;
        if (name === "id" || name === "tabindex" || name === "data-default") continue;
        res.setAttribute(name, node.getAttribute(name))
    }
    res.classList.add("ui");
    res.classList.add(typ);

    let lbl = document.createElement("label");
    lbl.innerHTML = node.innerHTML.replaceAll("{}", `<span class="placeholder"></span>`);
    let placeholders = lbl.getElementsByClassName("placeholder");

    function mk(tt, sub) {
        let ne = document.createElement("input");
        ne.id = id + sub;
        ne.name = id;
        if (tabindex !== null)
            ne.setAttribute("tabindex", tabindex);

        switch (tt) {
        case "boolean":
            ne.type = "checkbox";
            ne.classList.add("toggle");
            ne.checked = defvalue || false;
            break;
        case "number":
            ne.type = "number";
            ne.value = defvalue || 0;
            break;
        case "string":
            ne.type = "text";
            ne.value = defvalue || "";
            break;
        }

        return ne;
    }

    function place(i, tt, sub) {
        let ne = mk(tt, sub);
        let placeholder = placeholders[i];
        if (placeholder !== undefined)
            lbl.replaceChild(ne, placeholder);
        else if (tt !== "boolean")
            lbl.appendChild(ne);
        else
            lbl.prepend(ne);
        return ne;
    }

    if (typ === "tristate")
        place(0, "boolean", "");
    else if (typ === "omega") {
        place(1, "number", "");
        place(0, "boolean", "-omega");
    } else
        place(0, typ, "");

    res.appendChild(lbl);

    node.parentElement.replaceChild(res, node);
}

// current helpMark and helpDiv
let helpNodes = null;

// hide current tooltip
function hideHelp() {
    if (helpNodes === null) return;

    let [helpMark, helpDiv] = helpNodes;
    helpMark.checked = false;
    helpDiv.style.display = "none";
    helpNodes = null;
}

function helpMarkupToHTML(text) {
    return escapeHTML(text)
        .replaceAll("\n", "<br />")
        .replaceAll(/`([^`]+)`/g, "<code>$1</code>")
    ;
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
    node.innerHTML = helpMarkupToHTML(mapShortcutFunc(node.innerText, shortcut, sname));
}

// given a DOM node, add help tooltips to all its children with data-help attribute
function addHelp(node, shortcuts, mapShortcutFunc, noHide) {
    for (let child of node.childNodes) {
        if (child.nodeName === "#text" || child.nodeName === "#comment") continue;
        addHelp(child, shortcuts, mapShortcutFunc, true);
    }

    if (!noHide)
        node.addEventListener("click", hideHelp);

    let help = node.getAttribute("data-help");
    if (help === null) return;
    let origHelp = help;
    node.removeAttribute("data-help");

    let classes = node.getAttribute("data-help-class");
    if (classes !== null)
        classes = classes.split(" ");
    else
        classes = [];
    node.removeAttribute("data-help-class");

    if (shortcuts !== undefined) {
        let sname = node.getAttribute("data-shortcut");
        if (sname !== null) {
            let shortcut = shortcuts[sname];
            help = mapShortcutFunc(help, shortcut, sname);
        }
    }

    let helpTip = document.createElement("div");
    helpTip.classList.add("help-tip");
    helpTip.setAttribute("data-orig-help", origHelp);
    helpTip.style.display = "none";
    helpTip.innerHTML = helpMarkupToHTML(help);
    helpTip.onclick = hideHelp;

    let helpMark = document.createElement("input");
    helpMark.type = "checkbox";
    helpMark.classList.add("help-btn");
    helpMark.setAttribute("aria-label", "Show help for this element.");
    helpMark.setAttribute("tabindex", -1);

    helpMark.onchange = () => {
        hideHelp();

        if (helpMark.checked) {
            helpTip.style.display = "block";
            helpNodes = [helpMark, helpTip];
        } else
            helpTip.style.display = "none";
    }

    let root = document.createElement("span");
    root.classList.add("help-root");
    for (let c of classes)
        root.classList.add(c);

    node.parentElement.replaceChild(root, node);

    let main = node;
    if (node.tagName === "INPUT") {
        main = document.createElement("span");
        main.classList.add("help-main");
        main.appendChild(node);
    }
    main.setAttribute("title", help);
    main.appendChild(helpMark);
    root.appendChild(main);
    root.appendChild(helpTip);
}
