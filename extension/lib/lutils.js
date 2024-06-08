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

function getTabURL(tab) {
    let url = tab.url;
    if (useDebugger
        && tab.pendingUrl !== undefined && tab.pendingUrl !== null
        && tab.pendingUrl !== "")
        url = tab.pendingUrl;
    if (url !== undefined && url !== null
        && url !== "")
        return url;
    return null;
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
    return mapStateTabId(new URL(getTabURL(tab) || ""), (x) => x, tab.id, tab.id);
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
                     || error === "debugger::net::ERR_ABORTED"
                     || error === "debugger::net::ERR_CANCELED"
                     || error === "debugger::net::ERR_FAILED"
                     || error === "debugger::net::ERR_BLOCKED_BY_CLIENT"
                     || error === "debugger::net::ERR_CONNECTION_CLOSED"
                     || error === "debugger::pWebArc::EMIT_FORCED_BY_USER"
                     || error === "debugger::pWebArc::EMIT_FORCED_BY_CLOSED_TAB"
                     || error === "debugger::pWebArc::EMIT_FORCED_BY_DETACHED_DEBUGGER"
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

function isProblematicError(error) {
    if (!useDebugger && error === "filterResponseData::Channel redirected")
        // Firefox
        return false;
    return true;
}
