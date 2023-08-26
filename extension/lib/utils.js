/*
 * Some utility functions.
 *
 * Copyright (c) 2023 Jan Malakhovski <oxij@oxij.org>
 *
 * This file can be distributed under the terms of the GNU GPL, version 3 or later.
 */

"use strict";

function catchAll(func) {
    return (...args) => {
        try {
            return func(...args);
        } catch (exc) {
            console.log("exception in", func, ":", exc);
        }
    };
}

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

// like assignRec, but only updating existing keys in an Object
function updateFromRec(target, value) {
    if (value === undefined)
        return target;
    else if (target === undefined)
        return value;

    let typt = typeof target;
    let typ = typeof value;
    if (typt !== typ)
        return value;

    if (typ == "object") {
        for (let k of Object.keys(target)) {
            target[k] = updateFromRec(target[k], value[k]);
        }
        return target;
    } else if (typ == "boolean" || typ == "number" || typ == "string") {
        return value;
    } else {
        console.log(typ, value);
        throw new Error("what?");
    }
}

function buttonToAction(id, action) {
    let e = document.getElementById(id);
    e.onclick = action;
}

function buttonToMessage(id) {
    buttonToAction(id, () => browser.runtime.sendMessage([id]));
}

function setUI(prefix, value) {
    let typ = typeof value;

    if (typ == "object") {
        for (let k of Object.keys(value)) {
            setUI(prefix + "." + k, value[k]);
        }
        return;
    }

    let el = document.getElementById(prefix);
    if (el === null) return;
    //console.log("setting UI", prefix, el, value);

    if (typ == "boolean" && el.tagName == "INPUT" && el.type == "checkbox")
        el.checked = value;
    else if (typ == "string" && el.tagName == "INPUT" && el.type == "text")
        el.value  = value;
    else
        el.innerText = value;
}

function makeUI(prefix, value, update) {
    let typ = typeof value;

    if (typ == "object") {
        for (let k of Object.keys(value)) {
            makeUI(prefix + "." + k, value[k], (newvalue) => {
                value[k] = newvalue;
                update(value);
            })
        }
        return;
    }

    let el = document.getElementById(prefix);
    if (el === null || el.tagName !== "UI") return;
    //console.log("making UI", prefix, el, value);

    let res = document.createElement("div");
    res.id = "div-" + prefix;

    let sep = " "; // "<span class=\"sep\"> </span>";

    if (typ == "boolean") {
        let ne = document.createElement("input");
        ne.id = prefix;
        ne.name = prefix;
        ne.type = "checkbox";
        ne.classList.add("toggle");
        ne.checked = value;
        ne.onchange = () => {
            update(ne.checked);
        }

        let lbl = document.createElement("label");
        lbl.innerHTML = sep + el.innerHTML;
        lbl.prepend(ne);
        res.appendChild(lbl);
    } else if (typ == "string") {
        let ne = document.createElement("input");
        ne.style.width = `calc(100% - ${el.textContent.length + 3}ch)`;
        ne.id = prefix;
        ne.name = prefix;
        ne.type = "text";
        ne.value = value;
        ne.onchange = () => {
            update(ne.value);
        }

        let lbl = document.createElement("label");
        lbl.innerHTML = el.innerHTML + sep;
        lbl.appendChild(ne);
        res.appendChild(lbl);
    }

    for (let attr of el.attributes) {
        if (attr.name == "id") continue;
        res.setAttribute(attr.name, el.getAttribute(attr.name))
    }

    el.parentElement.replaceChild(res, el);
}

let targetNode = null;
function highlightNode(target) {
    if (targetNode !== null) {
        targetNode.classList.remove("target");
    }

    let el = document.getElementById(target);
    if (el !== null) {
        el.classList.add("target");
        el.scrollIntoView();
        targetNode = el;
    }
}

let helpNodes = null;
function addHelp(node) {
    for (let child of node.childNodes) {
        if (child.nodeName === "#text") continue;
        addHelp(child);
    }

    let help = node.getAttribute("data-help");
    if (help === null) return;

    let div = document.createElement("div");
    div.classList.add("help");
    div.style.display = "none";
    div.innerText = help;

    let el = document.createElement("input");
    el.type = "checkbox";
    el.classList.add("help");
    el.setAttribute("data-help", help);

    function unset(el, div) {
        el.checked = false;
        div.style.display = "none";
        helpNodes = null;
    }

    div.onclick = () => unset(el, div);

    el.onchange = () => {
        if (helpNodes !== null) {
            let [nel, ndiv] = helpNodes;
            unset(nel, ndiv);
        }

        if (el.checked) {
            div.style.display = "block";
            helpNodes = [el, div];
        } else
            div.style.display = "none";
    }

    node.appendChild(el);
    node.appendChild(div);
}
