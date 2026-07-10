/*
 * Copyright (c) 2023-2026 Jan Malakhovski <oxij@oxij.org>
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
 * Utility functions for HTML UI making.
 *
 * Depends on `./base.js` and `./schedule-timeout.js`.
 */

"use strict";

// get document root node
function getRootNode(document) {
    return Array.from(document.children).filter((e) => e.tagName === "HTML")[0];
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

let scrollStartIntoView = { behavior: "smooth", block: "start" };
let scrollCenterIntoView = { behavior: "smooth", block: "center" };
let scrollEndIntoView = { behavior: "smooth", block: "end" };

function viewHTMLNode(el, scrollIntoViewOptions, showAllFunc, hideAllFunc) {
    if (el !== null) {
        if (showAllFunc !== undefined)
            showAllFunc();
        let defopts = el.tagName.startsWith("H") ? scrollStartIntoView : scrollCenterIntoView;
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
let targetNode;

// Highlight DOM node with the given id by adding "target" to its class list.
// It also un-highlights previously highlighted one, if any.
function highlightNode(id) {
    if (targetNode !== undefined)
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

function viewHashNode(scrollIntoViewOptionsFunc, showAllFunc, hideAllFunc) {
    let id = document.location.hash.substr(1);
    let el = id ? document.getElementById(id) : null;
    // no-smooth scrolling by default here
    viewHTMLNode(el, scrollIntoViewOptionsFunc !== undefined ? scrollIntoViewOptionsFunc(id) : undefined, showAllFunc, hideAllFunc);
}

function focusHashNode(scrollIntoViewOptionsFunc, showAllFunc, hideAllFunc) {
    let id = document.location.hash.substr(1);
    // no-smooth scrolling by default here
    focusNode(id, scrollIntoViewOptionsFunc !== undefined ? scrollIntoViewOptionsFunc(id) : undefined, showAllFunc, hideAllFunc);
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

// go from history state `fromState` to url or state `toURLOrState`
function historyFromTo(fromState, toURLOrState) {
    if (equalRec(history.state, fromState))
        return;

    let fromURL = "#" + fromState.id;
    if (history.state !== null
        && typeof history.state === "object"
        && history.state.id !== undefined
        && history.state.id.startsWith("link-"))
        history.replaceState(fromState, "", fromURL);
    else
        history.pushState(fromState, "", fromURL);

    if (typeof toURLOrState === "string")
        history.pushState({ skip: true }, "", toURLOrState);
    else if (toURLOrState !== undefined) {
        let toURL = "#" + toURLOrState.id;
        history.pushState(toURLOrState, "", toURL);
    }
}

// attach function to `onclick` of DOM node with a given id
function buttonToAction(id, action) {
    let el = document.getElementById(id);
    if (el === null)
        throw new Error(`failed to attach an action to button id "${id}"`);
    el.onclick = catchAll(action);
    return el;
}

function createElements(arg, ...args) {
    if (args.length === 0) {
        if (arg instanceof Array) {
            let res = [];
            for (let e of arg)
                res.push(...(createElements(...e)));
            return res;
        } else if (typeof arg === "string")
            return [document.createTextNode(arg)];
        return [arg];
    }

    if (typeof arg === "function")
        return createElements(...args).map(arg);

    let node = document.createElement(arg);
    node.append(...(createElements(...args)));
    return [node];
}

function appendElements(node, ...args) {
    node.append(...(createElements(...args)));
}

function replaceElements(node, ...args) {
    node.replaceChildren(...(createElements(...args)));
}

function createButton(value, title, func) {
    let el = document.createElement("input");
    el.type = "button";
    el.value = value;
    el.title = title;
    el.onclick = func;
    return el;
}

function appendButton(node, ...args) {
    node.append(createButton(...args));
}

// emulating booleanOrNull using a checkbox:
// - true -> checked,
// - null -> !checked,
// - false -> !checked + .false class
function setBooleanOrNull(el, value) {
    el.checked = value === true;
    if (value === false)
        el.classList.add("false");
    else
        el.classList.remove("false");
}

function setNumberOrNull(checkbox, el, value) {
    if (value === null) {
        el.disabled = true;
        checkbox.checked = false;
    } else {
        el.disabled = false;
        el.value = value;
        checkbox.checked = true;
    }
}

let scheduledUI = new Map();

function _mkHandleOnChange(prefix, update, value, getValue, setValue) {
    let cvalue = value;
    return (event, partial) => {
        let nvalue = getValue(event, partial);

        if (nvalue === cvalue)
            return;
        cvalue = nvalue;

        if (setValue !== undefined)
            setValue(nvalue, event, partial);
        update(nvalue, prefix, event.resetting);
    };
}

function _dispatchReset(el) {
    let event = new Event("change");
    event.resetting = true;
    el.dispatchEvent(event);
}

function _mkHandleKeyUp(prefix, timeout, onchange) {
    return (event) => {
        if (event.key === "Enter")
            resetSingletonTimeout(scheduledUI, `update-${prefix}`, 0, () => onchange(event));
        else if (timeout !== 0)
            resetSingletonTimeout(scheduledUI, `update-${prefix}`, timeout, () => onchange(event, true));
    };
}

// set values of DOM elements from a given object
function setUIInternal(node, prefix, value, update, resetAcc) {
    let typ = typeof value;

    if (value !== null && typ === "object") {
        for (let k of Object.keys(value)) {
            setUIInternal(node, prefix ? prefix + "." + k : k, value[k], update !== undefined ? ((newvalue, path) => {
                value[k] = newvalue;
                update(value, path);
            }) : undefined, resetAcc);
        }

        return;
    }

    let el = node.getElementById(prefix);
    if (el === null)
        return;

    let div = node.getElementById("div-" + prefix);
    if (div !== null) {
        if ((value === null || typ === "boolean") && div.classList.contains("booleanOrNull"))
            typ = "booleanOrNull";
        else if ((value === null || typ === "number") && div.classList.contains("numberOrNull"))
            typ = "numberOrNull";
    }

    //console.log("setting UI", prefix, typ, el, value);

    if (el.tagName !== "INPUT") {
        // fallback so that this function could be used to set values of rangom HTML elements
        el.innerText = value;
        return;
    }

    let etyp = el.type;

    if (etyp === "button" && (typ === "number" || typ === "string")) {
        // fallback so that this function could be used to assign button labels
        el.value = value;
        return;
    }

    // actual implementation follows

    switch (typ) {
    case "boolean": {
        if (etyp !== "checkbox")
            break;

        el.checked = value;

        if (update === undefined)
            return;

        el.onchange = _mkHandleOnChange(
            prefix, update,
            value,
            () => el.checked,
        );

        let defvalue = div.getAttribute("data-default");
        defvalue = defvalue === "true";
        resetAcc.push(() => {
            el.checked = defvalue;
            _dispatchReset(el);
        });

        return;
    }

    case "booleanOrNull": {
        if (etyp !== "checkbox")
            break;

        setBooleanOrNull(el, value);

        if (update === undefined)
            return;

        el.onchange = _mkHandleOnChange(
            prefix, update,
            value,
            (event) => {
                if (event.resetting)
                    return el.checked ? true : (el.classList.contains("false") ? false : null);

                // switch it like this: false -> null -> true -> false
                return el.classList.contains("false") ? null : el.checked;
            },
            (nvalue) => setBooleanOrNull(el, nvalue),
        );

        let defvalue = div.getAttribute("data-default");
        defvalue = defvalue === null || defvalue === "null" ? null : defvalue === "true";
        resetAcc.push(() => {
            setBooleanOrNull(el, defvalue);
            _dispatchReset(el);
        });

        return;
    }

    case "number": {
        if (etyp !== "number")
            break;

        el.value = value;

        if (update === undefined)
            return;

        let onchange = _mkHandleOnChange(
            prefix, update,
            value,
            () => Number(el.value).valueOf(),
        );
        el.onchange = onchange;

        let defvalue = div.getAttribute("data-default");
        defvalue = defvalue || "0";
        resetAcc.push(() => {
            el.value = defvalue;
            _dispatchReset(el);
        });

        let timeout = Number(div.getAttribute("timeout")).valueOf();
        el.onkeyup = _mkHandleKeyUp(prefix, timeout, onchange);

        return;
    }

    case "numberOrNull": {
        if (etyp !== "number")
            break;

        let checkbox = node.getElementById(prefix + "-notNull");
        setNumberOrNull(checkbox, el, value);

        if (update === undefined)
            return;

        let onchange = _mkHandleOnChange(
            prefix, update,
            value,
            () => checkbox.checked ? Number(el.value).valueOf() : null,
            (nvalue) => setNumberOrNull(checkbox, el, nvalue),
        );
        checkbox.onchange = onchange;
        el.onchange = onchange;

        let defvalue = div.getAttribute("data-default");
        defvalue = defvalue === null || defvalue === "null" ? null : (defvalue || "0");
        resetAcc.push(() => {
            setNumberOrNull(checkbox, el, defvalue);
            _dispatchReset(el);
        });

        let timeout = Number(div.getAttribute("timeout")).valueOf();
        el.onkeyup = _mkHandleKeyUp(prefix, timeout, onchange);

        return;
    }

    case "string": {
        if (etyp !== "text" && etyp !== "search")
            break;

        el.value = value;

        if (update === undefined)
            return;

        let trim = div.getAttribute("trim") !== null;

        let onchange = _mkHandleOnChange(
            prefix, update,
            value,
            (event, partial) => {
                let nvalue = String(el.value).valueOf();

                if (trim) {
                    nvalue = nvalue.trim();
                    if (!partial)
                        el.value = nvalue;
                }

                return nvalue;
            },
        );
        el.onchange = onchange;

        let defvalue = div.getAttribute("data-default");
        defvalue = defvalue || "";
        resetAcc.push(() => {
            el.value = defvalue;
            _dispatchReset(el);
        });

        let timeout = Number(div.getAttribute("timeout")).valueOf();
        el.onkeyup = _mkHandleKeyUp(prefix, timeout, onchange);

        return;
    }
    }

    throw new Error(`setUI: can't set ${typ} to ${etyp}`);
}

function setUI(node, prefix, value, update) {
    if (update === undefined) {
        setUIInternal(node, prefix, value);
        return noop;
    }

    let resetAcc = [];
    setUIInternal(node, prefix, value, update, resetAcc);
    return () => {
        for (let func of resetAcc)
            func();
    };
}

// setUI, but with recursive updates for when `update` modifies the `value` too
function setUIRec(node, prefix, value, update) {
    if (update === undefined)
        return setUI(node, prefix, value);

    function recUpdate(nvalue, path) {
        update(nvalue, path);
        setUI(node, prefix, nvalue, recUpdate);
    }

    return setUI(node, prefix, value, recUpdate);
}

function createUINodes(typ, id, name, tabindex, defvalue) {
    let el = document.createElement("input");
    el.id = id;
    el.name = name;
    if (isValid(tabindex))
        el.setAttribute("tabindex", tabindex);

    switch (typ) {
    case "boolean":
    case "booleanOrNull":
        el.type = "checkbox";
        el.classList.add("toggle");

        if (typ === "boolean")
            el.checked = defvalue === "true";
        else {
            defvalue = defvalue === null || defvalue === "null" ? null : defvalue === "true";
            setBooleanOrNull(el, defvalue);
        }

        return [el];

    case "number":
    case "numberOrNull":
        el.type = "number";

        if (typ === "number") {
            el.value = defvalue || "0";
            return [el];
        }

        let els = createUINodes("boolean", id + "-notNull", id, tabindex, null);
        els.push(el);

        defvalue = defvalue === null || defvalue === "null" ? null : (defvalue || "0");
        setNumberOrNull(els[0], el, defvalue);
        return els;

    case "string":
    case "search":
        el.type = typ === "string" ? "text" : typ;
        el.value = defvalue || "";
        return [el];
    }

    throw new Error(`createUINodes: unknown node type: ${typ}`);
}

function placeUINodes(node, places, typ, ...args) {
    let els = createUINodes(typ, ...args);
    let elslen = els.length;
    for (let i = 0; i < els.length; ++i) {
        let child = places[i];
        if (child !== undefined)
            node.replaceChild(els[i], child);
        else if (typ.startsWith("boolean"))
            node.prepend(els[i]);
        else
            node.append(els[i]);
    }
}

// given a DOM node, replace <ui> nodes with corresponding UI elements
function makeUI(node) {
    for (let child of node.childNodes) {
        if (child.nodeName === "#text" || child.nodeName === "#comment")
            continue;

        makeUI(child);
    }

    if (node.tagName !== "UI")
        return;

    let id = node.getAttribute("id");
    let typ = node.getAttribute("type");
    let tabindex = node.getAttribute("tabindex");
    let defvalue = node.getAttribute("data-default");

    let div = document.createElement("div");
    div.id = "div-" + id;
    // copy other attributes
    for (let attr of node.attributes) {
        let name = attr.name;
        if (name === "id" || name === "tabindex")
            continue;
        div.setAttribute(name, node.getAttribute(name))
    }
    div.classList.add("genui");
    div.classList.add(typ);

    let lbl = document.createElement("label");
    lbl.innerHTML = node.innerHTML.replaceAll("{}", `<span class="placeholder"></span>`);
    let places = lbl.getElementsByClassName("placeholder");
    placeUINodes(lbl, places, typ, id, id, tabindex, defvalue);
    div.append(lbl);

    node.parentElement.replaceChild(div, node);
}

// current helpMark and helpDiv
let helpNodes;

// hide current tooltip
function hideHelp() {
    if (helpNodes === undefined)
        return;

    let [helpMark, helpDiv] = helpNodes;
    helpMark.checked = false;
    helpDiv.style.display = "none";
    helpNodes = undefined;
}

// given a DOM node, add help tooltips to all its children with data-help attribute
function addHelp(node, shortcuts, mapShortcutFunc, noHide) {
    for (let child of node.childNodes) {
        if (child.nodeName === "#text" || child.nodeName === "#comment")
            continue;

        addHelp(child, shortcuts, mapShortcutFunc, true);
    }

    if (!noHide)
        node.addEventListener("click", hideHelp);

    let origHelp;
    let help = origHelp = node.getAttribute("data-help");

    let shortcut;
    if (shortcuts !== undefined) {
        let sname = node.getAttribute("data-shortcut");
        if (sname !== null)
            shortcut = shortcuts[sname];
    }

    if (shortcut !== undefined)
        help = mapShortcutFunc(help !== null ? help : shortcut.description, shortcut.shortcut);

    if (!isValid(help))
        return;

    node.removeAttribute("data-help");

    let classes = node.getAttribute("data-help-class");
    if (classes !== null)
        classes = classes.split(" ");
    else
        classes = [];
    node.removeAttribute("data-help-class");

    let helpTip = document.createElement("div");
    helpTip.classList.add("help-tip");
    if (origHelp !== null)
        helpTip.setAttribute("data-orig-help", origHelp);
    helpTip.style.display = "none";
    helpTip.innerHTML = microMarkdownToHTML(help);
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
        main.append(node);
    }
    main.setAttribute("title", help);
    main.append(helpMark);
    root.append(main, helpTip);
}

let _classifyLinksNum = 0;

// Classify links under `node` based on their URLs. To get link highlights, run
// `setupHistoryPopState` before running this.
function classifyLinks(node, urlKlasses, setup) {
    if (setup === undefined)
        setup = (link, info) => {
            let klass = info.klass;
            if (klass !== undefined)
                link.classList.add(klass);
            link.onclick = (event) => {
                historyFromTo({ id: info.id });
            };
        };

    for (let link of node.getElementsByTagName("a")) {
        let href = link.href;
        let hashlessUrl = new URL(href);
        let hash = hashlessUrl.hash;
        hashlessUrl.hash = "";
        let hashlessHref = hashlessUrl.href;

        let id = link.id;
        if (!id) {
            link.id = id = `link-${_classifyLinksNum}`;
            _classifyLinksNum += 1;
        }

        let klass;
        for (let [eurl, eklass] of urlKlasses) {
            if (href === eurl || hashlessHref === eurl) {
                // exact match
                klass = eklass;
                break;
            } else if (klass === undefined && hashlessHref.startsWith(eurl)) {
                // otherwise, take the first matching prefix
                klass = eklass;
            }
        }

        setup(link, { klass, id, href, hashlessHref, hash, target: hash.substr(1) });
    }
}

// `classifyLinks` with automaic URL mapping relative to
// `document.location.href`.
function classifyDocumentLinks(node, urlKlasses, setup) {
    return classifyLinks(node, urlKlasses.map((v) => {
        let url = new URL(v[0], document.location.href);
        return [url.href, v[1]]
    }), setup);
}
