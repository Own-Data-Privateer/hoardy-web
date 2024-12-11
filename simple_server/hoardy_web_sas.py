#!/usr/bin/env python3

# A very simple archiving server for Hoardy-Web.
#
# Copyright (c) 2023 Jan Malakhovski <oxij@oxij.org>
#
# This file can be distributed under the terms of the GNU GPL, version 3 or later.

import argparse as _argparse
import gzip as _gzip
import io as _io
import json as _json
import os as _os
import re as _re
import sys as _sys
import threading as _threading
import time as _time
import typing as _t
import urllib.parse as _up
import wsgiref.simple_server as _wsgiss
import wsgiref.validate as _wsgival

_cbor2 = None

try:
    import importlib.metadata as _meta
    version = _meta.version(__package__)
except Exception:
    version = "dev"

mypid = str(_os.getpid())
bucket_re = _re.compile(r"[\w -]+")

class HTTPDumpServer(_threading.Thread):
    """HTTP server that accepts HTTP dumps as POST data, tries to compresses them
       with gzip, and saves them in a given directory.

       This runs in a separate thread so that KeyboardInterrupt and such
       would not interrupt a dump in the middle.
    """

    def __init__(self, cargs : _argparse.Namespace, *args : _t.Any, **kwargs : _t.Any) -> None:
        super().__init__(*args, **kwargs)
        self.httpd = _wsgiss.make_server(cargs.host, cargs.port, _wsgival.validator(self.handle_request))
        self.cargs = cargs
        self.server_info_json = _json.dumps({
            "version": 1,
            "dump_wrr": "/pwebarc/dump",
        }).encode("utf-8")
        self.epoch = 0
        self.num = 0
        print(f"Working as an archiving server at http://{cargs.host}:{cargs.port}/")

    def run(self) -> None:
        self.httpd.serve_forever()

    def stop(self) -> None:
        self.httpd.shutdown()

    def handle_request(self, env : _t.Any, start_response : _t.Any) -> _t.Iterator[bytes]:
        def end_with(explanation : str, more : bytes) -> _t.Iterator[bytes]:
            start_response(explanation, [("Content-Type", "text/plain; charset=utf-8")])
            yield more

        method = env["REQUEST_METHOD"]
        path = env["PATH_INFO"]

        if method == "GET" and path == "/hoardy-web/server-info":
            start_response("200 OK", [("Content-Type", "application/json")])
            yield self.server_info_json
        elif method == "POST" and path == "/pwebarc/dump":
            # sanity check
            ctype = env.get("CONTENT_TYPE", "")
            if ctype not in ["application/x-wrr+cbor", "application/cbor"]:
                yield from end_with("400 Bad Request", f"expected CBOR data, got `{ctype}`".encode("utf-8"))
                return

            cargs = self.cargs
            query = env.get("QUERY_STRING", "")
            params = _up.parse_qs(query)

            bucket = ""
            if not cargs.ignore_buckets:
                try:
                    bucket_param = params["profile"][-1]
                except KeyError:
                    pass
                else:
                    bucket = "".join(bucket_re.findall(bucket_param))
            if len(bucket) == 0:
                bucket = cargs.default_bucket

            # read request body data
            with _io.BytesIO() as cborf:
                inf = env["wsgi.input"]
                try:
                    todo = int(env["CONTENT_LENGTH"])
                except Exception:
                    yield from end_with("400 Bad Request", b"need `content-length`")
                    return
                while todo > 0:
                    res = inf.read(todo)
                    if len(res) == 0:
                        yield from end_with("400 Bad Request", b"incomplete data")
                        return
                    cborf.write(res)
                    todo -= len(res)
                data = cborf.getvalue()

            if _cbor2 is not None:
                rparsed = repr(_cbor2.loads(data))
                if len(rparsed) < 3000:
                    print("parsed", rparsed)
                else:
                    print("parsed", rparsed[:1500])
                    print("...")
                    print(rparsed[-1500:])
                del rparsed

            if cargs.compress:
                # gzip it, if it gzips
                with _io.BytesIO() as gz_outf:
                    with _gzip.GzipFile(fileobj=gz_outf, filename="", mtime=0, mode="wb", compresslevel=9) as gz_inf:
                        gz_inf.write(data)
                    compressed_data = gz_outf.getvalue()

                if len(compressed_data) < len(data):
                    data = compressed_data
                del compressed_data

            # write it out to a file in {cargs.root}/<bucket>/<year>/<month>/<day>/<epoch>_<number>.wrr

            # because time.time() gives a float
            epoch = _time.time_ns() // 1000000000
            # number reqres sequentially within the same second
            if (self.epoch != epoch):
                self.num = 0
            else:
                self.num += 1
            self.epoch = epoch

            dd = list(map(lambda x: format(x, "02"), _time.gmtime(epoch)[0:3]))
            directory = _os.path.join(cargs.root, bucket, *dd)
            path = _os.path.join(directory, f"{str(epoch)}_{mypid}_{str(self.num)}.wrr")
            _os.makedirs(directory, exist_ok=True)

            tmp_path = path + ".part"
            try:
                with open(tmp_path, "wb") as f:
                    f.write(data)
            except Exception as exc:
                try:
                    _os.unlink(tmp_path)
                except Exception:
                    pass
                raise exc

            _os.rename(tmp_path, path)
            print("dumped", path)

            yield from end_with("200 OK", b"")
        else:
            yield from end_with("404 Not Found", b"")

