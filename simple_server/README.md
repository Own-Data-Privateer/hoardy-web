# What is `hoardy-web-sas`?

`hoardy-web-sas`: a very simple archiving server for the [`Hoardy-Web` browser extension](https://github.com/Own-Data-Privateer/hoardy-web/tree/master/extension/) (also [there](https://oxij.org/software/hoardy-web/tree/master/extension/)).

I.e. this is the thing you run and then paste the URL of into `Server URL` setting in `Hoardy-Web`.

This thing is less than 200 lines of pure Python that only uses the Python\'s standard library and nothing else.
You could be running it already.

# Why does `hoardy-web-sas` exists?

This was made for easy [Quickstart](https://github.com/Own-Data-Privateer/hoardy-web/tree/master/README.md#quickstart) (also [there](https://oxij.org/software/hoardy-web/tree/master/README.md#quickstart)) that also [does reliable archiving](https://oxij.org/software/hoardy-web/tree/master/extension/page/help.org#faq-unsafe).

# Quickstart

## Installation

- You can run this without installing:
  ``` {.bash}
  ./hoardy-web-sas.py --help
  ```
- Alternatively, install with:
  ``` {.bash}
  pip install hoardy-web-sas
  ```
  and run as
  ``` {.bash}
  hoardy-web-sas --help
  ```
- Alternatively, install it via Nix
  ``` {.bash}
  nix-env -i -f ./default.nix
  hoardy-web-sas --help
  ```

# Usage

```
usage: hoardy_web_sas.py [-h] [--version] [--host HOST] [--port PORT] [--root ROOT] [--uncompressed] [--default-profile NAME] [--ignore-profiles] [--no-print-cbors]

Simple archiving server for Hoardy-Web. Dumps each request to `<ROOT>/<profile>/<year>/<month>/<day>/<epoch>_<number>.wrr`.

optional arguments:
  -h, --help            show this help message and exit
  --version             show program's version number and exit
  --host HOST           listen on what host/IP (default: 127.0.0.1)
  --port PORT           listen on what port (default: 3210)
  --root ROOT           path to dump data into (default: pwebarc-dump)
  --uncompressed        dump new archivals to disk without compression; the default is to try to compress each new archive first
  --default-profile NAME
                        default profile to use when no `profile` query parameter is supplied by the extension (default: `default`)
  --ignore-profiles     ignore `profile` query parameter supplied by the extension and use the value of `--default-profile` instead
  --no-print-cbors      don't print parsed representations of newly archived CBORs to stdout even if `cbor2` module is available

```
