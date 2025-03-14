# What is `Hoardy-Web` Web Extension?

`Hoardy-Web` is a browser extension (add-on) that passively captures and collects dumps of `HTTP` requests and responses as you browse the web, and then archives them using one or more of the following methods:

- by saving them into your browser's local storage, which is the default;
- by submitting them to your own private archiving server via `HTTP`, like
  - the advanced archival+replay server [`hoardy-web serve`](../tool/) or
  - the simple archiving-only server [`hoardy-web-sas`](../simple_server/);
- by generating fake-Downloads containing bundles of those dumps,
  making your browser simply save them to your `Downloads` directory.

`Hoardy-Web` produces dumps in a very simple, yet efficient, [`WRR` file format](../doc/data-on-disk.md).

Moreover, `Hoardy-Web` implements:

- UI indicators that help in ensuring good and complete website captures,
- optional post-capture machinery that helps in archiving only select subsets of captured data;
- archival+replay integration when used in combination with an [advanced archiving+replay server like `hoardy-web serve`](../tool/);
- capture of `DOM` snapshots;
- inspection of captured `HTTP` traffic, similar to browser's own `Network Monitor`
  (except browser-wise, i.e., it can capture `HTTP` requests even when a page generates them when its tab/window closes;
  which a surprising number of websites does to prevent their web traffic from being inspected with `Network Monitor`);
- some generally useful web browsing features (like per-tab `Work offline` mode).