def main() -> None:
    global _cbor2

    parser = _argparse.ArgumentParser(
        prog=__package__,
        description="Simple archiving server for Hoardy-Web. Dumps each request to `<ROOT>/<bucket>/<year>/<month>/<day>/<epoch>_<number>.wrr`.",
        add_help = False)
    parser.add_argument("-h", "--help", action="store_true", help="show this help message and exit")
    parser.add_argument("--version", action="version", version=f"{__package__} {version}")

    parser.add_argument("--host", type=str, default="127.0.0.1", help="listen on what host/IP; default: `%(default)s`")
    parser.add_argument("--port", type=int, default=3210, help="listen on what port; default: `%(default)s`")
    parser.add_argument("-t", "--to", "--archive-to", "--root", dest="root", type=str, default="pwebarc-dump", help="path to dump data into; default: `%(default)s`")

    grp = parser.add_mutually_exclusive_group()
    grp.add_argument("--compress", dest="compress", action="store_const", const=True, help="compress new archivals before dumping them to disk; default")
    grp.add_argument("--no-compress", "--uncompressed", dest="compress", action="store_const", const=False, help="dump new archivals to disk without compression")
    parser.set_defaults(compress = True)

    parser.add_argument("--default-bucket", "--default-profile", metavar="NAME", default="default", type=str, help="default bucket to use when no `profile` query parameter is supplied by the extension; default: `%(default)s`")
    parser.add_argument("--ignore-buckets", "--ignore-profiles", action="store_true", help="ignore `profile` query parameter supplied by the extension and use the value of `--default-bucket` instead")

    parser.add_argument("--no-print", "--no-print-cbors", action="store_true", help="don't print parsed representations of newly archived CBORs to stdout even if `cbor2` module is available")

    cargs = parser.parse_args(_sys.argv[1:])

    if cargs.help:
        if not _sys.stdout.isatty():
            parser.formatter_class = lambda *args, **kwargs: _argparse.HelpFormatter(*args, width=1024, **kwargs) # type: ignore
        print(parser.format_help())
        _sys.exit(0)

    cargs.root = _os.path.expanduser(cargs.root)

    if not cargs.no_print:
        try:
            import cbor2 as cbor2_
        except ImportError:
            _sys.stderr.write("warning: `cbor2` module is not available, forcing `--no-print` option\n")
            _sys.stderr.flush()
        else:
            _cbor2 = cbor2_
            del cbor2_

    t = HTTPDumpServer(cargs)
    t.start()
    try:
        t.join()
    except KeyboardInterrupt:
        print("Interrupted.")
        t.stop()
        t.join()

if __name__ == "__main__":
    main()
