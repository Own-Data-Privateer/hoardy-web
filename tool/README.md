# What?

`wrrarms` (`pwebarc-wrrarms`) is a tool for displaying, programmatically manipulating, organizing, importing, and exporting [Personal Private Passive Web Archive (pwebarc)](https://github.com/Own-Data-Privateer/pwebarc/) (also [there](https://oxij.org/software/pwebarc/)) Web Request+Response (WRR) files produced by [pWebArc browser extension](https://github.com/Own-Data-Privateer/pwebarc/tree/master/extension/) (also [there](https://oxij.org/software/pwebarc/tree/master/extension/)).

# Quickstart

## Installation

- Install with:
  ```bash
  pip install pwebarc-wrrarms
  ```
  and run as
  ```bash
  wrrarms --help
  ```
- Alternatively, install it via Nix
  ```bash
  nix-env -i -f ./default.nix
  wrrarms --help
  ```
- Alternatively, run without installing:
  ```bash
  alias wrrarms="python3 -m wrrarms"
  wrrarms --help
  ```

## Supported input file formats

### Simple WRR-dumps (`*.wrr`)

When you use [the `pWebArc` extension](../extension/) together with [the dumb archiving server](../dumb_server/), the latter writes [WRR-dumps pWebArc generates](../doc/data-on-disk.md) into separate `.wrr` files (aka "WRR files") in its dumping directory.
No further actions to use that data are required.

The situation is similar if you instead use `pWebArc` extension with "Export via `saveAs`" option enabled but `saveAs`-bundling option disabled (max bundle size set to zero).
The only difference is that WRR files will be put into `~/Downloads` or similar.

```bash
ls ~/Downloads/pWebArc-export-*
```

### Bundles of WRR-dumps (`*.wrrb`)

However, if instead of using any of the above you use `pWebArc` extension with both "Export via `saveAs`" and bundling options enabled, then, at the moment, you will need to `import` those `.wrrb` files (aka WRR-bundles) into separate WRR files first:

```bash
wrrarms import bundle --to ~/pwebarc/raw ~/Downloads/pWebArc-export-*
```

Note that `wrrarms` can parse `.wrr` files as single-dump `.wrrb` files, so the above will work even when some of the exported dumps are simple `.wrr` files (`pWebArc` generates those when exporting an only available per-bucket dump or when exporting dumps larger than set maximum bundle size).
So, essentially, the above command is equivalent to

```bash
wrrarms organize --copy --to ~/pwebarc/raw ~/Downloads/pWebArc-export-*.wrr
wrrarms import bundle --to ~/pwebarc/raw ~/Downloads/pWebArc-export-*.wrrb
```

### Other file formats

`wrrarms` can also use some other file formats as inputs.
See the documentation of the `wrrarms import` sub-command below for more info.

## How to merge multiple archive directories

To merge multiple input directories into one you can simply `wrrarms organize` them `--to` a new directory.
`wrrarms` will automatically deduplicate all the files in the generated result.

That is to say, for `wrrarms organize` (see the documentation below for more info):

- `--move` is de-duplicating when possible,
- while `--copy`, `--hardlink`, and `--symlink` are non-duplicating when possible.

For example, if you duplicate an input directory via `--copy` or `--hardlink`:

```bash
wrrarms organize --copy     --to ~/pwebarc/copy1 ~/pwebarc/original
wrrarms organize --hardlink --to ~/pwebarc/copy2 ~/pwebarc/original
```

(In real-life use different copies usually end up on in different backup drives or some such.)

Then, repeating the same command would a noop:

```bash
# noops
wrrarms organize --copy     --to ~/pwebarc/copy1 ~/pwebarc/original
wrrarms organize --hardlink --to ~/pwebarc/copy2 ~/pwebarc/original
```

And running the opposite command would also be a noop:

```bash
# noops
wrrarms organize --hardlink --to ~/pwebarc/copy1 ~/pwebarc/original
wrrarms organize --copy     --to ~/pwebarc/copy2 ~/pwebarc/original
```

And copying between copies is also a noop:

```bash
# noops
wrrarms organize --hardlink --to ~/pwebarc/copy2 ~/pwebarc/copy1
wrrarms organize --copy     --to ~/pwebarc/copy2 ~/pwebarc/copy1
```

But doing `wrrarms organize --move` while supplying directories that have the same data will deduplicate the results:

```bash
wrrarms organize --move --to ~/pwebarc/all ~/pwebarc/copy1 ~/pwebarc/copy2
# `~/pwebarc/all` will have each file only once
find ~/pwebarc/copy1 ~/pwebarc/copy2 -type f
# the output will be empty

wrrarms organize --move --to ~/pwebarc/original ~/pwebarc/all
# `~/pwebarc/original` will not change iff it is already organized using `--output default`
# otherwise, some files there will be duplicated
find ~/pwebarc/all -type f
# the output will be empty
```

Similarly, `wrrarms organize --symlink` resolves its input symlinks and deduplicates its output symlinks:

```bash
wrrarms organize --symlink --output hupq_msn --to ~/pwebarc/pointers ~/pwebarc/original
wrrarms organize --symlink --output shupq_msn --to ~/pwebarc/schemed ~/pwebarc/original

# noop
wrrarms organize --symlink --output hupq_msn --to ~/pwebarc/pointers ~/pwebarc/original ~/pwebarc/schemed
```

I.e. the above will produce `~/pwebarc/pointers` with unique symlinks pointing to each file in `~/pwebarc/original` only once.

## How to build a file system tree of latest versions of all hoarded URLs

Assuming you keep your WRR-dumps in `~/pwebarc/raw` you can generate a hierarchy of symlinks for each URL pointing from under `~/pwebarc/latest` to the most recent WRR file that contains `200 OK` response in `~/pwebarc/raw` via:

```bash
wrrarms organize --symlink --latest --output hupq --to ~/pwebarc/latest --and "status|~= .200C" ~/pwebarc/raw
```

Personally, I prefer `flat_mhs` (see the documentation of the `--output` below) format as I dislike deep file hierarchies, using it also simplifies filtering in my `ranger` file browser, so I do this:

```bash
wrrarms organize --symlink --latest --output flat_mhs --and "status|~= .200C" --to ~/pwebarc/latest ~/pwebarc/raw
```

### Update the tree incrementally, in real time

The above commands rescan the whole contents of `~/pwebarc/raw` and so can take a while to complete.

If you have a lot of WRR files and you want to keep your symlink tree updated in near-real-time you will need to use a two-stage pipeline by giving the output of `wrrarms organize --zero-terminated` to `wrrarms organize --stdin0` to perform complex updates.

E.g. the following will rename new reqres from `../dumb_server/pwebarc-dump` to `~/pwebarc/raw` renaming them with `--output default` (the `for` loop is there to preserve buckets/profiles):

```bash
for arg in ../dumb_server/pwebarc-dump/* ; do
  wrrarms organize --zero-terminated --to ~/pwebarc/raw/"$(basename "$arg")" "$arg"
done > changes
```

Then, you can reuse the paths saved in `changes` file to update the symlink tree, like in the above:

```
wrrarms organize --stdin0 --symlink --latest --output flat_mhs --and "status|~= .200C" --to ~/pwebarc/latest ~/pwebarc/raw < changes
```

Then, optionally, you can reuse `changes` file again to symlink all new files from `~/pwebarc/raw` to `~/pwebarc/all`, showing all URL versions, by using `--output hupq_msn` format:

```bash
wrrarms organize --stdin0 --symlink --output hupq_msn --to ~/pwebarc/all < changes
```

## <span id="mirror"/>How to generate a local offline website mirror like `wget -mpk`

If you want to render your WRR files into a local offline website mirror containing interlinked HTML files and their resources a-la `wget -mpk` (`wget --mirror --page-requisites --convert-links`), run one of the above `--symlink --latest` commands, and then do something like this:

```bash
wrrarms export mirror --to ~/pwebarc/mirror1 ~/pwebarc/latest/archiveofourown.org
```

on completion `~/pwebarc/mirror1` will contain a bunch of interlinked minimized HTML files, their resources, and everything else available from WRR files living under `~/pwebarc/latest/archiveofourown.org`.

The above command might fail if the set of WRR-dumps you are trying to export contains two or more dumps with distinct URLs that map to the same `--output` path.
This will produce an error since `wrrarms` does not permit file overwrites.
With the default `--output hupq` format this can happen, for instance, when the URLs recorded in the reqres are long and so they end up truncated into the same file system paths.

In this case you can either switch to a more verbose `--output` format

```bash
wrrarms export mirror --output hupq_n --to ~/pwebarc/mirror1 ~/pwebarc/latest/archiveofourown.org
```

or skip all reqres that would cause overwrites

```bash
wrrarms export mirror --skip-existing --to ~/pwebarc/mirror1 ~/pwebarc/latest/archiveofourown.org
```

or, almost equivalently for this use case, skip all export errors (which includes "no overwrites allowed" error)

```bash
wrrarms export mirror --errors skip --to ~/pwebarc/mirror1 ~/pwebarc/latest/archiveofourown.org
```

The latter command would also skip reqres that fail to be exported for other reasons.

By default, *all* the links in exported HTML files will be remapped to local files (even if source WRR files for those would-be exported files are missing in `~/pwebarc/latest/archiveofourown.org`, see the documentation for the `--remap-*` options below for more info), and those HTML files will also be stripped of all JavaScript, CSS, and other stuff of various levels of evil (see the documentation for the `scrub` function below for more info).

On the plus side, the result will be completely self-contained and safe to view with a dumb unconfigured browser.

If you are unhappy with this behaviour and, for instance, want to keep the CSS and produce human-readable HTML, run the following instead:

```bash
wrrarms export mirror \
  -e 'response.body|eb|scrub response +all_refs,-actions,+styles,+pretty' \
  --to ~/pwebarc/mirror2 ~/pwebarc/latest/archiveofourown.org
```

Note, however, that CSS resource filtering and remapping is not implemented yet.

If you also want to keep links that point to not yet hoarded Internet URLs to still point those URLs in the exported files instead of them pointing to non-existent local files, similarly to what `wget -mpk` does, run `wrrarms export mirror` with `--remap-open`, e.g.:

```bash
wrrarms export mirror \
  -e 'response.body|eb|scrub response +all_refs,-actions,+styles,+pretty' \
  --remap-open \
  --to ~/pwebarc/mirror3 ~/pwebarc/latest/archiveofourown.org
```

Finally, if you want a mirror made of raw files without any content censorship or link conversions, run:

```bash
wrrarms export mirror -e 'response.body|eb' --to ~/pwebarc/mirror-raw ~/pwebarc/latest/archiveofourown.org
```

The later command will render your mirror pretty quickly, but the other above-mentioned commands will call the `scrub` function, and that will be pretty slow (as in avg ~5Mb, ~3 files per second on my 2013-era laptop), mostly because `html5lib` that `wrrarms` uses for paranoid HTML parsing and filtering is fairly slow.

### Using `--root` and `--depth`

As an alternative to (or in combination with) keeping a symlink hierarchy of latest versions, you can load (an index of) an assortment of WRR files into `wrrarms`'s memory but then `export mirror` only select URLs (and all resources needed to properly render those pages) by running something like:

```
wrrarms export mirror \
  --root 'https://archiveofourown.org/works/3733123?view_adult=true&view_full_work=true' \
  --root 'https://archiveofourown.org/works/30186441?view_adult=true&view_full_work=true' \
  --to ~/pwebarc/mirror4 ~/pwebarc/raw/*/2023
```

(`wrrarms` loads (indexes) WRR files pretty fast, so if you are running from an SSD, you can totally feed it years of WRR files and then only export a couple of URLs, and it will take a couple of seconds to finish anyway.)

There is also `--depth` option, which works similarly to `wget`'s `--level` option in that it will follow all jump (`a href`) and action links accessible with no more than `--depth` browser navigations from recursion `--root`s and then `export mirror` all those URLs (and their resources) too.

When using `--root` options, `--remap-open` works exactly like `wget`'s `--convert-links` in that it will only remap the URLs that are going to be exported and will keep the rest as-is.
Similarly, `--remap-closed` will consider only the URLs reachable from the `--root`s in no more that `--depth` jumps as available.

## <span id="mitmproxy-mirror"/>How to generate local offline website mirrors like `wget -mpk` from you old `mitmproxy` stream dumps

Assuming `mitmproxy.001.dump`, `mitmproxy.002.dump`, etc are files that were produced by running something like

```bash
mitmdump -w +mitmproxy.001.dump
```

at some point, you can generate website mirrors from them by first importing them all to WRR

```bash
wrrarms import mitmproxy --to ~/pwebarc/mitmproxy mitmproxy.*.dump
```

and then `export mirror` like above, e.g. to generate mirrors for all URLs:

```bash
wrrarms export mirror --to ~/pwebarc/mirror ~/pwebarc/mitmproxy
```

## How to generate previews for WRR files, listen to them via TTS, open them with `xdg-open`, etc

See [`script` sub-directory](./script/) for examples that show how to use `pandoc` and/or `w3m` to turn WRR files into previews and readable plain-text that can viewed or listened to via other tools, or dump them into temporary raw data files that can then be immediately fed to `xdg-open` for one-click viewing.

# Usage

## wrrarms

A tool to pretty-print, compute and print values from, search, organize (programmatically rename/move/symlink/hardlink files), import, export, (WIP: check, deduplicate, and edit) pWebArc WRR (WEBREQRES, Web REQuest+RESponse) archive files.

Terminology: a `reqres` (`Reqres` when a Python type) is an instance of a structure representing HTTP request+response pair with some additional metadata.

- options:
  - `--version`
  : show program's version number and exit
  - `-h, --help`
  : show this help message and exit
  - `--markdown`
  : show help messages formatted in Markdown

- subcommands:
  - `{pprint,get,run,stream,find,organize,import,export}`
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
    : convert other HTTP archive formats into WRR
    - `export`
    : convert WRR archives into other formats

### wrrarms pprint

Pretty-print given WRR files to stdout.

- positional arguments:
  - `PATH`
  : inputs, can be a mix of files and directories (which will be traversed recursively)

- options:
  - `-u, --unabridged`
  : print all data in full
  - `--abridged`
  : shorten long strings for brevity, useful when you want to visually scan through batch data dumps; default
  - `--stdin0`
  : read zero-terminated `PATH`s from stdin, these will be processed after `PATH`s specified as command-line arguments

- error handling:
  - `--errors {fail,skip,ignore}`
  : when an error occurs:
    - `fail`: report failure and stop the execution; default
    - `skip`: report failure but skip the reqres that produced it from the output and continue
    - `ignore`: `skip`, but don't report the failure

- filters; both can be specified at the same time, both can be specified multiple times, both use the same expression format as `wrrarms get --expr` (which see), the resulting logical expression that will checked is `(O1 or O2 or ... or (A1 and A2 and ...))`, where `O1`, `O2`, ... are the arguments to `--or`s and `A1`, `A2`, ... are the arguments to `--and`s:
  - `--or EXPR`
  : only print reqres which match any of these expressions
  - `--and EXPR`
  : only print reqres which match all of these expressions

- MIME type sniffing:
  - `--naive`
  : populate "potentially" lists like `wrrarms (get|run|export) --expr '(request|response).body|eb|scrub \2 defaults'` does; default
  - `--paranoid`
  : populate "potentially" lists in the output using paranoid MIME type sniffing like `wrrarms (get|run|export) --expr '(request|response).body|eb|scrub \2 +paranoid'` does; this exists to answer "Hey! Why did it censor out my data?!" questions

- file system path ordering:
  - `--paths-given-order`
  : `argv` and `--stdin0` `PATH`s are processed in the order they are given; default
  - `--paths-sorted`
  : `argv` and `--stdin0` `PATH`s are processed in lexicographic order
  - `--paths-reversed`
  : `argv` and `--stdin0` `PATH`s are processed in reverse lexicographic order
  - `--walk-fs-order`
  : recursive file system walk is done in the order `readdir(2)` gives results
  - `--walk-sorted`
  : recursive file system walk is done in lexicographic order; default
  - `--walk-reversed`
  : recursive file system walk is done in reverse lexicographic order

### wrrarms get

Compute output values by evaluating expressions `EXPR`s on a given reqres stored at `PATH`, then print them to stdout terminating each value as specified.

- positional arguments:
  - `PATH`
  : input WRR file path

- expression evaluation:
  - `--expr-fd INT`
  : file descriptor to which the results of evaluations of the following `--expr`s computations should be written; can be specified multiple times, thus separating different `--expr`s into different output streams; default: `1`, i.e. `stdout`
  - `-e EXPR, --expr EXPR`
  : an expression to compute; can be specified multiple times in which case computed outputs will be printed sequentially; see also "printing" options below; default: `response.body|eb`, which will dump the HTTP response body; each `EXPR` describes a state-transformer (pipeline) which starts from value `None` and evaluates a script built from the following:
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
      - `echo`: replace the value with the given string
      - `quote`: URL-percent-encoding quote value
      - `quote_plus`: URL-percent-encoding quote value and replace spaces with `+` symbols
      - `unquote`: URL-percent-encoding unquote value
      - `unquote_plus`: URL-percent-encoding unquote value and replace `+` symbols with spaces
      - `to_ascii`: encode `str` value into `bytes` with "ascii" codec
      - `to_utf8`: encode `str` value into `bytes` with "utf-8" codec
      - `sha256`: replace `bytes` value with its `sha256` hex digest (`hex(sha256(value))`)
      - `~=`: check if the current value matches the regular exprission `arg`
      - `==`: apply `== arg`, `arg` is cast to the same type as the current value
      - `!=`: apply `!= arg`, similarly
      - `<`: apply `< arg`, similarly
      - `<=`: apply `<= arg`, similarly
      - `>`: apply `> arg`, similarly
      - `>=`: apply `>= arg`, similarly
      - `add_prefix`: add prefix to the current value
      - `add_suffix`: add suffix to the current value
      - `take_prefix`: take first `arg` characters or list elements from the current value
      - `take_suffix`: take last `arg` characters or list elements  from the current value
      - `abbrev`: leave the current value as-is if if its length is less or equal than `arg` characters, otherwise take first `arg/2` followed by last `arg/2` characters
      - `abbrev_each`: `abbrev arg` each element in a value `list`
      - `replace`: replace all occurences of the first argument in the current value with the second argument, casts arguments to the same type as the current value
      - `pp_to_path`: encode `path_parts` `list` into a POSIX path, quoting as little as needed
      - `qsl_urlencode`: encode parsed `query` `list` into a URL's query component `str`
      - `qsl_to_path`: encode `query` `list` into a POSIX path, quoting as little as needed
      - `scrub`: scrub the value by optionally rewriting links and/or removing dynamic content from it; what gets done depends on `--remap-*` command line options, the MIME type of the value itself, and the scrubbing options described below; this fuction takes two arguments:
            - the first must be either of `request|response`, it controls which HTTP headers `scrub` should inspect to help it detect the MIME type;
            - the second is either `defaults` or ","-separated string of `(+|-)(paranoid|unknown|jumps|actions|srcs|all_refs|scripts|iframes|styles|iepragmas|prefetches|tracking|dyndoc|all_dyns|verbose|whitespace|optional_tags|indent|pretty|debug)` tokens which control the scrubbing behaviour:
              - `+paranoid` will assume the server is lying in its `Content-Type` and `X-Content-Type-Options` HTTP headers, sniff the contents of `(request|response).body` to determine what it actually contains regardless of what the server said, and then use the most paranoid interpretation of both the HTTP headers and the sniffed possible MIME types to decide what should be kept and what sholuld be removed by the options below; i.e., this will make `-unknown`, `-scripts`, and `-styles` options below to censor out more things, in particular, at the moment, most plain text files will get censored out as potential JavaScript; the default is `-paranoid`;
              - `(+|-)unknown` controls if the data with unknown content types should passed to the output unchanged or censored out (respectively); the default is `+unknown`, which will keep data of unknown content types as-is;
              - `(+|-)(jumps|actions|srcs)` control which kinds of references to other documents should be remapped or censored out (respectively); i.e. it controls whether jump-links (HTML `a href`, `area href`, and similar), action-links (HTML `a ping`, `form action`, and similar), and/or resource references (HTML `img src`, `iframe src`, CSS `url` references, and similar) should be remapped using the specified `--remap-*` option (which see) or censored out similarly to how `--remap-void` will do it; the default is `+jumps,-actions,-srcs` which will produce a self-contained result that can be fed into another tool --- be it a web browser or `pandoc` --- without that tool trying to access the Internet;
              - `(+|-)all_refs` is equivalent to enabling or disabling all of the above options simultaneously;
              - `(+|-)(scripts|iframes|styles|iepragmas|prefetches|tracking)` control which things should be kept or censored out w.r.t. to HTML, CSS, and JavaScript, i.e. it controls whether JavaScript (both separate files and HTML tags and attributes), `<iframe>` HTML tags, CSS (both separate files and HTML tags and attributes; why? because CSS is Turing-complete), HTML Internet-Explorer pragmas, HTML content prefetch `link` tags, and other tracking HTML tags and attributes (like `a ping` attributes), should be respectively kept in or censored out from the input; the default is `-scripts,-iframes,-styles,-iepragmas,-prefetches,-tracking` which ensures the result will not produce any prefetch and tracking requests when loaded in a web browser, and that the whole result is simple data, not a program in some Turing-complete language, thus making it safe to feed the result to other tools too smart for their own users' good;
              - `(+|-)all_dyns` is equivalent to enabling or disabling all of the above (`scripts|...`) options simultaneously;
              - `(+|-)verbose` controls whether tag censoring controlled by the above options is to be reported in the output (as comments) or stuff should be wiped from existence without evidence instead; the default is `-verbose`;
              - `(+|-)whitespace` controls whether HTML renderer should keep the original HTML whitespace as-is or collapse it away (respectively); the default is `-whitespace`;
              - `(+|-)optional_tags` controls whether HTML renderer should put optional HTML tags into the output or skip them (respectively); the default is `+optional_tags` (because many tools fail to parse minimized HTML properly);
              - `(+|-)indent` controls whether HTML renderer should indent HTML elements (where whitespace placement in the original markup allows for it) or not (respectively); the default is `-indent`;
              - `+pretty` is an alias for `+verbose,-whitespace,+indent` which produces the prettiest possible human-readable output that keeps the original whitespace semantics; `-pretty` is an alias for `+verbose,+whitespace,-indent` which produces the approximation of the original markup with censoring applied; neither is the default;
              - `+debug` is an alias for `+pretty` that also uses a much more aggressive version of `indent` that ignores the semantics of original whitespace placement, i.e. it will indent `<p>not<em>sep</em>arated</p>` as if there was whitespace before and after `p`, `em`, `/em`, and `/p` tags; this is useful for debugging custom mutations; `-debug` is noop, which is the default;
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
      - `fs_path`: file system path for the WRR file containing this reqres; str | bytes | None
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
      - `status`: `"I"` or  `"C"` depending on the value of `request.complete` (`false` or `true`, respectively) followed by either `"N"`, whene `response == None`, or `str(response.code)` followed by `"I"` or  `"C"` depending on the value of `response.complete`; str
      - `method`: aliast for `request.method`; str
      - `raw_url`: aliast for `request.url`; str
      - `net_url`: `raw_url` with Punycode UTS46 IDNA encoded hostname, unsafe characters quoted, and without the fragment/hash part; this is the URL that actually gets sent to the server; str
      - `pretty_url`: `raw_url`, but using `hostname`, `mq_path`, and `mq_query`; str
      - `pretty_nurl`: `raw_url`, but using `hostname`, `mq_path`, and `mq_nquery`; str
      - `scheme`: scheme part of `raw_url`; e.g. `http`, `https`, etc; str
      - `raw_hostname`: hostname part of `raw_url` as it is recorded in the reqres; str
      - `net_hostname`: hostname part of `raw_url`, encoded as Punycode UTS46 IDNA; this is what actually gets sent to the server; ASCII str
      - `hostname`: `net_hostname` decoded back into UNICODE; this is the canonical hostname representation for which IDNA-encoding and decoding are bijective; UNICODE str
      - `rhostname`: `hostname` with the order of its parts reversed; e.g. `"www.example.org"` -> `"com.example.www"`; str
      - `port`: port part of `raw_url`; str
      - `netloc`: netloc part of `raw_url`; i.e., in the most general case, `<username>:<password>@<hostname>:<port>`; str
      - `raw_path`: raw path part of `raw_url` as it is recorded is the reqres; e.g. `"https://www.example.org"` -> `""`, `"https://www.example.org/"` -> `"/"`, `"https://www.example.org/index.html"` -> `"/index.html"`; str
      - `path_parts`: component-wise unquoted "/"-split `raw_path` with empty components removed and dots and double dots interpreted away; e.g. `"https://www.example.org"` -> `[]`, `"https://www.example.org/"` -> `[]`, `"https://www.example.org/index.html"` -> `["index.html"]` , `"https://www.example.org/skipped/.//../used/"` -> `["used"]`; list[str]
      - `mq_path`: `path_parts` turned back into a minimally-quoted string; str
      - `filepath_parts`: `path_parts` transformed into components usable as an exportable file name; i.e. `path_parts` with an optional additional `"index"` appended, depending on `raw_url` and `response` MIME type; extension will be stored separately in `filepath_ext`; e.g. for HTML documents `"https://www.example.org/"` -> `["index"]`, `"https://www.example.org/test.html"` -> `["test"]`, `"https://www.example.org/test"` -> `["test", "index"]`, `"https://www.example.org/test.json"` -> `["test.json", "index"]`, but if it has a JSON MIME type then `"https://www.example.org/test.json"` -> `["test"]` (and `filepath_ext` will be set to `".json"`); this is similar to what `wget -mpk` does, but a bit smarter; list[str]
      - `filepath_ext`: extension of the last component of `filepath_parts` for recognized MIME types, `".data"` otherwise; str
      - `raw_query`: query part of `raw_url` (i.e. everything after the `?` character and before the `#` character) as it is recorded in the reqres; str
      - `query_parts`: parsed (and component-wise unquoted) `raw_query`; list[tuple[str, str]]
      - `query_ne_parts`: `query_parts` with empty query parameters removed; list[tuple[str, str]]
      - `mq_query`: `query_parts` turned back into a minimally-quoted string; str
      - `mq_nquery`: `query_ne_parts` turned back into a minimally-quoted string; str
      - `oqm`: optional query mark: `?` character if `query` is non-empty, an empty string otherwise; str
      - `fragment`: fragment (hash) part of the url; str
      - `ofm`: optional fragment mark: `#` character if `fragment` is non-empty, an empty string otherwise; str
    - a compound expression built by piping (`|`) the above, for example:
      - `response.body|eb` (the default for `get`) will print raw `response.body` or an empty byte string, if there was no response;
      - `response.body|eb|scrub response defaults` will take the above value, `scrub` it using default content scrubbing settings which will censor out all action and resource reference URLs;
      - `response.body|eb|scrub response +all_refs,-actions` (the default for `export`) will remap all `href` jump-links and `src` resource references to local files while still censoring out all action URLs (since those don't make sense for a static mirror);
      - `response.complete` will print the value of `response.complete` or `None`, if there was no response;
      - `response.complete|false` will print `response.complete` or `False`;
      - `net_url|to_ascii|sha256` will print `sha256` hash of the URL that was actually sent over the network;
      - `net_url|to_ascii|sha256|take_prefix 4` will print the first 4 characters of the above;
      - `path_parts|take_prefix 3|pp_to_path` will print first 3 path components of the URL, minimally quoted to be used as a path;
      - `query_ne_parts|take_prefix 3|qsl_to_path|abbrev 128` will print first 3 non-empty query parameters of the URL, abbreviated to 128 characters or less, minimally quoted to be used as a path;

- URL remapping; used by `scrub` atom of `--expr`:
  - `--remap-id`
  : remap all URLs with an identity function; i.e. don't remap anything; default
  - `--remap-void`
  : remap all jump-link and action URLs to `javascript:void(0)` and all resource URLs into empty `data:` URLs; resulting web pages will be self-contained

- printing:
  - `--not-separated`
  : print values without separating them with anything, just concatenate them
  - `-l, --lf-separated`
  : print values separated with `\n` (LF) newline characters; default
  - `-z, --zero-separated`
  : print values separated with `\0` (NUL) bytes

### wrrarms run

Compute output values by evaluating expressions `EXPR`s for each of `NUM` reqres stored at `PATH`s, dump the results into into newly generated temporary files terminating each value as specified, spawn a given `COMMAND` with given arguments `ARG`s and the resulting temporary file paths appended as the last `NUM` arguments, wait for it to finish, delete the temporary files, exit with the return code of the spawned process.

- positional arguments:
  - `COMMAND`
  : command to spawn
  - `ARG`
  : additional arguments to give to the `COMMAND`
  - `PATH`
  : input WRR file paths to be mapped into new temporary files

- options:
  - `-n NUM, --num-args NUM`
  : number of `PATH`s; default: `1`

- expression evaluation:
  - `-e EXPR, --expr EXPR`
  : an expression to compute, same expression format and semantics as `wrrarms get --expr` (which see); can be specified multiple times; default: `response.body|eb`, which will dump the HTTP response body

- URL remapping; used by `scrub` atom of `--expr`:
  - `--remap-id`
  : remap all URLs with an identity function; i.e. don't remap anything; default
  - `--remap-void`
  : remap all jump-link and action URLs to `javascript:void(0)` and all resource URLs into empty `data:` URLs; resulting web pages will be self-contained

- printing:
  - `--not-separated`
  : print values without separating them with anything, just concatenate them
  - `-l, --lf-separated`
  : print values separated with `\n` (LF) newline characters; default
  - `-z, --zero-separated`
  : print values separated with `\0` (NUL) bytes

### wrrarms stream

Compute given expressions for each of given WRR files, encode them into a requested format, and print the result to stdout.

- positional arguments:
  - `PATH`
  : inputs, can be a mix of files and directories (which will be traversed recursively)

- options:
  - `-u, --unabridged`
  : print all data in full
  - `--abridged`
  : shorten long strings for brevity, useful when you want to visually scan through batch data dumps; default
  - `--format {py,cbor,json,raw}`
  : generate output in:
    - py: Pythonic Object Representation aka `repr`; default
    - cbor: CBOR (RFC8949)
    - json: JavaScript Object Notation aka JSON; **binary data can't be represented, UNICODE replacement characters will be used**
    - raw: concatenate raw values; termination is controlled by `*-terminated` options
  - `--stdin0`
  : read zero-terminated `PATH`s from stdin, these will be processed after `PATH`s specified as command-line arguments

- error handling:
  - `--errors {fail,skip,ignore}`
  : when an error occurs:
    - `fail`: report failure and stop the execution; default
    - `skip`: report failure but skip the reqres that produced it from the output and continue
    - `ignore`: `skip`, but don't report the failure

- filters; both can be specified at the same time, both can be specified multiple times, both use the same expression format as `wrrarms get --expr` (which see), the resulting logical expression that will checked is `(O1 or O2 or ... or (A1 and A2 and ...))`, where `O1`, `O2`, ... are the arguments to `--or`s and `A1`, `A2`, ... are the arguments to `--and`s:
  - `--or EXPR`
  : only print reqres which match any of these expressions
  - `--and EXPR`
  : only print reqres which match all of these expressions

- expression evaluation:
  - `-e EXPR, --expr EXPR`
  : an expression to compute, same expression format and semantics as `wrrarms get --expr` (which see); can be specified multiple times; default: `.`, which will dump the whole reqres structure

- URL remapping; used by `scrub` atom of `--expr`:
  - `--remap-id`
  : remap all URLs with an identity function; i.e. don't remap anything; default
  - `--remap-void`
  : remap all jump-link and action URLs to `javascript:void(0)` and all resource URLs into empty `data:` URLs; resulting web pages will be self-contained

- `--format=raw` output printing:
  - `--not-terminated`
  : print `--format=raw` output values without terminating them with anything, just concatenate them
  - `-l, --lf-terminated`
  : print `--format=raw` output values terminated with `\n` (LF) newline characters; default
  - `-z, --zero-terminated`
  : print `--format=raw` output values terminated with `\0` (NUL) bytes

- file system path ordering:
  - `--paths-given-order`
  : `argv` and `--stdin0` `PATH`s are processed in the order they are given; default
  - `--paths-sorted`
  : `argv` and `--stdin0` `PATH`s are processed in lexicographic order
  - `--paths-reversed`
  : `argv` and `--stdin0` `PATH`s are processed in reverse lexicographic order
  - `--walk-fs-order`
  : recursive file system walk is done in the order `readdir(2)` gives results
  - `--walk-sorted`
  : recursive file system walk is done in lexicographic order; default
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
    - `fail`: report failure and stop the execution; default
    - `skip`: report failure but skip the reqres that produced it from the output and continue
    - `ignore`: `skip`, but don't report the failure

- filters; both can be specified at the same time, both can be specified multiple times, both use the same expression format as `wrrarms get --expr` (which see), the resulting logical expression that will checked is `(O1 or O2 or ... or (A1 and A2 and ...))`, where `O1`, `O2`, ... are the arguments to `--or`s and `A1`, `A2`, ... are the arguments to `--and`s:
  - `--or EXPR`
  : only print paths to reqres which match any of these expressions
  - `--and EXPR`
  : only print paths to reqres which match all of these expressions

- found files printing:
  - `-l, --lf-terminated`
  : print absolute paths of matching WRR files terminated with `\n` (LF) newline characters; default
  - `-z, --zero-terminated`
  : print absolute paths of matching WRR files terminated with `\0` (NUL) bytes

- file system path ordering:
  - `--paths-given-order`
  : `argv` and `--stdin0` `PATH`s are processed in the order they are given; default
  - `--paths-sorted`
  : `argv` and `--stdin0` `PATH`s are processed in lexicographic order
  - `--paths-reversed`
  : `argv` and `--stdin0` `PATH`s are processed in reverse lexicographic order
  - `--walk-fs-order`
  : recursive file system walk is done in the order `readdir(2)` gives results
  - `--walk-sorted`
  : recursive file system walk is done in lexicographic order; default
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
  - `--stdin0`
  : read zero-terminated `PATH`s from stdin, these will be processed after `PATH`s specified as command-line arguments

- error handling:
  - `--errors {fail,skip,ignore}`
  : when an error occurs:
    - `fail`: report failure and stop the execution; default
    - `skip`: report failure but skip the reqres that produced it from the output and continue
    - `ignore`: `skip`, but don't report the failure

- filters; both can be specified at the same time, both can be specified multiple times, both use the same expression format as `wrrarms get --expr` (which see), the resulting logical expression that will checked is `(O1 or O2 or ... or (A1 and A2 and ...))`, where `O1`, `O2`, ... are the arguments to `--or`s and `A1`, `A2`, ... are the arguments to `--and`s:
  - `--or EXPR`
  : only work on reqres which match any of these expressions
  - `--and EXPR`
  : only work on reqres which match all of these expressions

- action:
  - `--move`
  : move source files under `DESTINATION`; default
  - `--copy`
  : copy source files to files under `DESTINATION`
  - `--hardlink`
  : create hardlinks from source files to paths under `DESTINATION`
  - `--symlink`
  : create symlinks from source files to paths under `DESTINATION`

- file outputs:
  - `-t DESTINATION, --to DESTINATION`
  : destination directory; when unset each source `PATH` must be a directory which will be treated as its own `DESTINATION`
  - `-o FORMAT, --output FORMAT`
  : format describing generated output paths, an alias name or "format:" followed by a custom pythonic %-substitution string:
    - available aliases and corresponding %-substitutions:
      - `default`     : `%(syear)d/%(smonth)02d/%(sday)02d/%(shour)02d%(sminute)02d%(ssecond)02d%(stime_msq)03d_%(qtime_ms)s_%(method)s_%(net_url|to_ascii|sha256|take_prefix 4)s_%(status)s_%(hostname)s_%(num)d`; the default
            - `https://example.org` -> `1970/01/01/001640000_0_GET_50d7_C200C_example.org_0`
            - `https://example.org/` -> `1970/01/01/001640000_0_GET_8198_C200C_example.org_0`
            - `https://example.org/index.html` -> `1970/01/01/001640000_0_GET_f0dc_C200C_example.org_0`
            - `https://example.org/media` -> `1970/01/01/001640000_0_GET_086d_C200C_example.org_0`
            - `https://example.org/media/` -> `1970/01/01/001640000_0_GET_3fbb_C200C_example.org_0`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `1970/01/01/001640000_0_GET_5658_C200C_example.org_0`
            - `https://königsgäßchen.example.org/index.html` -> `1970/01/01/001640000_0_GET_4f11_C200C_königsgäßchen.example.org_0`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `1970/01/01/001640000_0_GET_c4ae_C200C_ジャジェメント.ですの.example.org_0`
      - `short`       : `%(syear)d/%(smonth)02d/%(sday)02d/%(stime_ms)d_%(qtime_ms)s_%(num)d`
            - `https://example.org`, `https://example.org/`, `https://example.org/index.html`, `https://example.org/media`, `https://example.org/media/`, `https://example.org/view?one=1&two=2&three=&three=3#fragment`, `https://königsgäßchen.example.org/index.html`, `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `1970/01/01/1000000_0_0`
      - `surl`        : `%(scheme)s/%(netloc)s/%(mq_path)s%(oqm)s%(mq_query)s`
            - `https://example.org`, `https://example.org/` -> `https/example.org/`
            - `https://example.org/index.html` -> `https/example.org/index.html`
            - `https://example.org/media`, `https://example.org/media/` -> `https/example.org/media`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `https/example.org/view?one=1&two=2&three&three=3`
            - `https://königsgäßchen.example.org/index.html` -> `https/königsgäßchen.example.org/index.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `https/ジャジェメント.ですの.example.org/испытание/is`
      - `surl_msn`    : `%(scheme)s/%(netloc)s/%(mq_path)s%(oqm)s%(mq_query)s__%(method)s_%(status)s_%(num)d`
            - `https://example.org`, `https://example.org/` -> `https/example.org/__GET_C200C_0`
            - `https://example.org/index.html` -> `https/example.org/index.html__GET_C200C_0`
            - `https://example.org/media`, `https://example.org/media/` -> `https/example.org/media__GET_C200C_0`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `https/example.org/view?one=1&two=2&three&three=3__GET_C200C_0`
            - `https://königsgäßchen.example.org/index.html` -> `https/königsgäßchen.example.org/index.html__GET_C200C_0`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `https/ジャジェメント.ですの.example.org/испытание/is__GET_C200C_0`
      - `shupq`       : `%(scheme)s/%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_query|abbrev 120)s%(filepath_ext)s`
            - `https://example.org`, `https://example.org/` -> `https/example.org/index.htm`
            - `https://example.org/index.html` -> `https/example.org/index.html`
            - `https://example.org/media`, `https://example.org/media/` -> `https/example.org/media/index.htm`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `https/example.org/view/index?one=1&two=2&three&three=3.htm`
            - `https://königsgäßchen.example.org/index.html` -> `https/königsgäßchen.example.org/index.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `https/ジャジェメント.ですの.example.org/испытание/is/index.htm`
      - `shupq_n`     : `%(scheme)s/%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_query|abbrev 120)s.%(num)d%(filepath_ext)s`
            - `https://example.org`, `https://example.org/` -> `https/example.org/index.0.htm`
            - `https://example.org/index.html` -> `https/example.org/index.0.html`
            - `https://example.org/media`, `https://example.org/media/` -> `https/example.org/media/index.0.htm`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `https/example.org/view/index?one=1&two=2&three&three=3.0.htm`
            - `https://königsgäßchen.example.org/index.html` -> `https/königsgäßchen.example.org/index.0.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `https/ジャジェメント.ですの.example.org/испытание/is/index.0.htm`
      - `shupq_msn`   : `%(scheme)s/%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_query|abbrev 100)s.%(method)s_%(status)s_%(num)d%(filepath_ext)s`
            - `https://example.org`, `https://example.org/` -> `https/example.org/index.GET_C200C_0.htm`
            - `https://example.org/index.html` -> `https/example.org/index.GET_C200C_0.html`
            - `https://example.org/media`, `https://example.org/media/` -> `https/example.org/media/index.GET_C200C_0.htm`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `https/example.org/view/index?one=1&two=2&three&three=3.GET_C200C_0.htm`
            - `https://königsgäßchen.example.org/index.html` -> `https/königsgäßchen.example.org/index.GET_C200C_0.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `https/ジャジェメント.ですの.example.org/испытание/is/index.GET_C200C_0.htm`
      - `shupnq`      : `%(scheme)s/%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 120)s%(filepath_ext)s`
            - `https://example.org`, `https://example.org/` -> `https/example.org/index.htm`
            - `https://example.org/index.html` -> `https/example.org/index.html`
            - `https://example.org/media`, `https://example.org/media/` -> `https/example.org/media/index.htm`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `https/example.org/view/index?one=1&two=2&three=3.htm`
            - `https://königsgäßchen.example.org/index.html` -> `https/königsgäßchen.example.org/index.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `https/ジャジェメント.ですの.example.org/испытание/is/index.htm`
      - `shupnq_n`    : `%(scheme)s/%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 120)s.%(num)d%(filepath_ext)s`
            - `https://example.org`, `https://example.org/` -> `https/example.org/index.0.htm`
            - `https://example.org/index.html` -> `https/example.org/index.0.html`
            - `https://example.org/media`, `https://example.org/media/` -> `https/example.org/media/index.0.htm`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `https/example.org/view/index?one=1&two=2&three=3.0.htm`
            - `https://königsgäßchen.example.org/index.html` -> `https/königsgäßchen.example.org/index.0.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `https/ジャジェメント.ですの.example.org/испытание/is/index.0.htm`
      - `shupnq_msn`  : `%(scheme)s/%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 100)s.%(method)s_%(status)s_%(num)d%(filepath_ext)s`
            - `https://example.org`, `https://example.org/` -> `https/example.org/index.GET_C200C_0.htm`
            - `https://example.org/index.html` -> `https/example.org/index.GET_C200C_0.html`
            - `https://example.org/media`, `https://example.org/media/` -> `https/example.org/media/index.GET_C200C_0.htm`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `https/example.org/view/index?one=1&two=2&three=3.GET_C200C_0.htm`
            - `https://königsgäßchen.example.org/index.html` -> `https/königsgäßchen.example.org/index.GET_C200C_0.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `https/ジャジェメント.ですの.example.org/испытание/is/index.GET_C200C_0.htm`
      - `shupnq_mhs`  : `%(scheme)s/%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 120)s.%(method)s_%(net_url|to_ascii|sha256|take_prefix 4)s_%(status)s%(filepath_ext)s`
            - `https://example.org` -> `https/example.org/index.GET_50d7_C200C.htm`
            - `https://example.org/` -> `https/example.org/index.GET_8198_C200C.htm`
            - `https://example.org/index.html` -> `https/example.org/index.GET_f0dc_C200C.html`
            - `https://example.org/media` -> `https/example.org/media/index.GET_086d_C200C.htm`
            - `https://example.org/media/` -> `https/example.org/media/index.GET_3fbb_C200C.htm`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `https/example.org/view/index?one=1&two=2&three=3.GET_5658_C200C.htm`
            - `https://königsgäßchen.example.org/index.html` -> `https/königsgäßchen.example.org/index.GET_4f11_C200C.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `https/ジャジェメント.ですの.example.org/испытание/is/index.GET_c4ae_C200C.htm`
      - `shupnq_mhsn` : `%(scheme)s/%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 100)s.%(method)s_%(net_url|to_ascii|sha256|take_prefix 4)s_%(status)s_%(num)d%(filepath_ext)s`
            - `https://example.org` -> `https/example.org/index.GET_50d7_C200C_0.htm`
            - `https://example.org/` -> `https/example.org/index.GET_8198_C200C_0.htm`
            - `https://example.org/index.html` -> `https/example.org/index.GET_f0dc_C200C_0.html`
            - `https://example.org/media` -> `https/example.org/media/index.GET_086d_C200C_0.htm`
            - `https://example.org/media/` -> `https/example.org/media/index.GET_3fbb_C200C_0.htm`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `https/example.org/view/index?one=1&two=2&three=3.GET_5658_C200C_0.htm`
            - `https://königsgäßchen.example.org/index.html` -> `https/königsgäßchen.example.org/index.GET_4f11_C200C_0.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `https/ジャジェメント.ですの.example.org/испытание/is/index.GET_c4ae_C200C_0.htm`
      - `srhupq`      : `%(scheme)s/%(rhostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_query|abbrev 120)s%(filepath_ext)s`
            - `https://example.org`, `https://example.org/` -> `https/org.example/index.htm`
            - `https://example.org/index.html` -> `https/org.example/index.html`
            - `https://example.org/media`, `https://example.org/media/` -> `https/org.example/media/index.htm`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `https/org.example/view/index?one=1&two=2&three&three=3.htm`
            - `https://königsgäßchen.example.org/index.html` -> `https/org.example.königsgäßchen/index.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `https/org.example.ですの.ジャジェメント/испытание/is/index.htm`
      - `srhupq_n`    : `%(scheme)s/%(rhostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_query|abbrev 120)s.%(num)d%(filepath_ext)s`
            - `https://example.org`, `https://example.org/` -> `https/org.example/index.0.htm`
            - `https://example.org/index.html` -> `https/org.example/index.0.html`
            - `https://example.org/media`, `https://example.org/media/` -> `https/org.example/media/index.0.htm`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `https/org.example/view/index?one=1&two=2&three&three=3.0.htm`
            - `https://königsgäßchen.example.org/index.html` -> `https/org.example.königsgäßchen/index.0.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `https/org.example.ですの.ジャジェメント/испытание/is/index.0.htm`
      - `srhupq_msn`  : `%(scheme)s/%(rhostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_query|abbrev 100)s.%(method)s_%(status)s_%(num)d%(filepath_ext)s`
            - `https://example.org`, `https://example.org/` -> `https/org.example/index.GET_C200C_0.htm`
            - `https://example.org/index.html` -> `https/org.example/index.GET_C200C_0.html`
            - `https://example.org/media`, `https://example.org/media/` -> `https/org.example/media/index.GET_C200C_0.htm`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `https/org.example/view/index?one=1&two=2&three&three=3.GET_C200C_0.htm`
            - `https://königsgäßchen.example.org/index.html` -> `https/org.example.königsgäßchen/index.GET_C200C_0.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `https/org.example.ですの.ジャジェメント/испытание/is/index.GET_C200C_0.htm`
      - `srhupnq`     : `%(scheme)s/%(rhostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 120)s%(filepath_ext)s`
            - `https://example.org`, `https://example.org/` -> `https/org.example/index.htm`
            - `https://example.org/index.html` -> `https/org.example/index.html`
            - `https://example.org/media`, `https://example.org/media/` -> `https/org.example/media/index.htm`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `https/org.example/view/index?one=1&two=2&three=3.htm`
            - `https://königsgäßchen.example.org/index.html` -> `https/org.example.königsgäßchen/index.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `https/org.example.ですの.ジャジェメント/испытание/is/index.htm`
      - `srhupnq_n`   : `%(scheme)s/%(rhostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 120)s.%(num)d%(filepath_ext)s`
            - `https://example.org`, `https://example.org/` -> `https/org.example/index.0.htm`
            - `https://example.org/index.html` -> `https/org.example/index.0.html`
            - `https://example.org/media`, `https://example.org/media/` -> `https/org.example/media/index.0.htm`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `https/org.example/view/index?one=1&two=2&three=3.0.htm`
            - `https://königsgäßchen.example.org/index.html` -> `https/org.example.königsgäßchen/index.0.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `https/org.example.ですの.ジャジェメント/испытание/is/index.0.htm`
      - `srhupnq_msn` : `%(scheme)s/%(rhostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 100)s.%(method)s_%(status)s_%(num)d%(filepath_ext)s`
            - `https://example.org`, `https://example.org/` -> `https/org.example/index.GET_C200C_0.htm`
            - `https://example.org/index.html` -> `https/org.example/index.GET_C200C_0.html`
            - `https://example.org/media`, `https://example.org/media/` -> `https/org.example/media/index.GET_C200C_0.htm`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `https/org.example/view/index?one=1&two=2&three=3.GET_C200C_0.htm`
            - `https://königsgäßchen.example.org/index.html` -> `https/org.example.königsgäßchen/index.GET_C200C_0.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `https/org.example.ですの.ジャジェメント/испытание/is/index.GET_C200C_0.htm`
      - `srhupnq_mhs` : `%(scheme)s/%(rhostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 120)s.%(method)s_%(net_url|to_ascii|sha256|take_prefix 4)s_%(status)s%(filepath_ext)s`
            - `https://example.org` -> `https/org.example/index.GET_50d7_C200C.htm`
            - `https://example.org/` -> `https/org.example/index.GET_8198_C200C.htm`
            - `https://example.org/index.html` -> `https/org.example/index.GET_f0dc_C200C.html`
            - `https://example.org/media` -> `https/org.example/media/index.GET_086d_C200C.htm`
            - `https://example.org/media/` -> `https/org.example/media/index.GET_3fbb_C200C.htm`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `https/org.example/view/index?one=1&two=2&three=3.GET_5658_C200C.htm`
            - `https://königsgäßchen.example.org/index.html` -> `https/org.example.königsgäßchen/index.GET_4f11_C200C.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `https/org.example.ですの.ジャジェメント/испытание/is/index.GET_c4ae_C200C.htm`
      - `srhupnq_mhsn`: `%(scheme)s/%(rhostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 100)s.%(method)s_%(net_url|to_ascii|sha256|take_prefix 4)s_%(status)s_%(num)d%(filepath_ext)s`
            - `https://example.org` -> `https/org.example/index.GET_50d7_C200C_0.htm`
            - `https://example.org/` -> `https/org.example/index.GET_8198_C200C_0.htm`
            - `https://example.org/index.html` -> `https/org.example/index.GET_f0dc_C200C_0.html`
            - `https://example.org/media` -> `https/org.example/media/index.GET_086d_C200C_0.htm`
            - `https://example.org/media/` -> `https/org.example/media/index.GET_3fbb_C200C_0.htm`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `https/org.example/view/index?one=1&two=2&three=3.GET_5658_C200C_0.htm`
            - `https://königsgäßchen.example.org/index.html` -> `https/org.example.königsgäßchen/index.GET_4f11_C200C_0.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `https/org.example.ですの.ジャジェメント/испытание/is/index.GET_c4ae_C200C_0.htm`
      - `url`         : `%(netloc)s/%(mq_path)s%(oqm)s%(mq_query)s`
            - `https://example.org`, `https://example.org/` -> `example.org/`
            - `https://example.org/index.html` -> `example.org/index.html`
            - `https://example.org/media`, `https://example.org/media/` -> `example.org/media`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `example.org/view?one=1&two=2&three&three=3`
            - `https://königsgäßchen.example.org/index.html` -> `königsgäßchen.example.org/index.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `ジャジェメント.ですの.example.org/испытание/is`
      - `url_msn`     : `%(netloc)s/%(mq_path)s%(oqm)s%(mq_query)s__%(method)s_%(status)s_%(num)d`
            - `https://example.org`, `https://example.org/` -> `example.org/__GET_C200C_0`
            - `https://example.org/index.html` -> `example.org/index.html__GET_C200C_0`
            - `https://example.org/media`, `https://example.org/media/` -> `example.org/media__GET_C200C_0`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `example.org/view?one=1&two=2&three&three=3__GET_C200C_0`
            - `https://königsgäßchen.example.org/index.html` -> `königsgäßchen.example.org/index.html__GET_C200C_0`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `ジャジェメント.ですの.example.org/испытание/is__GET_C200C_0`
      - `hupq`        : `%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_query|abbrev 120)s%(filepath_ext)s`
            - `https://example.org`, `https://example.org/` -> `example.org/index.htm`
            - `https://example.org/index.html` -> `example.org/index.html`
            - `https://example.org/media`, `https://example.org/media/` -> `example.org/media/index.htm`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `example.org/view/index?one=1&two=2&three&three=3.htm`
            - `https://königsgäßchen.example.org/index.html` -> `königsgäßchen.example.org/index.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `ジャジェメント.ですの.example.org/испытание/is/index.htm`
      - `hupq_n`      : `%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_query|abbrev 120)s.%(num)d%(filepath_ext)s`
            - `https://example.org`, `https://example.org/` -> `example.org/index.0.htm`
            - `https://example.org/index.html` -> `example.org/index.0.html`
            - `https://example.org/media`, `https://example.org/media/` -> `example.org/media/index.0.htm`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `example.org/view/index?one=1&two=2&three&three=3.0.htm`
            - `https://königsgäßchen.example.org/index.html` -> `königsgäßchen.example.org/index.0.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `ジャジェメント.ですの.example.org/испытание/is/index.0.htm`
      - `hupq_msn`    : `%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_query|abbrev 100)s.%(method)s_%(status)s_%(num)d%(filepath_ext)s`
            - `https://example.org`, `https://example.org/` -> `example.org/index.GET_C200C_0.htm`
            - `https://example.org/index.html` -> `example.org/index.GET_C200C_0.html`
            - `https://example.org/media`, `https://example.org/media/` -> `example.org/media/index.GET_C200C_0.htm`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `example.org/view/index?one=1&two=2&three&three=3.GET_C200C_0.htm`
            - `https://königsgäßchen.example.org/index.html` -> `königsgäßchen.example.org/index.GET_C200C_0.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `ジャジェメント.ですの.example.org/испытание/is/index.GET_C200C_0.htm`
      - `hupnq`       : `%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 120)s%(filepath_ext)s`
            - `https://example.org`, `https://example.org/` -> `example.org/index.htm`
            - `https://example.org/index.html` -> `example.org/index.html`
            - `https://example.org/media`, `https://example.org/media/` -> `example.org/media/index.htm`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `example.org/view/index?one=1&two=2&three=3.htm`
            - `https://königsgäßchen.example.org/index.html` -> `königsgäßchen.example.org/index.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `ジャジェメント.ですの.example.org/испытание/is/index.htm`
      - `hupnq_n`     : `%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 120)s.%(num)d%(filepath_ext)s`
            - `https://example.org`, `https://example.org/` -> `example.org/index.0.htm`
            - `https://example.org/index.html` -> `example.org/index.0.html`
            - `https://example.org/media`, `https://example.org/media/` -> `example.org/media/index.0.htm`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `example.org/view/index?one=1&two=2&three=3.0.htm`
            - `https://königsgäßchen.example.org/index.html` -> `königsgäßchen.example.org/index.0.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `ジャジェメント.ですの.example.org/испытание/is/index.0.htm`
      - `hupnq_msn`   : `%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 100)s.%(method)s_%(status)s_%(num)d%(filepath_ext)s`
            - `https://example.org`, `https://example.org/` -> `example.org/index.GET_C200C_0.htm`
            - `https://example.org/index.html` -> `example.org/index.GET_C200C_0.html`
            - `https://example.org/media`, `https://example.org/media/` -> `example.org/media/index.GET_C200C_0.htm`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `example.org/view/index?one=1&two=2&three=3.GET_C200C_0.htm`
            - `https://königsgäßchen.example.org/index.html` -> `königsgäßchen.example.org/index.GET_C200C_0.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `ジャジェメント.ですの.example.org/испытание/is/index.GET_C200C_0.htm`
      - `hupnq_mhs`   : `%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 120)s.%(method)s_%(net_url|to_ascii|sha256|take_prefix 4)s_%(status)s%(filepath_ext)s`
            - `https://example.org` -> `example.org/index.GET_50d7_C200C.htm`
            - `https://example.org/` -> `example.org/index.GET_8198_C200C.htm`
            - `https://example.org/index.html` -> `example.org/index.GET_f0dc_C200C.html`
            - `https://example.org/media` -> `example.org/media/index.GET_086d_C200C.htm`
            - `https://example.org/media/` -> `example.org/media/index.GET_3fbb_C200C.htm`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `example.org/view/index?one=1&two=2&three=3.GET_5658_C200C.htm`
            - `https://königsgäßchen.example.org/index.html` -> `königsgäßchen.example.org/index.GET_4f11_C200C.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `ジャジェメント.ですの.example.org/испытание/is/index.GET_c4ae_C200C.htm`
      - `hupnq_mhsn`  : `%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 100)s.%(method)s_%(net_url|to_ascii|sha256|take_prefix 4)s_%(status)s_%(num)d%(filepath_ext)s`
            - `https://example.org` -> `example.org/index.GET_50d7_C200C_0.htm`
            - `https://example.org/` -> `example.org/index.GET_8198_C200C_0.htm`
            - `https://example.org/index.html` -> `example.org/index.GET_f0dc_C200C_0.html`
            - `https://example.org/media` -> `example.org/media/index.GET_086d_C200C_0.htm`
            - `https://example.org/media/` -> `example.org/media/index.GET_3fbb_C200C_0.htm`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `example.org/view/index?one=1&two=2&three=3.GET_5658_C200C_0.htm`
            - `https://königsgäßchen.example.org/index.html` -> `königsgäßchen.example.org/index.GET_4f11_C200C_0.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `ジャジェメント.ですの.example.org/испытание/is/index.GET_c4ae_C200C_0.htm`
      - `rhupq`       : `%(rhostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_query|abbrev 120)s%(filepath_ext)s`
            - `https://example.org`, `https://example.org/` -> `org.example/index.htm`
            - `https://example.org/index.html` -> `org.example/index.html`
            - `https://example.org/media`, `https://example.org/media/` -> `org.example/media/index.htm`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `org.example/view/index?one=1&two=2&three&three=3.htm`
            - `https://königsgäßchen.example.org/index.html` -> `org.example.königsgäßchen/index.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `org.example.ですの.ジャジェメント/испытание/is/index.htm`
      - `rhupq_n`     : `%(rhostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_query|abbrev 120)s.%(num)d%(filepath_ext)s`
            - `https://example.org`, `https://example.org/` -> `org.example/index.0.htm`
            - `https://example.org/index.html` -> `org.example/index.0.html`
            - `https://example.org/media`, `https://example.org/media/` -> `org.example/media/index.0.htm`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `org.example/view/index?one=1&two=2&three&three=3.0.htm`
            - `https://königsgäßchen.example.org/index.html` -> `org.example.königsgäßchen/index.0.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `org.example.ですの.ジャジェメント/испытание/is/index.0.htm`
      - `rhupq_msn`   : `%(rhostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_query|abbrev 100)s.%(method)s_%(status)s_%(num)d%(filepath_ext)s`
            - `https://example.org`, `https://example.org/` -> `org.example/index.GET_C200C_0.htm`
            - `https://example.org/index.html` -> `org.example/index.GET_C200C_0.html`
            - `https://example.org/media`, `https://example.org/media/` -> `org.example/media/index.GET_C200C_0.htm`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `org.example/view/index?one=1&two=2&three&three=3.GET_C200C_0.htm`
            - `https://königsgäßchen.example.org/index.html` -> `org.example.königsgäßchen/index.GET_C200C_0.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `org.example.ですの.ジャジェメント/испытание/is/index.GET_C200C_0.htm`
      - `rhupnq`      : `%(rhostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 120)s%(filepath_ext)s`
            - `https://example.org`, `https://example.org/` -> `org.example/index.htm`
            - `https://example.org/index.html` -> `org.example/index.html`
            - `https://example.org/media`, `https://example.org/media/` -> `org.example/media/index.htm`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `org.example/view/index?one=1&two=2&three=3.htm`
            - `https://königsgäßchen.example.org/index.html` -> `org.example.königsgäßchen/index.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `org.example.ですの.ジャジェメント/испытание/is/index.htm`
      - `rhupnq_n`    : `%(rhostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 120)s.%(num)d%(filepath_ext)s`
            - `https://example.org`, `https://example.org/` -> `org.example/index.0.htm`
            - `https://example.org/index.html` -> `org.example/index.0.html`
            - `https://example.org/media`, `https://example.org/media/` -> `org.example/media/index.0.htm`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `org.example/view/index?one=1&two=2&three=3.0.htm`
            - `https://königsgäßchen.example.org/index.html` -> `org.example.königsgäßchen/index.0.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `org.example.ですの.ジャジェメント/испытание/is/index.0.htm`
      - `rhupnq_msn`  : `%(rhostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 100)s.%(method)s_%(status)s_%(num)d%(filepath_ext)s`
            - `https://example.org`, `https://example.org/` -> `org.example/index.GET_C200C_0.htm`
            - `https://example.org/index.html` -> `org.example/index.GET_C200C_0.html`
            - `https://example.org/media`, `https://example.org/media/` -> `org.example/media/index.GET_C200C_0.htm`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `org.example/view/index?one=1&two=2&three=3.GET_C200C_0.htm`
            - `https://königsgäßchen.example.org/index.html` -> `org.example.königsgäßchen/index.GET_C200C_0.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `org.example.ですの.ジャジェメント/испытание/is/index.GET_C200C_0.htm`
      - `rhupnq_mhs`  : `%(rhostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 120)s.%(method)s_%(net_url|to_ascii|sha256|take_prefix 4)s_%(status)s%(filepath_ext)s`
            - `https://example.org` -> `org.example/index.GET_50d7_C200C.htm`
            - `https://example.org/` -> `org.example/index.GET_8198_C200C.htm`
            - `https://example.org/index.html` -> `org.example/index.GET_f0dc_C200C.html`
            - `https://example.org/media` -> `org.example/media/index.GET_086d_C200C.htm`
            - `https://example.org/media/` -> `org.example/media/index.GET_3fbb_C200C.htm`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `org.example/view/index?one=1&two=2&three=3.GET_5658_C200C.htm`
            - `https://königsgäßchen.example.org/index.html` -> `org.example.königsgäßchen/index.GET_4f11_C200C.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `org.example.ですの.ジャジェメント/испытание/is/index.GET_c4ae_C200C.htm`
      - `rhupnq_mhsn` : `%(rhostname)s/%(filepath_parts|abbrev_each 120|pp_to_path)s%(oqm)s%(mq_nquery|abbrev 100)s.%(method)s_%(net_url|to_ascii|sha256|take_prefix 4)s_%(status)s_%(num)d%(filepath_ext)s`
            - `https://example.org` -> `org.example/index.GET_50d7_C200C_0.htm`
            - `https://example.org/` -> `org.example/index.GET_8198_C200C_0.htm`
            - `https://example.org/index.html` -> `org.example/index.GET_f0dc_C200C_0.html`
            - `https://example.org/media` -> `org.example/media/index.GET_086d_C200C_0.htm`
            - `https://example.org/media/` -> `org.example/media/index.GET_3fbb_C200C_0.htm`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `org.example/view/index?one=1&two=2&three=3.GET_5658_C200C_0.htm`
            - `https://königsgäßchen.example.org/index.html` -> `org.example.königsgäßchen/index.GET_4f11_C200C_0.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `org.example.ですの.ジャジェメント/испытание/is/index.GET_c4ae_C200C_0.htm`
      - `flat`        : `%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path|replace / __|abbrev 120)s%(oqm)s%(mq_nquery|abbrev 100)s%(filepath_ext)s`
            - `https://example.org`, `https://example.org/` -> `example.org/index.htm`
            - `https://example.org/index.html` -> `example.org/index.html`
            - `https://example.org/media`, `https://example.org/media/` -> `example.org/media__index.htm`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `example.org/view__index?one=1&two=2&three=3.htm`
            - `https://königsgäßchen.example.org/index.html` -> `königsgäßchen.example.org/index.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `ジャジェメント.ですの.example.org/испытание__is__index.htm`
      - `flat_n`      : `%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path|replace / __|abbrev 120)s%(oqm)s%(mq_nquery|abbrev 100)s.%(num)d%(filepath_ext)s`
            - `https://example.org`, `https://example.org/` -> `example.org/index.0.htm`
            - `https://example.org/index.html` -> `example.org/index.0.html`
            - `https://example.org/media`, `https://example.org/media/` -> `example.org/media__index.0.htm`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `example.org/view__index?one=1&two=2&three=3.0.htm`
            - `https://königsgäßchen.example.org/index.html` -> `königsgäßchen.example.org/index.0.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `ジャジェメント.ですの.example.org/испытание__is__index.0.htm`
      - `flat_ms`     : `%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path|replace / __|abbrev 120)s%(oqm)s%(mq_nquery|abbrev 100)s.%(method)s_%(status)s%(filepath_ext)s`
            - `https://example.org`, `https://example.org/` -> `example.org/index.GET_C200C.htm`
            - `https://example.org/index.html` -> `example.org/index.GET_C200C.html`
            - `https://example.org/media`, `https://example.org/media/` -> `example.org/media__index.GET_C200C.htm`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `example.org/view__index?one=1&two=2&three=3.GET_C200C.htm`
            - `https://königsgäßchen.example.org/index.html` -> `königsgäßchen.example.org/index.GET_C200C.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `ジャジェメント.ですの.example.org/испытание__is__index.GET_C200C.htm`
      - `flat_msn`    : `%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path|replace / __|abbrev 120)s%(oqm)s%(mq_nquery|abbrev 100)s.%(method)s_%(status)s_%(num)d%(filepath_ext)s`
            - `https://example.org`, `https://example.org/` -> `example.org/index.GET_C200C_0.htm`
            - `https://example.org/index.html` -> `example.org/index.GET_C200C_0.html`
            - `https://example.org/media`, `https://example.org/media/` -> `example.org/media__index.GET_C200C_0.htm`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `example.org/view__index?one=1&two=2&three=3.GET_C200C_0.htm`
            - `https://königsgäßchen.example.org/index.html` -> `königsgäßchen.example.org/index.GET_C200C_0.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `ジャジェメント.ですの.example.org/испытание__is__index.GET_C200C_0.htm`
      - `flat_mhs`    : `%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path|replace / __|abbrev 120)s%(oqm)s%(mq_nquery|abbrev 100)s.%(method)s_%(net_url|to_ascii|sha256|take_prefix 4)s_%(status)s%(filepath_ext)s`
            - `https://example.org` -> `example.org/index.GET_50d7_C200C.htm`
            - `https://example.org/` -> `example.org/index.GET_8198_C200C.htm`
            - `https://example.org/index.html` -> `example.org/index.GET_f0dc_C200C.html`
            - `https://example.org/media` -> `example.org/media__index.GET_086d_C200C.htm`
            - `https://example.org/media/` -> `example.org/media__index.GET_3fbb_C200C.htm`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `example.org/view__index?one=1&two=2&three=3.GET_5658_C200C.htm`
            - `https://königsgäßchen.example.org/index.html` -> `königsgäßchen.example.org/index.GET_4f11_C200C.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `ジャジェメント.ですの.example.org/испытание__is__index.GET_c4ae_C200C.htm`
      - `flat_mhsn`   : `%(hostname)s/%(filepath_parts|abbrev_each 120|pp_to_path|replace / __|abbrev 120)s%(oqm)s%(mq_nquery|abbrev 100)s.%(method)s_%(net_url|to_ascii|sha256|take_prefix 4)s_%(status)s_%(num)d%(filepath_ext)s`
            - `https://example.org` -> `example.org/index.GET_50d7_C200C_0.htm`
            - `https://example.org/` -> `example.org/index.GET_8198_C200C_0.htm`
            - `https://example.org/index.html` -> `example.org/index.GET_f0dc_C200C_0.html`
            - `https://example.org/media` -> `example.org/media__index.GET_086d_C200C_0.htm`
            - `https://example.org/media/` -> `example.org/media__index.GET_3fbb_C200C_0.htm`
            - `https://example.org/view?one=1&two=2&three=&three=3#fragment` -> `example.org/view__index?one=1&two=2&three=3.GET_5658_C200C_0.htm`
            - `https://königsgäßchen.example.org/index.html` -> `königsgäßchen.example.org/index.GET_4f11_C200C_0.html`
            - `https://ジャジェメント.ですの.example.org/испытание/is/`, `https://xn--hck7aa9d8fj9i.xn--88j1aw.example.org/%D0%B8%D1%81%D0%BF%D1%8B%D1%82%D0%B0%D0%BD%D0%B8%D0%B5/is/` -> `ジャジェメント.ですの.example.org/испытание__is__index.GET_c4ae_C200C_0.htm`
    - available substitutions:
      - all expressions of `wrrarms get --expr` (which see);
      - `num`: number of times the resulting output path was encountered before; adding this parameter to your `--output` format will ensure all generated file names will be unique

