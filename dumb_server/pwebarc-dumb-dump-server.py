#!/usr/bin/env python3

import argparse
import os
import sys
import threading
import time

from html import escape
from urllib.parse import quote, unquote

import cgi
import wsgiref.util as wu
from wsgiref.validate import validator
from wsgiref.simple_server import make_server

class HTTPDumpServer(threading.Thread):
    """HTTP server that accepts HTTP dumps and saves them in a given directory.

       This runs in a separate thread so that KeyboardInterrupt and such would
       not interrupt the dump in the middle.
    """

    def __init__(self, host, port, root, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.lock = threading.Lock()
        self.root = root
        self.httpd = make_server(host, port, validator(self.handle_request))
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
            yield more.encode("utf-8")

        method = environ["REQUEST_METHOD"]
        path = environ["PATH_INFO"]

        with self.lock:
            if method == "POST" and path == "/pwebarc/dump":
                ctype = environ["CONTENT_TYPE"]
                if ctype != "application/cbor":
                    yield from end_with("400 Bad Request", "expecting CBOR data")
                    return

                fp = environ["wsgi.input"]

                data = b""
                todo = int(environ["CONTENT_LENGTH"])
                while todo > 0:
                    res = fp.read(todo)
                    data += res
                    todo -= len(res)

                epoch = time.time_ns() // 1000000000
                if (self.prevsec != epoch):
                    self.num = 0
                else:
                    self.num += 1
                self.prevsec = epoch

                gm = time.gmtime(epoch)
                dirs = os.path.join(self.root, *map(str, gm[0:3]))
                path = os.path.join(dirs, str(epoch) + "_" + str(self.num) + ".wrr")
                os.makedirs(dirs, exist_ok=True)

                try:
                    with open(path + ".tmp", "wb") as f:
                        while True:
                            res = f.write(data)
                            if res == len(data):
                                break
                            data = data[res:]
                except OSError as exc:
                    try:
                        os.unlink(path + ".tmp")
                    except OSError:
                        pass
                    raise exc

                os.rename(path + ".tmp", path)
                print("dumped", path)

                yield from end_with("200 OK", "")
            else:
                yield from end_with("404 Not Found", "")

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
        t.stop()
        t.join()
