/*
 * Copyright (c) 2023-2025 Jan Malakhovski <oxij@oxij.org>
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

/*
 * Issue accumulators.
 */

"use strict";

function newIssueAcc() {
    return [new Set(), new Map()];
}

function getByReasonMapRecord(byReasonMap, reason) {
    return cacheSingleton(byReasonMap, reason, () => { return {
        recoverable: true,
        queue: [],
        size: 0,
    }; });
}

function pushToByReasonRecord(v, recoverable, archivable) {
    v.when = Date.now();
    v.recoverable = v.recoverable && recoverable;
    v.queue.push(archivable);
    v.size += archivable[0].dumpSize || 0;
}

function pushManyToSetByReasonRecord(set, v, recoverable, archivables) {
    for (let archivable of archivables) {
        set.add(archivable);
        pushToByReasonRecord(v, recoverable, archivable);
    }
}

function pushToByReasonMap(byReasonMap, reason, recoverable, archivable) {
    let v = getByReasonMapRecord(byReasonMap, reason);
    pushToByReasonRecord(v, recoverable, archivable);
    return v;
}

function pushToIssueAcc(accumulator, reason, recoverable, archivable) {
    accumulator[0].add(archivable);
    pushToByReasonMap(accumulator[1], reason, recoverable, archivable);
}
