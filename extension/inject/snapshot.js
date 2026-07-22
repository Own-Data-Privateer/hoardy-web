/*
 * An injected script that does HTML DOM snapshotting.
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

"use strict";

(() => {
    let now = Date.now();
    let ct = document.contentType;
    let data = null;
    let errors = [];

    if (
        (document instanceof HTMLDocument && ct === "text/html") ||
        (document instanceof XMLDocument && ct === "image/svg+xml")
    ) {
        ct = `${ct}; charset=${document.characterSet}`;

        let ok = true;
        let gotDocType = false;
        let cres = [];

        try {
            for (let c of document.childNodes) {
                if (c instanceof DocumentType && c.name === "html") {
                    if (gotDocType) {
                        errors.push("snapshot::capture::MULTIPLE_DOCTYPES");
                    }
                    gotDocType = true;

                    cres.push("<!DOCTYPE html>");
                } else if (c instanceof Comment) {
                    cres.push(`<!-- ${c.nodeValue.trim()} -->`);
                } else if (c instanceof HTMLHtmlElement) {
                    cres.push(c.outerHTML);
                } else if (c instanceof SVGSVGElement) {
                    if (gotDocType) {
                        errors.push("snapshot::capture::MULTIPLE_DOCTYPES");
                    }
                    gotDocType = true;

                    cres.push(
                        `<?xml version="1.0" encoding="${document.characterSet}" standalone="no"?>`,
                    );
                    cres.push(c.outerHTML);
                } else {
                    console.error("SNAPSHOT: unknown element type:", c.toString());
                    errors.push("snapshot::capture::UNKNOWN_ELEMENT_TYPE");
                    ok = false;
                    break;
                }
            }
        } catch (err) {
            console.error("SNAPSHOT: error:", err);
            errors.push("snapshot::capture::OTHER");
            ok = false;
        }

        if (ok) {
            data = cres.join("\n");
        }
    } else {
        console.error("SNAPSHOT: unknown content type:", ct);
        errors.push("snapshot::capture::UNKNOWN_CONTENT_TYPE");
    }

    return [now, document.referrer, ct, data, errors];
})();
