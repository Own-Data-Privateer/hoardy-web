#!/usr/bin/env python3

# A very simple archiving server for pWebArc.
#
# Copyright (c) 2023 Jan Malakhovski <oxij@oxij.org>
#
# This file can be distributed under the terms of the GNU GPL, version 3 or later.

import argparse
import gzip
import io
import os
import sys
import threading
import time

from wsgiref.validate import validator
from wsgiref.simple_server import make_server

try:
    import cbor2
except ImportError:
    cbor2 = None

class HTTPDumpServer(threading.Thread):
    """HTTP server that accepts HTTP dumps as POST data, tries to compresses them
       with gzip, and saves them in a given directory.

       This runs in a separate thread so that KeyboardInterrupt and such
       would not interrupt a dump in the middle.
    """

    def __init__(self, host, port, root, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.httpd = make_server(host, port, validator(self.handle_request))
        self.root = root
        self.prevsec = 0
        self.num = 0
        print(f"Listening on {host} port {port}....")

    def run(self):
        self.httpd.serve_forever()

    def stop(self):
        self.httpd.shutdown()

    def handle_request(self, environ, start_response):
        def end_with(explanation, more):
            start_response(explanation, [("Content-type", "text/plain; charset=utf-8")])
            yield more

        method = environ["REQUEST_METHOD"]
        path = environ["PATH_INFO"]

        if method == "POST" and path == "/pwebarc/dump":
            # sanity check
            ctype = environ["CONTENT_TYPE"]
            if ctype != "application/cbor":
                yield from end_with("400 Bad Request", b"expecting CBOR data")
                return

            # read request body data
            fp = environ["wsgi.input"]
            data = b""
            todo = int(environ["CONTENT_LENGTH"])
            while todo > 0:
                res = fp.read(todo)
                data += res
                todo -= len(res)

            if cbor2 is not None:
                rparsed = repr(cbor2.loads(data))
                if len(rparsed) < 3000:
                    print("parsed", rparsed)
                else:
                    print("parsed", rparsed[:1500])
                    print("...")
                    print(rparsed[-1500:])
                del rparsed

            # gzip it, if it gzips
            buf = io.BytesIO()
            with gzip.GzipFile(fileobj=buf, filename="", mtime=0, mode="wb", compresslevel=9) as gz:
                gz.write(data)
            compressed_data = buf.getvalue()
            del buf

            if len(compressed_data) < len(data):
                data = compressed_data
            del compressed_data

            # write it out to a file in {self.root}/<year>/<month>/<day>/<epoch>_<number>.wrr

            # because time.time() gives a float
            epoch = time.time_ns() // 1000000000
            # number reqres sequentially while in the same second
            if (self.prevsec != epoch):
                self.num = 0
            else:
                self.num += 1
            self.prevsec = epoch

            gm = time.gmtime(epoch)
            directory = os.path.join(self.root, *map(str, gm[0:3]))
            path = os.path.join(directory, str(epoch) + "_" + str(self.num) + ".wrr")
            os.makedirs(directory, exist_ok=True)

            try:
                with open(path + ".tmp", "wb") as f:
                    f.write(data)
            except Exception as exc:
                try:
                    os.unlink(path + ".tmp")
                except Exception:
                    pass
                raise exc

            os.rename(path + ".tmp", path)
            print("dumped", path)

            yield from end_with("200 OK", b"")
        else:
            yield from end_with("404 Not Found", b"")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(prog="pwebarc-dumb-dump-server", description="Dumb dump server for pWebArc. Simply dumps each request to `ROOT/<year>/<month>/<day>/<epoch>_<number>.wrr`.")
    parser.add_argument("--host", default="127.0.0.1", type=str, help="listen on what host/IP (default: 127.0.0.1)")
    parser.add_argument("--port", default=3210, type=int, help="listen on what port (default: 3210)")
    parser.add_argument("--root", default="pwebarc-dump", type=str, help="path to dump data into (default: pwebarc-dump)")

    args = parser.parse_args(sys.argv[1:])

    t = HTTPDumpServer(args.host, args.port, args.root)
    t.start()
    try:
        t.join()
    except KeyboardInterrupt:
        print("Interrupted.")
        t.stop()
        t.join()
