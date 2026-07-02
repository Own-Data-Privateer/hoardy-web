/*
 * Copyright (c) 2023-2026 Jan Malakhovski <oxij@oxij.org>
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
 * - but then, while you'll usually want to set the new `setTimeout` for 1 second
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
        tid: undefined,
        priority,
        task: func,
        when: Date.now() + timeout,
        // NB:
        // - `false` means "run everything normally"
        // - `null` means "continue to run new `task`s, but ask the running `task` to stop gracefully, if possible"
        // - `true` means "stop running new `task`s, ask the running `task` to stop gracefully, if possible"
        wantStop: false,
        results: [],
        delay: [],
        then: [],
    };
    value.tid = setTimeout(() => evalSingletonTimeout(value), timeout);
    return value;
}

// Create or update singletonTimeout.
// Returns a new `makeSingletonTimeout` if given `value === undefined`.
// Otherwiss, returns `undefined`.
function setSingletonTimeout(value, priority, timeout, func, hurry) {
    if (value !== undefined && value.tid !== undefined) {
        // `value` is still valid

        let oldPriority = value.priority;
        if (oldPriority < priority)
            // the scheduled/running task has a higher (smaller) priority, do
            // nothing regardless of it executing or not.
            return;

        let now = Date.now();
        if (value.tid !== null) {
            // it's not yet running, cancel it
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
        value.wantStop = false;

        if (value.tid !== null)
            // re-schedule
            value.tid = setTimeout(() => evalSingletonTimeout(value), timeout);
        else if (timeout === 0)
            // ask the currently running task to stop, if possible, so that `hurry` would produce an
            // effect ASAP
            value.wantStop = null;

        return;
    }

    return makeSingletonTimeout(priority, timeout, func);
}

// Run a task stored in a given singletonTimeout value.
async function evalSingletonTimeout(value) {
    if (value.tid === undefined)
        throw new Error("evalSingletonTimeout: the task is already finished");
    if (value.tid === null)
        throw new Error("evalSingletonTimeout: the task is already running");

    // mark as running
    value.tid = null;

    let first = true;
    let ntimeout = 0;
    while (value.wantStop !== true) {
        let task = value.task;
        if (task === undefined)
            // nothing more to do
            break;

        if (!first) {
            ntimeout = value.when - Date.now();
            if (ntimeout > 0) {
                // the next part should not be running yet
                await asyncAllApply(value.delay, undefined, value.results);
                value.tid = setTimeout(() => evalSingletonTimeout(value), ntimeout);
                return;
            }
        }
        first = false;

        value.task = undefined;
        value.wantStop = false;

        try {
            let res = task(() => { return value.wantStop !== false; });
            while (res instanceof Promise)
                res = await res;
            value.results.push(res);
        } catch (err) {
            logError(err);
        }
    }

    // wipe the `.task` even if it wasn't run
    value.task = undefined;
    // mark it as finished
    value.tid = undefined;

    await asyncAllApply(value.then, undefined, value.results);

    // GC
    value.results = undefined;
    value.delay = undefined;
    value.then = undefined;
}

// Immediately run or cancel a given singletonTimeout.
function emitSingletonTimeout(value, run, wait) {
    if (value.tid === undefined)
        // it's already finished
        return;

    if (!run)
        // ask it to stop
        value.wantStop = true;

    if (value.tid !== null) {
        // it's not running,
        // cancel its `setTimeout`
        clearTimeout(value.tid);
        // and eval immediately
        let res = evalSingletonTimeout(value);
        if (wait)
            return res;
    }

    // it is already running
    if (wait)
        return new Promise((resolve, reject) => {
            value.then.push(resolve);
        });
}

// Use a Map as directory for delayed overridable and chainable functions.
function resetSingletonTimeout(map, key, timeout, func, priority, hurry) {
    if (priority === undefined)
        priority = 100;

    let value = map.get(key);
    value = setSingletonTimeout(value, priority, timeout, func, hurry);
    if (value !== undefined) {
        // a newly created one
        value.then.push(() => map.delete(key));
        map.set(key, value);
    }
    return value;
}

async function popSingletonTimeout(map, key, run, wait) {
    let value = map.get(key);
    if (value === undefined)
        return;
    await emitSingletonTimeout(value, run, wait);
}

async function runAllSingletonTimeouts(map) {
    for (let key of Array.from(map.keys()))
        await popSingletonTimeout(map, key, true, true);
}

async function cancelAllSingletonTimeouts(map) {
    for (let key of Array.from(map.keys()))
        await popSingletonTimeout(map, key, false, true);
}

tests.sheduleTimeout = async () => {
    let res = 0;
    let m = new Map();
    resetSingletonTimeout(m, "a", 1000, () => {
        res = 1;
    });
    await sleep(100);
    resetSingletonTimeout(m, "a", 100, () => {
        res = 2;
    });
    await sleep(1000);

    if (res !== 2)
        throw new Error();

    resetSingletonTimeout(m, "a", 100, () => {
        res = 3;
    });
    popSingletonTimeout(m, "a");
    await sleep(1000);

    if (res !== 2)
        throw new Error();

    resetSingletonTimeout(m, "a", 0, async () => {
        await sleep(1000);
        res = 4;
    });
    await sleep(100);
    await popSingletonTimeout(m, "a", true, true);

    if (res !== 4)
        throw new Error();
}
