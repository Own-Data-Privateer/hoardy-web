# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

- Added `wrrarms-spd-say` script, which can feed contents of an archived HTML document, extracted from HTML via `pandoc -t plain`, to `speech-dispatcher`'s `spd-say`, i.e. to your preferred TTS engine.

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

  This makes things less confusing on Chromium, the `Help` page explains it in more detail.

- Added toolbar button's badge as a prefix to its title, changed its format a bit.

  This is needed because Fenix-based browsers do not display the badge at all, so this change helps immensely there.
  Meanwhile, on desktop browsers this does not hurt.

- Improved styling and dark mode contrast of the popup UI.

- Improved documentation.

  In particular, among other things, added a lot of new anchors to the `Help` page, most internal links referencing some fact discussed in another section now point directly to the relevant paragraph instead of pointing to its section header.

### Fixed

On Firefox:

- Fixed capture of responses produced by service/shared workers.

  Also, added a new error code for when it (very rarely) fails because of a race condition inherent in `webRequest` API and documented all of it on the `Help` page.

- Fixed HTTP protocol version detection, requests fetched via `HTTP/3` will now be marked as such.

- Added yet another `webRequest` API error to a list of those that mark reqres response data as incomplete.

On Chromium:

- Fixed more edge cases where reqres could get stuck in `in_flight` state indefinitely.

Generally:

- Fixed navigation with browser's `Back` and `Forward` buttons to work properly on the `Help` page.

- Fixed a bug where force-stopping all in-flight reqres in a single tab could also drop some of the others.

## [extension-v1.13.1] - 2024-08-13

### Fixed

- Fixed a lot of places where the documentation was misaligned with current reality.

### Changed

- Improved documentation, especially the `Help` page.
- Tiny improvement in popup UI HTML layout.
- Changed `config.history` default value.

## [extension-v1.13.0] - 2024-08-05

### Added

- Implemented reqres persistence across restarts.

  pWebArc can now save and reload `collected` but not archived reqres (including those `in_limbo`) by stashing them into browser's local storage.
  This is now enabled by default, but it can be disabled globally, or per-tab.

- As a consequence, pWebArc now tracks browsing sessions and shows when a reqres belongs to an older session on its `Internal State` page.

- Implemented two new archiving methods.
  pWebArc can now archive `collected` reqres by

  - generating fake-Downloads containing either separate dumps (one dump of an HTTP request+response per file) or bundles of them (many dumps in a single file, for convenience, to be later imported via `wrrarms import bundle`),

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

- Added config options and popup UI toggles for picking and marking as problematic reqres with various HTTP status codes.

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

  - The popup, the `Help` page, the `Internal State` aka the `Log` page all had their UI improved greatly.

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

- The `Log` page became the `Internal State` page, now shows in-flight and in-limbo reqres. It also allows narrowing to data belonging to a single tab now.

- Improved UI.

- Improved performance.

## [tool-v0.11.1] - 2024-05-02

### Changed

- Improved default batching parameters.
- Improved documentation.

## [tool-v0.11.0] - 2024-04-03

### Added

- Implemented `scrub` `--expr` atom for rewriting links/references and wiping inner evils out from HTML, JavaScript, and CSS values.

  CSS scrubbing is not finished yet, so all CSS gets censored out by default at the moment.

  HTML processing uses `html5lib`, which is pretty nice (though, rather slow), but overall the complexity of this thing and the time it took to debug it into working is kind of unamusing.

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
- Improved UI and the `Help` page.

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
- Improved the `Help` page: it's much more helpful now.
- Improved the `Log` page: it's an interactive page that gets updated automatically now.

### Fixed

- Various small bugfixes.

## [extension-v0.1] - 2023-08-20

### Added

- Initial public release.

## [dumb_server-v0.1] - 2023-08-20

### Added

- Initial public release.

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
[tool-v0.11.2]: https://github.com/Own-Data-Privateer/hoardy-web/compare/tool-v0.11.1...tool-v0.11.2
[extension-v1.8.0]: https://github.com/Own-Data-Privateer/hoardy-web/compare/extension-v1.7.0...extension-v1.8.0
[extension-v1.7.0]: https://github.com/Own-Data-Privateer/hoardy-web/compare/extension-v1.6.0...extension-v1.7.0
[tool-v0.11.1]: https://github.com/Own-Data-Privateer/hoardy-web/compare/tool-v0.11.0...tool-v0.11.1
[tool-v0.11.0]: https://github.com/Own-Data-Privateer/hoardy-web/compare/tool-v0.9.0...tool-v0.11.0
[tool-v0.9.0]: https://github.com/Own-Data-Privateer/hoardy-web/compare/tool-v0.8.1...tool-v0.9.0
[tool-v0.8.1]: https://github.com/Own-Data-Privateer/hoardy-web/compare/tool-v0.8...tool-v0.8.1
[extension-v1.6.0]: https://github.com/Own-Data-Privateer/hoardy-web/compare/extension-v1.5...extension-v1.6.0
[tool-v0.8]: https://github.com/Own-Data-Privateer/hoardy-web/compare/tool-v0.6...tool-v0.8
[dumb_server-v1.6.0]: https://github.com/Own-Data-Privateer/hoardy-web/compare/dumb_server-v1.5.5...dumb_server-v1.6.0
[tool-v0.6]: https://github.com/Own-Data-Privateer/hoardy-web/compare/tool-v0.5...tool-v0.6
[dumb_server-v1.5.5]: https://github.com/Own-Data-Privateer/hoardy-web/compare/dumb_server-v1.5...dumb_server-v1.5.5
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
