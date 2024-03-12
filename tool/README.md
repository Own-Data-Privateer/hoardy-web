# What?

`wrrarms` (`pwebarc-wrrarms`) is a tool for displaying and manipulating [Personal Private Passive Web Archive (pwebarc)](https://github.com/Own-Data-Privateer/pwebarc/) (also [there](https://oxij.org/software/pwebarc/)) Web Request+Response (WRR) files produced by [pWebArc browser extension](https://github.com/Own-Data-Privateer/pwebarc/tree/master/extension/) (also [there](https://oxij.org/software/pwebarc/tree/master/extension/)).

# Quickstart

## Installation

- Install with:
  ``` {.bash}
  pip install pwebarc-wrrarms
  ```
  and run as
  ``` {.bash}
  wrrarms --help
  ```
- Alternatively, install it via Nix
  ``` {.bash}
  nix-env -i -f ./default.nix
  wrrarms --help
  ```
- Alternatively, run without installing:
  ``` {.bash}
  alias wrrarms="python3 -m wrrarms"
  wrrarms --help
  ```

## How to build a hierarchy of latest versions of all URLs

Assuming you keep your WRR dumps in `~/pwebarc/raw` you can generate a `wget`-like file hierarchy of symlinks under `~/pwebarc/latest` pointing to the latest version of each URL in `~/pwebarc/raw` with

``` {.bash}
wrrarms organize --action symlink-update --output hupq --to ~/pwebarc/latest --and "status|== 200C" ~/pwebarc/raw
```

or, using a bit better format:

``` {.bash}
wrrarms organize --action symlink-update --output hupnq --to ~/pwebarc/latest --and "status|== 200C" ~/pwebarc/raw
```

Personally, I prefer the `flat` format as I dislike deep file hierarchies and it allows to see and filter new dumps more easily in `ranger` file browser:

``` {.bash}
wrrarms organize --action symlink-update --output flat --to ~/pwebarc/latest --and "status|== 200C" ~/pwebarc/raw
```

If you have a lot of WRR files all of the above commands could be rather slow, so if you want to keep your tree updated in real-time you should use a two-stage `--stdin0` pipeline shown in the [examples section](#examples) below instead.

## How do I open WRR files with `xdg-open`? How do I generate previews for them?

See [`script` sub-directory](./script/README.md) for examples.

# <span id="todo"/>What is left TODO

- Rendering into static website mirrors a-la `wget -k`.

  Currently, the extension archives everything except WebSockets data but `wrrarms` + `pandoc` only work well for dumps of mostly plain text websites (which is the main use case I use this whole thing for: scrape a website and then mass-convert everything to PDFs via some `pandoc` magic, then index those with `recoll`).

- Converter from HAR, WARC, and PCAP files into WRR.
- Converter from WRR to WARC.
- Data de-duplication between different WRR files.
- Non-dumb server with time+URL index and replay, i.e. a local [Wayback Machine](https://web.archive.org/).
- Full text indexing and search.

# Usage

## wrrarms

A tool to pretty-print, compute and print values from, search, organize (programmatically rename/move/symlink/hardlink files), (WIP: check, deduplicate, and edit) pWebArc WRR (WEBREQRES, Web REQuest+RESponse) archive files.

Terminology: a `reqres` (`Reqres` when a Python type) is an instance of a structure representing HTTP request+response pair with some additional metadata.

- options:
  - `--version`
  : show program's version number and exit
  - `-h, --help`
  : show this help message and exit
  - `--markdown`
  : show help messages formatted in Markdown

- subcommands:
  - `{pprint,get,run,stream,find,organize,import}`
    - `pprint`
    : pretty-print given WRR files
    - `get`
    : print values produced by computing given expressions on a given WRR file
    - `run`
    : spawn a process with generated temporary files produced by given expressions computed on given WRR files as arguments
    - `stream`
    : produce a stream of structured lists containing values produced by computing given expressions on given WRR files, a generalized `wrrarms get`
    - `find`
    : print paths of WRR files matching specified criteria
    - `organize`
    : programmatically rename/move/hardlink/symlink WRR files based on their contents
    - `import`
    : convert other archive formats into WRR files

### wrrarms pprint

Pretty-print given WRR files to stdout.

- positional arguments:
  - `PATH`
  : inputs, can be a mix of files and directories (which will be traversed recursively)

- options:
  - `-u, --unabridged`
  : print all data in full
  - `--abridged`
  : shorten long strings for brevity (useful when you want to visually scan through batch data dumps) (default)
  - `--stdin0`
  : read zero-terminated `PATH`s from stdin, these will be processed after `PATH`s specified as command-line arguments

- error handling:
  - `--errors {fail,skip,ignore}`
  : when an error occurs:
    - `fail`: report failure and stop the execution (default)
    - `skip`: report failure but skip the reqres that produced it from the output and continue
    - `ignore`: `skip`, but don't report the failure

- filters:
  - `--or EXPR`
  : only print reqres which match any of these expressions...
  - `--and EXPR`
  : ... and all of these expressions, both can be specified multiple times, both use the same expression format as `wrrarms get --expr`, which see

- file system path ordering:
  - `--paths-given-order`
  : `argv` and `--stdin0` `PATH`s are processed in the order they are given (default)
  - `--paths-sorted`
  : `argv` and `--stdin0` `PATH`s are processed in lexicographic order
  - `--paths-reversed`
  : `argv` and `--stdin0` `PATH`s are processed in reverse lexicographic order
  - `--walk-fs-order`
  : recursive file system walk is done in the order `readdir(2)` gives results
  - `--walk-sorted`
  : recursive file system walk is done in lexicographic order (default)
  - `--walk-reversed`
  : recursive file system walk is done in reverse lexicographic order

### wrrarms get

Compute output values by evaluating expressions `EXPR`s on a given reqres stored at `PATH`, then print them to stdout terminating each value as specified.

- positional arguments:
  - `PATH`
  : input WRR file path

- options:
  - `-e EXPR, --expr EXPR`
  : an expression to compute; can be specified multiple times in which case computed outputs will be printed sequentially, see also "output" options below; (default: `response.body|es`); each EXPR describes a state-transformer (pipeline) which starts from value `None` and evaluates a script built from the following:
    - constants and functions:
      - `es`: replace `None` value with an empty string `""`
      - `eb`: replace `None` value with an empty byte string `b""`
      - `false`: replace `None` value with `False`
      - `true`: replace `None` value with `True`
      - `missing`: `True` if the value is `None`
      - `0`: replace `None` value with `0`
      - `1`: replace `None` value with `1`
      - `not`: apply logical `not` to value
      - `len`: apply `len` to value
      - `str`: cast value to `str` or fail
      - `bytes`: cast value to `bytes` or fail
      - `bool`: cast value to `bool` or fail
      - `int`: cast value to `int` or fail
      - `float`: cast value to `float` or fail
      - `quote`: URL-percent-encoding quote value
      - `quote_plus`: URL-percent-encoding quote value and replace spaces with `+` symbols
      - `unquote`: URL-percent-encoding unquote value
      - `unquote_plus`: URL-percent-encoding unquote value and replace `+` symbols with spaces
      - `sha256`: compute `hex(sha256(value.encode("utf-8"))`
      - `==`: apply `== arg`, `arg` is cast to the same type as the current value
      - `!=`: apply `!= arg`, similarly
      - `<`: apply `< arg`, similarly
      - `<=`: apply `<= arg`, similarly
      - `>`: apply `> arg`, similarly
      - `>=`: apply `>= arg`, similarly
      - `prefix`: take first `arg` characters
      - `suffix`: take last `arg` characters
      - `abbrev`: leave the current value as if if its length is less or equal than `arg` characters, otherwise take first `arg/2` followed by last `arg/2` characters
      - `abbrev_each`: `abbrev arg` each element in a value `list`
      - `replace`: replace all occurences of the first argument in the current value with the second argument, casts arguments to the same type as the current value
      - `pp_to_path`: encode `path_parts` `list` into a POSIX path, quoting as little as needed
      - `qsl_urlencode`: encode parsed `query` `list` into a URL's query component `str`
      - `qsl_to_path`: encode `query` `list` into a POSIX path, quoting as little as needed
    - reqres fields, these work the same way as constants above, i.e. they replace current value of `None` with field's value, if reqres is missing the field in question, which could happen for `response*` fields, the result is `None`:
      - `version`: WEBREQRES format version; int
      - `source`: `+`-separated list of applications that produced this reqres; str
      - `protocol`: protocol; e.g. `"HTTP/1.1"`, `"HTTP/2.0"`; str
      - `request.started_at`: request start time in seconds since 1970-01-01 00:00; Epoch
      - `request.method`: request HTTP method; e.g. `"GET"`, `"POST"`, etc; str
      - `request.url`: request URL, including the fragment/hash part; str
      - `request.headers`: request headers; list[tuple[str, bytes]]
      - `request.complete`: is request body complete?; bool
      - `request.body`: request body; bytes
      - `response.started_at`: response start time in seconds since 1970-01-01 00:00; Epoch
      - `response.code`: HTTP response code; e.g. `200`, `404`, etc; int
      - `response.reason`: HTTP response reason; e.g. `"OK"`, `"Not Found"`, etc; usually empty for Chromium and filled for Firefox; str
      - `response.headers`: response headers; list[tuple[str, bytes]]
      - `response.complete`: is response body complete?; bool
      - `response.body`: response body; Firefox gives raw bytes, Chromium gives UTF-8 encoded strings; bytes | str
      - `finished_at`: request completion time in seconds since 1970-01-01 00:00; Epoch
      - `websocket`: a list of WebSocket frames
    - derived attributes:
      - `fs_path`: file system path for the WRR file containing this reqres; str or None
      - `qtime`: aliast for `request.started_at`; mnemonic: "reQuest TIME"; seconds since UNIX epoch; decimal float
      - `qtime_ms`: `qtime` in milliseconds rounded down to nearest integer; milliseconds since UNIX epoch; int
      - `qtime_msq`: three least significant digits of `qtime_ms`; int
      - `qyear`: year number of `gmtime(qtime)` (UTC year number of `qtime`); int
      - `qmonth`: month number of `gmtime(qtime)`; int
      - `qday`: day of the month of `gmtime(qtime)`; int
      - `qhour`: hour of `gmtime(qtime)` in 24h format; int
      - `qminute`: minute of `gmtime(qtime)`; int
      - `qsecond`: second of `gmtime(qtime)`; int
      - `stime`: `response.started_at` if there was a response, `finished_at` otherwise; mnemonic: "reSponse TIME"; seconds since UNIX epoch; decimal float
      - `stime_ms`: `stime` in milliseconds rounded down to nearest integer; milliseconds since UNIX epoch, int
      - `stime_msq`: three least significant digits of `stime_msq`; int
      - `syear`: similar to `syear`, but for `stime`; int
      - `smonth`: similar to `smonth`, but for `stime`; int
      - `sday`: similar to `sday`, but for `stime`; int
      - `shour`: similar to `shour`, but for `stime`; int
      - `sminute`: similar to `sminute`, but for `stime`; int
      - `ssecond`: similar to `ssecond`, but for `stime`; int
      - `ftime`: aliast for `finished_at`; seconds since UNIX epoch; decimal float
      - `ftime_ms`: `ftime` in milliseconds rounded down to nearest integer; milliseconds since UNIX epoch; int
      - `ftime_msq`: three least significant digits of `ftime_msq`; int
      - `fyear`: similar to `syear`, but for `ftime`; int
      - `fmonth`: similar to `smonth`, but for `ftime`; int
      - `fday`: similar to `sday`, but for `ftime`; int
      - `fhour`: similar to `shour`, but for `ftime`; int
      - `fminute`: similar to `sminute`, but for `ftime`; int
      - `fsecond`: similar to `ssecond`, but for `ftime`; int
      - `status`: `"NR"` if there was no response, `str(response.code) + "C"` if response was complete, `str(response.code) + "N"` otherwise; str
      - `method`: aliast for `request.method`; str
      - `raw_url`: aliast for `request.url`; str
      - `net_url`: `raw_url` with Punycode UTS46 IDNA encoded hostname, unsafe characters quoted, and without the fragment/hash part; this is the URL that actually gets sent to the server; str
      - `scheme`: scheme part of `raw_url`; e.g. `http`, `https`, etc; str
      - `raw_hostname`: hostname part of `raw_url` as it is recorded in the reqres; str
      - `net_hostname`: hostname part of `raw_url`, encoded as Punycode UTS46 IDNA; this is what actually gets sent to the server; ASCII str
      - `hostname`: `net_hostname` decoded back into UNICODE; this is the canonical hostname representation for which IDNA-encoding and decoding are bijective; str
      - `rhostname`: `hostname` with the order of its parts reversed; e.g. `"www.example.org"` -> `"com.example.www"`; str
      - `port`: port part of `raw_url`; int or None
      - `netloc`: netloc part of `raw_url`; i.e., in the most general case, `<username>:<password>@<hostname>:<port>`; str
      - `raw_path`: raw path part of `raw_url` as it is recorded is the reqres; e.g. `"https://www.example.org"` -> `""`, `"https://www.example.org/"` -> `"/"`, `"https://www.example.org/index.html"` -> `"/index.html"`; str
      - `path_parts`: component-wise unquoted "/"-split `raw_path` with empty components removed and dots and double dots interpreted away; e.g. `"https://www.example.org"` -> `[]`, `"https://www.example.org/"` -> `[]`, `"https://www.example.org/index.html"` -> `["index.html"]` , `"https://www.example.org/skipped/.//../used/"` -> `["used"]; list[str]
      - `wget_parts`: `path + ["index.html"]` if `raw_path` ends in a slash, `path` otherwise; this is what `wget` does in `wget -mpk`; list[str]
      - `raw_query`: query part of `raw_url` (i.e. everything after the `?` character and before the `#` character) as it is recorded in the reqres; str
      - `query_parts`: parsed (and component-wise unquoted) `raw_query`; list[tuple[str, str]]
      - `query_ne_parts`: `query_parts` with empty query parameters removed; list[tuple[str, str]]
      - `oqm`: optional query mark: `?` character if `query` is non-empty, an empty string otherwise; str
      - `fragment`: fragment (hash) part of the url; str
      - `ofm`: optional fragment mark: `#` character if `fragment` is non-empty, an empty string otherwise; str
    - a compound expression built by piping (`|`) the above, for example:
      - `net_url|sha256`
      - `net_url|sha256|prefix 4`
      - `path_parts|pp_to_path`
      - `query_parts|qsl_to_path|abbrev 128`
      - `response.complete`: this will print the value of `response.complete` or `None`, if there was no response
      - `response.complete|false`: this will print `response.complete` or `False`
      - `response.body|eb`: this will print `response.body` or an empty string, if there was no response

- output:
  - `--not-terminated`
  : don't terminate output values with anything, just concatenate them (default)
  - `-l, --lf-terminated`
  : terminate output values with `\n` (LF) newline characters
  - `-z, --zero-terminated`
  : terminate output values with `\0` (NUL) bytes

### wrrarms run

Compute output values by evaluating expressions `EXPR`s for each of `NUM` reqres stored at `PATH`s, dump the results into into newly generated temporary files terminating each value as specified, spawn a given `COMMAND` with given arguments `ARG`s and the resulting temporary file paths appended as the last `NUM` arguments, wait for it to finish, delete the temporary files, exit with the return code of the spawned process.

- positional arguments:
  - `COMMAND`
  : command to spawn
  - `ARG`
  : additional arguments to give to the COMMAND
  - `PATH`
  : input WRR file paths to be mapped into new temporary files

- options:
  - `-e EXPR, --expr EXPR`
  : the expression to compute, can be specified multiple times, see `{__package__} get --expr` for more info; (default: `response.body|es`)
  - `-n NUM, --num-args NUM`
  : number of `PATH`s (default: `1`)

- output:
  - `--not-terminated`
  : don't terminate output values with anything, just concatenate them (default)
  - `-l, --lf-terminated`
  : terminate output values with `\n` (LF) newline characters
  - `-z, --zero-terminated`
  : terminate output values with `\0` (NUL) bytes

### wrrarms stream

Compute given expressions for each of given WRR files, encode them into a requested format, and print the result to stdout.

- positional arguments:
  - `PATH`
  : inputs, can be a mix of files and directories (which will be traversed recursively)

- options:
  - `-u, --unabridged`
  : print all data in full
  - `--abridged`
  : shorten long strings for brevity (useful when you want to visually scan through batch data dumps) (default)
  - `--format {py,cbor,json,raw}`
  : generate output in:
    - py: Pythonic Object Representation aka `repr` (default)
    - cbor: CBOR (RFC8949)
    - json: JavaScript Object Notation aka JSON; **binary data can't be represented, UNICODE replacement characters will be used**
    - raw: concatenate raw values; termination is controlled by `*-terminated` options
  - `-e EXPR, --expr EXPR`
  : an expression to compute, see `wrrarms get --expr` for more info on expression format, can be specified multiple times (default: `[]`); to dump all the fields of a reqres, specify "`.`"
  - `--stdin0`
  : read zero-terminated `PATH`s from stdin, these will be processed after `PATH`s specified as command-line arguments

- error handling:
  - `--errors {fail,skip,ignore}`
  : when an error occurs:
    - `fail`: report failure and stop the execution (default)
    - `skip`: report failure but skip the reqres that produced it from the output and continue
    - `ignore`: `skip`, but don't report the failure

- filters:
  - `--or EXPR`
  : only print reqres which match any of these expressions...
  - `--and EXPR`
  : ... and all of these expressions, both can be specified multiple times, both use the same expression format as `wrrarms get --expr`, which see

- `--format=raw` output:
  - `--not-terminated`
  : don't terminate `raw` output values with anything, just concatenate them
  - `-l, --lf-terminated`
  : terminate `raw` output values with `\n` (LF) newline characters (default)
  - `-z, --zero-terminated`
  : terminate `raw` output values with `\0` (NUL) bytes

- file system path ordering:
  - `--paths-given-order`
  : `argv` and `--stdin0` `PATH`s are processed in the order they are given (default)
  - `--paths-sorted`
  : `argv` and `--stdin0` `PATH`s are processed in lexicographic order
  - `--paths-reversed`
  : `argv` and `--stdin0` `PATH`s are processed in reverse lexicographic order
  - `--walk-fs-order`
  : recursive file system walk is done in the order `readdir(2)` gives results
  - `--walk-sorted`
  : recursive file system walk is done in lexicographic order (default)
  - `--walk-reversed`
  : recursive file system walk is done in reverse lexicographic order

### wrrarms find

Print paths of WRR files matching specified criteria.

- positional arguments:
  - `PATH`
  : inputs, can be a mix of files and directories (which will be traversed recursively)

- options:
  - `--stdin0`
  : read zero-terminated `PATH`s from stdin, these will be processed after `PATH`s specified as command-line arguments

- error handling:
  - `--errors {fail,skip,ignore}`
  : when an error occurs:
    - `fail`: report failure and stop the execution (default)
    - `skip`: report failure but skip the reqres that produced it from the output and continue
    - `ignore`: `skip`, but don't report the failure

- filters:
  - `--or EXPR`
  : only output paths to reqres which match any of these expressions...
  - `--and EXPR`
  : ... and all of these expressions, both can be specified multiple times, both use the same expression format as `wrrarms get --expr`, which see

- output:
  - `-l, --lf-terminated`
  : output absolute paths of matching WRR files terminated with `\n` (LF) newline characters to stdout (default)
  - `-z, --zero-terminated`
  : output absolute paths of matching WRR files terminated with `\0` (NUL) bytes to stdout

- file system path ordering:
  - `--paths-given-order`
  : `argv` and `--stdin0` `PATH`s are processed in the order they are given (default)
  - `--paths-sorted`
  : `argv` and `--stdin0` `PATH`s are processed in lexicographic order
  - `--paths-reversed`
  : `argv` and `--stdin0` `PATH`s are processed in reverse lexicographic order
  - `--walk-fs-order`
  : recursive file system walk is done in the order `readdir(2)` gives results
  - `--walk-sorted`
  : recursive file system walk is done in lexicographic order (default)
  - `--walk-reversed`
  : recursive file system walk is done in reverse lexicographic order

### wrrarms organize

Parse given WRR files into their respective reqres and then rename/move/hardlink/symlink each file to `DESTINATION` with the new path derived from each reqres' metadata.

Operations that could lead to accidental data loss are not permitted.
E.g. `wrrarms organize --move` will not overwrite any files, which is why the default `--output` contains `%(num)d`.

- positional arguments:
  - `PATH`
  : inputs, can be a mix of files and directories (which will be traversed recursively)

- options:
  - `--dry-run`
  : perform a trial run without actually performing any changes
  - `-q, --quiet`
  : don't log computed updates to stderr
  - `-t DESTINATION, --to DESTINATION`
  : destination directory, when unset each source `PATH` must be a directory which will be treated as its own `DESTINATION`
  - `-o FORMAT, --output FORMAT`
  : format describing generated output paths, an alias name or "format:" followed by a custom pythonic %-substitution string:
    - available aliases and corresponding %-substitutions:
      - `default`: `%(syear)d/%(smonth)02d/%(sday)02d/%(shour)02d%(sminute)02d%(ssecond)02d%(stime_msq)03d_%(qtime_ms)s_%(method)s_%(net_url|sha256|prefix 4)s_%(status)s_%(hostname)s.%(num)d.wrr` (default)
      - `short`: `%(syear)d/%(smonth)02d/%(sday)02d/%(stime_ms)d_%(qtime_ms)s.%(num)d.wrr`
      - `surl`: `%(scheme)s/%(netloc)s/%(path_parts|pp_to_path)s%(oqm)s%(query_parts|qsl_to_path)s`
      - `url`: `%(netloc)s/%(path_parts|pp_to_path)s%(oqm)s%(query_parts|qsl_to_path)s`
      - `surl_msn`: `%(scheme)s/%(netloc)s/%(path_parts|pp_to_path)s%(oqm)s%(query_parts|qsl_to_path)s_%(method)s_%(status)s.%(num)d.wrr`
      - `url_msn`: `%(netloc)s/%(path_parts|pp_to_path)s%(oqm)s%(query_parts|qsl_to_path)s_%(method)s_%(status)s.%(num)d.wrr`
      - `shpq`: `%(scheme)s/%(hostname)s/%(wget_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(query_parts|qsl_to_path|abbrev 120)s.wrr`
      - `hpq`: `%(hostname)s/%(wget_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(query_parts|qsl_to_path|abbrev 120)s.wrr`
      - `shpq_msn`: `%(scheme)s/%(hostname)s/%(wget_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(query_parts|qsl_to_path|abbrev 100)s_%(method)s_%(status)s.%(num)d.wrr`
      - `hpq_msn`: `%(hostname)s/%(wget_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(query_parts|qsl_to_path|abbrev 100)s_%(method)s_%(status)s.%(num)d.wrr`
      - `shupq`: `%(scheme)s/%(hostname)s/%(wget_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(query_parts|qsl_to_path|abbrev 120)s.wrr`
      - `hupq`: `%(hostname)s/%(wget_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(query_parts|qsl_to_path|abbrev 120)s.wrr`
      - `shupq_msn`: `%(scheme)s/%(hostname)s/%(wget_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(query_parts|qsl_to_path|abbrev 100)s_%(method)s_%(status)s.%(num)d.wrr`
      - `hupq_msn`: `%(hostname)s/%(wget_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(query_parts|qsl_to_path|abbrev 100)s_%(method)s_%(status)s.%(num)d.wrr`
      - `srhupq`: `%(scheme)s/%(rhostname)s/%(wget_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(query_parts|qsl_to_path|abbrev 120)s.wrr`
      - `rhupq`: `%(rhostname)s/%(wget_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(query_parts|qsl_to_path|abbrev 120)s.wrr`
      - `srhupq_msn`: `%(scheme)s/%(rhostname)s/%(wget_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(query_parts|qsl_to_path|abbrev 100)s_%(method)s_%(status)s.%(num)d.wrr`
      - `rhupq_msn`: `%(rhostname)s/%(wget_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(query_parts|qsl_to_path|abbrev 100)s_%(method)s_%(status)s.%(num)d.wrr`
      - `shupnq`: `%(scheme)s/%(hostname)s/%(wget_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(query_ne_parts|qsl_to_path|abbrev 120)s.wrr`
      - `hupnq`: `%(hostname)s/%(wget_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(query_ne_parts|qsl_to_path|abbrev 120)s.wrr`
      - `shupnq_msn`: `%(scheme)s/%(hostname)s/%(wget_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(query_ne_parts|qsl_to_path|abbrev 100)s_%(method)s_%(status)s.%(num)d.wrr`
      - `hupnq_msn`: `%(hostname)s/%(wget_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(query_ne_parts|qsl_to_path|abbrev 100)s_%(method)s_%(status)s.%(num)d.wrr`
      - `flat`: `%(hostname)s/%(wget_parts|abbrev_each 120|pp_to_path|replace / __|abbrev 120)s%(oqm)s%(query_ne_parts|qsl_to_path|abbrev 100)s_%(method)s_%(net_url|sha256|prefix 4)s_%(status)s.wrr`
      - `flat_n`: `%(hostname)s/%(wget_parts|abbrev_each 120|pp_to_path|replace / __|abbrev 120)s%(oqm)s%(query_ne_parts|qsl_to_path|abbrev 100)s_%(method)s_%(net_url|sha256|prefix 4)s_%(status)s.%(num)d.wrr`
    - available substitutions:
      - `num`: number of times the resulting output path was encountered before; adding this parameter to your `--output` format will ensure all generated file names will be unique
      - all expressions of `wrrarms get --expr`, which see
  - `--stdin0`
  : read zero-terminated `PATH`s from stdin, these will be processed after `PATH`s specified as command-line arguments

- error handling:
  - `--errors {fail,skip,ignore}`
  : when an error occurs:
    - `fail`: report failure and stop the execution (default)
    - `skip`: report failure but skip the reqres that produced it from the output and continue
    - `ignore`: `skip`, but don't report the failure

- filters:
  - `--or EXPR`
  : only work on reqres which match any of these expressions...
  - `--and EXPR`
  : ... and all of these expressions, both can be specified multiple times, both use the same expression format as `wrrarms get --expr`, which see

- output:
  - `--no-output`
  : don't print anything to stdout (default)
  - `-l, --lf-terminated`
  : output absolute paths of newly produced files terminated with `\n` (LF) newline characters to stdout
  - `-z, --zero-terminated`
  : output absolute paths of newly produced files terminated with `\0` (NUL) bytes to stdout

- action:
  - `--move`
  : move source files under `DESTINATION` (default)
  - `--copy`
  : copy source files to files under `DESTINATION`
  - `--hardlink`
  : create hardlinks from source files to paths under `DESTINATION`
  - `--symlink`
  : create symlinks from source files to paths under `DESTINATION`

- updates:
  - `--keep`
  : disallow replacements and overwrites for any existing files under `DESTINATION` (default);
    broken symlinks are allowed to be replaced;
    if source and target directories are the same then some files can still be renamed into previously non-existing names;
    all other updates are disallowed
  - `--latest`
  : replace files under `DESTINATION` if `stime_ms` for the source reqres is newer than the same value for reqres stored at the destination

- batching and caching:
  - `--batch-number INT`
  : batch at most this many IO actions together (default: `1024`), making this larger improves performance at the cost of increased memory consumption, setting it to zero will force all IO actions to be applied immediately
  - `--cache-number INT`
  : cache `stat(2)` information about this many files in memory (default: `4096`);
    making this larger improves performance at the cost of increased memory consumption;
    setting this to a too small number will likely force {__package__} into repeatedly performing lots of `stat(2)` system calls on the same files;
    setting this to a value smaller than `--batch-number` will not improve memory consumption very much since batched IO actions also cache information about their own files
  - `--lazy`
  : sets `--cache-number` and `--batch-number` to positive infinity; most useful in combination with `--symlink --latest` in which case it will force `wrrarms` to compute the desired file system state first and then perform disk writes in a single batch

- file system path ordering:
  - `--paths-given-order`
  : `argv` and `--stdin0` `PATH`s are processed in the order they are given (default when `--keep`)
  - `--paths-sorted`
  : `argv` and `--stdin0` `PATH`s are processed in lexicographic order
  - `--paths-reversed`
  : `argv` and `--stdin0` `PATH`s are processed in reverse lexicographic order (default when `--latest`)
  - `--walk-fs-order`
  : recursive file system walk is done in the order `readdir(2)` gives results
  - `--walk-sorted`
  : recursive file system walk is done in lexicographic order (default when `--keep`)
  - `--walk-reversed`
  : recursive file system walk is done in reverse lexicographic order (default when `--latest`)

### wrrarms import

Parse data in each `INPUT` `PATH` into reqres and dump them under `DESTINATION` with paths derived from their metadata, similar to `organize`.

Internally, this shares most of the code with `organize`, but unlike `organize` this holds the whole reqres in memory until its written out to disk.

- file formats:
  - `{mitmproxy}`
    - `mitmproxy`
    : convert other archive formats into WRR files

### wrrarms import mitmproxy

- positional arguments:
  - `PATH`
  : inputs, can be a mix of files and directories (which will be traversed recursively)

- options:
  - `--dry-run`
  : perform a trial run without actually performing any changes
  - `-q, --quiet`
  : don't log computed updates to stderr
  - `-t DESTINATION, --to DESTINATION`
  : destination directory
  - `-o FORMAT, --output FORMAT`
  : format describing generated output paths, an alias name or "format:" followed by a custom pythonic %-substitution string; same as `wrrarms organize --output`, which see
  - `--stdin0`
  : read zero-terminated `PATH`s from stdin, these will be processed after `PATH`s specified as command-line arguments

- error handling:
  - `--errors {fail,skip,ignore}`
  : when an error occurs:
    - `fail`: report failure and stop the execution (default)
    - `skip`: report failure but skip the reqres that produced it from the output and continue
    - `ignore`: `skip`, but don't report the failure

- filters:
  - `--or EXPR`
  : only import reqres which match any of these expressions...
  - `--and EXPR`
  : ... and all of these expressions, both can be specified multiple times, both use the same expression format as `wrrarms get --expr`, which see

- output:
  - `--no-output`
  : don't print anything to stdout (default)
  - `-l, --lf-terminated`
  : output absolute paths of newly produced files terminated with `\n` (LF) newline characters to stdout
  - `-z, --zero-terminated`
  : output absolute paths of newly produced files terminated with `\0` (NUL) bytes to stdout

- file system path ordering:
  - `--paths-given-order`
  : `argv` and `--stdin0` `PATH`s are processed in the order they are given (default)
  - `--paths-sorted`
  : `argv` and `--stdin0` `PATH`s are processed in lexicographic order
  - `--paths-reversed`
  : `argv` and `--stdin0` `PATH`s are processed in reverse lexicographic order
  - `--walk-fs-order`
  : recursive file system walk is done in the order `readdir(2)` gives results
  - `--walk-sorted`
  : recursive file system walk is done in lexicographic order (default)
  - `--walk-reversed`
  : recursive file system walk is done in reverse lexicographic order

## Examples

- Pretty-print all reqres in `../dumb_server/pwebarc-dump` using an abridged (for ease of reading and rendering) verbose textual representation:
  ```
  wrrarms pprint ../dumb_server/pwebarc-dump
  ```

- Pipe response body from a given WRR file to stdout:
  ```
  wrrarms get ../dumb_server/pwebarc-dump/path/to/file.wrr
  ```

- Get first 4 characters of a hex digest of sha256 hash computed on the URL without the fragment/hash part:
  ```
  wrrarms get -e "net_url|sha256|prefix 4" ../dumb_server/pwebarc-dump/path/to/file.wrr
  ```

- Pipe response body from a given WRR file to stdout, but less efficiently, by generating a temporary file and giving it to `cat`:
  ```
  wrrarms run cat ../dumb_server/pwebarc-dump/path/to/file.wrr
  ```

  Thus `wrrarms run` can be used to do almost anything you want, e.g.

  ```
  wrrarms run less ../dumb_server/pwebarc-dump/path/to/file.wrr
  ```

  ```
  wrrarms run -- sort -R ../dumb_server/pwebarc-dump/path/to/file.wrr
  ```

  ```
  wrrarms run -n 2 -- diff -u ../dumb_server/pwebarc-dump/path/to/file-v1.wrr ../dumb_server/pwebarc-dump/path/to/file-v2.wrr
  ```

- List paths of all WRR files from `../dumb_server/pwebarc-dump` that contain only complete `200 OK` responses with bodies larger than 1K:
  ```
  wrrarms find --and "status|== 200C" --and "response.body|len|> 1024" ../dumb_server/pwebarc-dump
  ```

- Rename all WRR files in `../dumb_server/pwebarc-dump/default` according to their metadata using `--output default` (see the `wrrarms organize` section for its definition, the `default` format is designed to be human-readable while causing almost no collisions, thus making `num` substitution parameter to almost always stay equal to `0`, making things nice and deterministic):
  ```
  wrrarms organize ../dumb_server/pwebarc-dump/default
  ```

  alternatively, just show what would be done

  ```
  wrrarms organize --dry-run ../dumb_server/pwebarc-dump/default
  ```

- The output of `wrrarms organize --zero-terminated` can be piped into `wrrarms organize --stdin0` to perform complex updates. E.g. the following will rename new reqres from `../dumb_server/pwebarc-dump` to `~/pwebarc/raw` renaming them with `--output default`, the `for` loop is there to preserve profiles:
  ```
  for arg in ../dumb_server/pwebarc-dump/* ; do
    wrrarms organize --zero-terminated --to ~/pwebarc/raw/"$(basename "$arg")" "$arg"
  done > changes
  ```

  then, we can reuse `changes` to symlink all new files from `~/pwebarc/raw` to `~/pwebarc/all` using `--output hupq_msn`, which would show most of the URL in the file name:

  ```
  wrrarms organize --stdin0 --symlink --to ~/pwebarc/all --output hupq_msn < changes
  ```

  and then, we can reuse `changes` again and use them to update `~/pwebarc/latest`, filling it with symlinks pointing to the latest `200 OK` complete reqres from `~/pwebarc/raw`, similar to what `wget -r` would produce (except `wget` would do network requests and produce responce bodies, while this will build a file system tree of symlinks to WRR files in `/pwebarc/raw`):

  ```
  wrrarms organize --stdin0 --symlink --latest --to ~/pwebarc/latest --output hupq --and "status|== 200C" < changes
  ```

- `wrrarms organize --move` is de-duplicating when possible, while `--copy`, `--hardlink`, and `--symlink` are non-duplicating when possible, i.e.:
  ```
  wrrarms organize --copy     --to ~/pwebarc/copy1 ~/pwebarc/original
  wrrarms organize --copy     --to ~/pwebarc/copy2 ~/pwebarc/original
  wrrarms organize --hardlink --to ~/pwebarc/copy3 ~/pwebarc/original

  # noops
  wrrarms organize --copy     --to ~/pwebarc/copy1 ~/pwebarc/original
  wrrarms organize --hardlink --to ~/pwebarc/copy1 ~/pwebarc/original
  wrrarms organize --copy     --to ~/pwebarc/copy2 ~/pwebarc/original
  wrrarms organize --hardlink --to ~/pwebarc/copy2 ~/pwebarc/original
  wrrarms organize --copy     --to ~/pwebarc/copy3 ~/pwebarc/original
  wrrarms organize --hardlink --to ~/pwebarc/copy3 ~/pwebarc/original

  # de-duplicate
  wrrarms organize --move --to ~/pwebarc/all ~/pwebarc/original ~/pwebarc/copy1 ~/pwebarc/copy2 ~/pwebarc/copy3
  ```

  will produce `~/pwebarc/all` which has each duplicated file stored only once. Similarly,

  ```
  wrrarms organize --symlink --output hupq_msn --to ~/pwebarc/pointers ~/pwebarc/original
  wrrarms organize --symlink --output shupq_msn --to ~/pwebarc/schemed ~/pwebarc/original

  # noop
  wrrarms organize --symlink --output hupq_msn --to ~/pwebarc/pointers ~/pwebarc/original ~/pwebarc/schemed
  ```

  will produce `~/pwebarc/pointers` which has each symlink only once.

## Advanced examples

- Pretty-print all reqres in `../dumb_server/pwebarc-dump` by dumping their whole structure into an abridged Pythonic Object Representation (repr):
  ```
  wrrarms stream --expr . ../dumb_server/pwebarc-dump
  ```

  ```
  wrrarms stream -e . ../dumb_server/pwebarc-dump
  ```

- Pretty-print all reqres in `../dumb_server/pwebarc-dump` using the unabridged verbose textual representation:
  ```
  wrrarms pprint --unabridged ../dumb_server/pwebarc-dump
  ```

  ```
  wrrarms pprint -u ../dumb_server/pwebarc-dump
  ```

- Pretty-print all reqres in `../dumb_server/pwebarc-dump` by dumping their whole structure into the unabridged Pythonic Object Representation (repr) format:
  ```
  wrrarms stream --unabridged --expr . ../dumb_server/pwebarc-dump
  ```

  ```
  wrrarms stream -ue . ../dumb_server/pwebarc-dump
  ```

- Produce a JSON list of `[<file path>, <time it finished loading in milliseconds since UNIX epoch>, <URL>]` tuples (one per reqres) and pipe it into `jq` for indented and colored output:
  ```
  wrrarms stream --format=json -ue fs_path -e finished_at -e request.url ../dumb_server/pwebarc-dump | jq .
  ```

- Similarly, but produce a CBOR output:
  ```
  wrrarms stream --format=cbor -ue fs_path -e finished_at -e request.url ../dumb_server/pwebarc-dump | less
  ```

- Concatenate all response bodies of all the requests in `../dumb_server/pwebarc-dump`:
  ```
  wrrarms stream --format=raw --not-terminated -ue "response.body|es" ../dumb_server/pwebarc-dump | less
  ```

- Print all unique visited URLs, one per line:
  ```
  wrrarms stream --format=raw --lf-terminated -ue request.url ../dumb_server/pwebarc-dump | sort | uniq
  ```

- Same idea, but using NUL bytes while processing, and prints two URLs per line:
  ```
  wrrarms stream --format=raw --zero-terminated -ue request.url ../dumb_server/pwebarc-dump | sort -z | uniq -z | xargs -0 -n2 echo
  ```

### How to handle binary data

Trying to use response bodies produced by `wrrarms stream --format=json` is likely to result garbled data as JSON can't represent raw sequences of bytes, thus binary data will have to be encoded into UNICODE using replacement characters:

```
wrrarms stream --format=json -ue . ../dumb_server/pwebarc-dump/path/to/file.wrr | jq .
```

The most generic solution to this is to use `--format=cbor` instead, which would produce a verbose CBOR representation equivalent to the one used by `--format=json` but with binary data preserved as-is:

```
wrrarms stream --format=cbor -ue . ../dumb_server/pwebarc-dump/path/to/file.wrr | less
```

Or you could just dump raw response bodies separately:

```
wrrarms stream --format=raw -ue response.body ../dumb_server/pwebarc-dump/path/to/file.wrr | less
```

```
wrrarms get ../dumb_server/pwebarc-dump/path/to/file.wrr | less
```

