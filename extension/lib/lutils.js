/*
 * Some utility functions and constants specific to `Hoardy-Web`.
 *
 * This file exists to prevent duplication between the core and the UI
 * parts of `Hoardy-Web`.
 *
 * Copyright (c) 2024 Jan Malakhovski <oxij@oxij.org>
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

// see https://en.wikipedia.org/wiki/HTTP_status_codes
// and https://datatracker.ietf.org/doc/html/rfc9110
let redirectStatusCodes = new Set([301, 302, 303, 307, 308]);
let transientStatusCodes = new Set([
    401, 402, 403, 404, 407, 408, 409,
    412, 416, 418, 421, 423, 424, 425,
    426, 429, 451,
    500, 502, 503, 504, 507, 511,
    // unofficial ones
    419, 440, 450, 495, 496,
    509, 520, 521, 522, 523, 524, 525,
    526, 530, 540, 598, 599,
]);

// for filtering out our own requests, pages, etc
let selfURL = browser.runtime.getURL("/");

function iconPath(name, size) {
    if (useSVGIcons)
        return `/icon/${name}.svg?v=${manifest.version}`;
    else
        return `/icon/${size}/${name}.png?v=${manifest.version}`;
}

function iconURL(name, size) {
    return browser.runtime.getURL(iconPath(name, size));
}

function mkIcons(what) {
    return {
        128: iconPath(what, 128),
    };
}

let stateURL = browser.runtime.getURL("/page/state.html");

function getStateTabIdOrTabId(tab) {
    return getMapURLParam(stateURL, "tab", new URL(getTabURL(tab, "")), toNumber, tab.id, tab.id);
}

function showChangelog(suffix, ...args) {
    return showInternalPageAtNode("/page/changelog.html" + suffix, ...args);
}

function showHelp(suffix, ...args) {
    return showInternalPageAtNode("/page/help.html" + suffix, ...args);
}

function showState(suffix, ...args) {
    return showInternalPageAtNode("/page/state.html" + suffix, ...args);
}

function showSaved(suffix, ...args) {
    return showInternalPageAtNode("/page/saved.html" + suffix, ...args);
}

// a filter for core events that can be ignored without causing inconsistencies
function thisIsFine(event) {
    // it usually isn't, isn't it?
    return false;
}

function setPageLoading() {
    document.getElementById("body_loading").innerHTML = "<p>Loading...</p>";
}

function setPageSettling() {
    document.getElementById("body_loading").innerHTML = "<p>Waiting for the core to settle...</p>";
}

function setPageLoaded() {
    document.getElementById("body_loading").style.display = "none";
    document.getElementById("body").style.display = "block";
}

function setPageError(error) {
    logError(error);

    document.getElementById("body_loading").style.display = "none";

    let be = document.getElementById("body_error");
    be.innerHTML = `
      <h1>This page failed to initialize</h1>
      <div id="body_exception"><h2>Exception</h2></div>
      <h2>To see more details</h2>
      <ul>
        <li>On Firefox-based browser: go to <code>about:debugging#/runtime/this-firefox</code>, click &quot;Inspect&quot; button on &quot;Hoardy-Web&quot;, select &quot;Console&quot;</li>
        <li>On Chromium-based browser: go to <code>chrome://extensions/</code>, click &quot;Inspect views&quot; link on &quot;Hoardy-Web&quot;, select &quot;Console&quot;</li>
      </ul>
    `;
    let p = document.createElement("pre");
    p.innerText = errorMessageOf(error);
    document.getElementById("body_exception").appendChild(p);
    be.style.display = "block";
}

function setRootClasses(config) {
    let dark = config.colors;

    let dnow = new Date();
    let dm = dnow.getMonth() + 1; // JavaScript is ridiculous
    let dd = dnow.getDate();
    let halloween = dm === 10 && dd >= 30 || dm === 11 && dd <= 1 || config.season.halloween === true;
    halloween = halloween && config.seasonal && config.season.halloween !== false;

    if (halloween)
        dark = true;
    else if (dark === null) {
        let dquery = window.matchMedia("(prefers-color-scheme: dark)");
        if (dquery.matches)
            dark = true;
    }

    let droot = getRootNode(document);
    setConditionalClass(droot, "dark", dark);
    setConditionalClass(droot, "light", !dark);
    setConditionalClass(droot, "colorblind", config.colorblind);
    setConditionalClass(droot, "halloween", halloween);

    return droot;
}

function isUnknownError(error) {
    if (useDebugger && (error === "webRequest::net::ERR_ABORTED"
                     || error === "webRequest::net::ERR_CANCELED"
                     || error === "webRequest::net::ERR_FAILED"
                     || error === "webRequest::net::ERR_BLOCKED_BY_CLIENT"
                     || error === "webRequest::net::ERR_CONNECTION_CLOSED"
                     || error === "webRequest::capture::CANCELED::NO_DEBUGGER"
                     || error === "webRequest::capture::EMIT_FORCED::BY_CLOSED_TAB"
                     || error === "webRequest::capture::EMIT_FORCED::BY_DETACHED_DEBUGGER"
                     || error === "webRequest::capture::EMIT_FORCED::BY_USER"
                     || error === "debugger::net::ERR_ABORTED"
                     || error === "debugger::net::ERR_CANCELED"
                     || error === "debugger::net::ERR_FAILED"
                     || error === "debugger::net::ERR_BLOCKED_BY_CLIENT"
                     || error === "debugger::net::ERR_CONNECTION_CLOSED"
                     || error === "debugger::capture::EMIT_FORCED::BY_CLOSED_TAB"
                     || error === "debugger::capture::EMIT_FORCED::BY_DETACHED_DEBUGGER"
                     || error === "debugger::capture::EMIT_FORCED::BY_USER"
                     || error === "debugger::capture::NO_RESPONSE_BODY::DETACHED_DEBUGGER"
                     || error === "debugger::capture::NO_RESPONSE_BODY::ACCESS_DENIED"
                     || error === "debugger::capture::NO_RESPONSE_BODY::OTHER"
                     || error.startsWith("debugger::net::ERR_BLOCKED::")))
        // Chromium
        return false;
    else if (!useDebugger && (error === "webRequest::NS_ERROR_ABORT"
                           || error === "webRequest::NS_BINDING_ABORTED"
                           || error === "webRequest::NS_ERROR_NET_ON_WAITING_FOR"
                           || error === "webRequest::NS_ERROR_NET_ON_RESOLVED"
                           || error === "webRequest::NS_ERROR_UNKNOWN_HOST"
                           || error === "webRequest::NS_ERROR_NET_ON_SENDING_TO"
                           || error === "webRequest::NS_ERROR_NET_PARTIAL_TRANSFER"
                           || error === "webRequest::NS_ERROR_UNEXPECTED"
                           || error === "webRequest::NS_IMAGELIB_ERROR_FAILURE"
                           || error === "webRequest::capture::EMIT_FORCED::BY_CLOSED_TAB"
                           || error === "webRequest::capture::EMIT_FORCED::BY_USER"
                           || error === "filterResponseData::Channel redirected"))
        // Firefox
        return false;
    return true;
}

function isIncompleteError(error) {
    if (!useDebugger && (error === "webRequest::NS_ERROR_ABORT"
                      || error === "webRequest::NS_BINDING_ABORTED"
                      || error === "webRequest::NS_ERROR_NET_ON_SENDING_TO"
                      || error === "webRequest::NS_ERROR_NET_PARTIAL_TRANSFER"
                      || error === "webRequest::NS_ERROR_UNEXPECTED"))
        // Firefox
        return true;
    return false;
}

function isImportantError(error) {
    if (error.startsWith("webRequest::capture::") || error.startsWith("debugger::capture::"))
        return true;
    return false;
}

function isTrivialError(error) {
    if (!useDebugger && error === "filterResponseData::Channel redirected")
        // Firefox
        return true;
    return false;
}

// Merge a given old updatedTabId and a new tabId.
// `null` here means `any`.
function mergeUpdatedTabIds(updatedTabId, tabId) {
    if (tabId === undefined)
        return updatedTabId;
    else if (updatedTabId === undefined)
        return tabId;
    else if (updatedTabId !== tabId)
        return null;
    return tabId;
}

// archival status of a loggable

const archivedViaExportAs = 1;
const archivedViaSubmitHTTP = 2;

function isArchivedVia(loggable, flag) {
    if (loggable.archived === undefined)
        loggable.archived = 0;

    return (loggable.archived & flag) !== 0;
}

// filter expression
let rrfilterDefaults = {
    limit: null,
    picked: null,
    was_problematic: null,
    problematic: null,
    was_in_limbo: null,
    in_limbo: null,
    collected: null,
    no_errors: null,
    did_exportAs: null,
    did_submitHTTP: null,
    in_ls: null,
};

// loggable is accepted by the rrfilter
function isAcceptedBy(rrfilter, loggable) {
    if ((rrfilter.picked !== null && loggable.picked !== rrfilter.picked)
        || (rrfilter.was_problematic !== null && loggable.was_problematic !== rrfilter.was_problematic)
        || (rrfilter.problematic !== null && loggable.problematic !== rrfilter.problematic)
        || (rrfilter.was_in_limbo !== null && loggable.was_in_limbo !== rrfilter.was_in_limbo)
        || (rrfilter.in_limbo !== null && loggable.in_limbo !== rrfilter.in_limbo)
        || (rrfilter.collected !== null && loggable.collected !== rrfilter.collected)
        || (rrfilter.no_errors === false && loggable.errors.length === 0)
        || (rrfilter.no_errors === true && loggable.errors.length > 0)
        || (rrfilter.did_exportAs === false && (loggable.archived & archivedViaExportAs) !== 0)
        || (rrfilter.did_exportAs === true && (loggable.archived & archivedViaExportAs) === 0)
        || (rrfilter.did_submitHTTP === false && (loggable.archived & archivedViaSubmitHTTP) !== 0)
        || (rrfilter.did_submitHTTP === true && (loggable.archived & archivedViaSubmitHTTP) === 0)
        || (rrfilter.in_ls !== null && loggable.inLS !== rrfilter.in_ls))
        return false;
    return true;
}

function annoyingNotification(config, what) {
    if (config.verbose)
        return `\n\nYou can disable this notification by toggling the "${what}" option in the settings.\nYou can also toggle "User Interface and Accessibily > Verbose notifications" there to make this and similar notifications less verbose.`;
    else
        return "";
}
