/*
 * Some utility functions.
 *
 * Copyright (c) 2023-2024 Jan Malakhovski <oxij@oxij.org>
 *
 * This file can be distributed under the terms of the GNU GPL, version 3 or later.
 */

"use strict";

// turn all uncaught exceptions into console.error
function catchAll(func) {
    return (...args) => {
        try {
            return func(...args);
        } catch (exc) {
            console.error("exception in", func, ":", exc);
            console.trace();
        }
    };
}

// same, but for async
function catchAllAsync(func) {
    return async (...args) => {
        try {
            let res = await func(...args);
            return res;
        } catch (exc) {
            console.error("exception in", func, ":", exc);
            console.trace();
        }
    };
}

// `catchAll`, but for use in Promises
function logError(err) {
    console.error("uncaught error", err);
    console.trace();
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
    return tab;
}

// add or remove class based on condition
function setConditionalClass(node, condition, className) {
    if (condition)
        node.classList.add(className);
    else
        node.classList.remove(className);
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

// currently highlighted node
let targetNode = null;

// Highlight DOM node with the given id by adding "target" to its class list.
// It also un-highlights previously highlighted one, if any.
function highlightNode(id) {
    if (targetNode !== null)
        targetNode.classList.remove("target");

    let el = document.getElementById(id);
    if (el !== null) {
        el.classList.add("target");
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        targetNode = el;
    }
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