- new `--output`s printing:
  - `--no-print`
  : don't print anything; default
  - `-l, --lf-terminated`
  : print absolute paths of newly produced or replaced files terminated with `\n` (LF) newline characters
  - `-z, --zero-terminated`
  : print absolute paths of newly produced or replaced files terminated with `\0` (NUL) bytes

- updates to `--output`s:
  - `--no-overwrites`
  : disallow overwrites and replacements of any existing `--output` files under `DESTINATION`, i.e. only ever create new files under `DESTINATION`, producing errors instead of attempting any other updates; default;
    `--output` targets that are broken symlinks will be considered to be non-existent and will be replaced;
    when the operation's source is binary-eqivalent to the `--output` target, the operation will be permitted, but the disk write will be reduced to a noop, i.e. the results will be deduplicated;
    the `dirname` of a source file and the `--to` target directories can be the same, in that case the source file will be renamed to use new `--output` name, though renames that attempt to swap source file names will still fail
  - `--latest`
  : replace files under `DESTINATION` with their latest version;
    this is only allowed in combination with `--symlink` at the moment;
    for each source `PATH` file, the destination `--output` file will be replaced with a symlink to the source if and only if `stime_ms` of the source reqres is newer than `stime_ms` of the reqres stored at the destination file

- caching, deferring, and batching:
  - `--seen-number INT`
  : track at most this many distinct generated `--output` values; default: `16384`;
    making this larger improves disk performance at the cost of increased memory consumption;
    setting it to zero will force force `wrrarms` to constantly re-check existence of `--output` files and force `wrrarms` to execute  all IO actions immediately, disregarding `--defer-number` setting
  - `--cache-number INT`
  : cache `stat(2)` information about this many files in memory; default: `8192`;
    making this larger improves performance at the cost of increased memory consumption;
    setting this to a too small number will likely force `wrrarms` into repeatedly performing lots of `stat(2)` system calls on the same files;
    setting this to a value smaller than `--defer-number` will not improve memory consumption very much since deferred IO actions also cache information about their own files
  - `--defer-number INT`
  : defer at most this many IO actions; default: `1024`;
    making this larger improves performance at the cost of increased memory consumption;
    setting it to zero will force all IO actions to be applied immediately
  - `--batch-number INT`
  : queue at most this many deferred IO actions to be applied together in a batch; this queue will only be used if all other resource constraints are met; default: 128
  - `--max-memory INT`
  : the caches, the deferred actions queue, and the batch queue, all taken together, must not take more than this much memory in MiB; default: `1024`;
    making this larger improves performance;
    the actual maximum whole-program memory consumption is `O(<size of the largest reqres> + <--seen-number> + <sum of lengths of the last --seen-number generated --output paths> + <--cache-number> + <--defer-number> + <--batch-number> + <--max-memory>)`
  - `--lazy`
  : sets all of the above options to positive infinity;
    most useful when doing `wrrarms organize --symlink --latest --output flat` or similar, where the number of distinct generated `--output` values and the amount of other data `wrrarms` needs to keep in memory is small, in which case it will force `wrrarms` to compute the desired file system state first and then perform all disk writes in a single batch

