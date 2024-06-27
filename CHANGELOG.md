# extension-v1.11.0

- Implemented DOM snapshots, their popup UI, keyboard shortcuts and documentation.

  - `Ctrl+Alt+S` runs `snapshotTab` by default now.

- Changed some default keyboard shortcuts:

  - `Ctrl+Alt+A` and `Ctrl+Alt+C` run `collectAllInLimbo` and `collectAllTabInLimbo` respectively now;
  - `Alt+Shift+D` and `Alt+Shift+W`run `discardAllInLimbo` and `discardAllTabInLimbo` now.

- Popup UI:

  - Improved layout.
  - Destructive actions will start asking for confirmations now.

- Added a bunch of new toolbar icons for various tab states.

  In particular, `problematic` state as well as mixed-capture states (e.g., disabled in this tab, but enabled and with limbo mode in children tabs) now have their own special icons.

- All SVG icons were edited to not reference any fonts, since those are not guaranteed to be available on a user's system.

- Improved behaviour of new tabs created by clicking buttons on the "Internal State" page.

- Greatly improved documentation.

# extension-v1.10.0

- Implemented dark mode theme.
  The extension will switch to it automatically when the browser asks (which it will if you switch your browser's theme to a dark one).

- Implemented some new optional UI-related accessibility config options with toggles in popup UI:

  - Colorblind mode: uses bluish colors instead of greenish where possible (which uses mostly the same colors pWebArc used before color-coding of UI toggles was introduced in `v1.9.0`, with slight variations for the new color-coding).
  - Pure text labels: disables emojis in UI labels, makes screen readers happier.

- Improved Internal State/Log UI:

  - Added a bunch of tristate toggles for filtering the logs.
  - Added in-log buttons to open a narrowed page for reqres with an associated tab.

- Improved keyboard shortcuts:

  - In popup UI, toggles and buttons with bound keyboard shortcuts will now get those shortcuts displayed in their tooltips.
  - [The "Keyboard shortcuts" section of the "Help" page](./extension/page/help.org#keyboard-shortcuts) will now show currently active shortcuts (when viewed via the "Help" button from the extension UI).
  - The changes to the code there mean all the shortcuts will be reset to their default keys, but it makes stuff much cleaner internally, so.
  - Collecting all reqres from currently active tab's limbo is bound to `Alt+S` by default now (similarly to how `Ctrl+S` saves the page).
  - Discarding all reqres from currently active tab's limbo is bound to `Alt+W` by default now (similarly to how `Ctrl+W` closes the tab).
  - Unmarking all problematic reqres in the currently active tab is bound to `Alt+U` by default now.
  - Added a few more shortcuts:
    - `Alt+Shift+U` by default unmarks all problematic reqres globally now.
    - `Alt+Shift+S` and `Alt+Shift+W` by default respectively collect and discard all reqres in limbo globally now.

- Added UI for internal scheduled/delayed actions/functions (e.g., saving of frequently changing stuff to persistent storage, automatic actions when a tab closes, canceling and reloading not-yet-debugged tabs on Chromium, etc):

  - If some functions are still waiting to be run, the badge will have "\~" or "." in it and change its color, depending on the importance of the stuff that is waiting to be run.
  - Popup UI has a new stat line showing the number of such delayed actions and buttons to run or cancel them immediately.

- Much of the code working with Chromium's debugger was rewritten.
  Now it reports all the errors properly and no longer crashes when the debugger gets detached at inopportune time in the pipeline (which is quite common, unfortunately).

- Added config options and popup UI toggles for picking and marking as problematic reqres with various HTTP status codes.

- "Mark reqres as problematic when they finish ... with reqres errors" config option became "... with reqres errors and get `dropped`", i.e. it is now disjoint with "... with reqres errors and get `picked`".

- Implemented new config options and popup UI toggles for browser-specific workarounds.
  In particular, on Chromium you can now set the URL new root tabs will be reset to (still `about:blank` by default).

- Improved desktop notifications, added some more of them, added config options and popup UI toggles for them.

- Popup UI, in its default rolled-up state, now exposes "Generate desktop notifications about ... new problematic reqres" option and has custom `tabindex`es set, for convenience.

- Changed some config option defaults (your existing config will not get affected).

- Slightly improved performance in normal operation.
  Greatly improved performance when archiving large batches of reqres at once, e.g. when collecting a lot of stuff from limbo.

- A lot of bugfixes.

- Greatly improved documentation.

# extension-v1.9.0

- Bugfixes. A whole ton of bugfixes.

  So many bugfixes that pWebArc on Chromium now actually works almost as well as on Firefox.

  All leftover issues on Chromium I'm aware of are consequences of Chromium's debugging API limitations and, as far as I can see, are unsolvable without actually patching Chromium (which is unlikely to be accepted upstream, given that patching them will make ad-blocking easier).

  `archiveweb.page` project appears to suffer from the same issues.

  Meanwhile, pWebArc continues to work exceptionally well on Firefox-based browsers.

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

  See [the "Help" page](./extension/page/help.org) for more info.

  - A lot of changes to make pWebArc consistently use the above terminology --- both in the source and in the documentation --- were performed for this release.

- New features:

  - Implemented "negative limbo mode".

    It does the same thing as limbo mode does, but for reqres that were dropped instead of picked.
    (Which is why there is an arrow from `dropped` to `in_limbo` on the diagram above.)

  - Implemented optional automatic actions when a tab gets closed.

    E.g., you can ask pWebArc to automatically unmark that tab's `problematic` reqres and/or collect and archive everything belonging to that tab from `limbo`.

  - Implemented a bunch of new desktop notifications.

  - Added a bunch of new configuration options.

    This includes a bunch of them for controlling desktop notifications.

  - Added a bunch of new keyboard shortcuts.

    Also, keyboard shortcuts now work properly in narrowed "Internal State" pages.

  - Implemented stat persistence between restarts.

    You can brag about your archiving prowess to your friends by sharing popup UI screenshots now.

- Added the "Changelog" page, which can be viewed by clicking the version number in the extension's popup.

- Improved visuals:

  - Extension's toolbar button icon, badge, and title are much more informative and consistent in their behaviour now.

  - The version number button in the popup (which opens the "Changelog") will now get highlighted on major updates.

  - Similarly, the "Help" button will now get highlighted when that page gets updated.

  - The popup, the "Help" page, the "Internal State" aka the "Log" page all had their UI improved greatly.

  - All the toggles in the popup are now color-coded with their expected values, so if something looks red(-dish), you might want to check the help string in question just in case.

- Improved documentation.

# tool-v0.12.0

- Changed format of reqres `.status` to `<"C" or "I" for request.complete><"N" for no response or <response.code><"C" or "I" for response.complete> otherwise>` (yes, this changes most `--output` formats of `organize`, again).

  - Added `~=` expression atom which does `re.match` internally.

  - Changed all documentation examples to do `~= .200C` instead of `== 200C` to reflect the above change.

- `export mirror`: implemented `--no-overwrites`, `--partial`, and `--overwrite-dangerously` options.

  Switched the default from `--overwrite-dangerously` (which is what `export mirror` did before even if there was no option for it) to `--no-overwrites`.
  This makes the default semantics consistent with that of `organize`.

- `organize`: renamed `--keep` -> `--no-overwrites` for consistency.

- Improved documentation.

# extension-v1.8.1

- Tiny bugfix.

# extension-v1.8.0

- Implemented "problematic" reqres flag, its tracking, UI, and documentation.

  This flag gets set for "no_response" and "incomplete" reqres by default but, unlike "Archive reqres with" settings, it does not influence archival.
  Instead pWebArc displays "error" as its icon and its badge gets "!" at the end.

  This is needed because, normally, browsers provide no indication when some parts of the page failed to load properly --- they expect you to actually look at the page with your eyes to notice something looking broken instead --- which is not a proper way to do this when you want to be sure that the whole page with all its resources was archived.

- Implemented currently active tab's limbo mode indication via the icon.

- Added more shortcuts, changed defaults for others:

  - Added `toggle-tabconfig-limbo`, `toggle-tabconfig-children-limbo`, and `show-tab-state` shortcuts,

  - Changed the default shortcut for `collect-all-tab-inlimbo` from `Alt+A` to `Alt+Shift+A` for uniformity.

- Renamed reqres states:

  - `noresponse` -\> `no_response`,
  - `incomplete-fc` -\> `incomplete_fc`.

- Added a separate state for reqres that are completed from cache: `complete_fc`.

- Improved UI, the internal state/log page is much nicer now, but the popup UI in its default state might have become a bit too long...

- Improved performance when using limbo mode.

- Improved documentation.

- Bugfixes.

(Actually, this releases about half of the new changes in my local branches, so expect a new release soonish.)

# tool-v0.11.2

- Bugfixes.

# extension-v1.7.0

- Implement "in limbo" reqres processing stage and toggles.

  "Limbo" is an optional pre-archival-queue stage for finished reqres that are ready to be archived but, unlike non-limbo reqres, are not to be archived automatically.

  Which is useful in cases when you need to actually look at a page before deciding if you want to archive it.

  E.g., you enable limbo mode, reload the page, notice there were no updates to the interesting parts of the page, and so you discard all of the reqres newly generated by that tab via appropriate button in the add-on popup, or via the new keyboard shortcut.

- The "Log" page became the "Internal State" page, now shows in-flight and in-limbo reqres. It also allows narrowing to data belonging to a single tab now.

- Improved UI.

- Improved performance.

# tool-v0.11.1

- Improved default batching parameters.
- Improved documentation.

# tool-v0.11.0

- Implemented `scrub` `--expr` atom for rewriting links/references and wiping inner evils out from HTML, JavaScript, and CSS values.

  CSS scrubbing is not finished yet, so all CSS gets censored out by default at the moment.

  HTML processing uses `html5lib`, which is pretty nice (though, rather slow), but overall the complexity of this thing and the time it took to debug it into working is kind of unamusing.

- Implemented `export mirror` subcommand generating static website mirrors from previously archived WRR files, kind of similar to what `wget -mpk` does, but offline and the outputs are properly `scrub`bed.

- A bunch of `--expr` atoms were renamed, a bunch more were added.

- A bunch of `--output` formats changed, most notably `flat` is now named `flat_ms`.

- Improved performance.

- Bugfixes.

- Improved documentation.

# tool-v0.9.0

- Updated `wrrarms` to build with newer `nixpkgs` and `cbor2` modules, the latter of which is now vendored, at least until upstream solves the custom encoders issue.

- Made more improvements to `--output` option of `organize` and `import` with IDNA and component-wise quoting/unquoting of tool-v0.8:

  - Added `pretty_url`, `mq_path`, `mq_query`, `mq_nquery` to substitutions and made pre-defined `--output` formats use them.

    `mq_nquery`, and `pretty_url` do what `nquery` and `nquery_url` did before v0.8.0, but better.

  - Dropped `shpq`, `hpq`, `shpq_msn`, and `hpq_msn` `--output` formats as they are now equivalent to their `hup` versions.

- Bugfixed `--expr` option of `run`, and the `clock` line in `pprint`.

- Tiny improvements to performance.

# tool-v0.8.1

- Bugfix #1:

  `tool-v0.8` might have skipped some of the updates when `import`ing and forgot to do some actions when doing `organize`, which was not the case for `tool-v0.6`.

  These bugs should have not been triggered ever (and with the default `--output` they are impossible to trigger) but to be absolutely sure you can re-run `import mitmproxy` and `organize` with the same arguments you used before.

- Bugfix #2:

  `organize --output` `num`bering is deterministic again, like it was in `tool-v0.6`.

- Added `--output flat_n`.

# extension-v1.6.0

- Replaced icons with a cuter set.

# tool-v0.8

- Implemented import for `mitmproxy` dumps.

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

# dumb_server-v1.6.0

- Implemented `--uncompressed` option.
- Renamed `--no-cbor` option to `--no-print-cbors`.

# dumb_server-v1.5.5

- Improved documentation.

# tool-v0.6

- `organize`: implemented `--quiet`, `--batch-number`, and `--lazy` options.
- `organize`: implemented `--output flat` and improved other `--output` formats a bit.
- `get` and `run` now allow multiple `--expr` arguments.
- Improved performance.
- Improved documentation.

# tool-v0.5

- Initial public release.

# dumb_server-v1.5

- Generated filenames for partial files now have `.part` extension.
- Generated filenames now include PID to allow multiple process instances of this to dump to the same directory.
- Added `--default-profile` option, changed semantics of `--ignore-profiles` a bit.
- Added `--no-cbor` option.
- Packaged as both Python and Nix package.

# extension-v1.5

- Added keyboard shortcuts toggling tab-related config settings.
- Improved UI.
- Improved documentation.
- Bugfixes.

# extension-v1.4

- Implemented context menu actions.
- Improved UI.
- Improved performance of dumping to CBOR.
- Improved documentation.

# extension-v1.3.5

- Improved `document_url` and `origin_url` handling.
- Improved documentation.

# extension-v1.3

- Experimental Chromium support.
- Improved UI.
- Bugfixes

# extension-v1.1

- Improved handling of "304 Not Modified" responses.
- Improved UI and the "Help" page.
- Bugfixes.

# dumb_server-v1.1

- Implemented `--ignore-profiles` option.

# dumb_server-v1.0

- All planned features are complete now.

# extension-v1.0

- Improved popup UI.
- Improved the "Help" page: it's much more helpful now.
- Improved the "Log" page: it's an interactive page that gets updated automatically now.
- Some small bugfixes.

# extension-v0.1

- Initial public release.
