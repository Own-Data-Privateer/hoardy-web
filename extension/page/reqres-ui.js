/*
 * Common parts between `state.js` and `saved.js`.
 *
 * Copyright (c) 2023-2024 Jan Malakhovski <oxij@oxij.org>
 *
 * This file is a part of pwebarc project.
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

"use strict";

let thisSessionId;
let thisTabId;

function switchToDataTabId(dataTabId) {
    return browser.tabs.update(dataTabId, { active: true }).catch(logError);
}

async function showStateOfDataTabId(dataTabId) {
    let tabId = dataTabId;

    let tab = await getActiveTab();
    if (tab !== null)
        tabId = tab.id;

    showState(`?tab=${dataTabId}`, "top", tabId);
}

// caches of `switchToDataTabId` and `showStateOfDataTabId` bound to a
// given argument, for efficiency
let switchFuncMap = new Map();
let showStateFuncMap = new Map();

function appendLoggable(el, loggable) {
    let tr = document.createElement("tr");

    let sparts = [];
    let color;
    if (loggable.collected === true) {
        color = "collected";
        sparts.push("collected");
    } else if (loggable.collected === false) {
        color = "discarded";
        sparts.push("discarded");
    } else if (loggable.picked === true) {
        color = "picked";
        sparts.push("picked");
    } else if (loggable.picked === false) {
        color = "dropped";
        sparts.push("dropped");
    } else {
        color = "in-flight";
        sparts.push("in_flight");
    }
    tr.classList.add(color);

    if (loggable.net_state !== undefined)
        sparts.push(loggable.net_state);
    if (loggable.redirectUrl !== undefined)
        sparts.push("redirected");
    if (loggable.in_limbo === true)
        sparts.push("in_limbo");
    else if (loggable.was_in_limbo === true)
        sparts.push("was_in_limbo");
    if (loggable.problematic === true)
        sparts.push("problematic!");
    else if (loggable.was_problematic === true)
        sparts.push("was_problematic");

    function mn(node, inn, data) {
        let n = document.createElement(inn);
        n.innerText = data;
        node.appendChild(n);
        return n;
    }

    function mtr(data) {
        return mn(tr, "td", data);
    }

    function mbtn(node, data, func) {
        let btn = document.createElement("input");
        btn.type = "button";
        btn.value = data;
        btn.onclick = func;
        node.appendChild(btn);
        return btn;
    }

    let dataSessionId = loggable.sessionId;
    let dataTabId = loggable.tabId;
    let name = loggable.fromExtension ? "ext" : (dataTabId === -1 ? "bg" : `tab #${loggable.tabId}`);
    let td = document.createElement("td");
    let div = document.createElement("div");
    if (dataSessionId === thisSessionId)
        mbtn(div, name,
             cacheSingleton(switchFuncMap, dataTabId, () => switchToDataTabId.bind(undefined, dataTabId)));
    else
        mn(div, "span", `${name} of ${dataSessionId.toString().substr(-3)}`);
    if (tabId === null)
        mbtn(div, "IS",
             cacheSingleton(showStateFuncMap, dataTabId, () => showStateOfDataTabId.bind(undefined, dataTabId)));
    td.appendChild(div);
    tr.appendChild(td);

    mtr(loggable.status);

    mtr(sparts.join(" "));
    mtr(dateToString(loggable.requestTimeStamp));
    mtr(loggable.protocol);
    mtr(loggable.method);
    mtr(loggable.url
        + (loggable.redirectUrl !== undefined ? " -> " + loggable.redirectUrl : "")
       ).className = "long";

    mtr(dateToString(loggable.responseTimeStamp));
    mtr(loggable.reason).className = "long";

    el.appendChild(tr);

    if (loggable.errors.length > 0) {
        let etr = document.createElement("tr");
        etr.classList.add("errors");

        let etd = document.createElement("td");
        etd.setAttribute("colspan", 2);
        etr.appendChild(etd);

        etd = document.createElement("td");
        etd.classList.add(color);
        etd.setAttribute("colspan", 7);
        etd.setAttribute("title", "errors");
        etd.innerHTML = escapeHTML(loggable.errors.join("\n")).replaceAll("\n", "<br>");
        etr.appendChild(etd);

        el.appendChild(etr);
    }
}

function appendToLog(el, log_data, predicate) {
    for (let loggable of log_data) {
        if (loggable === null) {
            let tr = document.createElement("tr");
            tr.innerHTML = `<td colspan=9><span class="flex"><span class="center">...</span></span></td>`;
            el.appendChild(tr);
        } else if ((tabId === null || loggable.tabId == tabId)
                   && (predicate === undefined || predicate(loggable)))
            appendLoggable(el, loggable);
    }
}

function resetDataNode(id, log_data, predicate) {
    let newtbody = document.createElement("tbody");
    newtbody.id = id;
    appendToLog(newtbody, log_data, predicate);
    let tbody = document.getElementById(id);
    tbody.parentElement.replaceChild(newtbody, tbody);
}

const headerHTML = `
<th><span data-help="Source of this reqres: &quot;ext&quot; for reqres produced by extensions, &quot;bg&quot; for reqres produced by background tasks, &quot;tab #N&quot; for reqres produced by the tab with id \`N\`, optionally followed by &quot;of S&quot; where \`S\` is the last three digits of \`.sessionId\`. For tabs of the current session the label is a button which switches currently active tab to the tab in question. If the current page is not narrowed to a tab, then a button labled &quot;IS&quot; follows. That button opens this page narrowed to the tab in question.">Src</span></th>
<th><span data-help="The \`.status\` this reqres will have in wrrarms: &quot;I&quot; or &quot;C&quot; character (for &quot;Incomplete&quot; and &quot;Complete&quot; respectively) representing the value of \`.request.complete\` flag followed by either &quot;N&quot; (for &quot;No response&quot;) or an HTTP status code (integer, e.g. &quot;200&quot;), followed by &quot;I&quot; or &quot;C&quot; representing the value of \`.response.complete\` flag.">WRR</span></th>
<th><span data-help="The current reqres \`state\` followed by \`the final networking state\`, followed by &quot;redirected&quot; when this reqres is a redirect, followed by &quot;was_in_limbo&quot; when this reqres was ever in limbo, followed by either &quot;problematic!&quot; when this reqres is marked as problematic or &quot;was_problematic&quot; when this reqres was marked as problematic before (see the Help page for more info).">pWA</span></th>
<th><span data-help="Timestamp of when the first byte of HTTP request headers was sent.">Request at</span></th>
<th><span data-help="Protocol/version.">P</span></th>
<th><span data-help="Protocol method.">M</span></th>
<th><span data-help="Request URL, followed by &quot; -> &quot; and a redirect URL when this reqres is a redirect.">URL</span></th>
<th><span data-help="Timestamp of when the first byte of HTTP response headers was received.">Response at</span></th>
<th><span data-help="HTTP protocol response reason, if any. Note that the HTTP response code is displayed as a part of the &quot;WRR&quot; field.">Reason</span></th>
`;

async function commonMain() {
    thisSessionId = await browser.runtime.sendMessage(["getSessionId"]);
    let thisTab = await getActiveTab();
    if (thisTab !== null)
        thisTabId = thisTab.id;
    else
        thisTabId = null;

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
