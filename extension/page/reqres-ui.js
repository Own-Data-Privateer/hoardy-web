/*
 * Copyright (c) 2023-2025 Jan Malakhovski <oxij@oxij.org>
 *
 * This file is a part of `hoardy-web` project.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

/*
 * Common parts between `state.js` and `saved.js`.
 */

"use strict";

// current values, to be filled in `commonMain`
let thisSessionId;
let thisTabId;

// this view should be narrowed to, to be filled in a derived page
let narrowSessionId;
let narrowTabId;

function switchToReqresTabId(reqresTabId) {
    return browser.tabs.update(reqresTabId, { active: true }).catch(logError);
}

function showStateOfReqresTabId(reqresSessionId, reqresTabId) {
    let openerTabId = thisTabId !== null ? thisTabId : reqresTabId;
    showState(reqresSessionId, reqresTabId, "top", openerTabId);
}

// caches of `switchToReqresTabId` and `showStateOfReqresTabId` bound to a
// given argument, for efficiency
let switchFuncMap = new Map();
let showStateFuncMap = new Map();

function appendLoggable(node, loggable) {
    let tr = document.createElement("tr");

    let sparts = [loggable.status];
    let color;
    if (loggable.collected === true) {
        color = "collected";
        sparts.push("@collected");
    } else if (loggable.collected === false) {
        color = "discarded";
        sparts.push("@discarded");
    } else if (loggable.picked === true) {
        color = "picked";
        sparts.push("@picked");
    } else if (loggable.picked === false) {
        color = "dropped";
        sparts.push("@dropped");
    } else {
        color = "in-flight";
        sparts.push("@in_flight");
    }

    tr.classList.add(color);

    if (loggable.net_state !== undefined)
        sparts.push("$" + loggable.net_state);
    if (!loggable.requestComplete)
        sparts.push("partial");
    if (!loggable.responseComplete)
        sparts.push("incomplete");
    if (loggable.requestBuggy || loggable.responseBuggy)
        sparts.push("buggy");
    if (loggable.redirectUrl !== undefined)
        sparts.push("redirected");
    if (loggable.problematic === true)
        sparts.push("problematic!");
    else if (loggable.was_problematic === true)
        sparts.push("was_problematic");

    if (loggable.in_limbo === true)
        sparts.push("@in_limbo");
    else if (loggable.was_in_limbo === true)
        sparts.push("was_in_limbo");

    function mn(node, inn, data) {
        let n = document.createElement(inn);
        n.innerText = data;
        node.appendChild(n);
        return n;
    }

    function mtr(data) {
        return mn(tr, "td", data);
    }

    function mbtn(node, value, title, func) {
        let btn = document.createElement("input");
        btn.type = "button";
        btn.value = value;
        btn.title = title;
        btn.onclick = func;
        node.appendChild(btn);
        return btn;
    }

    let reqresSessionId = loggable.sessionId;
    let reqresTabId = loggable.tabId;
    let name = loggable.fromExtension ? "ext" : (reqresTabId === -1 ? "bg" : `tab #${loggable.tabId}`);
    let td = document.createElement("td");
    let div = document.createElement("div");
    if (reqresSessionId === thisSessionId) {
        mbtn(div, name, "Switch to this tab.",
             cacheSingleton(switchFuncMap, reqresTabId, () => switchToReqresTabId.bind(undefined, reqresTabId)));
        if (narrowTabId === null)
            mbtn(div, "T", "Narrow this page to this tab's data.",
                 cacheSingleton(showStateFuncMap, reqresTabId,
                                () => showStateOfReqresTabId.bind(undefined, reqresSessionId, reqresTabId)));
    } else {
        mn(div, "span", `${name} of *${reqresSessionId.toString().substr(-3)}`);
        if (narrowSessionId === null)
            mbtn(div, "S", "Narrow this page to this session's data.",
                 cacheSingleton(showStateFuncMap,
                                reqresSessionId.toString() + ".",
                                () => showStateOfReqresTabId.bind(undefined, reqresSessionId, null)));
        else if (narrowTabId === null)
            mbtn(div, "ST", "Narrow this page to this session and tab's data.",
                 cacheSingleton(showStateFuncMap,
                                reqresSessionId.toString() + "." + reqresTabId.toString(),
                                () => showStateOfReqresTabId.bind(undefined, reqresSessionId, reqresTabId)));
    }
    td.appendChild(div);
    tr.appendChild(td);

    mtr(sparts.join(" "));
    mtr(dateToString(loggable.requestTimeStamp));
    mtr(loggable.protocol);
    mtr(loggable.method);
    mtr(loggable.url
        + (loggable.redirectUrl !== undefined ? " -> " + loggable.redirectUrl : "")
       ).className = "long";

    mtr(dateToString(loggable.responseTimeStamp));
    mtr(loggable.reason).className = "long";
    mtr(byteLengthToString(loggable.dumpSize) + ": " + byteLengthToString(loggable.requestSize) + " + " + byteLengthToString(loggable.responseSize));

    node.appendChild(tr);

    if (loggable.errors.length > 0) {
        let etr = document.createElement("tr");
        etr.classList.add("errors");

        let etd = document.createElement("td");
        etr.appendChild(etd);

        etd = document.createElement("td");
        etd.classList.add(color);
        etd.setAttribute("colspan", 8);
        etd.setAttribute("title", "errors");
        etd.innerHTML = escapeHTML(loggable.errors.join("\n")).replaceAll("\n", "<br>");
        etr.appendChild(etd);

        node.appendChild(etr);
    }
}

