/*
 * Simple CBOR encoder in pure JavaScript.
 *
 * Based on cbor.js <https://github.com/paroga/cbor-js> but a class,
 * encoder-only, supports chunked buffers made of Uint8Array's (for efficiency),
 * and can check for unexpected nulls and undefined values while encoding.
 *
 * Copyright (c) 2023 Jan Malakhovski <oxij@oxij.org>
 * Copyright (c) 2014-2016 Patrick Gansterer <paroga@paroga.com>
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

"use strict";

const pow_2_8 = 256;
const pow_2_12 = 4096;
const pow_2_16 = 65536;
const pow_2_32 = 4294967296;
const pow_2_53 = 9007199254740992;

class ChunkedBuffer extends Array {
    constructor(value) {
        if (value !== undefined) {
            for (let e of value)
                if (!(e instanceof Uint8Array))
                    throw new TypeError("expecting Uint8Array");
            super(value);
        }
        else
            super();
    }

    push(value) {
        if (value instanceof Uint8Array)
            super.push(value);
        else
            throw new TypeError("expecting Uint8Array");
    }

    get byteLength() {
        let length = 0;
        for (let e of this)
            length += e.byteLength;
        return length;
    }
}

class CBOREncoder {
    constructor(value) {
        this.chunks = new ChunkedBuffer();
        this.data = new ArrayBuffer(pow_2_8);
        this.view = new DataView(this.data);
        this.offset = 0;
    }

    ensureHave(length) {
        let currently = this.data.byteLength;
        let need = this.offset + length;

        if (currently >= need) return;

        while (currently < need)
            currently *= 2;

        let newdata = new ArrayBuffer(currently);

        let oldarr = new Uint8Array(this.data);
        let newarr = new Uint8Array(newdata);
        let offset = this.offset;
        for (let i = 0; i < offset; ++i) {
            newarr[i] = oldarr[i];
        }

        this.data = newdata;
        this.view = new DataView(this.data);
    }

    flush(desired) {
        let currently = this.data.byteLength;
        if (desired === undefined)
            desired = currently;

        let offset = this.offset;
        let taken = false;
        if (offset !== 0) {
            if (offset === currently) {
                // if we are flushing the whole buffer, take it as is
                this.chunks.push(new Uint8Array(this.data));
                taken = true;
            } else
                // otherwise, slice off the needed part
                this.chunks.push(new Uint8Array(this.data.slice(0, offset)));
            this.offset = 0;
        }

        if (taken || currently !== desired) {
            // reallocate the buffer
            this.data = new ArrayBuffer(desired);
            this.view = new DataView(this.data);
        }
        // otherwise, reuse the buffer
    }

    writeUint8(value) {
        this.ensureHave(1);
        this.view.setUint8(this.offset, value);
        this.offset += 1;
    }

    writeUint8Array(value) {
        let length = value.length;
        this.ensureHave(length);
        let offset = this.offset;
        for (let i = 0; i < length; ++i)
            this.view.setUint8(offset + i, value[i]);
        this.offset += length;
    }

    dumpUint8Array(value) {
        let offset = this.offset;
        if (offset === 0)
            this.chunks.push(value);
        else if (offset >= pow_2_8 || value.length >= pow_2_12) {
            this.flush(pow_2_8);
            this.chunks.push(value);
        } else
            this.writeUint8Array(value);
    }

    writeUint16(value) {
        this.ensureHave(2);
        this.view.setUint16(this.offset, value);
        this.offset += 2;
    }

    writeUint32(value) {
        this.ensureHave(4);
        this.view.setUint32(this.offset, value);
        this.offset += 4;
    }

    writeUint64(value) {
        let low = value % pow_2_32;
        let high = (value - low) / pow_2_32;
        this.ensureHave(8);
        this.view.setUint32(this.offset, high);
        this.view.setUint32(this.offset + 4, low);
        this.offset += 8;
    }

    writeFloat64(value) {
        this.ensureHave(8);
        this.view.setFloat64(this.offset, value);
        this.offset += 8;
    }

    writeTypeAndLength(type, length) {
        let typ = type << 5;
        if (length < 24) {
            this.writeUint8(typ | length);
        } else if (length < pow_2_8) {
            this.writeUint8(typ | 24);
            this.writeUint8(length);
        } else if (length < pow_2_16) {
            this.writeUint8(typ | 25);
            this.writeUint16(length);
        } else if (length < pow_2_32) {
            this.writeUint8(typ | 26);
            this.writeUint32(length);
        } else {
            this.writeUint8(typ | 27);
            this.writeUint64(length);
        }
    }

    encode(value, limits) {
        if (limits === undefined)
            limits = {
                allowNull: true,
                allowUndefined: true
            };

        //console.log("CBOR encode", typeof value, value);

        if (value === false) {
            this.writeUint8(0xf4);
            return this;
        } else if (value === true) {
            this.writeUint8(0xf5);
            return this;
        } else if (value === null) {
            if (!limits.allowNull)
                throw new Error("trying to encode null")
            this.writeUint8(0xf6);
            return this;
        } else if (value === undefined) {
            if (!limits.allowUndefined)
                throw new Error("trying to encode undefined")
            this.writeUint8(0xf7);
            return this;
        }

        let typ = typeof value;

        if (typ === "number") {
            if (Math.floor(value) === value) {
                if (0 <= value && value <= pow_2_53) {
                    this.writeTypeAndLength(0, value);
                } else if (-pow_2_53 <= value && value < 0) {
                    this.writeTypeAndLength(1, -(value + 1));
                } else
                    throw new TypeError(`can't encode ${value}`);
            } else {
                this.writeUint8(0xfb);
                this.writeFloat64(value);
            }
        } else if (value instanceof Uint8Array) {
            this.writeTypeAndLength(2, value.length);
            this.writeUint8Array(value);
        } else if (value instanceof ChunkedBuffer) {
            // same thing, but given as an array of chunks
            this.writeTypeAndLength(2, value.byteLength);
            for (let e of value)
                this.dumpUint8Array(e);
        } else if (typ === "string") {
            let enc = new TextEncoder("utf-8", { fatal: true });
            let utf8data = enc.encode(value);
            this.writeTypeAndLength(3, utf8data.length);
            this.dumpUint8Array(utf8data);
        } else if (Array.isArray(value)) {
            let length = value.length;
            this.writeTypeAndLength(4, length);
            for (let e of value)
                this.encode(e, limits);
        } else if (value instanceof Map) {
            this.writeTypeAndLength(5, value.size);
            for (let [k, v] of value.entries()) {
                this.encode(k, limits);
                this.encode(v, limits);
            }
        } else if (typ === "object") {
            let keys = Object.keys(value);
            this.writeTypeAndLength(5, keys.length);
            for (let k of keys) {
                this.encode(k, limits);
                this.encode(value[k], limits);
            }
        } else
            throw new TypeError(`can't encode ${value}`);

        return this;
    }

    // return the resulting Uint8Array
    result() {
        this.flush();

        let resbuf = new ArrayBuffer(this.chunks.byteLength);
        let resarr = new Uint8Array(resbuf);

        let resoffset = 0;
        for (let chunk of this.chunks) {
            let length = chunk.byteLength;
            for (let i = 0; i < length; ++i) {
                resarr[resoffset + i] = chunk[i];
            }
            resoffset += length;
        }

        return resarr;
    }
}
