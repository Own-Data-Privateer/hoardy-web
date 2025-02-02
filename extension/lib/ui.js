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
 * Utility functions for HTML UI making.
 *
 * Depends on `./base.js`.
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
    el.onclick = action;
    return el;
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
    res.classList.add("genui");
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
        main.appendChild(node);
    }
    main.setAttribute("title", help);
    main.appendChild(helpMark);
    root.appendChild(main);
    root.appendChild(helpTip);
}