In other words, this extension implements an in-browser half of your own personal private passive [Wayback Machine](https://web.archive.org/) that archives everything you see, including `HTTP POST` requests and responses (e.g. answer pages of web search engines), as well as most other `HTTP`-level data (`AJAX`, `JSON RPC`, etc).

For more information see [project's documentation](../README.md) and [extension's `Help` page](./page/help.org) (also distributed with the extension itself, available via the "Help" button from its popup UI), especially the ["Frequently Asked Questions" section there](./page/help.org#faq).

Also, note that:

- `Hoardy-Web` **DOES NOT** send any of your captured web browsing data anywhere, unless you explicitly configure it to do so.
- `Hoardy-Web` **DOES NOT** send any telemetry anywhere.
- Both of the above statements will apply to **all future versions** of `Hoardy-Web`.

`Hoardy-Web` was previously known as "Personal Private Passive Web Archive" aka `pWebArc`.

# Screenshots

See the [gallery](../doc/gallery.md).

# Installation

## <span id="install-firefox"/>On Firefox-based browsers (Firefox, Tor Browser, LibreWolf, Fenix aka Firefox for Android, Fennec, Mull, etc)

- [![](https://oxij.org/asset/img/software/amo/get-the-addon-small.png) Install the extension from addons.mozilla.org](https://addons.mozilla.org/en-US/firefox/addon/hoardy-web/).
  Then, in a desktop browser, press `Extensions` toolbar button and pin `Hoardy-Web`.
  (In mobile browsers there is are no customizable toolbars, unfortunately.)

- Alternatively, download the latest `Hoardy-Web-firefox-*.xpi` from [Releases](https://github.com/Own-Data-Privateer/hoardy-web/releases), and then [follow "Install as an unsigned XPI" instructions below](#unsigned-xpi).

- Alternatively, [build it from source](#build) and then follow those same instructions.

### <span id="unsigned-xpi"/>Install as an unsigned XPI

- Make sure your browser [supports installation of unsigned add-ons](https://wiki.mozilla.org/Add-ons/Extension_Signing) (Firefox ESR, Nightly, Developer Edition, and Tor Browser do, vanilla Firefox and its mobile versions do not).
- Go to `about:config`, set `xpinstall.signatures.required` to `false`.
- Go to `about:addons`, click the gear button, select `Install Add-on from File`, and select the XPI file in `./extension/dist` directory (or do `File > Open File` from the menu and then select the XPI file, or drag-and-drop the XPI file into the browser window).
- Then press `Extensions` toolbar button and pin `Hoardy-Web`.

### Install as a temporary add-on

If you are [building from source](#build), this is a nice way to do development, since to reload the add-on after making a new build will require a single click.

- In the browser, go to `about:debugging#/runtime/this-firefox`, click `Load Temporary Add-on` button, and select `./extension/dist/Hoardy-Web-firefox-*/manifest.json`.
- Then you might need to go into `about:addons` and enable `Run in Private Windows` for `Hoardy-Web` if your Firefox is running in Private-Windows-only mode.

## <span id="install-chromium"/>On Chromium-based browsers (Chromium, Google Chrome, Ungoogled Chromium, Brave, etc)

There are several ways you can do this.
**I recommend you read all of the following subsections first**, and then decide what you want to actually try doing.
Do not rush.

### <span id="unpacked-zip"/>Install as an unpacked extension

This is the simplest method that will work on all Chromium forks, but `Hoardy-Web` will not get automatic updates.
I.e., you will have to check the [Releases](https://github.com/Own-Data-Privateer/hoardy-web/releases) page periodically, download, and install new releases manually to update.

- Download the latest `Hoardy-Web-chromium-*.zip` from [Releases](https://github.com/Own-Data-Privateer/hoardy-web/releases).
- Unpack it.
  It's packed with a single directory named `Hoardy-Web-chromium-*` inside for convenience.
- Go to `Extensions > Manage Extensions` in the menu of your browser and enable `Developer mode` toggle.
- On the same page, press `Load Unpacked` and select the directory the unpacking of the `.zip` file produced.
  It should have `manifest.json` file in it, just navigate to that directory select it and then press the `Open` button (or navigate into that directory and then press the `Open` button, that will work too).
- Then press `Extensions` toolbar button and pin `Hoardy-Web`.

Apparently, if you are using Google Chrome, you will get annoying warnings about side-loaded extensions.
But you can also whitelist your extensions to prevent it, [see the second answer of this stackoverflow question](https://stackoverflow.com/questions/24577024/install-chrome-extension-form-outside-the-chrome-web-store).
For a `Hoardy-Web` downloaded from [Releases](https://github.com/Own-Data-Privateer/hoardy-web/releases) here, its Chromium extension ID is `amklkmnfmgjmofkjifjgngdnajpbpefp`.

### Install as an unpacked extension built from source

Alternatively, you can [build it from source](#build) and then follow those same instructions above, except use `./dist/Hoardy-Web-chromium-*` directory after pressing `Load Unpacked` button in the browser's UI.

Similarly, there will be no automatic updates.

In case you need to whitelist your build, the Chromium extension ID of your build will be written to `./dist/manifest-chromium-id.txt`.
That ID is derived from a public key, which is derived from a private key, which is generated by the [`gen-chromium-key.sh` script](./bin/gen-chromium-key.sh) called by [`build.sh` script](./build.sh) when you build the extension the very first time.
The result then gets stored in `./private/chromium.key.pem` and reused between builds.

### Install a CRX directly

If your Chromium fork supports installation of third-party CRX files (not fetched from [Chrome Web Store](https://chromewebstore.google.com/)), you can do this:

- Go to `chrome://flags`.
- Search for the `#extension-mime-request-handling` flag and set it to `Always prompt for install`.
- (If you did not find such a thing there, then you Chromium fork does not support installations of third-party CRX files.)
- Then, download the latest `Hoardy-Web-chromium-*.crx` from [Releases](https://github.com/Own-Data-Privateer/hoardy-web/releases).
- The browser should prompt you if you want to install `Hoardy-Web`.
- Confirm the install.

There may or may not be automatic updates for `Hoardy-Web`, depending of what your Chromium fork comes with.
If it supports updates for third-party extensions, you will get updates, if it does not, you will not.
The vanilla mainline Chromium comes without any such support.
See below for how to fix it.

### Install a CRX via drag-and-drop

If your Chromium fork supports installation of third-party CRX files fetched manually:

- Download the latest `Hoardy-Web-chromium-*.crx` from [Releases](https://github.com/Own-Data-Privateer/hoardy-web/releases).
- Drag-and-drop the resulting CRX file from your `Downloads` folder into your browser's window.
- The browser should either prompt you if you want to install `Hoardy-Web` or just install it silently.
- (If it does not, then you browser does not support that too.)
- Confirm the install or check you extensions list to confirm it's there.

The updates situation will be exactly the same as above.

### How to make `Hoardy-Web` (and other indie extensions) automatically update on Chromium forks that do not support auto-updates for third-party extensions

- Install `Hoardy-Web` using one of the above methods.

- Install [`chromium-web-store`](https://github.com/NeverDecaf/chromium-web-store) extension using one of the above methods.

  It exists to help you to install extensions from [Chrome Web Store](https://chromewebstore.google.com/) and other similar Web Extensions repositories on Chromium forks that do not come with builtin support for Web Extension stores.
  More importantly, however, it can periodically check all your extensions that have an `update_url` field set in their `manifest.json` for updates and notify you about them.
  (`Hoardy-Web`, of course, comes with `update_url` set.)

  So, the simplest way to do this on a most limited Chromium fork is to run

  ```bash
  git clone https://github.com/NeverDecaf/chromium-web-store
  ```

  and then simply `Load Unpacked` the `./chromium-web-store/src` directory in your Chromium fork.

Then you can:

- Go to `Extensions > Manage Extensions` in the menu of your browser.
- Press the `Details` button on `Chromium Web Store` extension.
- Press the `Extension options` (should be near the bottom) there.
- And edit those options to your liking.

E.g., you might want to:

- change hourly update checks to daily by setting the interval to `1440`,
- ask it to ignore some of your extensions you don't want to ever update,
- disable `Enable Chrome Web Store Integration`,
- etc, see there for more info.

Congratulations, from now on `Hoardy-Web` --- or any other extension that has `update_url` field set in its `manifest.json`, regardless of its availability at [Chrome Web Store](https://chromewebstore.google.com/) --- will get checked for updates periodically.

- If you installed `Hoardy-Web` (or another extension which has `update_url` field set) via a CRX, then `chromium-web-store` can even automatically update it for you.
- If you installed `Hoardy-Web` (or another extension) via `Load Unpacked`, you will have to manually re-install it from a [new release](https://github.com/Own-Data-Privateer/hoardy-web/releases) on updates, but you will at least get notified about it updating without you needing to check manually.

See [`chromium-web-store`'s README](https://github.com/NeverDecaf/chromium-web-store) for more info and instructions, especially if you get `CRX_REQUIRED_PROOF_MISSING` or `Apps, extensions and user scripts cannot be added from this website` errors.

# Development

## <span id="build"/>Build it from source

- `git clone` this repository.
- `cd extension`.
- Optionally: run `nix-shell ./default.nix` to get the exact build environment I use.
- Build by running `./build.sh clean firefox-mv2 chromium-mv2` from this directory.
- All outputs can then be found in the `dist` directory.

## Debugging

### On Firefox-based browsers

- To get the debugger console go to `about:debugging#/runtime/this-firefox` and press extension's `Inspect` button.
- You should also probably set "Persist Logs" setting on the "Console" tab.

### On Chromium-based browsers

- To get the debugger console go to `Extensions > Manage Extensions` and press `Inspect views` link after the extension's ID.
