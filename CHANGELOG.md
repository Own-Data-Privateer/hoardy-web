# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Also, at the bottom of this file there is [a TODO list](#todo) with planned future changes.

## [tool-v0.19.0] - 2024-12-07: Powerful filtering, exporting of different URL visits, hybrid export modes

### Changed: Semantics

- `*`:

  - In `--expr` expressions, `sha256` function changed semantics.
    From now on it returns the raw hash digest instead of the hexadecimal one.
    To get the old value, use `sha256|to_hex`.

### Added

- `*` except `organize --move`, `organize --hardlink`, `organize --symlink`, `get`, and `run`:

  - From now on, all sub-commands except for above can take inputs in all supported file formats.

    I.e., you can now do

    ```bash
    hoardy-web export mirror --to ~/hoardy-web/mirror1 mitmproxy.*.dump
    ```

    on `mitmproxy` dumps without even `import`ing them first.

  - By default, the above commands now also automatically dispatch between loaders of different file formats based on file extensions.
    So you can mix and match different file formats on the same command line.

  - Added a bunch of `--load-*` options that force a specific loader instead, e.g. `--load-wrrb`, `--load-mitmproxy`.

- `*`:

  - Added a ton of new filtering options.

    For example, you can now do:

    ```bash
    hoardy-web find --method GET --method DOM --status-re .200C --response-mime text/html \
      --response-body-grep-re "\bPotter\b" ~/hoardy-web/raw
    ```

    As before, these filters can still be used with other commands, like `stream`, or `export mirror`, etc.

    Also, the overall filtering semantics changed a bit.
    The top-level logical expression the filters compute is now a large conjunction.
    I.e. the above example now compiles to, a bit simplified, `(response.method == "GET" or response.method == "DOM") and re.match(".200C", status) and (response_mime == "text/html") and re.match("\\bPotter\\b", response.body)`.

  - Added a bunch of new `--output` formats.
    Mostly, this adds a bunch of output formats that refer to `stime`s.
    Mainly, to simplify `export mirror --all` usage, described below.

- `export mirror`:

  - Implemented exporting of different URL visits.

    I.e., you can now export not just `--latest` visit to each URL, but an `--oldest` one, or one `--nearest` to a given date, or `--all` of them.

  - Implemented `--latest-hybrid`, `--oldest-hybrid`, and `--nearest-hybrid` options.

    These allow you to export each page with resource requisites that are date-vise closest to the `stime` of the page itself, instead of taking globally `--latest`, `--oldest`, or `--nearest` versions of all requisite URLs.

    At the moment, this takes a lot more memory, but makes the results much more consistent for websites that do not use versioned resource requisites.

  - Implemented `--hardlink` and `--symlink` options, which allow exporting into content-addressed destinations.

    I.e. `export mirror --hardlink` will render and write each exported file to `<--to>/_content/<hash/based/path>.<ext>` and only then hardlink the result to `<--to>/<output/format/based/path>.<ext>` target destination.
    And similarly for `--symlink`.

    This saves quite a bit of space when pages refer to the same resource requisites by slightly different URLs, same images and fonts get distributed via different CDN hosts, when you export `--all` visits to some URLs and many of those are absolutely identical, etc.

    So, from now on, `--hardlink` is the default.
    The old behavior can be archived by running it with `--copy` instead.

  - Implemented `--relative` and `--absolute` options, which control if URLs should be remapped to relative or absolute `file:` URLs, respectively.

- Documented all the new things.

- Added a bunch of new `test-cli.sh` tests.

### Changed

- `export mirror`:

  - `--root-*` options now use the same syntax and machinery and support the same filtering options as the normal input filters.

  - Switched default `--output` to `hupq_n` to prevent collisions when using `--*-hybrid` and `--all`.

  - Improved handling of `base` `HTML` tags, `target` attributes are supported now.

  - Links that reference a page from itself will no longer refer to the page's filename, even when the link has no `fragment`.

    The results can be a bit confusing, but this makes the new content de-duplication options much more effective.

  - Made `export mirror` default filters explicit and changed them from `--method "GET" --status-re ".200C"` to `--method "GET" --method "DOM" --status-re ".200C"`.

  - Implemented `--ignore-bad-inputs` and `--index-all-inputs` options to allow you to change the above default.

  - Improved output log format.

- Improved file loading performance a bit.

- Improved documentation.

### Fixed

  - Added a bunch of new tests for `organize`, which cover the `organize --symlink --latest` bug of `tool-v0.18.0`.
    Won't happen again.

  - Fixed a couple of silly filtering-related bugs.

## [tool-v0.18.1] - 2024-11-30: Hotfixes

### Fixed

`tool-v0.18.0` introduced a bunch of issues:

- `organize`:

  - **Fixed `organize --symlink --latest` dereferencing output files, which lead to it overwriting plain `WRR` source files containing updated URLs with symlinks to their newer versions.**

    The good news is that this bug was only triggered when `organize --symlink --latest` was run with some newly archived data and,  for each updated `URL`, it only overwrote the second to last `WRR` file with a symlink to the latest `WRR` file.
    Unfortunately, this error was self-propagating, so those files could then get overwritten again by the next invocation of `organize --symlink --latest` with some more new data.
    This could happen up to 7 times, at which point it would start crashing, because of the OS symlink deferencing limit.

    You can check if you were affected by running:

    ```bash
    cd ~/web/raw ; find . -type l
    ```

    The paths it outputs will be the paths of lost `WRR` files.

    A reminder that it is good to do daily backups, I suppose.

    The next version will have a test for this, but I'm releasing this hotfix an hour after I discovered this.

  - Fixed it `assert`-crashing sometimes when running with `--symlink`.

  - Improved memory consumption a bit.

- `export mirror`:

  - Fixed overly large memory consumption.

## [tool-v0.18.0] - 2024-11-20: Incremental improvements

### Added

- `export mirror`:

  - Implemented the `--boring` option, which allows you to load some input `PATH`s without adding them as roots, even when no `--root-*` options are specified.

    This make CLI a bit more convenient to use.
    The [`README.md`](./tool/README.md) has a new example showcasing it.

- `export mirror`, `scrub`:

  - Implemented support for `@import` `CSS` rules using a string token in place of a URL.

    As far as I can see, this syntax is rarely used in practice, but the spec allows this, so.

  - Implemented `interpret_noscript` option, which enables inlining of `noscript` tags when `scrub` is running with `-scripts`.

    That is, `export mirror` will now use this feature by default.

    This is needed because some websites put `link` tags with `CSS` under `noscript`, thus making such pages look broken when `scrub`bed with `-scripts` (which is the default) and then opened in a browser with scripts enabled.

### Changed

- `*`: Refactored/reworked a large chunk of internals, as a result:

  - `organize` can now take `WRR` bundles as inputs too,
  - `export mirror` became much faster at indexing inputs that contain archives of the same URLs, repeatedly.

  In general, these changes are aimed towards making `hoardy-web` completely input-agnostic.
  That is, wouldn't it be nice if you could feed `mitmproxy` files to `export mirror` directly, instead of going through `import mitmproxy` first?

- `export mirror`, `scrub`:

  - From now on, it will stop generating `link` tags with void URLs, it will simply censor them out instead.

  - `scrub` with `+verbose` set will now also show original `rel` attr values for censored out tags.

  - Also, in general, the outputs of `scrub` with `+verbose` set are much prettier now.

- Improved documentation.

## [tool-v0.17.0] - 2024-11-09: Incremental improvements

### Added

- `*` except `organize`, `get`, and `run`:

  - All `WRR`-processing sub-commands except for above can now take `WRR` bundles as inputs.

    That is, you can now directly do

    ```bash
    hoardy-web pprint ~/Downloads/Hoardy-Web-export-*.wrrb
    hoardy-web export mirror --to ~/web/mirror ~/Downloads/Hoardy-Web-export-*.wrrb
    # etc
    ```

    without needing to run `hoardy-web import bundle` first.

    Though, at the moment, `export mirror` will stop respecting `--max-memory` option for such inputs.

- `export mirror`, `scrub`:

  - Implemented support for old-style `HTML` pages using `frameset` and `frame` `HTML` tags.

  - Implemented support for stylesheets stored as `data:` URLs stored in `href`s of `link` tags.

    Yes, this is actually allowed by the specs and the browsers.

### Changed

- `*`:

  - Parsing of `MIME` types, `Content-Type`, and `Link` headers is much more forgiving towards malformed inputs now.

- `export mirror`, `scrub`:

  - Links pointing to an `id` on same `HTML` page will now get emitted as `#<id>`, not `./<file>#<id>`.

  - `Refresh` headers with non-`HTTP` URLs will get censored away now.

  - Improved error messages in cases when an `HTTP` header failed to parse.

  - Improved performance a little bit.

### Fixed

- `export mirror`, `scrub`:

  - From now on, `scrub` will simply drop `HTML` tag attributes when all URLs in their values get censored away.

    Previously, it produced attributes with void URLs instead.

    This makes a huge difference for `src` and `srcset` attributes of `HTML` `img` tags where, before, generated pages plugged void URLs for missing sources, which sometimes confused browsers about which things should be used to display stuff, breaking things.

- `*`:

  - `HTML`s with Byte Order Marks will no longer get `mimesniff`ed as `text/plain`.

  - Fixed parsing of quoted `MIME` parameter values.

  - Fixed various crashes when processing data generated by the extension running under Chromium.