- file system path ordering:
  - `--paths-given-order`
  : `argv` and `--stdin0` `PATH`s are processed in the order they are given; default when `--keep`
  - `--paths-sorted`
  : `argv` and `--stdin0` `PATH`s are processed in lexicographic order
  - `--paths-reversed`
  : `argv` and `--stdin0` `PATH`s are processed in reverse lexicographic order; default when `--latest`
  - `--walk-fs-order`
  : recursive file system walk is done in the order `readdir(2)` gives results
  - `--walk-sorted`
  : recursive file system walk is done in lexicographic order; default when `--keep`
  - `--walk-reversed`
  : recursive file system walk is done in reverse lexicographic order; default when `--latest`

### wrrarms import

Use specified parser to parse data in each `INPUT` `PATH` into (a sequence of) reqres and then generate and place their WRR-dumps into separate WRR files under `DESTINATION` with paths derived from their metadata.
In short, this is `wrrarms organize --copy` for `INPUT` files that use different files formats.

- file formats:
  - `{bundle,mitmproxy}`
    - `bundle`
    : convert WRR-bundles into separate WRR files
    - `mitmproxy`
    : convert `mitmproxy` stream dumps into WRR files

### wrrarms import bundle

Parse each `INPUT` `PATH` as a WRR-bundle (an optionally compressed sequence of WRR-dumps) and then generate and place their WRR-dumps into separate WRR files under `DESTINATION` with paths derived from their metadata.

