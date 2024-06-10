/*
 * Some utility functions.
 *
 * Copyright (c) 2023-2024 Jan Malakhovski <oxij@oxij.org>
 *
 * This file can be distributed under the terms of the GNU GPL, version 3 or later.
 */

"use strict";

function logError(err) {
    console.error("uncaught error", err);
    console.trace();
}

// turn all uncaught exceptions into console.error
function catchAll(func) {
    return (...args) => {
        try {
            return func(...args);
        } catch (err)
            logError(err);
    };
}

// same, but for async
function catchAllAsync(func) {
    return async (...args) => {
        try {
            let res = await func(...args);
            return res;
        } catch (err)
            logError(err);
    };
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

// recursively assign fields in target from fields in value
// i.e. `assignRec({}, value)` would just copy `value`
function assignRec(target, value) {
    if (value === undefined)
        return target;
    else if (target === undefined)
        return value;

    let typt = typeof target;
    let typ = typeof value;
    if (typt !== typ)
        return value;

    if (typ == "object") {
        for (let [k, v] of Object.entries(value)) {
            target[k] = assignRec(target[k], v);
        }
        return target;
    } else if (typ == "boolean" || typ == "number" || typ == "string") {
        return value;
    } else {
        console.log(typ, value);
        throw new Error("what?");
    }
}

// like `assignRec`, but only updates fields that already exist in target
function updateFromRec(target, value, prefer_original) {
    if (value === undefined)
        return target;
    else if (target === undefined)
        return value;

    let typt = typeof target;
    let typ = typeof value;
    if (typt !== typ) {
        if (prefer_original)
            return target;
        else
            return value;
    }

    if (typ == "object") {
        for (let k of Object.keys(target)) {
            target[k] = updateFromRec(target[k], value[k]);
        }
        return target;
    } else if (typ == "boolean" || typ == "number" || typ == "string") {
        return value;
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

function isLocalURL(url) {
    if (url.startsWith("data:") || url.startsWith("file:"))
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

function escapeHTML(text) {
    return text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
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

// Ask ../background/core.js to broadcast this `data` to all open
// pages belonging to this extension.
function broadcast(data) {
    return browser.runtime.sendMessage(["broadcast", data]);
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
}

// make a DOM node with a given id emit a `browser.runtime.sendMessage` with the same id
function buttonToMessage(id) {
    buttonToAction(id, catchAllAsync(() => browser.runtime.sendMessage([id])));
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

async function showInternalPageAtNode(url, id, tabId, scrollIntoViewOptions) {
    let rurl = browser.runtime.getURL(url + (id ? "#" + id : ""));
    let tab;
    try {
        tab = await openOrActivateTab(rurl, { openerTabId: tabId });
    } catch (e) {
        // in case tabId points to a dead tab
        tab = await openOrActivateTab(rurl);
    }
    if (id !== undefined)
        broadcast(["viewNode", tab.id, id, scrollIntoViewOptions]);
    return tab;
}

// add or remove class based on condition
function setConditionalClass(node, condition, className) {
    if (condition)
        node.classList.add(className);
    else
        node.classList.remove(className);
}

let defaultScrollIntoViewOptions = { behavior: "smooth", block: "center" };

function viewHTMLNode(el, scrollIntoViewOptions, showAllFunc, hideAllFunc) {
    if (el !== null) {
        if (showAllFunc !== undefined)
            showAllFunc();
        el.scrollIntoView(scrollIntoViewOptions ? scrollIntoViewOptions : defaultScrollIntoViewOptions);
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
    viewHTMLNode(el, scrollIntoViewOptions ? scrollIntoViewOptions : { block: "start" }, showAllFunc, hideAllFunc);
}

function focusHashNode(scrollIntoViewOptions, showAllFunc, hideAllFunc) {
    let hash = document.location.hash.substr(1);
    // no-smooth scrolling by default here
    focusNode(hash, scrollIntoViewOptions ? scrollIntoViewOptions : { block: "start" }, showAllFunc, hideAllFunc);
}

function handleDefaultMessages(update, thisTabId, showAllFunc, hideAllFunc) {
    let [what, reqTabId, data1, data2] = update;
    if (reqTabId !== thisTabId)
        return;

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
        viewNode(data1, data2 ? data2 : defaultScrollIntoViewOptions, showAllFunc, hideAllFunc);
        return;
    case "highlightNode":
        highlightNode(data1);
        return;
    case "focusNode":
        focusNode(data1, data2 ? data2 : defaultScrollIntoViewOptions, showAllFunc, hideAllFunc);
        return;
    }
}

// this goes here to prevent Chromium running GC on this
let portToExtension;

// open port
async function subscribeToExtension(processUpdate, refreshFunc, extensionId, connectInfo) {
    // open connection to the core.js script and listen for updates
    portToExtension = browser.runtime.connect(extensionId, connectInfo);
    portToExtension.onMessage.addListener(processUpdate);
    // retry in 1s on disconnect
    portToExtension.onDisconnect.addListener(() => {
        setTimeout(catchAll(() => {
            subscribeToExtension(processUpdate, refreshFunc, extensionId, connectInfo);
        }), 1000);
    });

    // meanwhile, update everything
    if (refreshFunc !== undefined)
        await refreshFunc();
}

function subscribeToExtensionSimple(name, showAllFunc, hideAllFunc) {
    return subscribeToExtension(catchAllAsync((update) => handleDefaultMessages(update, name)));
}

// set values of DOM elements from a given object
function setUI(prefix, value, update) {
    let typ = typeof value;

    if (typ == "object") {
        if (update === undefined) {
            for (let k of Object.keys(value)) {
                setUI(prefix + "." + k, value[k]);
            }
        } else {
            for (let k of Object.keys(value)) {
                setUI(prefix + "." + k, value[k], (newvalue, path) => {
                    value[k] = newvalue;
                    update(value, path);
                });
            }
        }
        return;
    }

    let el = document.getElementById(prefix);
    if (el === null) return;
    //console.log("setting UI", prefix, typ, el, value);

    if (typ == "boolean" && el.tagName == "INPUT" && el.type == "checkbox") {
        el.checked = value;
        if (update !== undefined)
            el.onchange = () => {
                update(el.checked, prefix);
            };
    } else if ((typ == "number" || typ == "string") && el.tagName == "INPUT"
               && (el.type == "number" || el.type == "text" || el.type == "button")) {
        el.value  = value;
        if (update !== undefined && el.type != "button")
            el.onchange = () => {
                let nvalue = el.value;
                if (typ == "number")
                    nvalue = Number(nvalue).valueOf();
                else if (typ == "string")
                    nvalue = String(nvalue).valueOf();
                update(nvalue, prefix);
            };
    } else
        el.innerText = value;
}

// given a DOM node, replace <ui> nodes with corresponding UI elements
function makeUI(node) {
    for (let child of node.childNodes) {
        if (child.nodeName === "#text") continue;
        makeUI(child);
    }

    if (node.tagName !== "UI") return;

    let id = node.getAttribute("id");
    let typ = node.getAttribute("type");

    let res = document.createElement("div");
    res.id = "div-" + id;
    // copy other attributes
    for (let attr of node.attributes) {
        if (attr.name == "id") continue;
        res.setAttribute(attr.name, node.getAttribute(attr.name))
    }
    res.classList.add("ui");
    res.classList.add(typ);

    let sep = " "; // "<span class=\"sep\"> </span>";

    if (typ == "boolean") {
        let ne = document.createElement("input");
        ne.id = id;
        ne.name = id;
        ne.type = "checkbox";
        ne.classList.add("toggle");
        ne.checked = false;

        let lbl = document.createElement("label");
        lbl.innerHTML = sep + node.innerHTML;
        lbl.prepend(ne);
        res.appendChild(lbl);
    } else if (typ == "number" || typ == "string") {
        let ne = document.createElement("input");
        ne.id = id;
        ne.name = id;
        if (typ == "number") {
            ne.type = "number";
            ne.value = 0;
        } else {
            ne.type = "text";
            ne.value = "";
        }

        let lbl = document.createElement("label");
        lbl.innerHTML = node.innerHTML + sep;
        lbl.appendChild(ne);
        res.appendChild(lbl);
    }

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

// given a DOM node, add help tooltips to all its children with data-help attribute
function addHelp(node, attachHide) {
    for (let child of node.childNodes) {
        if (child.nodeName === "#text" || child.nodeName === "#comment") continue;
        addHelp(child);
    }

    if (attachHide === true)
        node.onclick = hideHelp;

    let help = node.getAttribute("data-help");
    if (help === null) return;
    node.removeAttribute("data-help");
    node.setAttribute("data-orig-help", help);
    node.setAttribute("title", help);
    node.classList.add("help-root");

    let helpDiv = document.createElement("div");
    helpDiv.classList.add("help-tip");
    helpDiv.style.display = "none";
    helpDiv.innerHTML = helpMarkupToHTML(help);
    helpDiv.onclick = hideHelp;

    let helpMark = document.createElement("input");
    helpMark.type = "checkbox";
    helpMark.classList.add("help-btn");

    helpMark.onchange = () => {
        hideHelp();

        if (helpMark.checked) {
            helpDiv.style.display = "block";
            helpNodes = [helpMark, helpDiv];
        } else
            helpDiv.style.display = "none";
    }

    node.appendChild(helpMark);
    node.appendChild(helpDiv);
}