## [extension-v1.17.2] - 2024-11-09: Documentation fixes, mostly

### Changed

- [The `Help` page](./extension/page/help.org):

  - Rewrote "Conventions" and "'Work offline' mode" sections of to be much more readable.

- `*`:

  - Improved contrast when running with a light `CSS` color scheme.

### Fixed

- Documentation:

  - Fixed some typos.

- `*`:

  - Fixed some potential state display inconsistency bugs and improved UI pages' init performance when the core is very busy.

## [extension-v1.17.1] - 2024-11-01: Annoyance fixes

### Changed

- Popup UI:

  - Reverted most of the block reordering bit of popup UI rework of `extension-v1.17.0`.

    The "Globally" block is near the top again.

  - Edited the "Persistence" block a bit more.

    Mainly, to stop graying out always-useful stat lines, even when the associated features are disabled.

    This prevents possible confusion of what buttons can be used when.

  - Renamed some options and stat lines, mostly to make their names shorter to make popup UI on Fenix more readable.

- Toolbar button:

  - Edited its title format to be much shorter, especially on Fenix.

  - Reverted the ordering of parts there to how it was before `extension-v1.17.0`.

    The (much shorter now) "globally" part is at the front again because otherwise the badge being at the front there too without an explanation of its format is kind of confusing.

- Core + All internal pages:

  - Improved internal async message handling infrastructure, making things slightly more efficient.

  - Improved initialization functions of all internal pages, making them more efficient and making the resulting UI much less jiggly when changing zoom level and/or jumping around between pages.

- `*`:

  - Renamed `build.sh` `firefox` target to `firefox-mv2`, for consistency.

### Fixed

- UI:

  - Fixed flaky rendering of [`Help`](./extension/page/help.org) and `Changelog` pages on Fenix.

    They render properly now the very first time you load them, no reloads needed.

  - Fixed duplication of history entries when navigating internal links.

  - Fixed source links sometimes failing to being highlighted when pressing the browser's "Back" button.

  - Fixed some small `CSS` nitpicks.

- Popup UI + Documentation:

  - Realigned some help strings with reality.

- `*`:

  - Fixed a couple more mostly inconsequential tiny bugs.

### Added

- [The `Help` page](./extension/page/help.org):

  - Documented what `webNavigation` permission is used for, improved the rest a bit.

## [extension-v1.17.0] - 2024-10-30: Halloween special: major UI and state display improvements, fine-grained `Work offline` mode, add-on reloading with its state preserved, new options, etc

