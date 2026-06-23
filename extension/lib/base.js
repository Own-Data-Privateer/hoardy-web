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

function noop() {}

async function asyncNoop() {}

function isValid(...args) {
    return args.every((x) => x !== undefined && x !== null);
}

function isValidStr(...args) {
    return args.every((x) => x !== undefined && x !== null && x !== "");
}

class StopIteration extends Error {}

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
function catchAll(func, def) {
    return (...args) => {
        let res;
        try {
            res = func(...args);
        } catch (err) {
            logError(err);
            return def;
        }

        if (res instanceof Promise)
            return new Promise((resolve, reject) => res.catch((err) => {
                logError(err);
                return def;
            }).then(resolve));
        else
            return res;
    };
}

let tests = {};

async function runTests(noConsole) {
    let errors = {};

    for (let [k, v] of Object.entries(tests)) {
        try {
            let res = v();
            while (res instanceof Promise)
                res = await res;
            if (!noConsole)
                console.debug("test PASS", k);
        } catch (err) {
            let msg = errorMessageOf(err);
            errors[k] = msg;
            if (!noConsole)
                console.error("test FAIL", k, ":", msg);
        }
    }

    return errors;
}

function evalFunctionsAway(iterable) {
    let res = [];
    for (let e of iterable) {
        if (typeof e !== "function")
            res.push(e);
        else
            res.push(e());
    }
    return res;
}

