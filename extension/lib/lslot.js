/*
 * Copyright (c) 2024-2025 Jan Malakhovski <oxij@oxij.org>
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
 * Same API as `idbp.js`, but using `browser.storage.local` API instead.
 */

"use strict";

async function storageGetOne(storage, id) {
    let res = await storage.get([id]);
    return res[id];
}

function getFromLocalStorage(id) {
    return storageGetOne(browser.storage.local, id);
}

class LSlotTransaction {
    constructor(storage) {
        this.storage = storage;
        this._toPut = {}; // what needs to be written back
        this._toDelete = new Set(); // what needs to be deleted
    }

    async get(id) {
        if (this._toDelete.has(id)) {
            console.error("trying to `get`", id, "after a `delete`");
            throw new Error("trying to `get` after a `delete`");
        }

        let res = await storageGetOne(this.storage, id);
        return res;
    }

    put(id, data) {
        this._toDelete.delete(id);
        this._toPut[id] = data;
    }

    delete(id) {
        this._toDelete.add(id);
        delete this._toPut[id];
    }

    async commit() {
        await this.storage.set(this._toPut);
        if (this._toDelete.size > 0)
            await this.storage.remove(Array.from(this._toDelete));
    }
}

function lslotMetaIdOf(prefix) {
    return `lsmeta-${prefix}`;
}

function lslotDataIdOf(prefix, slot) {
    return `lsdata-${prefix}-${slot}`;
}

async function lslotGetMeta(get, prefix) {
    let metaid = lslotMetaIdOf(prefix);
    let metaobj = await get(metaid);
    let meta = updateFromRec({ first: 0, next: 0 }, metaobj);
    return [metaid, meta];
}

async function lslotGetSlot(get, prefix, slot) {
    let sid = lslotDataIdOf(prefix, slot);
    let resobj = await get(sid);
    return resobj;
}

async function lslotForEach(get, meta, func) {
    let next = meta.next;
    let end = next + 100;

    let first = meta.first;
    let cur = Math.max(0, first - 100);
    let isFirst = true;

    while (cur < end) {
        let el = await get(cur);
        if (el !== undefined) {
            if (isFirst) {
                first = cur;
                isFirst = false;
            }
            next = cur + 1;
            end = cur + 100;

            try {
                let res = func(el, cur);
                if (res instanceof Promise)
                    await res;
            } catch(err) {
                // widen the range if an error happens
                if (first < meta.first)
                    meta.first = first;
                if (next > meta.next)
                    meta.next = next;
                throw err;
            }
        }
        cur += 1;
    }

    // widen or narrow the range if everything is ok
    meta.first = first;
    meta.next = next;
}

class LSlotObjectStore {
    constructor(transaction, name) {
        this.transaction = transaction;
        this.name = name;
    }

    getMeta() {
        let transaction = this.transaction;
        return lslotGetMeta((id) => transaction.get(id), this.name);
    }

    get(slot) {
        let transaction = this.transaction;
        return lslotGetSlot((id) => transaction.get(id), this.name, slot);
    }

    // find first empty slot
    async findEmptySlot(start) {
        while (true) {
            let sid = lslotDataIdOf(this.name, start);
            let res = await storageGetOne(this.transaction.storage, sid);
            if (res === undefined)
                return [start, sid];
            start += 1;
        }
        //throw new Error("no empty local storage slots are available");
    }

    async put(data, slot) {
        let [metaid, meta] = await this.getMeta();
        if (slot === undefined) {
            let [id, sid] = await this.findEmptySlot(meta.next);
            meta.next = id + 1;
            this.transaction.put(metaid, meta);
            this.transaction.put(sid, data);
            return id;
        } else {
            let sid = lslotDataIdOf(this.name, slot);
            this.transaction.put(sid, data);
            return slot;
        }
    }

    async delete(slot) {
        let sid = lslotDataIdOf(this.name, slot);
        let [metaid, meta] = await this.getMeta();

        if (slot === meta.first) {
            meta.first += 1;
            this.transaction.put(metaid, meta);
        } else if (slot === meta.next - 1) {
            meta.next -= 1;
            this.transaction.put(metaid, meta);
        }

        this.transaction.delete(sid);
    }

    async forEach(func) {
        let [metaid, meta] = await this.getMeta();
        let firstBefore = meta.first;
        let nextBefore = meta.next;

        let transaction = this.transaction;
        let name = this.name;

        try {
            await lslotForEach((slot) => lslotGetSlot((id) => transaction.get(id), name, slot), meta, func);
        } finally {
            if (firstBefore !== meta.first || nextBefore !== meta.next)
                // record the update meta range
                this.transaction.put(metaid, meta);
        }
    }
}

async function lslotTransaction(storage, /* ignored */ mode, names, func) {
    let transaction = new LSlotTransaction(storage);

    let args = [];
    for (let n of names)
        args.push(new LSlotObjectStore(transaction, n));

    let res = await func(transaction, ...args);
    await transaction.commit();
    return res;
}

async function lslotDump() {
    let res = await browser.storage.local.get();
    for (let [k, v] of Object.entries(res)) {
        if (k.startsWith("lsmeta-"))
            console.log("meta", k.substr(7), v);
    }
    for (let [k, v] of Object.entries(res)) {
        if (k.startsWith("lsdata-"))
            console.log("data", k.substr(7), v);
    }
}
