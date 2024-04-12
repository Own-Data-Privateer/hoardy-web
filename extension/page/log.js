/*
 * Copyright (c) 2023 Jan Malakhovski <oxij@oxij.org>
 *
 * This file can be distributed under the terms of the GNU GPL, version 3 or later.
 */

"use strict";

function fdate(epoch) {
    if (epoch === undefined)
        return "undefined";
    return new Date(epoch).toISOString();
}

function newReqres(reqres) {
    let tr = document.createElement("tr");
    tr.setAttribute("style", `background-color: ${reqres.archiving ? "#aaffaa" : "#ffaaaa"}`);

    function mtr(data) {
        let td = document.createElement("td");
        td.innerText = data;
        tr.appendChild(td);
        return td;
    }

    mtr(reqres.state);
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

function resetLogTo(log) {
    let newtbody = document.createElement("tbody");
    newtbody.id = "tbody";
    for (let reqres of log)
        newtbody.appendChild(newReqres(reqres));

    let tbody = document.getElementById("tbody");
    tbody.parentElement.replaceChild(newtbody, tbody);
}

document.addEventListener("DOMContentLoaded", catchAll(() => {
    buttonToMessage("clearLog");

    // add help tooltips
    addHelp(document.body, true);

    // open connection to the background script
    let port = browser.runtime.connect();

    port.onMessage.addListener(catchAll((update) => {
        let [what, data] = update;
        if (what == "newReqres") {
            // add new rows on log status message
            let tbody = document.getElementById("tbody");
            tbody.appendChild(newReqres(data));
        } else if (what == "setLog")
            // reset when core says so
            resetLogTo(data);
    }));

    // meanwhile, get the whole log, render it, and replace the whole
    // page with it
    browser.runtime.sendMessage(["getLog"]).then(resetLogTo);
}));
