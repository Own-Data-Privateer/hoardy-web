# What is `hoardy-web-sas`?

`hoardy-web-sas` is a very simple archiving server for [the `Hoardy-Web` Web Extension browser add-on](https://github.com/Own-Data-Privateer/hoardy-web/tree/master/extension/) (also [there](https://oxij.org/software/hoardy-web/tree/master/extension/)).

I.e. this is the thing you run and then paste the URL of into the `Server URL` setting of the `Hoardy-Web` add-on.

This thing is less than 250 lines of pure Python that only uses the Python\'s standard library and nothing else.
You could be running it already.

# Why does `hoardy-web-sas` exists?

This was made for easy [Quickstart](https://github.com/Own-Data-Privateer/hoardy-web/tree/master/README.md#quickstart) (also [there](https://oxij.org/software/hoardy-web/tree/master/README.md#quickstart)) that also [does reliable archiving](https://oxij.org/software/hoardy-web/tree/master/extension/page/help.org#faq-unsafe).

# Quickstart

## Pre-installation

- Install `Python 3`:

  - On Windows: [Download and install Python from the official website](https://www.python.org/downloads/windows/).
  - On a conventional POSIX system like most GNU/Linux distros and MacOS X: Install `python3` via your package manager. Realistically, it probably is installed already.

## Installation

- On a Windows system with unconfigured `PATH`, install with:

  ``` bash
  pip install hoardy-web-sas
  ```
  and run as
  ``` bash
  python3 -m hoardy_web_sas --help
  ```

- On a conventional POSIX system or on a Windows system with configured `PATH` environment variable, install it with:

  ``` bash
  pip install hoardy-web-sas
  ```
  and run as
  ``` bash
  hoardy-web-sas --help
  ```

- Alternatively, run without installing:

  ``` {.bash}
  ./hoardy-web-sas.py --help
  ```

- Alternatively, on a system with [Nix package manager](https://nixos.org/nix/)

  ``` {.bash}
  nix-env -i -f ./default.nix
  hoardy-web-sas --help
  ```

  Though, in this case, you'll probably want to do the first command from the parent directory, to install everything all at once.

# Usage

```
usage: hoardy_web_sas.py [-h] [--version] [--host HOST] [--port PORT] [--root ROOT] [--uncompressed] [--default-bucket NAME] [--ignore-buckets] [--no-print]

Simple archiving server for Hoardy-Web. Dumps each request to `<ROOT>/<profile>/<year>/<month>/<day>/<epoch>_<number>.wrr`.

options:
  -h, --help            show this help message and exit
  --version             show program's version number and exit
  --host HOST           listen on what host/IP (default: 127.0.0.1)
  --port PORT           listen on what port (default: 3210)
  --root ROOT           path to dump data into (default: pwebarc-dump)
  --uncompressed        dump new archivals to disk without compression; the default is to try to compress each new archive first
  --default-bucket NAME, --default-profile NAME
                        default bucket to use when no `profile` query parameter is supplied by the extension (default: `default`)
  --ignore-buckets, --ignore-profiles
                        ignore `profile` query parameter supplied by the extension and use the value of `--default-bucket` instead
  --no-print, --no-print-cbors
                        don't print parsed representations of newly archived CBORs to stdout even if `cbor2` module is available

```
