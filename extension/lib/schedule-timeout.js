/*
 * Copyright (c) 2023-2025 Jan Malakhovski <oxij@oxij.org>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/*
 * A tiny library for scheduling things with `setTimeout`.
 *
 * This implements "tasks", which consist of pre-, main-, and post- functions,
 * which get scheduled with `setTimeout`s, and can be updated later in various
 * ways.
 *
 * The main use case for this is UI updates:
 *
 * - you schedule a UI-updating function `action1` in 1 second, but then 0.5s
 *   later the state changes, and that computation is no longer relevant, so you
 *   want to replace the previous `setTimeout` of `action1`, with a call to
 *   `action2`;
 *
 *   so far `setTimeout` can do this;
 *
 * - but then, while you'l usually want to set the new `setTimeout` for 1 second
 *   again, sometimes you want to set it for leftover 0.5 seconds in the future;
 *
 *   this library can do both (the latter is the `hurry` mode);
 *
 * - but then just as `action2` started to execute, the data was invalidated
 *   again, and the code asked to schedule `action3` instead;
 *
 *   so, now you need to schedule `action3` to be run immediately after
 *   `action2` finishes, and then ask `action2` to stop immediately if possible,
 *   to improve latency;
 *
 *   this library does this transparently for you.
 *
 * Depends on `./base.js`.
 */

"use strict";

// An overridable and 1-chainable task scheduled to execute after a given timeout.
function makeSingletonTimeout(priority, timeout, func) {
    let value = {
        priority: priority,
        task: func,
        when: Date.now() + timeout,
        stop: false,
        results: [],
        before: [],
        after: [],
    };
    value.tid = setTimeout(() => evalSingletonTimeout(value, true), timeout);
    return value;
}

// Create or update singletonTimeout.
// Returns a new `makeSingletonTimeout` if given `value === undefined`.
// Otherwiss, returns `undefined`.
function setSingletonTimeout(value, priority, timeout, func, hurry) {
    if (value !== undefined) {
        let oldPriority = value.priority;
        if (oldPriority < priority)
            // the scheduled/running task has a higher (smaller) priority, do
            // nothing regardless of it executing or not.
            return

        let now = Date.now();
        if (value.tid !== null) {
            // it's not running, cancel it
            clearTimeout(value.tid);
            // hurry it up, meaning, do not move the target execution time
            // any more into the future
            if (hurry)
                timeout = clamp(0, value.when - now, timeout);
        }

        // update the scheduled task
        value.priority = priority;
        value.task = func;
        value.when = now + timeout;

        if (value.tid !== null)
            // re-schedule
            value.tid = setTimeout(() => evalSingletonTimeout(value, true), timeout);
        else if (timeout === 0)
            // ask the running task to stop, if possible
            value.stop = true;

        return;
    }

    return makeSingletonTimeout(priority, timeout, func);
}

// Run a task stored in a given singletonTimeout value.
async function evalSingletonTimeout(value, run) {
    if (value.tid === undefined)
        throw new Error("called evalSingletonTimeout on a finished task");

    if (value.tid === null)
        // already running
        return;

    // mark as running
    value.tid = null;

    await asyncEvalSequence(value.before);

    let first = true;
    while (run) {
        let task = value.task;
        if (task === undefined)
            // all done
            break;

        if (!first) {
            let when = value.when;
            let now = Date.now();
            let ntimeout = when - now;
            if (ntimeout > 0) {
                // this task should not be running yet, re-schedule it
                value.tid = setTimeout(() => evalSingletonTimeout(value, true), ntimeout);
                return;
            }
        }
        first = false;

        // clear
        value.task = undefined;
        value.when = undefined;
        value.stop = false;

        try {
            let res = task(() => { return value.stop; });
            if (res instanceof Promise)
                res = await res;
            value.results.push(res);
        } catch (err) {
            logError(err);
        }
    }

    // cleanup
    value.priority = undefined;
    value.task = undefined;
    value.when = undefined;
    value.stop = true;
    value.tid = undefined;

    await asyncEvalSequence(value.after, value.results);
}

// Immediately run or cancel a given singletonTimeout.
async function emitSingletonTimeout(value, run, synchronous) {
    if (value.tid === undefined)
        // it's already finished
        return;
    else if (value.tid === null) {
        // it is already running
        if (!run)
            // but we don't want it to
            value.stop = true;
        if (synchronous)
            // wait for it to finish
            await new Promise((resolve, reject) => {
                value.after.push(resolve);
            });
    } else {
        // it's not yet running
        clearTimeout(value.tid);
        // eval immediately
        let res = evalSingletonTimeout(value, run);
        if (synchronous)
            await res;
    }
}

// Use a Map as directory for delayed overridable and chainable functions.
function resetSingletonTimeout(map, key, timeout, func, priority, hurry) {
    if (priority === undefined)
        priority = 100;

    let value = map.get(key);
    value = setSingletonTimeout(value, priority, timeout, func, hurry);
    if (value !== undefined) {
        // a newly created one
        value.after.push(() => map.delete(key));
        map.set(key, value);
    }
    return value;
}

async function popSingletonTimeout(map, key, run, synchronous) {
    let value = map.get(key);
    if (value === undefined)
        return;
    await emitSingletonTimeout(value, !!run, !!synchronous);
}

async function runAllSingletonTimeouts(map) {
    for (let key of Array.from(map.keys()))
        await popSingletonTimeout(map, key, true, true);
}

async function cancelAllSingletonTimeouts(map) {
    // quickly cancel all that can be canceled immediately
    for (let key of Array.from(map.keys()))
        await popSingletonTimeout(map, key, false, false);

    // wait for the rest to finish
    for (let key of Array.from(map.keys()))
        await popSingletonTimeout(map, key, false, true);
}
