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

import urllib.parse as up

from wsgiref.validate import validator
from wsgiref.simple_server import make_server

try:
    import importlib.metadata as meta
    version = meta.version(__package__)
except Exception:
    version = "dev"

cbor2 = None

mypid = str(os.getpid())

class HTTPDumpServer(threading.Thread):
    """HTTP server that accepts HTTP dumps as POST data, tries to compresses them
       with gzip, and saves them in a given directory.

       This runs in a separate thread so that KeyboardInterrupt and such
       would not interrupt a dump in the middle.
    """

    def __init__(self, host, port, root, default_profile, ignore_profiles, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.httpd = make_server(host, port, validator(self.handle_request))
        self.root = os.path.expanduser(root)
        self.default_profile = default_profile
        self.ignore_profiles = ignore_profiles
        self.prevsec = 0
        self.num = 0
        print(f"Listening for archive requests on http://{host}:{port}/pwebarc/dump")

    def run(self):
        self.httpd.serve_forever()

    def stop(self):
        self.httpd.shutdown()

    def handle_request(self, environ, start_response):
        def end_with(explanation, more):
            start_response(explanation, [("Content-Type", "text/plain; charset=utf-8")])
            yield more

        method = environ["REQUEST_METHOD"]
        path = environ["PATH_INFO"]

        if method == "POST" and path == "/pwebarc/dump":
            # sanity check
            ctype = environ["CONTENT_TYPE"]
            if ctype != "application/cbor":
                yield from end_with("400 Bad Request", b"expecting CBOR data")
                return

            try:
                query = environ["QUERY_STRING"]
            except KeyError:
                query = ""
            params = up.parse_qs(query)

            profile = ""
            if "profile" in params:
                profile = params["profile"][0]
            if self.ignore_profiles or profile == "":
                profile = self.default_profile

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

            dd = list(map(lambda x: format(x, "02"), time.gmtime(epoch)[0:3]))
            directory = os.path.join(self.root, profile, *dd)
            path = os.path.join(directory, f"{str(epoch)}_{mypid}_{str(self.num)}.wrr")
            os.makedirs(directory, exist_ok=True)

            tmp_path = path + ".part"
            try:
                with open(tmp_path, "wb") as f:
                    f.write(data)
            except Exception as exc:
                try:
                    os.unlink(tmp_path)
                except Exception:
                    pass
                raise exc

            os.rename(tmp_path, path)
            print("dumped", path)

            yield from end_with("200 OK", b"")
        else:
            yield from end_with("404 Not Found", b"")

def main():
    global cbor2

    parser = argparse.ArgumentParser(prog=__package__, description="Simple archiving server for pWebArc. Dumps each request to `ROOT/<profile>/<year>/<month>/<day>/<epoch>_<number>.wrr`.")
    parser.add_argument("--version", action="version", version=f"{__package__} {version}")
    parser.add_argument("--host", default="127.0.0.1", type=str, help="listen on what host/IP (default: 127.0.0.1)")
    parser.add_argument("--port", default=3210, type=int, help="listen on what port (default: 3210)")
    parser.add_argument("--root", default="pwebarc-dump", type=str, help="path to dump data into (default: pwebarc-dump)")
    parser.add_argument("--default-profile", metavar="NAME", default="default", type=str, help="default profile to use when no `profile` query parameter is supplied by the extension (default: `default`)")
    parser.add_argument("--ignore-profiles", action="store_true", help="ignore `profile` query parameter supplied by the extension and use the value of `--default-profile` instead")
    parser.add_argument("--no-cbor", action="store_true", help="don't load `cbor2` module, disables parsing of input data")

    args = parser.parse_args(sys.argv[1:])

    if not args.no_cbor:
        try:
            import cbor2 as cbor2_
        except ImportError:
            sys.stderr.write("warning: `cbor2` module is not available, forcing `--no-cbor` option\n")
            sys.stderr.flush()
        else:
            cbor2 = cbor2_
            del cbor2_

    t = HTTPDumpServer(args.host, args.port, args.root, args.default_profile, args.ignore_profiles)
    t.start()
    try:
        t.join()
    except KeyboardInterrupt:
        print("Interrupted.")
        t.stop()
        t.join()

if __name__ == "__main__":
    main()