function asyncAllApply (list, nthis, ...args) {
    return Promise.all(list.map((f) => f.apply(nthis, args)));
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

function capitalize(x) {
    return x.substr(0, 1).toUpperCase() + x.substr(1);
}

function uncapitalize(x) {
    return x.substr(0, 1).toLowerCase() + x.substr(1);
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

// partition an iterable via a predicate, but stop after num elements
function partitionN(predicate, num, iterable) {
    let total = 0;
    let first = [];
    let second = [];
    for (let e of iterable) {
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

// Check if `a` and `b` are equivalent, recursively. The `func` argmument supplies an equivalence
// checking function that will be called for all sub-parts of `a` and `b`, let's name them `x` and
// `y`, respectively, when `x !== y`.
//
// Thus, for example,
//   equivalentRec((x, y) => false, a, b, true)
// is just a recursive version of `a === b`.
function equivalentRec(func, a, b, quick, path) {
    if (a === b)
        return true;

    if (a instanceof Array && b instanceof Array) {
        let al = a.length;
        let bl = b.length;

        if (quick && al !== bl)
            return false;

        let ml = Math.max(a.length, b.length);
        let res = true;

        for (let i = 0; i < ml; ++i) {
            if (!equivalentRec(func, a[i], b[i], quick, path ? path + "." + i.toString() : i.toString())) {
                res = false;
                if (quick)
                    break;
            }
        }

        return res;
    }

    if (a instanceof Object && !(a instanceof Array) &&
        b instanceof Object && !(b instanceof Array)) {
        let ae = Array.from(Object.entries(a));
        let be = Array.from(Object.entries(b));

        if (quick && ae.length !== be.length)
            return false;

        let seen = new Set();
        let res = true;

        for (let [k, v] of ae) {
            seen.add(k);
            if (!equivalentRec(func, v, b[k], quick, path ? path + "." + k.toString() : k.toString())) {
                res = false;
                if (quick)
                    break;
            }
        }

        for (let [k, v] of be) {
            if (seen.has(k))
                continue;
            if (!equivalentRec(func, a[k], v, quick, path ? path + "." + k.toString() : k.toString())) {
                res = false;
                if (quick)
                    break;
            }
        }

        return res;
    }

    return func(a, b, path ? path : "");
}

// Check if `a` and `b` are equial, recursively.
function equalRec(a, b, path) {
    return equivalentRec(() => false, a, b, true, path);
}

function equalRecDiff(a, b, path) {
    let diff = [];
    let res = equivalentRec((a, b, path) => {
        diff.push([path, a, b]);
        return false;
    }, a, b, false, path);
    return [res, diff];
}

function equalRecWarnNeq(a, b, msg, path) {
    let [res, diff] = equalRecDiff(a, b, path);
    if (!res) {
        for (let [k, a, b] of diff)
            console.warn(msg ? msg : "changed", k, ":", a, "->", b);
    }
    return res;
}

tests.equalRec = () => {
    let ls = [undefined, null, true, false, 0, 1, 2, "", "a", [], {}];
    for (let a of ls) {
        for (let b of ls) {
            if (equalRec(a, b) !== (a === b)) {
                console.error("neq id", a, b);
                throw new Error(`neq id`);
            }
        }
    }

    if (!equalRec([], []))
        throw new Error("neq []");

    if (!equalRec({}, {}))
        throw new Error("neq {}");
}

tests.equivalentRec = () => {
    if (!equivalentRec((a, b) => a === 2 && b === 3, [2], [3]))
        throw new Error("neq []1");

    if (!equivalentRec((a, b) => a === 2 && b === 3 || a === undefined && b === 4, [2], [3, 4]))
        throw new Error("neq []2");

    if (!equivalentRec((a, b) => a === 2 && b === 3, {a: 2}, {a: 3}))
        throw new Error("neq {}1");

    if (!equivalentRec((a, b) => a === 2 && b === undefined || a === undefined && b === 3, {a: 2}, {b: 3}))
        throw new Error("neq {}2");
};

// recursively assign fields in target from fields in values, i.e. `assignRec({}, value)` would just
// copy `value`
function assignRec(target, ...values) {
    for (let value of values) {
        if (value === undefined)
            continue;

        if (value === null) {
            target = value;
            continue;
        }

        let typ = typeof value;
        if (typ == "boolean" || typ == "number" || typ == "string" || value instanceof Array) {
            target = value;
            continue;
        }

        if (value instanceof Object) {
            if (target === undefined)
                target = {};
            for (let [k, v] of Object.entries(value))
                target[k] = assignRec(target[k], v);
        } else {
            console.error("assignRec", typ, target, value);
            throw new Error("what?");
        }
    }

    return target;
}

// like `assignRec`, but only updates fields that already exist in the `target` and checks that
// their types match
function updateFromRec(target, ...values) {
    if (target === undefined)
        return target;

    for (let value of values) {
        if (value === undefined)
            continue;

        // treat `null` as a value of any type
        if (target === null || value === null) {
            target = value;
            continue;
        }

        let typ = typeof value;
        if (typeof target !== typ) {
            console.error("updateFromRec", typ, target, value);
            throw new Error(`updateFromRec: ${typ} ${target} ${value}`);
        }

        if (typ == "boolean" || typ == "number" || typ == "string") {
            target = value;
            continue;
        }

        if (value instanceof Object) {
            for (let k of Object.keys(target))
                target[k] = updateFromRec(target[k], value[k]);
        } else {
            console.error("updateFromRec", typ, target, value);
            throw new Error(`updateFromRec: ${typ} ${target} ${value}`);
        }
    }

    return target;
}

function numberToPowerString(n, powers) {
    if (!isValid(n))
        return "?";

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
function getMapURLParam(op, param, url, f, def1, def2) {
    if (url === undefined)
        return def2;
    let purl = url instanceof URL ? url : new URL(url);
    if (purl.origin + purl.pathname !== op)
        return def2;
    let params = new URLSearchParams(purl.search);
    let id = params.get(param);
    if (id === null)
        return def1;
    return f(id);
}

// given a URL, return its HTTP-on-the-wire version
function normalizedURL(url) {
    let nurl = new URL(url);
    nurl.hash = "";
    return nurl.href;
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
    return escapeHTMLTags(
        text
        .replaceAll("&", "&amp;")
        .replaceAll("\"", "&quot;")
        .replaceAll("'", "&#039;")
    );
}

function microMarkdownToHTML(text) {
    return escapeHTML(text)
        .replaceAll("\n", "<br />")
        .replaceAll(/`([^`]+)`/g, "<code>$1</code>")
    ;
}
