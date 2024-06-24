/*
 * An injected script that does HTML DOM snapshotting.
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

"use strict";

(() => {
    let now = Date.now();
    let errors = [];
    let result = null;
    let ct = document.contentType;

    if (document instanceof HTMLDocument && ct === "text/html"
       || document instanceof XMLDocument && ct === "image/svg+xml") {
        ct = `${ct}; charset=${document.characterSet}`;

        let gotDocType = false;
        let cres = [];
        for (let c of document.childNodes) {
            if (c instanceof DocumentType && c.name === "html") {
                if (gotDocType)
                    errors.push("multiple doctypes");
                gotDocType = true;

                cres.push("<!DOCTYPE html>");
            } else if (c instanceof HTMLHtmlElement)
                cres.push(c.outerHTML);
            else if (c instanceof SVGSVGElement) {
                if (gotDocType)
                    errors.push("multiple doctypes");
                gotDocType = true;

                cres.push(`<?xml version="1.0" encoding="${document.characterSet}" standalone="no"?>`)
                cres.push(c.outerHTML);
            } else
                errors.push(`unknown child element type ${c.toString()}`);
        }

        result = cres.join("\n");
    } else
        errors.push(`snapshotting of frames with \`${ct}\` content type is not implemented`);

    return [now, document.documentURI, document.referrer, document.URL, ct, result, errors];
})();