- positional arguments:
  - `PATH`
  : inputs, can be a mix of files and directories (which will be traversed recursively)

- options:
  - `--dry-run`
  : perform a trial run without actually performing any changes
  - `-q, --quiet`
  : don't log computed updates to stderr
  - `--stdin0`
  : read zero-terminated `PATH`s from stdin, these will be processed after `PATH`s specified as command-line arguments

- error handling:
  - `--errors {fail,skip,ignore}`
  : when an error occurs:
    - `fail`: report failure and stop the execution; default
    - `skip`: report failure but skip the reqres that produced it from the output and continue
    - `ignore`: `skip`, but don't report the failure

- filters; both can be specified at the same time, both can be specified multiple times, both use the same expression format as `wrrarms get --expr` (which see), the resulting logical expression that will checked is `(O1 or O2 or ... or (A1 and A2 and ...))`, where `O1`, `O2`, ... are the arguments to `--or`s and `A1`, `A2`, ... are the arguments to `--and`s:
  - `--or EXPR`
  : only import reqres which match any of these expressions
  - `--and EXPR`
  : only import reqres which match all of these expressions

- file outputs:
  - `-t DESTINATION, --to DESTINATION`
  : destination directory
  - `-o FORMAT, --output FORMAT`
  : format describing generated output paths, an alias name or "format:" followed by a custom pythonic %-substitution string; same expression format as `wrrarms organize --output` (which see); default: default

