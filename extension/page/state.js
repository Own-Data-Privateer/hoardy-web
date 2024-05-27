/*
 * Copyright (c) 2023-2024 Jan Malakhovski <oxij@oxij.org>
 *
 * This file can be distributed under the terms of the GNU GPL, version 3 or later.
 */

"use strict";

function fdate(epoch) {
    if (epoch === undefined)
        return "undefined";
    return new Date(epoch).toISOString();
}

let tabId = getStateTabId(document.location);
if (tabId !== undefined)
    document.title = `pWebArc: tab ${tabId}: Internal State`;

function newReqres(reqres) {
    let tr = document.createElement("tr");

    let color = "#ffffaa";
    if (reqres.taken === true)
        color = "#aaffaa";
    else if (reqres.taken === false)
        color = "#ffaaaa";

    tr.setAttribute("style", `background-color: ${color}`);

    function mtr(data) {
        let td = document.createElement("td");
        td.innerText = data;
        tr.appendChild(td);
        return td;
    }

    if (reqres.state === undefined)
        mtr("tracking");
    else
        mtr((reqres.problematic ? "P!" : "") + reqres.state);

    mtr(fdate(reqres.requestTimeStamp));
    mtr(reqres.method);
    mtr(reqres.url).className = "long";
    if (reqres.fromExtension)
        mtr("extension");
    else
        mtr(`tab ${reqres.tabId}`);
    mtr(reqres.requestComplete);

    mtr(fdate(reqres.responseTimeStamp));
    mtr(reqres.statusCode);
    mtr(reqres.reason);
    mtr(reqres.responseComplete);
    mtr(reqres.protocol);

    return tr;
}

function appendLog(el, log, predicate) {
    for (let reqres of log)
        if ((tabId === undefined || reqres.tabId == tabId) &&
            (predicate === undefined || predicate(reqres)))
            el.appendChild(newReqres(reqres));
}

function resetLog(id, log, predicate) {
    let newtbody = document.createElement("tbody");
    newtbody.id = id;
    appendLog(newtbody, log, predicate);
    let tbody = document.getElementById(id);
    tbody.parentElement.replaceChild(newtbody, tbody);
}

function resetFinished(log) {
    resetLog("finished", log);
}

function resetProblematic(log) {
    resetLog("problematic", log);
}

function resetInLimbo(log) {
    resetLog("in_limbo", log);
}

function resetInFlight(log) {
    resetLog("in_flight", log);
}

document.addEventListener("DOMContentLoaded", catchAll(() => {
    // create UI
    for (let el of document.getElementsByTagName("table")) {
        let thead = document.createElement("thead");
        thead.innerHTML = `
<tr>
  <th>State</th>
  <th>Request started</th>
  <th>Method</th>
  <th>URL</th>
  <th>Origin</th>
  <th><span title="Request body complete">Req</span></th>

  <th>Response started</th>
  <th>Code</th>
  <th>Reason</th>
  <th><span title="Response body complete">Res</span></th>
  <th>Protocol</th>
</tr>
`;
        el.insertBefore(thead, el.firstChild);
    }

    buttonToAction("forgetHistory", () => browser.runtime.sendMessage(["forgetHistory", tabId]));
    buttonToAction("forgetProblematic", () => browser.runtime.sendMessage(["forgetProblematic", tabId]));
    buttonToAction("takeOneInLimbo",    () => browser.runtime.sendMessage(["popInLimbo", true, 1, tabId]));
    buttonToAction("discardOneInLimbo", () => browser.runtime.sendMessage(["popInLimbo", false, 1, tabId]));
    buttonToAction("takeAllInLimbo",    () => browser.runtime.sendMessage(["popInLimbo", true, null, tabId]));
    buttonToAction("discardAllInLimbo", () => browser.runtime.sendMessage(["popInLimbo", false, null, tabId]));
    buttonToAction("stopAllInFlight", () => browser.runtime.sendMessage(["stopAllInFlight", tabId]));

    // add help tooltips
    addHelp(document.body, true);

    // open connection to the background script
    let port = browser.runtime.connect();

    port.onMessage.addListener(catchAll((update) => {
        let [what, data] = update;
        if (what == "resetLog") {
            resetFinished(data);
            return;
        } else if (what == "resetProblematicLog") {
            resetProblematic(data);
            return;
        } else if (what == "resetInLimboLog") {
            resetInLimbo(data);
            return;
        // incrementally add new rows
        } else if (what == "newInFlight") {
            appendLog(document.getElementById("in_flight"), data);
            return;
        } else if (what == "newProblematic") {
            appendLog(document.getElementById("problematic"), data);
            return;
        } else if (what == "newLimbo") {
            appendLog(document.getElementById("in_limbo"), data);
        } else if (what == "newLog") {
            appendLog(document.getElementById("finished"), data);
        } else
            return;
        // reset in-flight
        browser.runtime.sendMessage(["getInFlightLog"]).then(resetInFlight);
    }));

    // meanwhile, get the whole log, render it, and replace the whole
    // page with it
    browser.runtime.sendMessage(["getLog"]).then(resetFinished);
    browser.runtime.sendMessage(["getProblematicLog"]).then(resetProblematic);
    browser.runtime.sendMessage(["getInLimboLog"]).then(resetInLimbo);
    browser.runtime.sendMessage(["getInFlightLog"]).then(resetInFlight);
}));
