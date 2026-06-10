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

function newIssueAcc(callback) {
    return [new Set(), new Map(), callback];
}

function getByReasonMapRecord(byReasonMap, reason) {
    return cacheSingleton(byReasonMap, reason, () => { return {
        real: true,
        recoverable: true,
        queue: [],
        size: 0,
    }; });
}

function pushToByReasonRecord(v, real, recoverable, archivable) {
    v.when = Date.now();
    v.real = v.real && real;
    v.recoverable = v.recoverable && recoverable;
    v.queue.push(archivable);
    v.size += archivable[0].dumpSize || 0;
}

function pushManyToSetByReasonRecord(set, v, real, recoverable, archivables) {
    for (let archivable of archivables) {
        set.add(archivable);
        pushToByReasonRecord(v, real, recoverable, archivable);
    }
}

function pushToByReasonMap(byReasonMap, reason, real, recoverable, archivable) {
    let v = getByReasonMapRecord(byReasonMap, reason);
    pushToByReasonRecord(v, real, recoverable, archivable);
    return v;
}

function pushToIssueAcc(accumulator, reason, real, recoverable, archivable) {
    accumulator[0].add(archivable);
    pushToByReasonMap(accumulator[1], reason, real, recoverable, archivable);
    if (accumulator[2] !== undefined)
        accumulator[2](recoverable);
}

function pushToIssueAcc2(accumulator, storeID, reason, real, recoverable, archivable) {
    let m = cacheSingleton(accumulator[1], storeID, () => new Map());
    pushToIssueAcc([accumulator[0], m, accumulator[2]], reason, real, recoverable, archivable);
}

function pushManyToIssueAcc2(accumulator, storeID, reason, real, recoverable, archivables) {
    let byReasonMap = cacheSingleton(accumulator[1], storeID, () => new Map());
    let v = getByReasonMapRecord(byReasonMap, reason);
    pushManyToSetByReasonRecord(accumulator[0], v, real, recoverable, archivables);
    if (accumulator[2] !== undefined)
        accumulator[2](recoverable);
}

function deleteFromIssueAccSet(set, archivables) {
    let toDelete = new Set();
    for (let archivable of archivables) {
        let had = set.delete(archivable);
        if (had)
            toDelete.add(archivable);
    }
    return toDelete;
}

function deleteFromIssueAccMap(map, toDelete) {
    let toCleanup = [];
    for (let [k, v] of map) {
        v.queue = v.queue.filter((archivable) => !toDelete.has(archivable));
        if (v.queue.length === 0)
            toCleanup.push(k);
    }
    for (let k of toCleanup)
        map.delete(k);
}

function deleteFromIssueAcc(accumulator, archivables) {
    let toDelete = deleteFromIssueAccSet(accumulator[0], archivables);
    deleteFromIssueAccMap(accumulator[1], toDelete);
}

function deleteFromIssueAcc2(accumulator, archivables) {
    let toDelete = deleteFromIssueAccSet(accumulator[0], archivables);

    let toCleanup = [];
    for (let [k, v] of accumulator[1]) {
        deleteFromIssueAccMap(v, toDelete);
        if (v.size === 0)
            toCleanup.push(k);
    }
    for (let k of toCleanup)
        accumulator[1].delete(k);
}