In related news, I have [💸☕ a Patreon account](https://www.patreon.com/oxij) now.

### Fixed: Possibly important

- Core:

  - Fixed a bug in `upgradeConfig` that was resetting `bucket` settings to their default values or upgrade to `extension-v1.13.0`.
    So, this is no longer relevant, but still.
    Also, refactored code there to prevent such errors in the future.

    **However, just in case, if you previously set `bucket` settings to something other than their default values and those settings are important to you, you should probably check your settings to ensure everything there is set as you expect it to be.**

### Changed: Important UI

- Core + Popup UI + Documentation:

  - Renamed `failed` state and related `failed*` stats to `unarchived` state and `unarchived*` stats.
    Introduced a new `failed` stat that is now a sum of `unstashed` and `unarchived` stats.
    Edited the popup UI and the other pages appropriately.

    This makes documentation's terminology more consistent, and simplifies UI a bit.

    In particular, the `Retry` button of `Queued/Failed` stat line will both retry stashing `unstashed` and archiving `unarchived` reqres now.

- Popup UI:

  - Reworked the whole thing quite a bit:

    - Improved option names and help strings.
    - Sorted sections and options to follow a more logically consistent order.
    - Improved layout.
    - Fixed some typos there.

  - From now on, setting `Bucket` for the current tab will set `Bucket` for its new children too, similar to how the rest of those settings work.

  - From now on, setting any of the `Bucket` settings to nothing will reset it to the parent/default value.
    I.e.:

    - Setting `Bucket` of `This tab's new children` to nothing will reset it to `Bucket` value of `This tab`.
    - Setting `Bucket` of `This tab` to nothing will reset it to `Bucket` value of `New root tabs`.
    - Setting `Bucket` of `New root tabs` to nothing will reset it to `default`.

- [The `Help` page](./extension/page/help.org):

  - The previous "Desktop" `JavaScript`-generated layout became `columns` `CSS` layout and `JS`-operation mode, while the "Mobile" `JavaScript`-generated layout became `linear` `CSS` layout and `JS`-operation mode.
    The page will now automatically switch between these two layouts and modes synchronously, depending on viewport width.

    (As before, in `linear` mode hovering over a link does nothing, but in `columns` mode, hovering over a link referring to a target in popup UI scrolls the popup UI column to that target and highlights it.)

    I.e., this means that on a Desktop browser, you can now zoom [the `Help` page](./extension/page/help.org) to arbitrary zoom levels and it will just switch between layouts and link-hover behaviors depending on available viewport width.

  - Greatly improved the styling of all links and documented it in [the "Conventions" section](./extension/page/help.org#conventions).

- All internal pages:

  - All internal pages now color-code links depending on where they point to, using exactly the same `CSS` as [the `Help` page](./extension/page/help.org).

  - All pages now use the same history state handling behaviour.

    I.e., using the "Back" button of your browser will now not only go back, but also highlight the last link you clicked.

  - All documentation pages now set viewport width to `device-width`, set content's `max-width` to `900px` and `width` to `100% - padding`, preventing horizontal scroll, when possible.
  - Improved the `CSS` styling in general.

- Core + Popup UI + General UI:

  - Implemented a new popup UI tristate toggle named `Color scheme` which allows `Hoardy-Web`'s color-scheme to be different from the browser's default.

  - Implemented a mechanism and popup UI settings for applying additional themes and experimental features.

  - And then I looked at the date. Which is why ◥▅◤◢▅◣◥▅◤ `Hoardy-Web` now has `🦇 Halloween mode`. ◥▅◤◢▅◣◥▅◤.

  - Also, from now on, the neutral states of tristate toggles are displayed with toggle knobs being in the middle of the things, not on their left.
    This is not a political statement.
    This mans that all tristate toggles, from left to right, now go `false` -> `null` -> `true` both internally (exactly as they did before) and externally (which is new).

### Changed: State display

- Core + Toolbar button + Icons:

  - Replaced toolbar button's icons representing Cartesian products of other icons with animations.

    In other words, the previous "this tab has limbo mode enabled while this tab's children do not" icon will now instead be represented with an animation that switches between "this tab has limbo mode enabled" and "this tab is idle" icons instead.

    This both takes less space in the `XPI`/`CRX`, makes for a cuter UI, and is the only reasonable solution when the core wants to display more than two icons at the same time.

  - Improved toolbar button's badge and title format a bit.

    "This tab" part goes first now, then "its new children", then "globally".

    Also, the order of sub-parts of those strings is more consistent now.

  - From now on, internal UI updater will generate icon animation frames for all important statuses and setting states.

    - When per-tab and per-tab's-new-children animation frames are equal, the repeated part will be elided.
    - When per-tab and per-tab's-new-children animation frames differ, the `main` icon will be inserted at the end to make it obvious when the animation loop restarts (otherwise, it's easy to interpret such animation loops incorrectly).

  - The update frequency of toolbar button's icon, badge, and title now depends on the amount of not yet done stuff still queued in the core.

    I.e., from now on, when the core has a lot of stuff to do (like when re-archiving thousands of reqres at the same time), it will start updating toolbar button's properties less to trade update latency for improved performance, and vice versa.

  - Greatly improved performance of state display updates. It's uses 2-1000x less CPU now, depending on what the core is doing.

- Icons:

  - Renamed the `error` icon to `failed` and added a new `error` icon.

    From now on, the `failed` icon will only be used for archival/stashing errors, while the `error` icon will only be used for internal errors (i.e. bugs).

  - Improved all icons to make them more visually distinct when they are being rendered at 48x48 or less, both in light and dark mode.

  - On Chromium, all icons are now rendered with transparent backgrounds, so now they will look nice in the dark mode too.

### Added: State display

- Core + Popup UI + Toolbar button:

  - From now on, popup UI and toolbar button's badge and title will display information about currently running internal actions.

    (Implementing this took a surprising amount of effort in improvements to infrastructure code.)

- Core + Toolbar button + Icons:

  - Added a new `in_limbo` icon for "this tab has data in limbo" status.
    Unlike most other icons, this icon will never be used alone, it will always be an animation frame of something longer.

- Core + Popup UI + Toolbar button:

  - Implemented `Animate toolbar icon every` setting for controlling toolbar icon animation speed.

### Fixed: State display

- Core + Toolbar button:

  - Fixed a bunch of bugs that prevented updates to toolbar button's icon and badge in some cases.

  - The icon and the badge will no longer get stuck when the core is very busy, like when re-archiving a lot of stuff all at once.

### Added: `Work offline` mode

- Core + Popup UI + Toolbar button + Icons + Documentation:

  - Implemented `Work offline` mode, options, their popup UI, shortcuts, and icons.

    This mode does the same thing as `File > Work Offline` checkbox of Firefox, except it supports per-tab/per-other-origin operation, not just the whole-browser one.
    Also, enabling any these options will not break requests that are still in flight, and the requests they do cancel can be logged.

    That is, enabling `Work offline` in a tab will start canceling all new requests that tab generates, and the resulting `canceled` reqres will get logged if `Track new requests` option is enabled in the same tab.
    Similarly for background tasks and other origins.

    This can be generally useful for debugging your own websites with dynamic responsive `CSS`, or if you just want to prevent a tab from accessing the network for some reason.

    However, the main reason this exists is that the files generated by `hoardy-web export mirror` do not get `scrub`bed absolutely correctly at the moment, and the resulting pages can end up with some references to remote resources (in cases when an exported page uses some rare `HTML` and `CSS` tag combinations, or lazy-load images via `JavaScript`, but still).
    With `Work offline` options enabled in a tab, you can now be sure that opening pages generated by `hoardy-web export mirror` won't send any requests to the network.

    In fact, from now on, by default, `Hoardy-Web` will enable `Work offline` in all tabs pointing to `file:` URLs.
    This can be disabled in the settings.

  - Documented it in more detain on [the `Help` page](./extension/page/help.org#work-offline).

  - Added a new `offline` toolbar icon to display the above state.

### Added: Reloading with state preserved

- Core + Popup UI + Documentation:

  - Implemented `reloadSelf` action that reloads the add-on while preserving its state.

    This action is different from similar `Reload` buttons in browser's own UI in that triggering this action will reload the add-on while preserving its state.
    Meanwhile, using the browser's buttons will reset everything and loose all reqres that are both unarchived and unstashed.

  - Added a popup UI button for triggering this action.
    (The button is only shown when a new version is available, unless debugging is enabled.)

  - Implemented `Auto-reload on updates` setting to automate away clicking of that button on updates.
    Though, it is currently disabled by default, because this feature is a bit experimental at the moment.

  - Documented it a little bit on [the `Help` page](./extension/page/help.org#bugs).

  - That is, from now on, after the browser notifies the add-on that it ready to be updated, the popup UI will display a button allowing you to reload it, so that the browser could load the new version instead.
    Alternatively, you can now enable `Auto-reload on updates` and it would do that automatically.

### Added: Options

- Core + Popup UI:

  - Implemented `Export via 'saveAs' > Bundle dumps` option as separate toggle instead of forcing you into set the maximum size to `0` to get the same effect.

  - Implemented `Include in global snapshots` per-tab/per-origin setting.

    I.e., you can now exclude specific tabs from being included in all-tab `DOM`-snapshots even when `Track new requests` option is enabled.

- Notifications + Popup UI:

  - Implemented `Notify about 'problematic' reqres` per-tab/per-origin setting.

    I.e., you can now exclude specific tabs from generating notifications about `problematic` reqres even when `Generate notifications about > ... new 'problematic' reqres` option is enabled.

### Changed: Misc

- Notifications + Documentation:

  - From now on, clicking an error notification will open [the relevant section of the `Help` page](./extension/page/help.org#error-notifications) while doing nothing for other notifications.

  - Also, improved that section a little bit.

- Documentation:

  - Moved re-archival instructions from the top-level [`README.md`](./README.md) to
    [the `Help` page](./extension/page/help.org#re-archival) and generalized them a bit.

  - Improved many random bits of documentation in random places.

- Core:

  - On Chromium, there will no longer be duplicates in reqres errors lists.

  - From now on, when you close a tab, all in-flight reqres in it will be emitted with `*::capture::EMIT_FORCED::BY_CLOSED_TAB` error set.
    Before, some of them sometimes finished with `webRequest::*_ABORT` errors instead.

  - Refactored a lot of internal stuff, simplifying how many internal things are done.

### Added: Misc

- Icons:

  - `build.sh` now has a new `tiles` target which generates pretty tile images from the icons on both light and dark backgrounds.
    This helps with debugging visual issues there.

    Also, both [Patreon](https://www.patreon.com/oxij) and [GitHub](https://github.com/Own-Data-Privateer/hoardy-web) are now configured to use one of the resulting images as `og:image`.
    For cuteness!

### Fixed: Misc

- Core + Documentation:

  - Fixed handling of interactions between page scrolling, node hilighting, and help tooltips.

    I.e., on [the `Help` page](./extension/page/help.org), highlighting an option in the popup UI by hovering over a link there, and then clicking on the help tooltip of the highlighted option will no longer make the UI look weird.

- Core + Notifications:

  - Fixed a small bug preventing no longer relevant notifications about `unarchived` reqres from being closed automatically.

## [tool-v0.16.0] - 2024-10-19

### Added

- `scrub`, `export mirror`:

  - Implemented inlining of `Link`, `Refresh`, `Content-Security-Policy`, and some other `HTTP` headers into the exported `HTML` files as `meta http-equiv` tags.

  - `scrub` now has `(+|-)navigations` option which controls whether the resulting `meta http-equiv=refresh` headers should be kept or censored out, `-navigations` is the default.

  - Also, CSP headers are not supported yet and, thus, the generated `meta http-equiv=content-security-policy` tags will get immediately censored out, which is usually invisible, but can be seen with `+verbose` set.

- `export mirror`:

  - Added `--max-memory` option, allowing you to sacrifice arbitrary amounts of RAM to improve performance.

- `*`:

  - Added unit tests for all internal parsers.

  - Added a lot of new integration tests.

### Changed

- `export mirror`:

  - Improved the exporting algorithm, switched to a completely recursive implementation, in preparation for future extensions with cool features.

  - From now on, writes to *all* files that are being exported (not just the top-level ones) will be atomic with respect to their dependencies.

- `*`:

  - Refactored internals a lot.

  - Improved performance a bit.

## [extension-v1.16.1] - 2024-10-15

### Fixed

- On Chromium, fixed request tracking being frequently broken since `extension-v1.15.0`.

- Fixed reqres without responses but with networking errors having "Responded at" field set in the logs.

## [tool-v0.15.5] - 2024-10-07

### Fixed

- `get`, `export mirror`, etc:

  - Restricted the `idna` workaround of `tool-v0.15.4` to hostnames with "--" in \[2:4\] character positions.

    The previous iteration made `parse_url` start accepting many malformed URLs.

  - URL parsing will now strip hostnames of leading and following whitespace, like browsers do.

    Mainly, this improves `export mirror` outputs.

  - Fixed output formatting when redirecting output to a non-tty destination.

## [simple_server-v1.7.0] - 2024-10-03

### Changed

- File path parts starting with "." in `profile`s (i.e. buckets) given by clients are ignored now.

  This prevents escapes from the given `--root`.

  The previous behaviour was not really a security issue, given that the server is not designed to be run with untrusted clients, and filenames are generated by it, not the clients.
  But still.

- Renamed command-line options:

  - `--no-print-cbors` -\> `--no-print`
  - `--default-profile` -\> `--default-bucket`
  - `--ignore-profiles` -\> `--ignore-buckets`

  This is makes them use the same terminology the extension uses.

  Old names are kept as aliases.

### Added

- `version` endpoint, for extensibility.

## [tool-v0.15.4] - 2024-10-02

### Fixed

- `get`, `export mirror`, etc:

  - Added a work-around for `idna` module failing to parse some hostnames ([#5 on GitHub](https://github.com/Own-Data-Privateer/hoardy-web/issues/5)).

- `find`:

  - Added `--sniff-*` options to fix crashes introduced in `v0.15.0`.

    Added tests to hopefully stop this kind of errors.

### Changed

- `get`, `export mirror`, etc:

  - `--expr`: technically, renamed `full_url` -\> `url`, though it did not officially exist before.

    Added it to the docs.

  - `ftp` and `ftps` URL schemes are now allowed everywhere.

## [tool-v0.15.3] - 2024-09-28

### Fixed

- `scrub`, `export mirror`:

  - From now on `scrub` will simply remove all `CORS` and `SRI` attributes from all relevant `HTML` tags.

    This works fine 99% of the time.
    Smarter handling for this will be implemented later.

  - Fixed `MIME` type sniffing of `XHTML` data.

    Also, added some tests for my `mimesniff` implementation.

  - Fixed crashes when URL remapper encounters weirdly malformed URLs.

    From now on they will be remapped into void URLs instead.

- `export mirror`:

  - Fixed it skipping regular files given directly as command line arguments.

    This was broken since `v0.15.0`.

- `scrub`, `import`:

  - Fixed some places where the documentation was misaligned with the code.

### Changed

- Improved documentation.

## [tool-v0.15.2] - 2024-09-21

### Fixed

- `scrub`, `export mirror`:

  - Fixed a stupid bug in `MIME` detection code that prevented external `CSS` files from being detected as such.

    Added tests to prevent such things in the future.

  - Fixed `CSS` formatting with `+whitespace` set.

  - Made `scrub` remove `crossorigin` attributes from `HTML` tags for which it remapped a URL.

    This seems to have fixed most of issues causing pages produced by `export mirror` looking broken when opened in a web browser.

### Changed

- Improved documentation.

## [tool-v0.15.1] - 2024-09-18

### Added

- `export mirror`

  - Added reporting for roots being queued at the very beginning.

### Fixed

- `import *`:

  - Added `--sniff-*` options to fix crashes introduced in `v0.15.0`.

- `export mirror`

  - It will now remap URL fragments instead of dropping them.
  - It will now report the correct `depth` value in the UI.
  - Stopped reporting of repeated `not remapping '%s'` lines.

## [tool-v0.15.0] - 2024-09-16

`export mirror` sub-command now produces results quite usable in a normal web browser.
I.e. it is now comparable to, say, what `Single-File` produces.

Feature-wise, it reaches a [Pareto front](https://en.wikipedia.org/wiki/Pareto_front), AFAICS, since no other tool I know of can do efficient (with shared page requisites) incremental static semi-open (see `--remap-semi` option below) website mirrors.

At the moment, scrubbed CSS can get a bit broken sometimes, because `hoardy-web` leans in favor of its results being safe to use, not them being as close to the original as possible.
Also, support for `audio`, `video`, and `source` `HTML` tags is still a bit quirky.
But the current state is quite usable.

### Added

- `scrub`, `export mirror`:

  - Implemented stylesheet (`CSS`) scrubbing with the help of `tinycss2`.

    I.e., requisite resource URLs mentioned in stylesheets will now be properly remapped.

    I.e., `export`ed website mirrors will be styled now.

- `export mirror`:

  - Added `--remap-semi` option, which does the same thing as `--remap-open` (which is equivalent to `wget --convert-links`), except it remaps unavailable action links and page requisites to void URLs, making the resulting generated pages self-contained and safe to open in a web browser without it trying to download something.

    I.e. `--remap-semi` does what `wget --convert-links` should be doing, IMHO.

  - Added `--root-url-prefix` and `--root-url-re` options.

- `pprint`, `get`, `run`, `stream`, `export mirror`:

  - Implemented `--sniff-*` options controlling `mimesniff` algorithm usage.

    For `pprint` sub-command they replace `--naive` and `--paranoid` options.

- `--expr`, `--output`: Added `pretty_net_url`, `pretty_net_nurl`, `raw_path_parts`, and `mq_raw_path` atoms.

### Changed

- `scrub`, `export mirror`:

  - Changed the way all `--remap-*` options are implemented.
    Most of the remapping logic was moved into the `scrub` function.
    `--remap-*` options simply change default values of the corresponding `--expr` options now.

  - `+styles` and `+iframes` options are now set by default.

    Since these things can now be properly exported.

  - Renamed `(+|-)srcs` options to `(+|-)reqs` to follow the terminology used by `wget`.

    In documentation, "page resources" became "requisite resources" and "page requisites".

  - Improved censoring for `IE`-pragmas.

  - Improved `+indent` and `+pretty` output layout a bit.

  - Improved `+verbose` output format a bit.

- `export mirror`:

  - Renamed `--root` option to `--root-url`, `-r` and `--root` options now point to `--root-url-prefix` instead.
    The `--root` option name is deprecated now and will be removed in the future.

  - Improved progress reporting UI.

    It's much prettier and more informative now.

  - It ignores duplicate input paths now.

    This allows to easily prioritize exporting of some files over others by specifying them in the command line arguments first, followed by their containing directory in a later argument.

    [`README.md`](./tool/README.md) has a new example showcasing it.

  - It delays disk writes for `HTML` pages until after all of their requisite resources finished exporting now.

    I.e. newly generated `HTML` pages can now be opened in a web browser while `export mirror` is still running, having not finished exporting other things yet.

- Improved content `MIME` type handling a bit, added `text/vtt` recognition.

- `--expr`, `--output`:
  - Renamed: `path_parts` -\> `npath_parts`, `mq_path` -\> `mq_npath`.

  - Changed semantics of `net_url` and `pretty_url` a bit.
    Both add trailing slashes after empty `raw_path`s now.
    Also, `pretty_url` does not normalize `raw_path` now, i.e. now it only re-quotes path parts, but does not interpret `.` and `..` path parts away.

- Greatly improved documentation.

### Fixed

- `scrub`, `export mirror`:

  - Fixed generation of broken `file:` links for URLs with query parameters.

  - From now on `stylesheet`, `icon`, and `shortcut` `link`s are treated as page requisites.

    This fixed a bug where `export mirror` with `--depth` set would forget to export `shortcut` `icon`s and `CSS` files.

  - Fixed a bug where `export mirror` with `--depth` and `--remap-(open|closed)` set would fail to remap unreachable URLs properly.

- Fixed some places where the code was misaligned with the documentation.

  - Most importantly, `scrub` and `export mirror` use `-verbose` by default now, which documentation claimed they did, but they did not.

- Fixed some typos.

## [extension-v1.16.0] - 2024-09-05

### Changed

- Renamed `pWebArc` -> `Hoardy-Web`.
- Renamed all `::pWebArc::` error codes into a more consistent naming scheme.
- Improved documentation.

## [tool-v0.14.1] - 2024-09-04

### Changed

- Renamed `wrrarms` -> `hoardy-web`.

## [simple_server-v1.6.1] - 2024-09-04

### Changed

- Renamed `dumb-dump-server` -> `hoardy-web-sas`.

## [extension-v1.15.1] - 2024-09-04

### Fixed

- Fixed some typos.

### Changed

- Improved notifications.
- Improved documentation.

## [tool-v0.14.0] - 2024-09-04

### Added

- Improved all the `script`s by adding usage descriptions and `--help` options to all of them.

- Added `--to` option to `wrrarms-pandoc` script.
  It allows you to change the output format it will use.

- Added `wrrarms-spd-say` script, which can feed contents of an archived `HTML` document, extracted from `HTML` via `pandoc -t plain`, to `speech-dispatcher`'s `spd-say`, i.e. to your preferred TTS engine.

- Added `--*-url` options to `wrrarms-w3m` and `wrrarms-pandoc` scripts.
  They allow you to control how to print the document's URL in the output.

- `get`: implemented `--expr-fd` option, which allows you to extracts multiple `--expr` values from the same input file to different output file descriptors in a single `wrrarms` call.

- Modified `wrrarms-w3m` and `wrrarms-pandoc` scripts to use `--expr-fd` option, making them ~2x faster.

- `export mirror`: implemented support for multiple `--expr` arguments.

- `import`: implemented `--override-dangerously` option.

- Added more `--output` formats.

### Changed

- Renamed all `--no-output` options to `--no-print`.

- Edited `--output` formats, making them more consistent with their expected usage:

  - Edited the `default`, `short`, `surl_msn`, and `url_msn` `--output` formats, replacing a "." before the `num` field with a "\_".
    Because these formats do not mention any file extensions.

  - Edited `surl_msn` and `url_msn` `--output` formats, replacing  and a "\_" before the `method` with "\_\_".
    To make these `--output` formats useful in programmatic usage.

  - Edited most other`--output` formats, replacing a "\_" before the `method` field with a "." and a "." before the non-standalone `num` with a "\_".
    Since these `--output` formats do use file extensions, this turns the whole `wrrarms`-specific suffix into a sub-extension.

- `wrrarms-pandoc` uses `plain` text `--to` output format by default now.
  The previous default was `org`-mode.

- Improved error messages.

- Improved documentation.

### Fixed

- `export mirror` now respects the given `--errors` option value not only while indexing inputs, but also while rendering and writing out outputs.

- Resurrected `flat_n` `--output` format.

## [extension-v1.15.0] - 2024-08-29

### Added

- `pWebArc` is now officially supported on Fenix (Firefox for Android). It is quite usable there now, so go forth and test it.

- Chromium version now has a `update_url` set in the `manifest.json`, so if you use [`chromium-web-store`](https://github.com/NeverDecaf/chromium-web-store) or some such, it can be updated semi-automatically now, see [the extension's `README.md`](./extension/README.md) for more info.

- Implemented `User Interface and Accessibility > Verbose` option.

  From now on, by default, `pWebArc` will have its most common but annoying notifications mention they can be disabled and explain how.

  This is mostly for Fenix users, where these things are not obvious, but it could also be useful for new users elsewhere.

- Implemented `User Interface and Accessibility > Spawn internal pages in new tabs` option which controls if internal pages should be spawned in new tabs or reuse the current window.

  It can not be disabled on desktop browsers at the moment, but it is disabled by default on mobile browsers.

- Implemented a bunch of new notifications about automatic fixes applied to `config`.

  I.e., it will now not just fix your `config` for you, but also complain if you try to set an invalid combinations of options.

- Implemented `Generate desktop notifications about ... > UI hints` option to allow you to disable the above notifications.

### Changed

- `pWebArc` will CBOR-dump all reqres fields completely raw from now on.

  `wrrarms` learned to handle this properly quite a while ago.

  This simplifies the parsing of the results and makes the implementation adhere to the stated technical philosophy more closely.

  The dumps will grow in size a tiny bit, but this is negligible, since they are compressed by default by all the archival methods now.

Moreover:

- A lot of UI improvements, mainly for Fenix.
- From now on, per-tab `Stash 'in_limbo' reqres` option is being inherited by children tabs like the rest of similar options do.
- Renamed `build.sh` `chromium` target to `chromium-mv2` in preparation for eventual `chromium-mv3` support.
- Advanced minimum browser versions to Firefox v102, and Fenix v113.
- Improved performance.
- Improved documentation and installation instructions.

### Fixed

- Fixed wrong "In limbo" counts after the extension gets reloaded.
- Fixed race conditions in `browserAction` updates.
- Worked around `browserAction` title updates being flaky on Fenix.
  I.e. you can stare at the `Extensions > pWebArc` line in the browser's UI now while the browser fetches some stuff and it will be properly interactively updated.
- On Firefox, fixed the id of the extension leaking into `origin_url` field of the very first dump of each session when `Workarounds for Firefox bugs > Restart the very first request` is enabled (which is the default).
- Fixed some typos.

## [extension-v1.14.0] - 2024-08-25

### Added

- pWebArc now runs under Fenix aka Firefox-for-Android-based browsers, including at least Fennec and Mull.

  Thought, `Export via 'saveAs'` archival method is broken there, because of [a bug in Firefox](https://bugzilla.mozilla.org/show_bug.cgi?id=1914360).
  Other methods do work, though.

  (Also, it is not marked as compatible with Firefox on Android on addons.mozilla.org at the moment, it probably will be in the next version.)

- The above change also added a settings page (aka `options_ui`).

  At the moment, the settings page is simply an unrolled by default version of popup UI, with per-tabs settings removed.

  This is need because on mobile browsers the main screen of the browser is not a tab and there's no toolbar, so there's no popup UI button there, and so the extension UI becomes really confusing without a separate settings page.

### Changed

- Split `in_flight` stat into a sum of two numbers.

  This makes things less confusing on Chromium, [the `Help` page](./extension/page/help.org) explains it in more detail.

- Added toolbar button's badge as a prefix to its title, changed its format a bit.

  This is needed because Fenix-based browsers do not display the badge at all, so this change helps immensely there.
  Meanwhile, on desktop browsers this does not hurt.

- Improved styling and dark mode contrast of the popup UI.

- Improved documentation.

  In particular, among other things, added a lot of new anchors to [the `Help` page](./extension/page/help.org), most internal links referencing some fact discussed in another section now point directly to the relevant paragraph instead of pointing to its section header.

### Fixed

On Firefox:

- Fixed capture of responses produced by service/shared workers.

  Also, added a new error code for when it (very rarely) fails because of a race condition inherent in `webRequest` API and documented all of it on [the `Help` page](./extension/page/help.org).

- Fixed `HTTP` protocol version detection, requests fetched via `HTTP/3` will now be marked as such.

- Added yet another `webRequest` API error to a list of those that mark reqres response data as incomplete.

On Chromium:

- Fixed more edge cases where reqres could get stuck in `in_flight` state indefinitely.

Generally:

- Fixed navigation with browser's `Back` and `Forward` buttons to work properly on [the `Help` page](./extension/page/help.org).

- Fixed a bug where force-stopping all in-flight reqres in a single tab could also drop some of the others.

## [extension-v1.13.1] - 2024-08-13

### Fixed

- Fixed a lot of places where the documentation was misaligned with current reality.

### Changed

- Improved documentation, especially [the `Help` page](./extension/page/help.org).
- Tiny improvement in popup UI `HTML` layout.
- Changed `config.history` default value.

## [extension-v1.13.0] - 2024-08-05

### Added

- Implemented reqres persistence across restarts.

  pWebArc can now save and reload `collected` but not archived reqres (including those `in_limbo`) by stashing them into browser's local storage.
  This is now enabled by default, but it can be disabled globally, or per-tab.

- As a consequence, pWebArc now tracks browsing sessions and shows when a reqres belongs to an older session on its `Internal State` page.

- Implemented two new archiving methods.
  pWebArc can now archive `collected` reqres by

  - generating fake-Downloads containing either separate dumps (one dump of an `HTTP` request+response per file) or bundles of them (many dumps in a single file, for convenience, to be later imported via `wrrarms import bundle`),

  - archiving separate dumps to your own private archiving server (the old one, the previous default, inherited on extension update),
  - archiving separate dumps to your browser's local storage (the new default on a new clean install).

- As a consequence, pWebArc now has a new `Saved in Local Storage` page for displaying the latter.

- Implemented display and filtering for `queued` and `failed` reqres on the `Internal State` page.

- Implemented tracking of per-state size totals for reqres in most states after `finished`.

- As a consequence, popup UI will now display those newly tracked sizes.

- Introduced the `errored` reqres state.

  With stashing to local storage enabled, pWebArc will now try its best not to loose any captured data even when its archiving code fails (bugs out) with an unexpected exception.
  If it bugs out in the capture code, then all bets are off, unfortunately.

### Changed

- pWebArc will now track if an error is recoverable and will not retry actions with unrecoverable errors automatically by default.

- pWebArc now follows the following state diagram:

  ```
  (start) -> (request sent) -> (nIO) -> (headers received) -> (nIO) --> (body recived)
     |                           |                              |             |
     |                           v                              v             v
     |                     (no_response)                   (incomplete)   (complete)
     |                           |                              |             |
     |                           \                              |             |
     |\---> (canceled) ----\      \                             |             |
     |                      \      \                            \             |
     |\-> (incomplete_fc) ---\      \                            \            v
     |                        >------>---------------------------->-----> (finished)
     |\--> (complete_fc) ----/                                             /  |
     |                      /                                             /   |
     \----> (snapshot) ----/       /- (collected) <--------- (picked) <--/    |
                                  /        ^                     |            |
                 (stashIO?) <----/         |                     v            v
                     |                     \-- (in_limbo) <- (stashIO?) <- (dropped)
                     v                              |                         |
                  (queued) <------------------\     |                         |
                  / |  ^ \                     \    \-----> (discarded) <-----/
    (exported) <-/  |  |  \----------------\    \                ^
        |           |  |                    \    \               |
        |       /---/  \-----------------\   \    \              |
        |       |                        |    \    \             |
        |       v                        |     \    \            |
        |\-> (srvIO) -> (stashIO?) -> (failed) |     \           |
        |       |                        ^     /      \          |
        |       v                        |    v        |         |
        |   (sumbitted) --------------> (saveIO) --> (saved)     | {{!saving}}
        |       \                                                |
        \-------->-----------------------------------------------/
  ```

- Renamed all `Profile` settings into `Bucket`, as this makes more sense.

- Improved popup UI layout.

- Changed toolbar icon's badge format a bit.

- Improved debugging options.

- A huge internal refactoring to solve constant sub-task scheduling issues once and for all.

- Improved documentation.

### Removed

- Removed `config.logDiscarded` option as it is no longer needed (pWebArc has proper log filtering now).

### Fixed

- Various small bugfixes.

## [tool-v0.13.0] - 2024-08-05

### Added

- Implemented `import bundle` sub-command which takes WRR-bundles (optionally gzipped concatenations of WRR-dumps) as inputs.
  The next version of the extension will start (optionally) producing these.

### Changed

- Improved error handling and error messages.

### Fixed

- A tiny fix for `pprint` output formatting.

## [extension-v1.12.0] - 2024-07-03

### Changed

- pWebArc will no longer automatically reload on updates, waiting for the browser to restart or for you to reload it explicitly instead.

  This way you won't lose any data on extension updates.

  Proper automatic reloads on updates will be implemented later, after pWebArc gets full persistence.

- Popup UI:

  - Reverted the split between `Globally` and `This session`.

    Implementing that split properly will make future things much harder, so, simple is best.

  - `Queued` stat moved to a separate line again.

    It also shows the sum total of sizes of all dumps now.

  - Added `Scheduled ... actions` stat line, showing the names of actions that are scheduled.

    It is hidden by default, because watching it closely while pWebArc is very busy can probably cause seizures in some people.

- Improved documentation.

### Fixed

- Various small bugfixes.

## [extension-v1.11.0] - 2024-06-27

### Added

- Implemented DOM snapshots, their popup UI, keyboard shortcuts and documentation.

  - Popup UI now has buttons to snapshot a single tab (`snapshotTab`) and snapshot all open tabs (`snapshotAll`).
  - `Ctrl+Alt+S` runs `snapshotTab` by default now.

- Added a bunch of new toolbar icons for various tab states.

  In particular, `problematic` state as well as mixed-capture states (e.g., disabled in this tab, but enabled and with limbo mode in children tabs) now have their own special icons.

### Changed

- Changed some default keyboard shortcuts:

  - `Ctrl+Alt+A` and `Ctrl+Alt+C` run `collectAllInLimbo` and `collectAllTabInLimbo` respectively now;
  - `Alt+Shift+D` and `Alt+Shift+W` run `discardAllInLimbo` and `discardAllTabInLimbo` now.

- Popup UI:

  - Improved layout.
  - Destructive actions will start asking for confirmations now.

- All SVG icons were edited to not reference any fonts, since those are not guaranteed to be available on a user's system.

- Improved behaviour of new tabs created by clicking buttons on the `Internal State` page.

- Greatly improved documentation.

## [extension-v1.10.0] - 2024-06-18

### Added

- Implemented dark mode theme.
  The extension will switch to it automatically when the browser asks (which it will if you switch your browser's theme to a dark one).

- Implemented some new optional UI-related accessibility config options with toggles in popup UI:

  - Colorblind mode: uses bluish colors instead of greenish where possible (which uses mostly the same colors pWebArc used before color-coding of UI toggles was introduced in `v1.9.0`, with slight variations for the new color-coding).
  - Pure text labels: disables emojis in UI labels, makes screen readers happier.

- Improved Internal State/Log UI:

  - Added a bunch of tristate toggles for filtering the logs.
  - Added in-log buttons to open a narrowed page for reqres with an associated tab.

- Added UI for internal scheduled/delayed actions/functions (e.g., saving of frequently changing stuff to persistent storage, automatic actions when a tab closes, canceling and reloading not-yet-debugged tabs on Chromium, etc):

  - If some functions are still waiting to be run, the badge will have `~` or `.` in it and change its color, depending on the importance of the stuff that is waiting to be run.
  - Popup UI has a new stat line showing the number of such delayed actions and buttons to run or cancel them immediately.

- Added config options and popup UI toggles for picking and marking as problematic reqres with various `HTTP` status codes.

- Implemented new config options and popup UI toggles for browser-specific workarounds.
  In particular, on Chromium you can now set the URL new root tabs will be reset to (still `about:blank` by default).

- Added more desktop notifications, added config options and popup UI toggles for them.

### Changed

- Improved keyboard shortcuts:

  - In popup UI, toggles and buttons with bound keyboard shortcuts will now get those shortcuts displayed in their tooltips.
  - [The "Keyboard shortcuts" section of the `Help` page](./extension/page/help.org#keyboard-shortcuts) will now show currently active shortcuts (when viewed via the `Help` button from the extension UI).
  - The changes to the code there mean all the shortcuts will be reset to their default keys, but it makes stuff much cleaner internally, so.
  - Collecting all reqres from currently active tab's limbo is bound to `Alt+S` by default now (similarly to how `Ctrl+S` saves the page).
  - Discarding all reqres from currently active tab's limbo is bound to `Alt+W` by default now (similarly to how `Ctrl+W` closes the tab).
  - Unmarking all problematic reqres in the currently active tab is bound to `Alt+U` by default now.
  - Added a few more shortcuts:
    - `Alt+Shift+U` by default unmarks all problematic reqres globally now.
    - `Alt+Shift+S` and `Alt+Shift+W` by default respectively collect and discard all reqres in limbo globally now.

- Much of the code working with Chromium's debugger was rewritten.
  Now it reports all the errors properly and no longer crashes when the debugger gets detached at inopportune time in the pipeline (which is quite common, unfortunately).

- `Mark reqres as 'problematic' when they finish > ... with reqres errors` config option became `> ... with reqres errors and get 'dropped'`, i.e. it is now disjoint with `> ... with reqres errors and get 'picked'`.

- Improved desktop notifications.

- Popup UI, in its default rolled-up state, now exposes `Generate desktop notifications about > ... new problematic reqres` option and has custom `tabindex`es set, for convenience.

- Changed some config option defaults (your existing config will not get affected).

- Slightly improved performance in normal operation.
  Greatly improved performance when archiving large batches of reqres at once, e.g. when collecting a lot of stuff from limbo.

- Greatly improved documentation.

### Fixed

- Various small bugfixes.

## [extension-v1.9.0] - 2024-06-07

### Fixed

- A whole ton of bugfixes.

  So many bugfixes that pWebArc on Chromium now actually works almost as well as on Firefox.

  All leftover issues on Chromium I'm aware of are consequences of Chromium's debugging API limitations and, as far as I can see, are unsolvable without actually patching Chromium (which is unlikely to be accepted upstream, given that patching them will make ad-blocking easier).

  `archiveweb.page` project appears to suffer from the same issues.

  Meanwhile, pWebArc continues to work exceptionally well on Firefox-based browsers.

### Added

- Implemented "negative limbo mode".

  It does the same thing as limbo mode does, but for reqres that were dropped instead of picked.
  (Which is why there is an arrow from `dropped` to `in_limbo` on the diagram below.)

- Implemented optional automatic actions when a tab gets closed.

  E.g., you can ask pWebArc to automatically unmark that tab's `problematic` reqres and/or collect and archive everything belonging to that tab from `limbo`.

- Implemented a bunch of new desktop notifications.

- Added a bunch of new configuration options.

  This includes a bunch of them for controlling desktop notifications.

- Added a bunch of new keyboard shortcuts.

  Also, keyboard shortcuts now work properly in narrowed `Internal State` pages.

- Implemented stat persistence between restarts.

  You can brag about your archiving prowess to your friends by sharing popup UI screenshots now.

- Added the `Changelog` page, which can be viewed by clicking the version number in the extension's popup.

### Changed

- pWebArc now follows the following state diagram:

  ```
  (start) -> (request sent) -> (nIO) -> (headers received) -> (nIO) --> (body recived)
     |                           |                              |             |
     |                           v                              v             v
     |                     (no_response)                   (incomplete)   (complete)
     |                           |                              |             |
     |                           \                              |             |
     |\---> (canceled) -----\     \                             |             |
     |                       \     \                            \             |
     |                        \     \                            \            v
     |\-> (incomplete_fc) ----->----->---------------------------->-----> (finished)
     |                        /                                            /  |
     |                       /                                      /-----/   |
     \--> (complete_fc) ----/        /--------------- (picked) <---/          v
                                     |                   |                (dropped)
                                     v                   v                 /  |
         (archived) <- (sIO) <- (collected) <------- (in_limbo) <---------/   |
                         |           ^                   |                    |
                         |           |                   |                    |
                  /------/           \-----\             \--> (discarded) <---/
                  |                        |
                  \-> (failed to archive) -/
  ```

  Terminology-wise, most notably, `picked` and `dropped` now mean what `collected` and `discarded` meant before.

  See [the `Help` page](./extension/page/help.org) for more info.

- A lot of changes to make pWebArc consistently use the above terminology --- both in the source and in the documentation --- were performed for this release.

- Improved visuals:

  - Extension's toolbar button icon, badge, and title are much more informative and consistent in their behaviour now.

  - The version number button in the popup (which opens the `Changelog`) will now get highlighted on major updates.

  - Similarly, the `Help` button will now get highlighted when that page gets updated.

  - The popup, [the `Help` page](./extension/page/help.org), [the `Internal State` aka the `Log` page](#state-in-extension-ui-only) all had their UI improved greatly.

  - All the toggles in the popup are now color-coded with their expected values, so if something looks red(-dish), you might want to check the help string in question just in case.

- Improved documentation.

## [tool-v0.12.0] - 2024-06-07

### Added

- `export mirror`: implemented `--no-overwrites`, `--partial`, and `--overwrite-dangerously` options.

### Changed

- `export mirror`: Switched the default from `--overwrite-dangerously` (which is what `export mirror` did before even if there was no option for it) to `--no-overwrites`.
  This makes the default semantics consistent with that of `organize`.

- Changed format of reqres `.status` to `<"C" or "I" for request.complete><"N" for no response or <response.code><"C" or "I" for response.complete> otherwise>` (yes, this changes most `--output` formats of `organize`, again).

  - Added `~=` expression atom which does `re.match` internally.

  - Changed all documentation examples to do `~= .200C` instead of `== 200C` to reflect the above change.

- `organize`: renamed `--keep` -> `--no-overwrites` for consistency.

- Improved documentation.

## [extension-v1.8.1] - 2024-05-22

### Fixed

- A tiny bugfix.

## [extension-v1.8.0] - 2024-05-20

(Actually, this releases about half of the new changes in my local branches, so expect a new release soonish.)

### Added

- Implemented `problematic` reqres flag, its tracking, UI, and documentation.

  This flag gets set for `no_response` and `incomplete` reqres by default but, unlike `Archive reqres with` settings, it does not influence archival.
  Instead pWebArc displays "archival failure" as its icon and its badge gets `!` at the end.

  This is needed because, normally, browsers provide no indication when some parts of the page failed to load properly --- they expect you to actually look at the page with your eyes to notice something looking broken instead --- which is not a proper way to do this when you want to be sure that the whole page with all its resources was archived.

- Implemented currently active tab's limbo mode indication via the icon.

- Added a separate state for reqres that are completed from cache: `complete_fc`.

### Changed

- Renamed reqres states:

  - `noresponse` -\> `no_response`,
  - `incomplete-fc` -\> `incomplete_fc`.

- pWebArc now follows the following state diagram:

  ```
  (start) -> (request sent) -> (nIO) -> (headers received) -> (nIO) --> (body recived)
     |                           |                              |             |
     |                           v                              v             v
     |                     (no_response)                   (incomplete)   (complete)
     |                           |                              |             |
     |                           \                              |             |
     |\---> (canceled) -----\     \                             |             |
     |                       \     \                            \             |
     |                        \     \                            \            v
     |\-> (incomplete_fc) ----->----->---------------------------->-----> (finished)
     |                        /                                            /  |
     |                       /                                      /-----/   |
     \--> (complete_fc) ----/        /------------- (collected) <--/          v
                                     |                   |                (discarded)
                                     v                   v                 /  |
         (archived) <- (sIO) <--- (queued) <-------- (in_limbo) <---------/   |
                         |           ^                   |                    |
                         |           |                   |                    |
                  /------/           \-----\             \----> (freeed) <----/
                  |                        |
                  \-> (failed to archive) -/
  ```

- Added more shortcuts, changed defaults for others:

  - Added `toggle-tabconfig-limbo`, `toggle-tabconfig-children-limbo`, and `show-tab-state` shortcuts,

  - Changed the default shortcut for `collect-all-tab-inlimbo` from `Alt+A` to `Alt+Shift+A` for uniformity.

- Improved UI:

  - The internal state/log page is much nicer now.
  - But the popup UI in its default state might have become a bit too long...

- Improved performance when using limbo mode.

- Improved documentation.

### Fixed

- Various small bugfixes.

## [tool-v0.11.2] - 2024-05-20

### Fixed

- `organize`: now works on Windows.

## [extension-v1.7.0] - 2024-05-02

### Added

- Implemented "limbo" reqres processing stage and toggles.

  "Limbo" is an optional pre-archival-queue stage for finished reqres that are ready to be archived but, unlike non-limbo reqres, are not to be archived automatically.

  Which is useful in cases when you need to actually look at a page before deciding if you want to archive it.

  E.g., you enable limbo mode, reload the page, notice there were no updates to the interesting parts of the page, and so you discard all of the reqres newly generated by that tab via appropriate button in the add-on popup, or via the new keyboard shortcut.

### Changed

- pWebArc now follows the following state diagram:

  ```
  (start) -> (request sent) -> (nIO) -> (headers received) -> (nIO) --> (body recived)
     |                           |                              |             |
     |                           v                              v             v
     |                      (noresponse)                   (incomplete)   (complete)
     |                           |                              |             |
     |                           \                              |             |
     |\---> (canceled) -----\     \                             |             |
     |                       \     \                            \             |
     |                        \     \                            \            v
     \--> (incomplete-fc) ----->----->---------------------------->-----> (finished)
                                                                           /  |
                                                                    /-----/   |
                                     /------------- (collected) <--/          v
                                     |                   |                (discarded)
                                     v                   v                 /  |
         (archived) <- (sIO) <--- (queued) <-------- (in_limbo) <---------/   |
                         |           ^                   |                    |
                         |           |                   |                    |
                  /------/           \-----\             \----> (freeed) <----/
                  |                        |
                  \-> (failed to archive) -/
  ```

- [The `Log` page became the `Internal State` page](#state-in-extension-ui-only), now shows in-flight and in-limbo reqres.
  It also allows narrowing to data belonging to a single tab now.

- Improved UI.

- Improved performance.

## [tool-v0.11.1] - 2024-05-02

### Changed

- Improved default batching parameters.
- Improved documentation.

## [tool-v0.11.0] - 2024-04-03

### Added

- Implemented `scrub` `--expr` atom for rewriting links/references and wiping inner evils out from `HTML`, `JavaScript`, and `CSS` values.

  `CSS` scrubbing is not finished yet, so all `CSS` gets censored out by default at the moment.

  `HTML` processing uses `html5lib`, which is pretty nice (though, rather slow), but overall the complexity of this thing and the time it took to debug it into working is kind of unamusing.

- Implemented `export mirror` subcommand generating static website mirrors from previously archived WRR files, kind of similar to what `wget -mpk` does, but offline and the outputs are properly `scrub`bed.

### Changed

- A bunch of `--expr` atoms were renamed, a bunch more were added.

- A bunch of `--output` formats changed, most notably `flat` is now named `flat_ms`.

- Improved performance.

- Improved documentation.

### Fixed

- Various small bugfixes.

## [tool-v0.9.0] - 2024-03-22

### Changed

- Updated `wrrarms` to build with newer `nixpkgs` and `cbor2` modules, the latter of which is now vendored, at least until upstream solves the custom encoders issue.

- Made more improvements to `--output` option of `organize` and `import` with IDNA and component-wise quoting/unquoting of tool-v0.8:

  - Added `pretty_url`, `mq_path`, `mq_query`, `mq_nquery` to substitutions and made pre-defined `--output` formats use them.

    `mq_nquery`, and `pretty_url` do what `nquery` and `nquery_url` did before v0.8.0, but better.

  - Dropped `shpq`, `hpq`, `shpq_msn`, and `hpq_msn` `--output` formats as they are now equivalent to their `hup` versions.

- `run`: `--expr` option now uses the same semantics as `get --expr`.

- Tiny improvements to performance.

### Fixed

- `pprint`: fixed `clock` line formatting a bit.

## [tool-v0.8.1] - 2024-03-12

### Added

- Added `--output flat_n`.

### Fixed

- Bugfix #1:

  `tool-v0.8` might have skipped some of the updates when `import`ing and forgot to do some actions when doing `organize`, which was not the case for `tool-v0.6`.

  These bugs should have not been triggered ever (and with the default `--output` they are impossible to trigger) but to be absolutely sure you can re-run `import mitmproxy` and `organize` with the same arguments you used before.

- Bugfix #2:

  `organize --output` `num`bering is deterministic again, like it was in `tool-v0.6`.

## [extension-v1.6.0] - 2024-03-08

### Changed

- Replaced icons with a cuter set.

## [tool-v0.8] - 2024-03-08

### Added

- Implemented import for `mitmproxy` dumps.

### Changed

- Improved `net_url` normalization and components handling, added support for IDNA hostnames.

- Improved most `--output` formats, custom `--output` formats now require `format:` prefix to distinguish them from the built-in ones, like in `git`.

- Renamed response status codes:

  - `N` -\> `I` for "Incomplete"
  - `NR` -\> `N` for "None"

- Renamed

  - `organize --action rename` -\> `organize --move` (as it can now atomically move files between file systems, see below),
  - `--action hardlink` -\> `--hardlink`,
  - `--action symlink` -\> `--symlink`,
  - `--action symlink-update` -\> `--symlink --latest`.

- Added `organize --copy`.

- `organize` now performs changes atomically: it writes to newly created files first, `fsync` them, replaces old destination files, `fsync`s touched directories, reports changes to `stdout` (for consumption by subsequent commands' `--stdin0`), and only then (when doing `--move`) deletes source files.

- Made many internal changes to simplify things in the future.

Paths produced by `wrrarms organize` are expected to change:

- with the default `--output` format you will only see changes to WRR files with international (IDNA) hostnames and those with the above response statuses;

- names of files generated by most other `--output` formats will change quite a lot, since the path abbreviation algorithm is much smarter now.

## [dumb_server-v1.6.0] - 2024-02-19

### Added

- Implemented `--uncompressed` option.

### Changed

- Renamed `--no-cbor` option to `--no-print-cbors`.

## [dumb_server-v1.5.5] - 2023-12-04

### Changed

- Improved documentation.

## [tool-v0.6] - 2023-12-04

### Added

- `organize`: implemented `--quiet`, `--batch-number`, and `--lazy` options.
- `organize`: implemented `--output flat` and improved other `--output` formats a bit.
- `get` and `run` now allow multiple `--expr` arguments.

### Changed

- Improved performance.
- Improved documentation.

## [tool-v0.5] - 2023-11-22

### Added

- Initial public release.

## [dumb_server-v1.5] - 2023-10-25

### Added

- Added `--default-profile` option, changed semantics of `--ignore-profiles` a bit.
- Added `--no-cbor` option.
- Packaged as both Python and Nix package.

### Changed

- Generated filenames for partial files now have `.part` extension.
- Generated filenames now include PID to allow multiple process instances of this to dump to the same directory.

## [extension-v1.5] - 2023-10-22

### Added

- Added keyboard shortcuts for toggling tab-related config settings.

### Changed

- Improved UI.
- Improved documentation.

### Fixed

- Various small bugfixes.

## [extension-v1.4] - 2023-09-25

### Added

- Implemented context menu actions.

### Changed

- Improved UI.
- Improved performance of dumping to CBOR.
- Improved documentation.

## [extension-v1.3.5] - 2023-09-13

### Changed

- Improved `document_url` and `origin_url` handling.
- Improved documentation.

## [extension-v1.3] - 2023-09-04

### Added

- Experimental Chromium support.

### Changed

- Improved UI.

### Fixed

- Various small bugfixes.

## [extension-v1.1] - 2023-08-28

### Changed

- Improved handling of `304 Not Modified` responses.
- Improved UI and [the `Help` page](./extension/page/help.org).

### Fixed

- Various small bugfixes.

## [dumb_server-v1.1] - 2023-08-28

### Added

- Implemented `--ignore-profiles` option.

## [dumb_server-v1.0] - 2023-08-25

### Added

- It now prints the its own server URL at the start, for convenience.
- Implemented gzipping before dumping to disk.
- The extension can now specify a per-dump `profile`, which is a suffix to be appended to the dumping directory.
- Implemented optional printing of the head and the tail of the dumped data to the TTY.

All planned features are complete now.

## [extension-v1.0] - 2023-08-25

### Changed

- Improved popup UI.
- Improved [the `Help` page](./extension/page/help.org): it's much more helpful now.
- Improved [the `Log` page](#state-in-extension-ui-only): it's an interactive page that gets updated automatically now.

### Fixed

- Various small bugfixes.

## [extension-v0.1] - 2023-08-20

### Added

- Initial public release.

## [dumb_server-v0.1] - 2023-08-20

### Added

- Initial public release.

[tool-v0.19.0]: https://github.com/Own-Data-Privateer/hoardy-web/compare/tool-v0.18.1...tool-v0.19.0
[tool-v0.18.1]: https://github.com/Own-Data-Privateer/hoardy-web/compare/tool-v0.18.0...tool-v0.18.1
[tool-v0.18.0]: https://github.com/Own-Data-Privateer/hoardy-web/compare/tool-v0.17.0...tool-v0.18.0
[tool-v0.17.0]: https://github.com/Own-Data-Privateer/hoardy-web/compare/tool-v0.16.0...tool-v0.17.0
[extension-v1.17.2]: https://github.com/Own-Data-Privateer/hoardy-web/compare/extension-v1.17.1...extension-v1.17.2
[extension-v1.17.1]: https://github.com/Own-Data-Privateer/hoardy-web/compare/extension-v1.17.0...extension-v1.17.1
[extension-v1.17.0]: https://github.com/Own-Data-Privateer/hoardy-web/compare/extension-v1.16.1...extension-v1.17.0
[tool-v0.16.0]: https://github.com/Own-Data-Privateer/hoardy-web/compare/tool-v0.15.5.1...tool-v0.16.0
[extension-v1.16.1]: https://github.com/Own-Data-Privateer/hoardy-web/compare/extension-v1.16.0...extension-v1.16.1
[tool-v0.15.5]: https://github.com/Own-Data-Privateer/hoardy-web/compare/tool-v0.15.4...tool-v0.15.5.1
[simple_server-v1.7.0]: https://github.com/Own-Data-Privateer/hoardy-web/compare/simple_server-v1.6.1...simple_server-v1.7.0
[tool-v0.15.4]: https://github.com/Own-Data-Privateer/hoardy-web/compare/tool-v0.15.3...tool-v0.15.4
[tool-v0.15.3]: https://github.com/Own-Data-Privateer/hoardy-web/compare/tool-v0.15.2...tool-v0.15.3
[tool-v0.15.2]: https://github.com/Own-Data-Privateer/hoardy-web/compare/tool-v0.15.1...tool-v0.15.2
[tool-v0.15.1]: https://github.com/Own-Data-Privateer/hoardy-web/compare/tool-v0.15.0...tool-v0.15.1
[tool-v0.15.0]: https://github.com/Own-Data-Privateer/hoardy-web/compare/tool-v0.14.1...tool-v0.15.0
[extension-v1.16.0]: https://github.com/Own-Data-Privateer/hoardy-web/compare/extension-v1.15.1...extension-v1.16.0
[tool-v0.14.1]: https://github.com/Own-Data-Privateer/hoardy-web/compare/tool-v0.14.0...tool-v0.14.1
[simple_server-v1.6.1]: https://github.com/Own-Data-Privateer/hoardy-web/compare/dumb_server-v1.6.0...simple_server-v1.6.1
[extension-v1.15.1]: https://github.com/Own-Data-Privateer/hoardy-web/compare/extension-v1.15.0...extension-v1.15.1
[tool-v0.14.0]: https://github.com/Own-Data-Privateer/hoardy-web/compare/tool-v0.13.0...tool-v0.14.0
[extension-v1.15.0]: https://github.com/Own-Data-Privateer/hoardy-web/compare/extension-v1.14.0...extension-v1.15.0
[extension-v1.14.0]: https://github.com/Own-Data-Privateer/hoardy-web/compare/extension-v1.13.1...extension-v1.14.0
[extension-v1.13.1]: https://github.com/Own-Data-Privateer/hoardy-web/compare/extension-v1.13.0...extension-v1.13.1
[extension-v1.13.0]: https://github.com/Own-Data-Privateer/hoardy-web/compare/extension-v1.12.0...extension-v1.13.0
[tool-v0.13.0]: https://github.com/Own-Data-Privateer/hoardy-web/compare/tool-v0.12.0...tool-v0.13.0
[extension-v1.12.0]: https://github.com/Own-Data-Privateer/hoardy-web/compare/extension-v1.11.0...extension-v1.12.0
[extension-v1.11.0]: https://github.com/Own-Data-Privateer/hoardy-web/compare/extension-v1.10.0...extension-v1.11.0
[extension-v1.10.0]: https://github.com/Own-Data-Privateer/hoardy-web/compare/extension-v1.9.0...extension-v1.10.0
[extension-v1.9.0]: https://github.com/Own-Data-Privateer/hoardy-web/compare/extension-v1.8.1...extension-v1.9.0
[tool-v0.12.0]: https://github.com/Own-Data-Privateer/hoardy-web/compare/tool-v0.11.2...tool-v0.12.0
[extension-v1.8.1]: https://github.com/Own-Data-Privateer/hoardy-web/compare/extension-v1.8.0...extension-v1.8.1
[extension-v1.8.0]: https://github.com/Own-Data-Privateer/hoardy-web/compare/extension-v1.7.0...extension-v1.8.0
[tool-v0.11.2]: https://github.com/Own-Data-Privateer/hoardy-web/compare/tool-v0.11.1...tool-v0.11.2
[extension-v1.7.0]: https://github.com/Own-Data-Privateer/hoardy-web/compare/extension-v1.6.0...extension-v1.7.0
[tool-v0.11.1]: https://github.com/Own-Data-Privateer/hoardy-web/compare/tool-v0.11.0...tool-v0.11.1
[tool-v0.11.0]: https://github.com/Own-Data-Privateer/hoardy-web/compare/tool-v0.9.0...tool-v0.11.0
[tool-v0.9.0]: https://github.com/Own-Data-Privateer/hoardy-web/compare/tool-v0.8.1...tool-v0.9.0
[tool-v0.8.1]: https://github.com/Own-Data-Privateer/hoardy-web/compare/tool-v0.8...tool-v0.8.1
[extension-v1.6.0]: https://github.com/Own-Data-Privateer/hoardy-web/compare/extension-v1.5...extension-v1.6.0
[tool-v0.8]: https://github.com/Own-Data-Privateer/hoardy-web/compare/tool-v0.6...tool-v0.8
[dumb_server-v1.6.0]: https://github.com/Own-Data-Privateer/hoardy-web/compare/dumb_server-v1.5.5...dumb_server-v1.6.0
[dumb_server-v1.5.5]: https://github.com/Own-Data-Privateer/hoardy-web/compare/dumb_server-v1.5...dumb_server-v1.5.5
[tool-v0.6]: https://github.com/Own-Data-Privateer/hoardy-web/compare/tool-v0.5...tool-v0.6
[tool-v0.5]: https://github.com/Own-Data-Privateer/hoardy-web/releases/tag/tool-v0.5
[dumb_server-v1.5]: https://github.com/Own-Data-Privateer/hoardy-web/compare/dumb_server-v1.1...dumb_server-v1.5
[extension-v1.5]: https://github.com/Own-Data-Privateer/hoardy-web/compare/extension-v1.4...extension-v1.5
[extension-v1.4]: https://github.com/Own-Data-Privateer/hoardy-web/compare/extension-v1.3.5...extension-v1.4
[extension-v1.3.5]: https://github.com/Own-Data-Privateer/hoardy-web/compare/extension-v1.3...extension-v1.3.5
[extension-v1.3]: https://github.com/Own-Data-Privateer/hoardy-web/compare/extension-v1.1...extension-v1.3
[extension-v1.1]: https://github.com/Own-Data-Privateer/hoardy-web/compare/extension-v1.0...extension-v1.1
[dumb_server-v1.1]: https://github.com/Own-Data-Privateer/hoardy-web/compare/dumb_server-v1.0...dumb_server-v1.1
[dumb_server-v1.0]: https://github.com/Own-Data-Privateer/hoardy-web/compare/dumb_server-v0.1...dumb_server-v1.0
[extension-v1.0]: https://github.com/Own-Data-Privateer/hoardy-web/compare/extension-v0.1...extension-v1.0
[extension-v0.1]: https://github.com/Own-Data-Privateer/hoardy-web/releases/tag/extension-v0.1
[dumb_server-v0.1]: https://github.com/Own-Data-Privateer/hoardy-web/releases/tag/dumb_server-v0.1

# TODO

... each roughly sorted according to the expected order things will probably get implemented.

## `Hoardy-Web` extension

- UI:
  - Improve `Internal State` and `Saved into Local Storage` UIs.
  - Add option persistence to `Internal State` and `Saved into Local Storage` UIs.
  - Add URL matching to `Internal State` and `Saved into Local Storage` UIs.
- Core+UI:
  - Add a popup UI section for `Closed tabs`, so that you could easily collect/discard `in_limbo` reqres from such tabs.
  - Track navigations and allow to use them as boundaries between batches of reqres saved in limbo mode.
  - (~25% done) Reorganize tracking- and problematic-related options into config profiles, allow them to override each over.
  - Implement per-host profiles.
  - Implement automatic capture of `DOM` snapshots when a page changes.
- UI:
  - (~25% done) Roll/unroll popup UI in steps, a-la `uBlock Origin`.
    The number of settings `Hoardy-Web` now has is kind of ridiculous (and I still want more), I find it hard to find stuff in there myself now, so.
- Core:
  - Implement automatic management of `network.proxy.no_proxies_on` setting to allow `Hoardy-Web` archival to an archiving server to work out of the box when using proxies.
  - Maybe: Dumping straight into `WARC`, so that third-party tools (i.e. not just `hoardy-web`) could be used for everything except capture.

## `hoardy-web` tool

- `export mirror`, `scrub`:
  - Handle SRI things.
  - Handle CSP things.
- `export mirror`:
  - Implement `export mirror --standalone`, which would inline all resources into each exported page, a-la `SingleFile`.
- `organize`:
  - Implement automatic discernment of relatedness of `WRR` files (by URLs and similarity) and packing of related files into `WRR` bundles.
  - Maybe: Implement data de-duplication between `WRR` files.
  - Implement `un206` command/option, which would reassemble a bunch of `GET 206` `WRR` files into a single `GET 200` `WRR` file.
- `export mirror`, `organize`:
  - Allow unloading and lazy re-loading of reqres loaded from anything other than separate `WRR` files.
    The fact that this is not possible at the moment makes memory consumption in those cases rather abysmal.
  - Implement on-the-fly mangling of reqres, so that, e.g. you could `organize` or `export` a reqres containing `https://web.archive.org/web/<something>/<URL>` as if it was just a `<URL>`.
- `*`:
  - Non-dumb `HTTP` server with time+URL index and replay, i.e. a local `HTTP` UI a-la [Wayback Machine](https://web.archive.org/).
    (Because re-generating local mirrors all the time can get a bit annoying.)
- `import`, `export`:
  - Converters from `HAR` and `WARC` to `WRR`.
  - Converter from `WRR` to `WARC`.
  - Converter from `PCAP` to `WRR`.
- `*`:
  - Maybe: Full text indexing and search. "Maybe", because offloading (almost) everything search-related to third-party tools may be a better idea.