- new `--output`s printing:
  - `--no-print`
  : don't print anything; default
  - `-l, --lf-terminated`
  : print absolute paths of newly produced or replaced files terminated with `\n` (LF) newline characters
  - `-z, --zero-terminated`
  : print absolute paths of newly produced or replaced files terminated with `\0` (NUL) bytes

- updates to `--output`s:
  - `--no-overwrites`
  : disallow overwrites and replacements of any existing `--output` files under `DESTINATION`, i.e. only ever create new files under `DESTINATION`, producing errors instead of attempting any other updates; default
  - `--overwrite-dangerously`
  : permit overwriting of old `--output` files under `DESTINATION`;
    DANGEROUS! not recommended, importing to a new `DESTINATION` with the default `--no-overwrites` and then `rsync`ing some of the files over to the old `DESTINATION` is a safer way to do this

- caching, deferring, and batching:
  - `--seen-number INT`
  : track at most this many distinct generated `--output` values; default: `16384`;
    making this larger improves disk performance at the cost of increased memory consumption;
    setting it to zero will force force `wrrarms` to constantly re-check existence of `--output` files and force `wrrarms` to execute  all IO actions immediately, disregarding `--defer-number` setting
  - `--cache-number INT`
  : cache `stat(2)` information about this many files in memory; default: `8192`;
    making this larger improves performance at the cost of increased memory consumption;
    setting this to a too small number will likely force `wrrarms` into repeatedly performing lots of `stat(2)` system calls on the same files;
    setting this to a value smaller than `--defer-number` will not improve memory consumption very much since deferred IO actions also cache information about their own files
  - `--defer-number INT`
  : defer at most this many IO actions; default: `0`;
    making this larger improves performance at the cost of increased memory consumption;
    setting it to zero will force all IO actions to be applied immediately
  - `--batch-number INT`
  : queue at most this many deferred IO actions to be applied together in a batch; this queue will only be used if all other resource constraints are met; default: 1024
  - `--max-memory INT`
  : the caches, the deferred actions queue, and the batch queue, all taken together, must not take more than this much memory in MiB; default: `1024`;
    making this larger improves performance;
    the actual maximum whole-program memory consumption is `O(<size of the largest reqres> + <--seen-number> + <sum of lengths of the last --seen-number generated --output paths> + <--cache-number> + <--defer-number> + <--batch-number> + <--max-memory>)`
  - `--lazy`
  : sets all of the above options to positive infinity;
    most useful when doing `wrrarms organize --symlink --latest --output flat` or similar, where the number of distinct generated `--output` values and the amount of other data `wrrarms` needs to keep in memory is small, in which case it will force `wrrarms` to compute the desired file system state first and then perform all disk writes in a single batch

