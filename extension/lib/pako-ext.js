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
 * Wrappers over pako.
 */

// Deflate, and then return the compressed or the original imput,
// depending on which is smaller.
function deflateMaybe(input, options, errorHandler) {
    try {
        let compressed = pako.deflate(input, options);
        if (compressed.byteLength < input.byteLength)
            return compressed;
    } catch (err) {
        if (errorHandler !== undefined)
            errorHandler(err);
        else
            throw err;
    }
    return input;
}

// Do the reverse to `deflateMaybe`, checking the input for the GZip header.
function inflateMaybe(input, options, errorHandler) {
    if (input[0] === 31 && input[1] === 139 /* GZip header */) {
        try {
            return pako.inflate(input, options);
        } catch (err) {
            if (errorHandler !== undefined)
                errorHandler(err);
            else
                throw err;
        }
    }
    return input;
}

// `pako.Deflate` which does not fattern the compressed chunks and
// tracks the total size of the result.
class DeflateInChunks extends pako.Deflate {
    constructor (options) {
        super(options);
        this.size = 0;
    }

    onData(chunk) {
        this.chunks.push(chunk);
        this.size += chunk.byteLength;
    }

    onEnd(status) {
        this.err = status;
        this.msg = this.strm.msg;
    }
}

// deflateChunks : [Uint8Array] -> DeflateOptions -> [[Uint8Array], int, int]
function deflateChunks(inputChunks, options) {
    const deflate = new DeflateInChunks(options);
    let inputSize = 0;

    for (let chunk of inputChunks) {
        deflate.push(chunk, false);
        inputSize += chunk.byteLength;
    }
    deflate.push(new Uint8Array([]), true);

    if (deflate.err)
        throw deflate.msg;

    return [deflate.chunks, deflate.size, inputSize];
}

function deflateChunksMaybe(inputChunkss, options, errorHandler) {
    try {
        let [compressedChunks, compressedSize, inputSize] = deflateChunks(inputChunkss, options);
        if (compressedSize < inputSize)
            return compressedChunks;
    } catch (err) {
        if (errorHandler !== undefined)
            errorHandler(err);
        else
            throw err;
    }
    return inputChunks;
}
