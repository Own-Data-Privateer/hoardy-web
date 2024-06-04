/*
 * Copyright (c) 2023-2024 Jan Malakhovski <oxij@oxij.org>
 *
 * This file can be distributed under the terms of the GNU GPL, version 3 or later.
 */

"use strict";

function fdate(epoch) {
    if (epoch === undefined)
        return "undefined";
    let str = new Date(epoch).toISOString();
    let pos = str.indexOf(".");
    if (pos != -1)
        str = str.substr(0, pos);
    return str.replace("T", " ");
}

let tabId = getStateTabId(document.location);
if (tabId !== null)
    document.title = `pWebArc: tab ${tabId}: Internal State`;

function switchToDataTabId() {
    let dataTabId = Number(this.getAttribute("data-tabid"));
    browser.tabs.update(dataTabId, { active: true }).catch(logError);
}

function appendReqres(el, reqres) {
    let tr = document.createElement("tr");

    let state = "in_flight";
    let color = "#ffffaa";
    if (reqres.collected === true) {
        state = "collected";
        color = "#aaffaa";
    } else if (reqres.collected === false) {
        state = "discarded";
        color = "#ffaaaa";
    } else if (reqres.picked === true) {
        state = "in_limbo";
        color = "#eeffee";
    } else if (reqres.picked === false) {
        state = "in_limbo";
        color = "#ffeeee";
    }
    tr.setAttribute("style", `background-color: ${color}`);

    function mtr(data) {
        let td = document.createElement("td");
        td.innerText = data;
        tr.appendChild(td);
        return td;
    }

    function mbtn(data) {
        let btn = document.createElement("input");
        btn.type = "button";
        btn.value = data;

        let td = document.createElement("td");
        td.appendChild(btn);
        tr.appendChild(td);
        return btn;
    }

    if (reqres.fromExtension)
        mtr("ext");
    else if (reqres.tabId == -1)
        mtr("bg");
    else {
        let btn = mbtn(`tab #${reqres.tabId}`);
        btn.setAttribute("data-tabid", reqres.tabId.toString());
        btn.onclick = switchToDataTabId.bind(btn);
    }

    mtr((reqres.requestComplete ? "C" : "I")
        + (!reqres.sent || reqres.responseTimeStamp === undefined ? "N"
           : (reqres.statusCode.toString()
              + (reqres.responseComplete ? "C" : "I"))));

    mtr(state
        + (reqres.net_state !== undefined ? " " + reqres.net_state : "")
        + (reqres.redirectUrl !== undefined ? " redirected" : "")
        + (reqres.was_in_limbo === true ? " was_in_limbo" : "")
        + (reqres.problematic === true ? " problematic!" :
           (reqres.was_problematic === true ? " was_problematic" : ""))
       );

    mtr(fdate(reqres.requestTimeStamp));
    mtr(reqres.protocol);
    mtr(reqres.method);
    mtr(reqres.url
        + (reqres.redirectUrl !== undefined ? " -> " + reqres.redirectUrl : "")
       ).className = "long";

    mtr(fdate(reqres.responseTimeStamp));
    mtr(reqres.reason).className = "long";

    el.appendChild(tr);

    if (reqres.errors.length > 0) {
        let etr = document.createElement("tr");
        etr.setAttribute("style", `background-color: ${color}`);
        let etd = document.createElement("td");
        etd.setAttribute("colspan", 2);
        etr.appendChild(etd);

        etd = document.createElement("td");
        etd.setAttribute("colspan", 7);
        etd.setAttribute("title", "errors");
        etd.innerHTML = escapeHTML(reqres.errors.join("\n")).replaceAll("\n", "<br>");
        etr.appendChild(etd);

        el.appendChild(etr);
    }
}

function appendToLog(el, log_data, predicate) {
    for (let reqres of log_data)
        if ((tabId === null || reqres.tabId == tabId) &&
            (predicate === undefined || predicate(reqres)))
            appendReqres(el, reqres);
}

function resetDataNode(id, log_data, predicate) {
    let newtbody = document.createElement("tbody");
    newtbody.id = id;
    appendToLog(newtbody, log_data, predicate);
    let tbody = document.getElementById(id);
    tbody.parentElement.replaceChild(newtbody, tbody);
}

function resetInFlight(log_data) {
    resetDataNode("data_in_flight", log_data);
}

function resetProblematic(log_data) {
    resetDataNode("data_problematic", log_data);
}

function resetInLimbo(log_data) {
    resetDataNode("data_in_limbo", log_data);
}

function resetLog(log_data) {
    resetDataNode("data_log", log_data);
}

