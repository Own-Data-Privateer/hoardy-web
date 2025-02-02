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
 * Some utility functions.
 */

"use strict";

function sleep(timeout) {
    return new Promise((resolve, reject) => setTimeout(resolve, timeout));
}

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

// recursive equality comparison
function equalRec(a, b, diff, prefix) {
    if (a === b)
        return true;

    if (a === undefined && b !== undefined
        || a !== undefined && b === undefined
        || a === null && b !== null
        || a !== null && b === null) {
        if (diff !== undefined)
            diff.push(prefix);
        return false;
    }

    let typ = typeof a;
    if (typ === "boolean" || typ === "number" || typ === "string") {
        if (a !== b) {
            if (diff !== undefined)
                diff.push(prefix);
            return false;
        }
        return true;
    }

    if (a instanceof Array && b instanceof Array) {
        if (a.length !== b.length) {
            if (diff !== undefined)
                diff.push(prefix);
            return false;
        }

        if (diff === undefined)
            return a.every((v, i) => equalRec(v, b[i]));
        else
            return a.every((v, i) => equalRec(v, b[i], diff, prefix ? prefix + "." + i.toString() : i.toString()));
    }

    if (a instanceof Object && b instanceof Object) {
        let ae = Array.from(Object.entries(a));
        let be = Array.from(Object.entries(b));
        if (ae.length !== be.length) {
            if (diff !== undefined)
                diff.push(prefix);
            return false;
        }

        let res = true;
        if (diff === undefined) {
            for (let [k, v] of ae) {
                if (!equalRec(v, b[k])) {
                    res = false;
                    break;
                }
            }
        } else {
            for (let [k, v] of ae) {
                if (!equalRec(v, b[k], diff, prefix ? prefix + "." + k : k))
                    res = false;
            }
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

// given a URL, return its HTTP-on-the-wire version
function normalizedURL(url) {
    let nurl = new URL(url);
    nurl.hash = "";
    return nurl.href;
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

function microMarkdownToHTML(text) {
    return escapeHTML(text)
        .replaceAll("\n", "<br />")
        .replaceAll(/`([^`]+)`/g, "<code>$1</code>")
    ;
}
