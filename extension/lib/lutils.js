/*
 * Some utility functions relevant specifically for pWebArc.
 *
 * Copyright (c) 2024 Jan Malakhovski <oxij@oxij.org>
 *
 * This file can be distributed under the terms of the GNU GPL, version 3 or later.
 */

let redirectStatusCodes = new Set([301, 302, 303, 307, 308]);

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
        if (pendingUrl !== undefined && pendingUrl !== null && pendingUrl !== "")
            return pendingUrl;
    }
    let url = tab.url;
    if (url !== undefined && url !== null && url !== "")
        return url;
    return def;
}

// return mapped ?tab= parameter when the URL is the state page
function mapStateTabId(purl, f, def1, def2) {
    if (purl.origin + purl.pathname == stateURL) {
        let params = new URLSearchParams(purl.search);
        let tabId = params.get("tab");
        if (tabId !== null)
            return f(Number(tabId).valueOf());
        else
            return def1;
    }
    return def2;
}

function getStateTabIdOrTabId(tab) {
    return mapStateTabId(new URL(getTabURL(tab, "")), (x) => x, tab.id, tab.id);
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
                           || error === "webRequest::pWebArc::EMIT_FORCED_BY_USER"
                           || error === "filterResponseData::Channel redirected"))
        // Firefox
        return false;
    return true;
}

function isAbortedError(error) {
    if (!useDebugger && (error === "webRequest::NS_ERROR_ABORT"
                      || error === "webRequest::NS_BINDING_ABORTED"))
        // Firefox
        return true;
    return false;
}

function isProblematicError(error) {
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

// reqres is accepted by the rrfilter
function isAcceptedBy(rrfilter, reqres) {
    if ((rrfilter.picked !== null && reqres.picked !== rrfilter.picked)
        || (rrfilter.was_problematic !== null && reqres.was_problematic !== rrfilter.was_problematic)
        || (rrfilter.problematic !== null && reqres.problematic !== rrfilter.problematic)
        || (rrfilter.was_in_limbo !== null && reqres.was_in_limbo !== rrfilter.was_in_limbo)
        || (rrfilter.in_limbo !== null && reqres.in_limbo !== rrfilter.in_limbo)
        || (rrfilter.collected !== null && reqres.collected !== rrfilter.collected)
        || (rrfilter.no_errors === false && reqres.errors.length == 0)
        || (rrfilter.no_errors === true && reqres.errors.length > 0))
        return false;
    return true;
}
