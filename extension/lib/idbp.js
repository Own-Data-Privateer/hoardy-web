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
 * A tiny Promise-based wrapper over `window.indexedDB` API.
 */

"use strict";

function idbRequestAsPromise(request) {
    return new Promise((resolve, reject) => {
        request.onerror = (event) => reject(event.target.error);
        request.onsuccess = (event) => resolve(event.target.result);
    });
}

function idbFunctionAsPromise(old, nthis) {
    return (...args) => {
        return idbRequestAsPromise(old.apply(nthis, args));
    };
}

function idbStoreProxyPromise(obj) {
    return {
        count: idbFunctionAsPromise(obj.count, obj),
        get: idbFunctionAsPromise(obj.get, obj),
        getKey: idbFunctionAsPromise(obj.getKey, obj),
        getAll: idbFunctionAsPromise(obj.getAll, obj),
        getAllKeys: idbFunctionAsPromise(obj.getAllKeys, obj),
        add: idbFunctionAsPromise(obj.add, obj),
        put: idbFunctionAsPromise(obj.put, obj),
        delete: idbFunctionAsPromise(obj.delete, obj),

        autoIncrement: obj.autoIncrement,
    };
}

function idbOpen(name, version, upgradeFunc) {
    return new Promise((resolve, reject) => {
        let request = window.indexedDB.open(name, version);
        request.onblocked = (event) => reject("blocked");
        request.onerror = (event) => reject(event.target.error);
        request.onsuccess = (event) => resolve(event.target.result);
        if (upgradeFunc !== undefined)
            request.onupgradeneeded = (event) => {
                let db = event.target.result;
                try {
                    upgradeFunc(db, event.oldVersion, event.newVersion);
                } catch (err) {
                    reject(err);
                    throw new Error("upgradeFunc threw an error, aborting indexdeDB upgrade");
                }
            };
    });
}

function idbDelete(name) {
    return idbRequestAsPromise(window.indexedDB.deleteDatabase(name));
}

function idbTransaction(db, mode, objectStoreNames, func) {
    return new Promise((resolve, reject) => {
        let transaction = db.transaction(objectStoreNames, mode);
        let result;
        let error;
        transaction.onerror = (event) => reject(error !== undefined ? error : event.target.error);
        transaction.oncomplete = (event) => {
            if (result instanceof Promise)
                result.then(resolve, reject);
            else
                resolve(result);
        };
        let args = [];
        for (let n of objectStoreNames)
            args.push(idbStoreProxyPromise(transaction.objectStore(n)));
        try {
            result = func(transaction, ...args);
        } catch (err) {
            error = err;
            transaction.abort();
        }
        if (result instanceof Promise)
            result.catch((err) => {
                error = err;
                transaction.abort();
                throw err;
            });
    });
}

async function idbDump(db) {
    for (let name of db.objectStoreNames) {
        console.log("store", name);
        await idbTransaction(db, "readonly", [name], async (transaction, store) => {
            let keys = await store.getAllKeys();
            console.log(name);
            for (let k of keys) {
                let v = await store.get(k);
                console.log("object", k, v);
            }
        }).catch(logError);
    }
}

async function idbExampleTest() {
    try {
        let db = await idbOpen("test", 1, (db, oldVersion, newVersion) => {
            db.createObjectStore("archive", { autoIncrement: true });
        });
        let res = await idbTransaction(db, "readwrite", ["archive"], async (transaction, archiveStore) => {
            let one = await archiveStore.add({data: "abc"});
            let two = await archiveStore.add({data: new Uint8Array([1, 2, 3])});
            //transaction.abort();
            //throw new Error("bad");
            return [one, two];
        });
        console.log("ok", res);
        db.close();
    } catch(err) {
        logError(err);
    } finally {
        idbDelete("test");
    }
}
