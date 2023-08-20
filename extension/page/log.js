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

document.addEventListener("DOMContentLoaded", () => {
    browser.runtime.sendMessage(["getLog"]).then((log) => {
        let tbody = document.getElementById("tbody");
        let tr;

        function mtr(data) {
            let td = document.createElement("td");
            td.innerText = data;
            tr.appendChild(td);
            return td;
        }

        for (let reqres of log) {
            tr = document.createElement("tr");
            mtr(reqres.state);
            mtr(fdate(reqres.requestTimeStamp));
            mtr(fdate(reqres.responseTimeStamp));
            mtr(reqres.protocol);
            mtr(reqres.method);
            mtr(reqres.url).className = "long";
            mtr(reqres.statusCode);
            mtr(reqres.reason);
            if (reqres.fromExtension)
                mtr("extension");
            else
                mtr(`tab ${reqres.tabId}`);
            mtr(reqres.requestComplete);
            mtr(reqres.responseComplete);
            tr.setAttribute("style", `background-color: ${reqres.archiving ? "#aaffaa" : "#ffaaaa"}`);
            tbody.appendChild(tr);
        }
    });
});
