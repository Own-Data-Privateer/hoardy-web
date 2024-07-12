/*
 * Some utility functions and constants specific to pWebArc.
 *
 * This file exists to prevent duplication between the core and the UI
 * parts of pWebArc.
 *
 * Copyright (c) 2024 Jan Malakhovski <oxij@oxij.org>
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
        return `/icon/${name}.svg`;
    else
        return `/icon/${size}/${name}.png`;
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

function getTabURL(tab, def) {
    if (useDebugger) {
        let pendingUrl = tab.pendingUrl;
        if (isDefinedURL(pendingUrl))
            return pendingUrl;
    }
    let url = tab.url;
    if (isDefinedURL(url))
        return url;
    return def;
}

function getStateTabIdOrTabId(tab) {
    return getMapURLParam(stateURL, "tab", new URL(getTabURL(tab, "")), toNumber, tab.id, tab.id);
}

function showChangelog(suffix, id, tabId) {
    return showInternalPageAtNode("/page/changelog.html" + suffix, id, tabId);
}

function showHelp(suffix, id, tabId) {
    return showInternalPageAtNode("/page/help.html" + suffix, id, tabId);
}

function showState(suffix, id, tabId) {
    return showInternalPageAtNode("/page/state.html" + suffix, id, tabId);
}

function setPageLoaded() {
    document.getElementById("body_loading").style.display = "none";
    document.getElementById("body").style.display = "block";
}

function setPageError(error) {
    logError(error);
    document.getElementById("body_loading").style.display = "none";
    document.getElementById("body_error").style.display = "block";
}

function isUnknownError(error) {
    if (useDebugger && (error === "webRequest::net::ERR_ABORTED"
                     || error === "webRequest::net::ERR_CANCELED"
                     || error === "webRequest::net::ERR_FAILED"
                     || error === "webRequest::net::ERR_BLOCKED_BY_CLIENT"
                     || error === "webRequest::net::ERR_CONNECTION_CLOSED"
                     || error === "webRequest::pWebArc::NO_DEBUGGER::CANCELED"
                     || error === "debugger::net::ERR_ABORTED"
                     || error === "debugger::net::ERR_CANCELED"
                     || error === "debugger::net::ERR_FAILED"
                     || error === "debugger::net::ERR_BLOCKED_BY_CLIENT"
                     || error === "debugger::net::ERR_CONNECTION_CLOSED"
                     || error === "debugger::pWebArc::EMIT_FORCED_BY_USER"
                     || error === "debugger::pWebArc::EMIT_FORCED_BY_CLOSED_TAB"
                     || error === "debugger::pWebArc::EMIT_FORCED_BY_DETACHED_DEBUGGER"
                     || error === "debugger::pWebArc::NO_RESPONSE_BODY::DETACHED_DEBUGGER"
                     || error === "debugger::pWebArc::NO_RESPONSE_BODY::ACCESS_DENIED"
                     || error === "debugger::pWebArc::NO_RESPONSE_BODY::OTHER"
                     || error.startsWith("debugger::net::ERR_BLOCKED::")))
        // Chromium
        return false;
    else if (!useDebugger && (error === "webRequest::NS_ERROR_ABORT"
                           || error === "webRequest::NS_BINDING_ABORTED"
                           || error === "webRequest::NS_ERROR_NET_ON_WAITING_FOR"
                           || error === "webRequest::NS_ERROR_NET_ON_RESOLVED"
                           || error === "webRequest::NS_ERROR_UNKNOWN_HOST"
                           || error === "webRequest::NS_ERROR_NET_ON_SENDING_TO"
                           || error === "webRequest::NS_ERROR_UNEXPECTED"
                           || error === "webRequest::NS_IMAGELIB_ERROR_FAILURE"
                           || error === "webRequest::pWebArc::EMIT_FORCED_BY_USER"
                           || error === "filterResponseData::Channel redirected"))
        // Firefox
        return false;
    return true;
}

function isIncompleteError(error) {
    if (!useDebugger && (error === "webRequest::NS_ERROR_ABORT"
                      || error === "webRequest::NS_BINDING_ABORTED"
                      || error === "webRequest::NS_ERROR_NET_ON_SENDING_TO"
                      || error === "webRequest::NS_ERROR_UNEXPECTED"))
        // Firefox
        return true;
    return false;
}

function isImportantError(error) {
    if (error.startsWith("webRequest::pWebArc::") || error.startsWith("debugger::pWebArc::"))
        return true;
    return false;
}

function isNonTrivialError(error) {
    if (!useDebugger && error === "filterResponseData::Channel redirected")
        // Firefox
        return false;
    return true;
}

// filter expression
let rrfilterDefaults = {
    picked: null,
    was_problematic: null,
    problematic: null,
    was_in_limbo: null,
    in_limbo: null,
    collected: null,
    no_errors: null,
};

// loggable is accepted by the rrfilter
function isAcceptedBy(rrfilter, loggable) {
    if ((rrfilter.picked !== null && loggable.picked !== rrfilter.picked)
        || (rrfilter.was_problematic !== null && loggable.was_problematic !== rrfilter.was_problematic)
        || (rrfilter.problematic !== null && loggable.problematic !== rrfilter.problematic)
        || (rrfilter.was_in_limbo !== null && loggable.was_in_limbo !== rrfilter.was_in_limbo)
        || (rrfilter.in_limbo !== null && loggable.in_limbo !== rrfilter.in_limbo)
        || (rrfilter.collected !== null && loggable.collected !== rrfilter.collected)
        || (rrfilter.no_errors === false && loggable.errors.length == 0)
        || (rrfilter.no_errors === true && loggable.errors.length > 0))
        return false;
    return true;
}
