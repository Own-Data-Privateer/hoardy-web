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
    if (target === undefined)
        return value;

    let typ = typeof value;
    if (typ == "object") {
        for (let [k, v] of Object.entries(value)) {
            target[k] = assignRec(target[k], v);
        }
        return target;
    } else if (typ == "boolean" || typ == "number" || typ == "string") {
        return value;
    } else {
        console.log(typ);
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

    let res;
    let sep = " "; // "<span class=\"sep\"> </span>";

    if (typ == "boolean") {
        let ne = document.createElement("input");
        ne.id = prefix;
        ne.name = prefix;
        ne.type = "checkbox";
        ne.checked = value;
        ne.onchange = () => {
            update(ne.checked);
        }

        res = document.createElement("label");
        res.style.display = "block flow-root";
        res.innerHTML = sep + el.innerHTML;
        res.prepend(ne);
        res = res;
    } else if (typ == "string") {
        let ne = document.createElement("input");
        ne.style.float = "right";
        ne.style.width = `calc(100% - ${el.textContent.length + 2}ch)`;
        ne.id = prefix;
        ne.name = prefix;
        ne.type = "text";
        ne.value = value;
        ne.onchange = () => {
            update(ne.value);
        }

        res = document.createElement("label");
        res.style.display = "block flow-root";
        res.innerHTML = el.innerHTML + sep;
        res.appendChild(ne);
    }

    for (let attr of el.attributes) {
        if (attr.name == "id") continue;
        res.setAttribute(attr.name, el.getAttribute(attr.name))
    }

    el.parentElement.replaceChild(res, el);
}
