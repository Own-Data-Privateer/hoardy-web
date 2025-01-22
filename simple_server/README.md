# What is `hoardy-web-sas`?

`hoardy-web-sas` is a very simple archiving server for the [`Hoardy-Web` Web Extension browser add-on](https://oxij.org/software/hoardy-web/tree/master/extension/) (also on [GitHub](https://github.com/Own-Data-Privateer/hoardy-web/tree/master/extension/)).

I.e. this is the thing you run and then paste the URL of into the `Server URL` setting of `Hoardy-Web`.

This is not the most feature-rich thing for doing that, [`hoardy-web serve`](https://oxij.org/software/hoardy-web/tree/master/tool/) (also on [GitHub](https://github.com/Own-Data-Privateer/hoardy-web/tree/master/tool/)) is much more powerful.
But, `hoardy-web serve` is not at all simple and it depends on quite a lot of things.
Meanwhile, this `hoardy-web-sas` thing is less than 300 lines of pure Python that only uses the Python\'s standard library and nothing else.
You could be running it already.

# Quickstart

## Pre-installation

- Install `Python 3`:

  - On a Windows system: [Download Python installer from the official website](https://www.python.org/downloads/windows/), run it, **set `Add python.exe to PATH` checkbox**, then `Install` (the default options are fine).
  - On a conventional POSIX system like most GNU/Linux distros and MacOS X: Install `python3` via your package manager. Realistically, it probably is installed already.

## Installation

- On a Windows system:

  Open `cmd.exe` (press `Windows+R`, enter `cmd.exe`, press `Enter`), install this tool with
  ```bash
  python -m pip install hoardy-web-sas
  ```
  and run as
  ```bash
  python -m hoardy_web_sas --help
  ```

- On a POSIX system or on a Windows system with Python's `/Scripts` added to `PATH`:

  Open a terminal/`cmd.exe`, install with
  ```bash
  pip install hoardy-web-sas
  ```
  and run as
  ```bash
  hoardy-web-sas --help
  ```

- Alternatively, run without installing:

  ```bash
  python hoardy-web-sas.py --help
  # or, on POSIX
  ./hoardy-web-sas.py --help
  ```

- Alternatively, on a system with [Nix package manager](https://nixos.org/nix/)

  ```bash
  nix-env -i -f ./default.nix
  hoardy-web-sas --help
  ```

  Though, in this case, you'll probably want to do the first command from the parent directory, to install everything all at once.

## Start archiving

```bash
python -m hoardy_web_sas --archive-to C:\Users\Me\Documents\hoardy-web\raw
# or
hoardy-web-sas --archive-to ~/hoardy-web/raw
```

## Capture and archive some websites

See [`Hoardy-Web`'s "Quickstart"](https://oxij.org/software/hoardy-web/tree/master/README.md#quickstart) (also on [GitHub](https://github.com/Own-Data-Privateer/hoardy-web/tree/master/README.md#quickstart)).

# Usage

```
usage: hoardy-web-sas [-h] [--version] [--host HOST] [--port PORT] [-t ROOT] [--compress | --no-compress] [--default-bucket NAME] [--ignore-buckets] [--no-print]

A simple archiving server for the `Hoardy-Web` Web Extension browser add-on: listen on given `--host` and `--port` via `HTTP`, dump each `POST`ed `WRR` dump to `<--archive-to>/<bucket>/<year>/<month>/<day>/<epoch>_<number>.wrr`.

options:
  -h, --help            show this help message and exit
  --version             show program's version number and exit
  --host HOST           listen on what host/IP; default: `127.0.0.1`
  --port PORT           listen on what port; default: `3210`
  -t ROOT, --to ROOT, --archive-to ROOT, --root ROOT
                        path to dump data into; default: `pwebarc-dump`
  --compress            compress new archivals before dumping them to disk; default
  --no-compress, --uncompressed
                        dump new archivals to disk without compression
  --default-bucket NAME, --default-profile NAME
                        default bucket to use when no `profile` query parameter is supplied by the extension; default: `default`
  --ignore-buckets, --ignore-profiles
                        ignore `profile` query parameter supplied by the extension and use the value of `--default-bucket` instead
  --no-print, --no-print-cbors
                        don't print parsed representations of newly archived CBORs to stdout even if `cbor2` module is available

```