- file system path ordering:
  - `--paths-given-order`
  : `argv` and `--stdin0` `PATH`s are processed in the order they are given; default
  - `--paths-sorted`
  : `argv` and `--stdin0` `PATH`s are processed in lexicographic order
  - `--paths-reversed`
  : `argv` and `--stdin0` `PATH`s are processed in reverse lexicographic order
  - `--walk-fs-order`
  : recursive file system walk is done in the order `readdir(2)` gives results
  - `--walk-sorted`
  : recursive file system walk is done in lexicographic order; default
  - `--walk-reversed`
  : recursive file system walk is done in reverse lexicographic order

### wrrarms import mitmproxy

Parse each `INPUT` `PATH` as `mitmproxy` stream dump (by using `mitmproxy`'s own parser) into a sequence of reqres and then generate and place their WRR-dumps into separate WRR files under `DESTINATION` with paths derived from their metadata.

- positional arguments:
  - `PATH`
  : inputs, can be a mix of files and directories (which will be traversed recursively)

- options:
  - `--dry-run`
  : perform a trial run without actually performing any changes
  - `-q, --quiet`
  : don't log computed updates to stderr
  - `--stdin0`
  : read zero-terminated `PATH`s from stdin, these will be processed after `PATH`s specified as command-line arguments

- error handling:
  - `--errors {fail,skip,ignore}`
  : when an error occurs:
    - `fail`: report failure and stop the execution; default
    - `skip`: report failure but skip the reqres that produced it from the output and continue
    - `ignore`: `skip`, but don't report the failure

- filters; both can be specified at the same time, both can be specified multiple times, both use the same expression format as `wrrarms get --expr` (which see), the resulting logical expression that will checked is `(O1 or O2 or ... or (A1 and A2 and ...))`, where `O1`, `O2`, ... are the arguments to `--or`s and `A1`, `A2`, ... are the arguments to `--and`s:
  - `--or EXPR`
  : only import reqres which match any of these expressions
  - `--and EXPR`
  : only import reqres which match all of these expressions

- file outputs:
  - `-t DESTINATION, --to DESTINATION`
  : destination directory
  - `-o FORMAT, --output FORMAT`
  : format describing generated output paths, an alias name or "format:" followed by a custom pythonic %-substitution string; same expression format as `wrrarms organize --output` (which see); default: default

- new `--output`s printing:
  - `--no-print`
  : don't print anything; default
  - `-l, --lf-terminated`
  : print absolute paths of newly produced or replaced files terminated with `\n` (LF) newline characters
  - `-z, --zero-terminated`
  : print absolute paths of newly produced or replaced files terminated with `\0` (NUL) bytes

- updates to `--output`s:
  - `--no-overwrites`
  : disallow overwrites and replacements of any existing `--output` files under `DESTINATION`, i.e. only ever create new files under `DESTINATION`, producing errors instead of attempting any other updates; default
  - `--overwrite-dangerously`
  : permit overwriting of old `--output` files under `DESTINATION`;
    DANGEROUS! not recommended, importing to a new `DESTINATION` with the default `--no-overwrites` and then `rsync`ing some of the files over to the old `DESTINATION` is a safer way to do this

- caching, deferring, and batching:
  - `--seen-number INT`
  : track at most this many distinct generated `--output` values; default: `16384`;
    making this larger improves disk performance at the cost of increased memory consumption;
    setting it to zero will force force `wrrarms` to constantly re-check existence of `--output` files and force `wrrarms` to execute  all IO actions immediately, disregarding `--defer-number` setting
  - `--cache-number INT`
  : cache `stat(2)` information about this many files in memory; default: `8192`;
    making this larger improves performance at the cost of increased memory consumption;
    setting this to a too small number will likely force `wrrarms` into repeatedly performing lots of `stat(2)` system calls on the same files;
    setting this to a value smaller than `--defer-number` will not improve memory consumption very much since deferred IO actions also cache information about their own files
  - `--defer-number INT`
  : defer at most this many IO actions; default: `0`;
    making this larger improves performance at the cost of increased memory consumption;
    setting it to zero will force all IO actions to be applied immediately
  - `--batch-number INT`
  : queue at most this many deferred IO actions to be applied together in a batch; this queue will only be used if all other resource constraints are met; default: 1024
  - `--max-memory INT`
  : the caches, the deferred actions queue, and the batch queue, all taken together, must not take more than this much memory in MiB; default: `1024`;
    making this larger improves performance;
    the actual maximum whole-program memory consumption is `O(<size of the largest reqres> + <--seen-number> + <sum of lengths of the last --seen-number generated --output paths> + <--cache-number> + <--defer-number> + <--batch-number> + <--max-memory>)`
  - `--lazy`
  : sets all of the above options to positive infinity;
    most useful when doing `wrrarms organize --symlink --latest --output flat` or similar, where the number of distinct generated `--output` values and the amount of other data `wrrarms` needs to keep in memory is small, in which case it will force `wrrarms` to compute the desired file system state first and then perform all disk writes in a single batch

- file system path ordering:
  - `--paths-given-order`
  : `argv` and `--stdin0` `PATH`s are processed in the order they are given; default
  - `--paths-sorted`
  : `argv` and `--stdin0` `PATH`s are processed in lexicographic order
  - `--paths-reversed`
  : `argv` and `--stdin0` `PATH`s are processed in reverse lexicographic order
  - `--walk-fs-order`
  : recursive file system walk is done in the order `readdir(2)` gives results
  - `--walk-sorted`
  : recursive file system walk is done in lexicographic order; default
  - `--walk-reversed`
  : recursive file system walk is done in reverse lexicographic order

### wrrarms export

Parse given WRR files into their respective reqres, convert to another file format, and then dump the result under `DESTINATION` with the new path derived from each reqres' metadata.

- file formats:
  - `{mirror}`
    - `mirror`
    : convert given WRR files into a local website mirror stored in interlinked plain files

### wrrarms export mirror

Parse given WRR files, filter out those that have no responses, transform and then dump their response bodies into separate files under `DESTINATION` with the new path derived from each reqres' metadata.
In short, this is a combination of `wrrarms organize --copy` followed by in-place `wrrarms get`.
In other words, this generates static offline website mirrors, producing results similar to those of `wget -mpk`.

- positional arguments:
  - `PATH`
  : inputs, can be a mix of files and directories (which will be traversed recursively)

- options:
  - `--dry-run`
  : perform a trial run without actually performing any changes
  - `-q, --quiet`
  : don't log computed updates to stderr
  - `--stdin0`
  : read zero-terminated `PATH`s from stdin, these will be processed after `PATH`s specified as command-line arguments

- error handling:
  - `--errors {fail,skip,ignore}`
  : when an error occurs:
    - `fail`: report failure and stop the execution; default
    - `skip`: report failure but skip the reqres that produced it from the output and continue
    - `ignore`: `skip`, but don't report the failure

- filters; both can be specified at the same time, both can be specified multiple times, both use the same expression format as `wrrarms get --expr` (which see), the resulting logical expression that will checked is `(O1 or O2 or ... or (A1 and A2 and ...))`, where `O1`, `O2`, ... are the arguments to `--or`s and `A1`, `A2`, ... are the arguments to `--and`s:
  - `--or EXPR`
  : only export reqres which match any of these expressions
  - `--and EXPR`
  : only export reqres which match all of these expressions

- expression evaluation:
  - `-e EXPR, --expr EXPR`
  : an expression to compute, same expression format and semantics as `wrrarms get --expr` (which see); can be specified multiple times; default: `response.body|eb|scrub response +all_refs,-actions`, which will export safe scrubbed versions of all files

- URL remapping; used by `scrub` atom of `--expr`:
  - `--remap-id`
  : remap all URLs with an identity function; i.e. don't remap anything
  - `--remap-void`
  : remap all jump-link and action URLs to `javascript:void(0)` and all resource URLs into empty `data:` URLs; resulting web pages will be self-contained
  - `--remap-open, -k, --convert-links`
  : point all URLs present in input `PATH`s and reachable from `--root`s in no more that `--depth` steps to their corresponding output paths, remap all other URLs like `--remap-id` does; this is similar to `wget (-k|--convert-links)`
  - `--remap-closed`
  : remap all reachable URLs like `--remap-open` does, remap all other URLs like `--remap-void` does; `export`ed `mirror`s will be self-contained
  - `--remap-all`
  : remap all reachable URLs like `--remap-open` does, remap other URLs as if for each missing URL a trivial `GET <URL> -> 200 OK` reqres is present among input `PATH`s; this will produce broken links if the `--output` format depends on anything but the URL itself, but for a simple `--output` (like the default `hupq`) this will remap missing URLs to `--output` paths that they would occupy if they were present; this allows `wrrarms export` to be used incrementally; `export`ed `mirror`s will be self-contained; default

- exporting:
  - `--not-separated`
  : export values without separating them with anything, just concatenate them
  - `--lf-separated`
  : export values separated with `\n` (LF) newline characters; default
  - `--zero-separated`
  : export values separated with `\0` (NUL) bytes

- file outputs:
  - `-t DESTINATION, --to DESTINATION`
  : destination directory
  - `-o FORMAT, --output FORMAT`
  : format describing generated output paths, an alias name or "format:" followed by a custom pythonic %-substitution string; same expression format as `wrrarms organize --output` (which see); default: hupq

- new `--output`s printing:
  - `--no-print`
  : don't print anything; default
  - `-l, --lf-terminated`
  : print absolute paths of newly produced or replaced files terminated with `\n` (LF) newline characters
  - `-z, --zero-terminated`
  : print absolute paths of newly produced or replaced files terminated with `\0` (NUL) bytes

- updates to `--output`s:
  - `--no-overwrites`
  : disallow overwrites and replacements of any existing `--output` files under `DESTINATION`, i.e. only ever create new files under `DESTINATION`, producing errors instead of attempting any other updates; default;
    repeated exports of the same export targets with the same parameters (which, therefore, will produce the same `--output` data) are allowed and will be reduced to noops;
    however, trying to overwrite existing `--output` files under `DESTINATION` with any new data will produce errors;
    this allows reusing the `DESTINATION` between unrelated exports and between exports that produce the same data on disk in their common parts
  - `--skip-existing, --partial`
  : skip exporting of targets which have a corresponding `--output` file under `DESTINATION`;
    using this together with `--depth` is likely to produce a partially broken result, since skipping an export target will also skip all the documents it references;
    on the other hand, this is quite useful when growing a partial mirror generated with `--remap-all`
  - `--overwrite-dangerously`
  : export all targets while permitting overwriting of old `--output` files under `DESTINATION`;
    DANGEROUS! not recommended, exporting to a new `DESTINATION` with the default `--no-overwrites` and then `rsync`ing some of the files over to the old `DESTINATION` is a safer way to do this

- export targets:
  - `-r URL, --root URL`
  : recursion root; a URL which will be used as a root for recursive export; can be specified multiple times; if none are specified, then all (`net_url`) URLs available from input `PATH`s will be treated as roots
  - `-d DEPTH, --depth DEPTH`
  : maximum recursion depth level; the default is `0`, which means "`--root` documents and their resources only"; setting this to `1` will also export one level of documents referenced via jump and action links, if those are being remapped to local files with `--remap-*`; higher values will mean even more recursion

- file system path ordering:
  - `--paths-given-order`
  : `argv` and `--stdin0` `PATH`s are processed in the order they are given; default
  - `--paths-sorted`
  : `argv` and `--stdin0` `PATH`s are processed in lexicographic order
  - `--paths-reversed`
  : `argv` and `--stdin0` `PATH`s are processed in reverse lexicographic order
  - `--walk-fs-order`
  : recursive file system walk is done in the order `readdir(2)` gives results
  - `--walk-sorted`
  : recursive file system walk is done in lexicographic order; default
  - `--walk-reversed`
  : recursive file system walk is done in reverse lexicographic order

## Examples

- Pretty-print all reqres in `../dumb_server/pwebarc-dump` using an abridged (for ease of reading and rendering) verbose textual representation:
  ```
  wrrarms pprint ../dumb_server/pwebarc-dump
  ```

- Pipe raw response body from a given WRR file to stdout:
  ```
  wrrarms get ../dumb_server/pwebarc-dump/path/to/file.wrr
  ```

- Pipe response body scrubbed of dynamic content from a given WRR file to stdout:
  ```
  wrrarms get -e "response.body|eb|scrub response defaults" ../dumb_server/pwebarc-dump/path/to/file.wrr
  ```

- Get first 4 characters of a hex digest of sha256 hash computed on the URL without the fragment/hash part:
  ```
  wrrarms get -e "net_url|to_ascii|sha256|take_prefix 4" ../dumb_server/pwebarc-dump/path/to/file.wrr
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
  wrrarms find --and "status|~= .200C" --and "response.body|len|> 1024" ../dumb_server/pwebarc-dump
  ```

- Rename all WRR files in `../dumb_server/pwebarc-dump/default` according to their metadata using `--output default` (see the `wrrarms organize` section for its definition, the `default` format is designed to be human-readable while causing almost no collisions, thus making `num` substitution parameter to almost always stay equal to `0`, making things nice and deterministic):
  ```
  wrrarms organize ../dumb_server/pwebarc-dump/default
  ```

  alternatively, just show what would be done

  ```
  wrrarms organize --dry-run ../dumb_server/pwebarc-dump/default
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

- Produce a JSON list of `[<file path>, <time it finished loading in seconds since UNIX epoch>, <URL>]` tuples (one per reqres) and pipe it into `jq` for indented and colored output:
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

