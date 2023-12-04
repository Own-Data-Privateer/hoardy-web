# What?

`pwebarc_dumb_dump_server.py`: a very ~~dumb~~ simple archiving server for [Private Web Archive (pwebarc)](https://github.com/Own-Data-Privateer/pwebarc/) [pWebArc browser extension](https://github.com/Own-Data-Privateer/pwebarc/extension/).
This thing is less than 200 lines of pure Python that only uses the Python\'s standard library and nothing else.
You could be running it already.

# Why?

This was made for easy [Quickstart](https://github.com/Own-Data-Privateer/README.md#quickstart).
Ideally, you would use something smarter than this (when I publish it), but this will work fine as a starting point.

# Quickstart

## Installation

- You can run this without installing:
  ``` {.bash}
  ./pwebarc_dumb_dump_server.py --help
  ```
- Alternatively, install with:
  ``` {.bash}
  pip install pwebarc-dumb-dump-server
  ```
  and run as
  ``` {.bash}
  pwebarc-dumb-dump-server --help
  ```
- Alternatively, install it via Nix
  ``` {.bash}
  nix-env -i -f ./default.nix
  ```

# Usage

```
usage: pwebarc_dumb_dump_server.py [-h] [--version] [--host HOST]
                                   [--port PORT] [--root ROOT]
                                   [--default-profile NAME]
                                   [--ignore-profiles] [--no-cbor]

Simple archiving server for pWebArc. Dumps each request to
`ROOT/<profile>/<year>/<month>/<day>/<epoch>_<number>.wrr`.

options:
  -h, --help            show this help message and exit
  --version             show program's version number and exit
  --host HOST           listen on what host/IP (default: 127.0.0.1)
  --port PORT           listen on what port (default: 3210)
  --root ROOT           path to dump data into (default: pwebarc-dump)
  --default-profile NAME
                        default profile to use when no `profile` query
                        parameter is supplied by the extension (default:
                        `default`)
  --ignore-profiles     ignore `profile` query parameter supplied by the
                        extension and use the value of `--default-profile`
                        instead
  --no-cbor             don't load `cbor2` module, disables parsing of input
                        data
```
