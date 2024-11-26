#!/usr/bin/env python3

import argparse
import hashlib
import os
import os.path
import stat
import sys
import time
import typing as _t

def any_to_bytes(s : _t.Any) -> bytes:
    if isinstance(s, bytes):
        return s
    elif isinstance(s, str):
        return os.fsencode(s)
    else:
        try:
            return os.fsencode(str(s))
        except Exception:
            return os.fsencode(repr(s))

binstdout = os.fdopen(sys.stdout.fileno(), "wb")
def printbin(*ls : _t.Any) -> None:
    res = b" ".join(map(any_to_bytes, ls)).replace(b"\\", b"\\\\").replace(b"\n", b"\\n")
    binstdout.write(res + b"\n")
    binstdout.flush()

BUFFER_SIZE = 4 * 1024 * 1024
def hex_sha256_of(fpath : bytes) -> str:
    with open(fpath, "rb") as f:
        fhash=hashlib.sha256()
        while True:
            data = f.read(BUFFER_SIZE)
            if len(data) == 0: break
            fhash.update(data)
        return fhash.hexdigest()

def main() -> None:
    parser = argparse.ArgumentParser(prog="describe-dir", description="generate a recursive deterministic textual textual description of given input directories")
    parser.add_argument("--no-mtime", action="store_true", help="ignore mtimes")
    parser.add_argument("path", metavar="PATH", nargs="*", type=str, help="input directories")
    args = parser.parse_args(sys.argv[1:])

    argvb = [os.fsencode(a) for a in args.path]
    argvb.sort()

    seen : dict[tuple[int, int], bytes] = {}
    for dirpath in argvb:
        for root, dirs, files in os.walk(dirpath):
            dirs.sort()
            files.sort()
            everything = dirs + files
            everything.sort()
            for name in everything:
                fpath=os.path.join(root, name)
                opath=os.path.relpath(fpath, dirpath)

                fstat = os.lstat(fpath)
                ino = (fstat.st_dev, fstat.st_ino)
                try:
                    hardlink = seen[ino]
                except KeyError:
                    seen[ino] = fpath
                else:
                    hardlink = os.path.relpath(hardlink, fpath)
                    printbin(opath, "=>", hardlink)
                    continue

                if args.no_mtime:
                    mtime = "no"
                else:
                    mtime = "[" + time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(fstat.st_mtime)) + "]"
                size = fstat.st_size
                mode = oct(stat.S_IMODE(fstat.st_mode))[2:]
                if stat.S_ISDIR(fstat.st_mode):
                    printbin(opath, "dir", "mode", mode, "mtime", mtime)
                elif stat.S_ISREG(fstat.st_mode):
                    sha256 = hex_sha256_of(fpath)
                    printbin(opath, "reg", "mode", mode, "mtime", mtime, "size", size, "sha256", sha256)
                elif stat.S_ISLNK(fstat.st_mode):
                    symlink = os.path.relpath(os.readlink(fpath), fpath)
                    printbin(opath, "lnk", "mode", mode, "mtime", mtime, "->", symlink)
                else:
                    printbin(opath, "...", "mode", mode, "mtime", mtime, "size", size)

if __name__ == "__main__":
    main()
