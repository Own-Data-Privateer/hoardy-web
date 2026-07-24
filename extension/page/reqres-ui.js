/*
 * Copyright (c) 2023-2026 Jan Malakhovski <oxij@oxij.org>
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

let dbody = document.body;
let pbody;

// current values, to be filled in `commonMain`
let thisSessionId;
let thisTabId;

// this view should be narrowed to, to be filled in a derived page
// eslint-disable-next-line no-unassigned-vars
let narrowSessionId;
// eslint-disable-next-line no-unassigned-vars
let narrowWindowId;
// eslint-disable-next-line no-unassigned-vars
let narrowTabId;

function switchToReqresTabId(reqresTabId) {
    return browser.tabs.update(reqresTabId, { active: true }).catch(logError);
}

function showStateOfReqresTabId(reqresSessionId, reqresTabId) {
    let openerTabId = thisTabId !== null ? thisTabId : reqresTabId;
    showState(reqresSessionId, null, reqresTabId, "top", openerTabId);
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

    if (loggable.net_state !== undefined) {
        sparts.push("$" + loggable.net_state);
    }
    if (!loggable.requestComplete) {
        sparts.push("partial");
    }
    if (!loggable.responseComplete) {
        sparts.push("incomplete");
    }
    if (loggable.requestBuggy) {
        sparts.push("buggy_request");
    }
    if (loggable.responseBuggy) {
        sparts.push("buggy_response");
    }
    if (loggable.redirectUrl !== undefined) {
        sparts.push("redirected");
    }
    if (loggable.problematic === true) {
        sparts.push("problematic!");
    } else if (loggable.was_problematic === true) {
        sparts.push("was_problematic");
    }

    if (loggable.in_limbo === true) {
        sparts.push("@in_limbo");
    } else if (loggable.was_in_limbo === true) {
        sparts.push("was_in_limbo");
    }

    let reqresSessionId = loggable.sessionId;
    let reqresTabId = loggable.tabId;
    let name = loggable.fromExtension
        ? "ext"
        : reqresTabId === TAB_ID_NONE
          ? "bg"
          : `tab #${reqresTabId}`;

    let div = document.createElement("div");

    if (reqresSessionId === thisSessionId) {
        appendButton(
            div,
            name,
            "Switch to this tab.",
            cacheSingleton(switchFuncMap, reqresTabId, () =>
                switchToReqresTabId.bind(undefined, reqresTabId),
            ),
        );
        if (narrowTabId === null) {
            appendButton(
                div,
                "T",
                "Narrow this page to this tab's data.",
                cacheSingleton(showStateFuncMap, reqresTabId, () =>
                    showStateOfReqresTabId.bind(undefined, reqresSessionId, reqresTabId),
                ),
            );
        }
    } else {
        appendElements(div, "span", `${name} of *${reqresSessionId.toString().substr(-3)}`);
        if (narrowSessionId === null) {
            appendButton(
                div,
                "S",
                "Narrow this page to this session's data.",
                cacheSingleton(showStateFuncMap, reqresSessionId.toString() + ".", () =>
                    showStateOfReqresTabId.bind(undefined, reqresSessionId, null),
                ),
            );
        } else if (narrowTabId === null) {
            appendButton(
                div,
                "ST",
                "Narrow this page to this session and tab's data.",
                cacheSingleton(
                    showStateFuncMap,
                    reqresSessionId.toString() + "." + reqresTabId.toString(),
                    () => showStateOfReqresTabId.bind(undefined, reqresSessionId, reqresTabId),
                ),
            );
        }
    }

    appendElements(tr, "td", div);
    appendElements(tr, "td", sparts.join(" "));
    appendElements(tr, "td", dateToString(loggable.requestTimeStamp));
    appendElements(tr, "td", loggable.protocol);
    appendElements(tr, "td", loggable.method);
    appendElements(
        tr,
        (e) => {
            e.className = "long";
            return e;
        },
        "td",
        loggable.url + (loggable.redirectUrl !== undefined ? " -> " + loggable.redirectUrl : ""),
    );

    appendElements(tr, "td", dateToString(loggable.responseTimeStamp));
    appendElements(
        tr,
        (e) => {
            e.className = "long";
            return e;
        },
        "td",
        loggable.reason,
    );

    let dumpSize = loggable.dumpSize;
    let requestSize = loggable.requestSize;
    let responseSize = loggable.responseSize;
    let remainder = isDefined(dumpSize, requestSize, responseSize)
        ? dumpSize - requestSize - responseSize
        : undefined;
    appendElements(
        tr,
        "td",
        `${byteLengthToString(dumpSize)} = ${byteLengthToString(requestSize)} + ${byteLengthToString(responseSize)} + ${byteLengthToString(remainder)}`,
    );

    node.append(tr);

    if (loggable.errors.length > 0) {
        appendElements(
            node,
            (e) => {
                e.className = "errors";
                return e;
            },
            "tr",
            [
                [document.createElement("td")],
                [
                    (e) => {
                        e.className = color;
                        e.setAttribute("colspan", 8);
                        e.setAttribute("title", "errors");
                        return e;
                    },
                    "td",
                    loggable.errors.map((err) => {
                        return createElements("pre", "code", err);
                    }),
                ],
            ],
        );
    }
}

function appendToLog(node, log_data, predicate) {
    for (let loggable of log_data) {
        if (loggable === null) {
            appendElements(
                node,
                (e) => {
                    e.setAttribute("colspan", 9);
                    return e;
                },
                "td",
                (e) => {
                    e.className = "flex";
                    return e;
                },
                "span",
                (e) => {
                    e.className = "center";
                    return e;
                },
                "span",
                "...",
            );
        } else if (predicate === undefined || predicate(loggable)) {
            appendLoggable(node, loggable);
        }
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
            let rrpredicate = compileReqresFilter(getReqresFilter())[1];
            resetDataNode(document.getElementById(id), log_data, rrpredicate);
        },
        (log_data) => {
            let rrpredicate = compileReqresFilter(getReqresFilter())[1];
            appendToLog(document.getElementById(id), log_data, rrpredicate);
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

- \`bg\` for reqres produced by background requests,
- \`ext\` for reqres produced by requests made by extensions,
- \`tab #&lt;N&gt;\` for reqres produced by requests of tab with id \`N\`, optionally followed by \`of *&lt;S&gt;\` where \`S\` is the last three digits of reqres' \`sessionId\`.

For reqres belonging to tabs of the current session the label becomes a button which switches currently active tab to the tab in question.

If the current page is not narrowed to a session and the reqres in question belongs to an older session, then a button labled \`S\` follows. That button opens another state page narrowed to the session in question.

Otherwise, if the current page is not narrowed to a tab, a button labled \`T\` or \`ST\` follows. That buton open another state page narrowed to the tab (and session) in question.">Src</span></th>
<th><span data-help="State-related information of this reqres.

The first value uses the same format as \`status\` in \`hoardy-web\`:
- \`I\` or \`C\` character (for &quot;Incomplete&quot; and &quot;Complete&quot; respectively) representing the value of \`request.complete\`,
- followed by either \`N\` (for &quot;No response&quot;) or an HTTP status code (integer, e.g. \`200\`),
- followed by \`I\` or \`C\` (same as above) representing the value of \`response.complete\`.

After that comes \`@\` symbol prepended to the name of the \`current state\` of this reqres.

After that comes \`$\` symbol prepended to the name of the \`final networking state\` of this reqres.

Which can then be followed by
- \`partial\` when this reqres has partial request body (not \`request.complete\`);
- \`incomplete\` when it has incomplete response body (not \`response.compete\`);
- \`buggy_request\` and/or \`buggy_response\` when it has buggy metadata;
- \`redirected\` when it is a redirect;
- either \`problematic!\` or \`was_problematic\` if it is or was previously marked as \`problematic\`;
- either \`@in_limbo\` or \`was_in_limbo\` if it is or was previously in limbo.

See the \`Help\` page for more info.
">Info</span></th>
<th><span data-help="Timestamp of when the first byte of HTTP request headers was sent.">Request at</span></th>
<th><span data-help="Protocol/version.">P</span></th>
<th><span data-help="Protocol method.">M</span></th>
<th><span data-help="Request URL, followed by \` -> \` and a redirect URL when this reqres is a redirect.">URL</span></th>
<th><span data-help="Timestamp of when the first byte of HTTP response headers was received.">Response at</span></th>
<th><span data-help="HTTP protocol response reason, if any. Note that the HTTP response code is displayed as a part of the &quot;Info&quot; field.">R</span></th>
<th><span data-help="The size of the whole WRR dump, followed by &quot;=&quot;, followed by the sum of sizes of \`request.body\`, \`response.body\`, and the remainder.
The reminder is just the first value minus the latter two, it represents the sum of sizes of CBOR-encoded HTTP headers, reqres metadata, and the encoded CBOR structure itself.
All sizes are given for uncompressed data.

At the moment, the values in this column don't auto-update even when they should. Reload the whole page manually if you want to track changes.">Sizes</span></th>
`;

async function commonMain() {
    let config = await browser.runtime.sendMessage(["getConfig"]);
    setRootClasses(config);

    thisSessionId = await browser.runtime.sendMessage(["getSessionId"]);
    let thisTab = await getActiveTab();
    thisTabId = thisTab !== null ? thisTab.id : null;

    pbody = document.getElementById("body");

    // generate UI
    makeUI(pbody);

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

        if (created) {
            addFunc(res);
        }
    }

    for (let el of document.getElementsByTagName("table")) {
        firstOrMake(el, "thead", (thead) => {
            el.insertBefore(thead, el.firstChild);
        });
        firstOrMake(el, "tfoot", (tfoot) => {
            el.appendChild(tfoot);
        });
    }

    addHelp(pbody);
}
