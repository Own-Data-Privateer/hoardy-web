# What?

`wrrarms` (`pwebarc-wrrarms`) is a tool for displaying and manipulating [Private Web Archive (pwebarc)](https://github.com/Own-Data-Privateer/pwebarc/) Web Request+Response (WRR) files produced by [pWebArc browser extension](https://github.com/Own-Data-Privateer/pwebarc/extension/).

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
  ```
- Alternatively, run without installing:
  ``` {.bash}
  python3 -m wrrarms --help
  ```

## Building a hierarchy of latest versions of all URLs

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

## Previewing WRR files

See [`wrrarms-xdg-open` script](./scripts/wrrarms-xdg-open) for a way to `xdg-open` `.wrr` files.

See [`wrrarms-w3m` script](./scripts/wrrarms-w3m) for an example of how you can use `wrrarms` and `w3m` to turn your WRR files containing HTML pages into readable plain-text.
There is also [`wrrarms-pandoc` script](./scripts/wrrarms-pandoc) that does the same via `pandoc`.

See the [scripts sub-directory](./scripts) for more examples.

# TODO

- Rendering into static website mirrors a-la `wget -k`.

  Currently, the extension archives everything except WebSockets data but `wrrarms` + `pandoc` only work well for dumps of mostly plain text websites (which is the main use case I use this whole thing for: scrape a website and then mass-convert everything to PDFs via some `pandoc` magic, then index those with `recoll`).

- Converter from `mitmproxy` dumps, HAR, WARC, and PCAP files into WRR.
- Converter from WRR to WARC.
- Data deduplication.
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
  - `{pprint,get,run,find,organize,stream}`
    - `pprint`
    : pretty-print WRR files
    - `get`
    : print expressions computed from a WRR file to stdout
    - `run`
    : spawn a process on generated temporary files produced from expressions computed on WRR files
    - `find`
    : print paths of WRR files matching specified criteria
    - `organize`
    : rename/hardlink/symlink WRR files based on their metadata
    - `stream`
    : produce a stream structured lists containing expressions computed from specified WRR files to stdout, a generalized `wrrarms get`

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

### wrrarms get

Compute output values by evaluating expressions `EXPR`s on a given reqres stored at `PATH`, then print them to stdout (terminating each value as specified).

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
      - `0`: replace `None` value with `0`
      - `1`: replace `None` value with `1`
      - `not`: apply logical `not` to value
      - `len`: apply `len` to value
      - `str`: cast value to `str` or fail
      - `bytes`: cast value to `bytes` or fail
      - `bool`: cast value to `bool` or fail
      - `int`: cast value to `int` or fail
      - `float`: cast value to `float` or fail
      - `unquote`: percent-encoding-unquote value
      - `unquote_plus`: percent-encoding-unquote value and replace `+` symbols with spaces
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
      - `replace`: replace all occurences of the first argument in the current value with the second argument, casts arguments to the same type as the current value
    - reqres fields, these work the same way as constants above, i.e. they replace current value of `None` with field's value, if reqres is missing the field in question, which could happen for `response*` fields, the result is `None`:
      - `version`: WEBREQRES format version; int
      - `source`: `+`-separated list of applications that produced this reqres; str
      - `protocol`: protocol (e.g. `"HTTP/1.0"`, `"HTTP/2.0"`); str
      - `request.started_at`: request start time in milliseconds since 1970-01-01 00:00; EpochMsec
      - `request.method`: request HTTP method (`"GET"`, `"POST"`, etc); str
      - `request.url`: request URL, including the fragment/hash part; str
      - `request.headers`: request headers; list[tuple[str, bytes]]
      - `request.complete`: is request body complete?; bool
      - `request.body`: request body; bytes
      - `response.started_at`: response start time in milliseconds since 1970-01-01 00:00; EpochMsec
      - `response.code`: HTTP response code (like `200`, `404`, etc); int
      - `response.reason`: HTTP response reason (like `"OK"`, `"Not Found"`, etc); usually empty for Chromium and filled for Firefox; str
      - `response.headers`: response headers; list[tuple[str, bytes]]
      - `response.complete`: is response body complete?; bool
      - `response.body`: response body; Firefox gives raw bytes, Chromium gives UTF-8 encoded strings; bytes | str
      - `finished_at`: request completion time in milliseconds since 1970-01-01 00:00; EpochMsec
    - derived attributes:
      - `fs_path`: file system path for the WRR file containing this reqres; str
      - `qtime_ms`: aliast for `request.started_at`; mnemonic: "reQuest TIME"; int
      - `qtime`: `qtime_ms` rounded down to seconds (UNIX epoch); int
      - `qtime_msq`: three least significant digits of `qtime_ms`; int
      - `qyear`: year number of `gmtime(qtime)` (UTC year number of `qtime`); int
      - `qmonth`: month number of `gmtime(qtime)`; int
      - `qday`: day of the month of `gmtime(qtime)`; int
      - `qhour`: hour of `gmtime(qtime)` in 24h format; int
      - `qminute`: minute of `gmtime(qtime)`; int
      - `qsecond`: second of `gmtime(qtime)`; int
      - `stime_ms`: `response.started_at` if there was a response, `finished_at` otherwise; mnemonic: "reSponse TIME"; int
      - `stime`: `stime_ms` rounded down to seconds (UNIX epoch); int
      - `stime_msq`: three least significant digits of `stime_msq`; int
      - `syear`: similar to `syear`, but for `stime`; int
      - `smonth`: similar to `smonth`, but for `stime`; int
      - `sday`: similar to `sday`, but for `stime`; int
      - `shour`: similar to `shour`, but for `stime`; int
      - `sminute`: similar to `sminute`, but for `stime`; int
      - `ssecond`: similar to `ssecond`, but for `stime`; int
      - `ftime_ms`: aliast for `finished_at`; int
      - `ftime`: `ftime_ms` rounded down to seconds (UNIX epoch); int
      - `ftime_msq`: three least significant digits of `ftime_msq`; int
      - `fyear`: similar to `syear`, but for `ftime`; int
      - `fmonth`: similar to `smonth`, but for `ftime`; int
      - `fday`: similar to `sday`, but for `ftime`; int
      - `fhour`: similar to `shour`, but for `ftime`; int
      - `fminute`: similar to `sminute`, but for `ftime`; int
      - `fsecond`: similar to `ssecond`, but for `ftime`; int
      - `status`: `"NR"` if there was no response, `str(response.code) + "C"` if response was complete, `str(response.code) + "N"` otherwise; str
      - `method`: aliast for `request.method`; str
      - `full_url`: aliast for `request.url`; str
      - `net_url`: `request.url` without the fragment/hash part, if any, this is the URL that actually gets sent to the server; str
      - `scheme`: scheme part of `request.url` (`http`, `https`); str
      - `netloc`: netloc part of `request.url` (i.e., in the most general case, `<username>:<password>@<hostname>:<port>`)
      - `hostname`: hostname part of `request.url`
      - `rhostname`: hostname part of `request.url` with the order of parts reversed, e.g. `"https://www.example.com"` -> `"com.example.www"`
      - `raw_path`: raw path part of `request.url`, e.g. `"https://www.example.com"` -> `""`, `"https://www.example.com/"` -> `"/"`, `"https://www.example.com/index.html"` -> `"/index.html"`
      - `path`: `raw_path` without the leading slash, if any, e.g. `"https://www.example.com"` -> `""`, `"https://www.example.com/"` -> `""`, `"https://www.example.com/index.html"` -> `"index.html"`
      - `ipath`: `path + "index.html"` if `path` is empty or ends with a slash, `path` otherwise
      - `query`: query part of `request.url` (everything after the `?` character and before the `#` character)
      - `nquery`: normalized `query` (with empty query parameters removed)
      - `nquery_url`: `full_url` with normalized `query`; str
      - `oqm`: optional query mark: `?` character if `query` is non-empty, an empty string otherwise; str
      - `fragment`: fragment (hash) part of the url; str
      - `ofm`: optional fragment mark: `#` character if `fragment` is non-empty, an empty string otherwise; str
    - a compound expression built by piping (`|`) the above, for example:
      - `net_url|sha256`
      - `net_url|sha256|prefix 4`
      - `path|unquote`
      - `query|unquote_plus|abbrev 128`
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

Compute output values by evaluating expressions `EXPR`s for each of `NUM` reqres stored at `PATH`s, dump the results into into newly generated temporary files (terminating each value as specified), spawn a given `COMMAND` with given arguments `ARG`s and the resulting temporary file paths appended as the last `NUM` arguments, wait for it to finish, delete the temporary files, exit with the return code of the spawned process.

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

### wrrarms find

Print paths of WRR files matching specified criteria.

- positional arguments:
  - `PATH`
  : inputs, can be a mix of files and directories (which will be traversed recursively)

- options:
  - `--stdin0`
  : read zero-terminated `PATH`s from stdin, these will be processed after `PATH`s specified as command-line arguments, requires specified `--to`

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
  - `-l, --lf-terminated`
  : output absolute paths of matching WRR files terminated with `\n` (LF) newline characters to stdout (default)
  - `-z, --zero-terminated`
  : output absolute paths of matching WRR files terminated with `\0` (NUL) bytes to stdout

### wrrarms organize

Rename/hardlink/symlink given WRR files to `DESTINATION` based on their metadata.

Operations that could lead to accidental data loss are not permitted.
E.g. `wrrarms organize --action rename` will not overwrite any files, which is why the default `--output` contains `%(num)d`.

- positional arguments:
  - `PATH`
  : inputs, can be a mix of files and directories (which will be traversed recursively)

- options:
  - `--dry-run`
  : perform a trial run without actually performing any changes
  - `-q, --quiet`
  : don't log computed updates to stderr
  - `-a {rename,hardlink,symlink,symlink-update}, --action {rename,hardlink,symlink,symlink-update}`
  : organize how:
    - `rename`: rename source files under `DESTINATION`, will fail if target already exists (default)
    - `hardlink`: create hardlinks from source files to paths under `DESTINATION`, will fail if target already exists
    - `symlink`: create symlinks from source files to paths under `DESTINATION`, will fail if target already exists
    - `symlink-update`: create symlinks from source files to paths under `DESTINATION`, will overwrite the target if `stime_ms` for the source reqres is newer than the same value for the target
  - `--batch-number INT`
  : batch at most this many `--action`s together (default: `1024`), making this larger improves performance at the cost of increased memory consumption, setting it to zero will force all `--action`s to be applied immediately
  - `--lazy`
  : sets `--batch-number` to positive infinity; most useful in combination with `--action symlink-update` in which case it will force `wrrarms` to compute the desired file system state first and then perform disk writes in a single batch
  - `-o FORMAT, --output FORMAT`
  : format describing the generated output path, an alias name or a custom pythonic %-substitution string:
    - available aliases and corresponding %-substitutions:
      - `default`: `%(syear)d/%(smonth)02d/%(sday)02d/%(shour)02d%(sminute)02d%(ssecond)02d%(stime_msq)03d_%(qtime_ms)s_%(method)s_%(net_url|sha256|prefix 4)s_%(status)s_%(hostname)s.%(num)d.wrr` (default)
      - `short`: `%(syear)d/%(smonth)02d/%(sday)02d/%(stime_ms)d_%(qtime_ms)s.%(num)d.wrr`
      - `surl`: `%(scheme)s/%(netloc)s/%(path)s%(oqm)s%(query)s`
      - `url`: `%(netloc)s/%(path)s%(oqm)s%(query)s`
      - `surl_msn`: `%(scheme)s/%(netloc)s/%(path)s%(oqm)s%(query)s_%(method)s_%(status)s.%(num)d.wrr`
      - `url_msn`: `%(netloc)s/%(path)s%(oqm)s%(query)s_%(method)s_%(status)s.%(num)d.wrr`
      - `shpq`: `%(scheme)s/%(hostname)s/%(ipath|abbrev 120)s%(oqm)s%(query|abbrev 120)s.wrr`
      - `hpq`: `%(hostname)s/%(ipath|abbrev 120)s%(oqm)s%(query|abbrev 120)s.wrr`
      - `shpq_msn`: `%(scheme)s/%(hostname)s/%(ipath|abbrev 120)s%(oqm)s%(query|abbrev 100)s_%(method)s_%(status)s.%(num)d.wrr`
      - `hpq_msn`: `%(hostname)s/%(ipath|abbrev 120)s%(oqm)s%(query|abbrev 100)s_%(method)s_%(status)s.%(num)d.wrr`
      - `shupq`: `%(scheme)s/%(hostname)s/%(ipath|unquote|abbrev 120)s%(oqm)s%(query|unquote_plus|abbrev 120)s.wrr`
      - `hupq`: `%(hostname)s/%(ipath|unquote|abbrev 120)s%(oqm)s%(query|unquote_plus|abbrev 120)s.wrr`
      - `shupq_msn`: `%(scheme)s/%(hostname)s/%(ipath|unquote|abbrev 120)s%(oqm)s%(query|unquote_plus|abbrev 100)s_%(method)s_%(status)s.%(num)d.wrr`
      - `hupq_msn`: `%(hostname)s/%(ipath|unquote|abbrev 120)s%(oqm)s%(query|unquote_plus|abbrev 100)s_%(method)s_%(status)s.%(num)d.wrr`
      - `srhupq`: `%(scheme)s/%(rhostname)s/%(ipath|unquote|abbrev 120)s%(oqm)s%(query|unquote_plus|abbrev 100)s.wrr`
      - `rhupq`: `%(rhostname)s/%(ipath|unquote|abbrev 120)s%(oqm)s%(query|unquote_plus|abbrev 100)s.wrr`
      - `srhupq_msn`: `%(scheme)s/%(rhostname)s/%(ipath|unquote|abbrev 120)s%(oqm)s%(query|unquote_plus|abbrev 100)s_%(method)s_%(status)s.%(num)d.wrr`
      - `rhupq_msn`: `%(rhostname)s/%(ipath|unquote|abbrev 120)s%(oqm)s%(query|unquote_plus|abbrev 100)s_%(method)s_%(status)s.%(num)d.wrr`
      - `shupnq`: `%(scheme)s/%(hostname)s/%(ipath|unquote|abbrev 120)s%(oqm)s%(nquery|unquote_plus|abbrev 120)s.wrr`
      - `hupnq`: `%(hostname)s/%(ipath|unquote|abbrev 120)s%(oqm)s%(nquery|unquote_plus|abbrev 120)s.wrr`
      - `shupnq_msn`: `%(scheme)s/%(hostname)s/%(ipath|unquote|abbrev 120)s%(oqm)s%(nquery|unquote_plus|abbrev 120)s_%(method)s_%(status)s.%(num)d.wrr`
      - `hupnq_msn`: `%(hostname)s/%(ipath|unquote|abbrev 120)s%(oqm)s%(nquery|unquote_plus|abbrev 120)s_%(method)s_%(status)s.%(num)d.wrr`
      - `flat`: `%(hostname)s/%(ipath|unquote|replace / __|abbrev 120)s%(oqm)s%(nquery|unquote_plus|replace / __|abbrev 100)s_%(method)s_%(net_url|sha256|prefix 4)s_%(status)s.wrr`
    - available substitutions:
      - `num`: number of times an output path like this was seen; this value gets incremened for each new WRR file generating the same path with `num` set to `0` and when the file at the path generated with the current value of `num` already exists; i.e. adding this parameter to your `--output` format will ensure all generated file names will be unique
      - all expressions of `wrrarms get --expr`, which see
  - `-t DESTINATION, --to DESTINATION`
  : target directory, when unset each source `PATH` must be a directory which will be treated as its own `DESTINATION`
  - `--stdin0`
  : read zero-terminated `PATH`s from stdin, these will be processed after `PATH`s specified as command-line arguments, requires specified `--to`

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
    - json: JavaScript Object Notation aka JSON (binary data can't be represented, UNICODE replacement characters will be used)
    - raw: concatenate raw values (termination is controlled by `*-terminated` options)
  - `-e EXPR, --expr EXPR`
  : an expression to compute, see `wrrarms get --expr` for more info on expression format, can be specified multiple times (default: `[]`); to dump all the fields of a reqres, specify "`.`"

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

- `--format=raw` output:
  - `--not-terminated`
  : don't terminate `raw` output values with anything, just concatenate them
  - `-l, --lf-terminated`
  : terminate `raw` output values with `\n` (LF) newline characters (default)
  - `-z, --zero-terminated`
  : terminate `raw` output values with `\0` (NUL) bytes

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
  wrrarms organize --stdin0 --action symlink --to ~/pwebarc/all --output hupq_msn < changes
  ```

  and then, we can reuse `changes` again and use them to update `~/pwebarc/latest`, filling it with symlinks pointing to the latest `200 OK` complete reqres from `~/pwebarc/raw`, similar to what `wget -r` would produce (except `wget` would do network requests and produce responce bodies, while this will build a file system tree of symlinks to WRR files in `/pwebarc/raw`):

  ```
  wrrarms organize --stdin0 --action symlink-update --to ~/pwebarc/latest --output hupq --and "status|== 200C" < changes
  ```

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

## Handling binary data

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