function appendToLog(node, log_data, predicate) {
    for (let loggable of log_data) {
        if (loggable === null) {
            let tr = document.createElement("tr");
            tr.innerHTML = `<td colspan=9><span class="flex"><span class="center">...</span></span></td>`;
            node.appendChild(tr);
        } else if (predicate === undefined || predicate(loggable))
            appendLoggable(node, loggable);
    }
}

function resetDataNode(node, log_data, predicate) {
    let newtbody = document.createElement("tbody");
    newtbody.id = node.id;
    appendToLog(newtbody, log_data, predicate);
    node.parentElement.replaceChild(newtbody, node);
}

// Make pair of `resetFunc, appendFunc`
function mkDataNodeUpdater(id, getReqresFilter) {
    return [
        (log_data) => {
            let rrfilter = buildReqresFilter(getReqresFilter());
            resetDataNode(document.getElementById(id), log_data, (loggable) => isAcceptedBy(rrfilter, loggable));
        },
        (log_data) => {
            let rrfilter = buildReqresFilter(getReqresFilter());
            appendToLog(document.getElementById(id), log_data, (loggable) => isAcceptedBy(rrfilter, loggable));
        },
    ];
}

// Generate a record of said functions for every key of given `rrfilter`
function mkDataNodeUpdaters(rrfilters) {
    let res = {};
    for (let k of Object.keys(rrfilters)) {
        let ck = capitalize(k);
        let [reset, append] = mkDataNodeUpdater("data-" + k, () => rrfilters[k]);
        res["reset" + ck] = reset;
        res["append" + ck] = append;
    }
    return res;
}

const headerHTML = `
<th><span data-help="Source of this reqres:

- &quot;ext&quot; for reqres produced by extensions,
- &quot;bg&quot; for reqres produced by background tasks,
- &quot;tab #N&quot; for reqres produced by the tab with id \`N\`, optionally followed by &quot;of *S&quot where \`S\` is the last three digits of reqres' \`sessionId\`.

For reqres belonging to tabs of the current session the label becomes a button which switches currently active tab to the tab in question.

If the current page is not narrowed to a session and the reqres in question belongs to an older session, then a button labled &quot;S&quot; follows. That button opens another state page narrowed to the session in question.

Otherwise, if the current page is not narrowed to a tab, a button labled &quot;T&quot; or &quot;ST&quot; follows. That buton open another state page narrowed to the tab (and session) in question.">Src</span></th>
<th><span data-help="State-related information of this reqres.

The \`status\` uses the same format as \`status\` in \`hoardy-web\`: &quot;I&quot; or &quot;C&quot; character (for &quot;Incomplete&quot; and &quot;Complete&quot; respectively) representing the value of \`request.complete\` followed by either &quot;N&quot; (for &quot;No response&quot;) or an HTTP status code (integer, e.g. &quot;200&quot;) which is followed by &quot;I&quot; or &quot;C&quot; (same as above) representing the value of \`response.complete\`.

After that comes one of &quot;@&quot; symbol prepended to the name of the \`current state\`.

After that comes &quot;$&quot; symbol prepended to the name of the \`final networking state\`.

That can be followed by
- &quot;partial&quot; when this reqres has partial request body (not \`request.complete\`);
- &quot;incomplete&quot; when it has incomplete response body (not \`response.compete\`);
- &quot;buggy&quot; when it has buggy metadata;
- &quot;redirected&quot; when it is a redirect;
- either &quot;problematic!&quot; or &quot;was_problematic&quot; if it is or was marked as \`problematic\`;
- either &quot;@in_limbo&quot; or &quot;was_in_limbo&quot; if it is or was in limbo.

See the \`Help\` page for more info.
">Info</span></th>
<th><span data-help="Timestamp of when the first byte of HTTP request headers was sent.">Request at</span></th>
<th><span data-help="Protocol/version.">P</span></th>
<th><span data-help="Protocol method.">M</span></th>
<th><span data-help="Request URL, followed by &quot; -> &quot; and a redirect URL when this reqres is a redirect.">URL</span></th>
<th><span data-help="Timestamp of when the first byte of HTTP response headers was received.">Response at</span></th>
<th><span data-help="HTTP protocol response reason, if any. Note that the HTTP response code is displayed as a part of the &quot;Info&quot; field.">R</span></th>
<th><span data-help="The (uncompressed) size of the whole WRR dump followed by the (uncompressed) sizes of \`request.body\` and \`response.body\`.

At the moment, the values in this column don't auto-update even when they should. Reload the whole page manually if you want to track changes.">Sizes</span></th>
`;

async function commonMain() {
    let config = await browser.runtime.sendMessage(["getConfig"]);
    setRootClasses(config);

    thisSessionId = await browser.runtime.sendMessage(["getSessionId"]);
    let thisTab = await getActiveTab();
    thisTabId = thisTab !== null ? thisTab.id : null;

    // generate UI
    let body = document.body;
    makeUI(body);

    function firstOrMake(el, tagName, addFunc) {
        let res = el.getElementsByTagName(tagName)[0];
        let created = false;
        if (res === undefined) {
            res = document.createElement(tagName);
            created = true;
        }

        let tr = document.createElement("tr");
        tr.innerHTML = headerHTML;
        res.appendChild(tr);

        if (created)
            addFunc(res);
    }

    for (let el of document.getElementsByTagName("table")) {
        firstOrMake(el, "thead", (thead) => {
            el.insertBefore(thead, el.firstChild);
        });
        firstOrMake(el, "tfoot", (tfoot) => {
            el.appendChild(tfoot);
        });
    }

    addHelp(body);
}