async function stateMain() {
    let thisTab = await getActiveTab();
    let thisTabId = thisTab.id;

    // create UI
    for (let el of document.getElementsByTagName("table")) {
        let thead = document.createElement("thead");
        thead.innerHTML = `
<tr>
  <th><span data-help="Source of this reqres: &quot;ext&quot; for reqres produced by extensions, &quot;bg&quot; for reqres produced by background tasks, &quot;tab #N&quot; for reqres produced by the tab with id \`N\`. For tabs the label is a button which switches currently active tab to the tab in question.">Src</span></th>
  <th><span data-help="The \`.status\` this reqres will have in wrrarms: &quot;I&quot; or &quot;C&quot; character (for &quot;Incomplete&quot; and &quot;Complete&quot; respectively) representing the value of \`.request.complete\` flag followed by either &quot;N&quot; (for &quot;No response&quot;) or an HTTP status code (integer, e.g. &quot;200&quot;), followed by &quot;I&quot; or &quot;C&quot; representing the value of \`.response.complete\` flag.">WRR</span></th>
  <th><span data-help="The current reqres \`state\` followed by \`the final networking state\`, followed by &quot;redirected&quot; when this reqres is a redirect, followed by &quot;was_in_limbo&quot; when this reqres was ever in limbo, followed by either &quot;problematic!&quot; when this reqres is marked as problematic or &quot;was_problematic&quot; when this reqres was marked as problematic before (see the Help page for more info).">pWA</span></th>
  <th><span data-help="Timestamp of when the first byte of HTTP request headers was sent.">Request at</span></th>
  <th><span data-help="Protocol/version.">P</span></th>
  <th><span data-help="Protocol method.">M</span></th>
  <th><span data-help="Request URL, followed by &quot; -> &quot; and a redirect URL when this reqres is a redirect.">URL</span></th>
  <th><span data-help="Timestamp of when the first byte of HTTP response headers was received.">Response at</span></th>
  <th><span data-help="HTTP protocol response reason, if any. Note that the HTTP response code is displayed as a part of the &quot;WRR&quot; field.">Reason</span></th>
</tr>
`;
        el.insertBefore(thead, el.firstChild);
        let tfoot = document.createElement("tfoot");
        tfoot.innerHTML = thead.innerHTML;
        el.appendChild(tfoot);
    }

    buttonToAction("forgetHistory", catchAllAsync(() => browser.runtime.sendMessage(["forgetHistory", tabId])));
    buttonToAction("rotateOneProblematic", catchAllAsync(() => browser.runtime.sendMessage(["rotateProblematic", 1, tabId])));
    buttonToAction("unmarkOneProblematic", catchAllAsync(() => browser.runtime.sendMessage(["unmarkProblematic", 1, tabId])));
    buttonToAction("unmarkAllProblematic", catchAllAsync(() => browser.runtime.sendMessage(["unmarkProblematic", null, tabId])));
    buttonToAction("rotateOneInLimbo",  catchAllAsync(() => browser.runtime.sendMessage(["rotateInLimbo", 1, tabId])));
    buttonToAction("discardOneInLimbo", catchAllAsync(() => browser.runtime.sendMessage(["popInLimbo", false, 1, tabId])));
    buttonToAction("discardAllInLimbo", catchAllAsync(() => browser.runtime.sendMessage(["popInLimbo", false, null, tabId])));
    buttonToAction("collectOneInLimbo",   catchAllAsync(() => browser.runtime.sendMessage(["popInLimbo", true, 1, tabId])));
    buttonToAction("collectAllInLimbo",   catchAllAsync(() => browser.runtime.sendMessage(["popInLimbo", true, null, tabId])));
    buttonToAction("stopAllInFlight", catchAllAsync(() => browser.runtime.sendMessage(["stopAllInFlight", tabId])));

    // add help tooltips
    addHelp(document.body, true);

    async function processUpdate(update) {
        let [what, data] = update;
        switch(what) {
        case "resetLog":
            resetLog(data);
            break;
        case "resetProblematicLog":
            resetProblematic(data);
            break;
        case "resetInLimboLog":
            resetInLimbo(data);
            break;
        // incrementally add new rows
        case "newInFlight":
            appendToLog(document.getElementById("data_in_flight"), data);
            break;
        case "newProblematic":
            appendToLog(document.getElementById("data_problematic"), data);
            break;
        case "newLimbo":
            appendToLog(document.getElementById("data_in_limbo"), data);
            browser.runtime.sendMessage(["getInFlightLog"]).then(resetInFlight).catch(logError);
            break;
        case "newLog":
            appendToLog(document.getElementById("data_log"), data);
            if (update[2])
                // it's flesh from in-flight
                browser.runtime.sendMessage(["getInFlightLog"]).then(resetInFlight).catch(logError);
            break;
        default:
            await handleDefaultMessages(update, thisTabId);
        }
    }

    await subscribeToExtension(catchAllAsync(processUpdate), catchAllAsync(async () => {
        await browser.runtime.sendMessage(["getInFlightLog"]).then(resetInFlight);
        await browser.runtime.sendMessage(["getProblematicLog"]).then(resetProblematic);
        await browser.runtime.sendMessage(["getInLimboLog"]).then(resetInLimbo);
        await browser.runtime.sendMessage(["getLog"]).then(resetLog);
    }));

    // show UI
    setPageLoaded();

    // force re-scroll
    viewHashNode();
}

document.addEventListener("DOMContentLoaded", () => stateMain().catch(setPageError), setPageError);
