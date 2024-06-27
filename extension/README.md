# What is `pWebArc` browser extension/add-on?

`pWebArc` (Personal Private Passive Web Archive) is a browser add-on (extension) that passively captures, collects, and archives dumps of HTTP requests and responses to your own private archiving server (like [the dumb archiving server](../dumb_server/)) as you browse the web.

`pWebArc` is most similar to [archiveweb.page](https://github.com/webrecorder/archiveweb.page) and [DiskerNet](https://github.com/dosyago/DownloadNet) projects, but it works both on Firefox- and Chromium-based browsers, and it follows [a different design philosophy](../README.md#philosophy), which makes the experience of using it is very different.
Basically, you install this, enable it, run the archiving server, and forget about it until you need to refer back to something you've seen before.

See [higher-level README](../README.md) if the above makes little sense or if you want more docs, or if you want to see in-depth comparisons to `archiveweb.page` and other similar and related software.

# Screenshots

See [higher-level README](../doc/gallery.md).

# What does it do exactly? I have questions.

See ["Technical Philosophy"](../README.md#philosophy) and ["I have questions"](../README.md#more-docs) sections of the higher-level README.

# Installation

## <span id="install-firefox"/>On Firefox, Tor Browser, LibreWolf, etc

- [![](https://oxij.org/asset/img/software/amo/get-the-addon-small.png) Install the extension from addons.mozilla.org](https://addons.mozilla.org/en-US/firefox/addon/pwebarc/).
  Then press "Extensions" toolbar button and pin "pWebArc".

- Alternatively, download the latest `pWebArc-firefox-v*.xpi` from Releases, and then [follow "Install as an unsigned XPI" instructions below](#unsigned-xpi).

- Alternatively, [build it from source](#build) and then follow those same instructions.

### <span id="unsigned-xpi"/>Install as an unsigned XPI

- Make sure your browser [supports installation of unsigned add-ons](https://wiki.mozilla.org/Add-ons/Extension_Signing) (Firefox ESR, Nightly, Developer Edition, and Tor Browser do).
- Go to `about:config`, set `xpinstall.signatures.required` to `false`.
- Go to `about:addons`, click the gear button, select "Install Add-on from File", and select the XPI file in `./extension/dist` directory (or do `File > Open File` from the menu and then select the XPI file, or drag-and-drop the XPI file into the browser window).
- Then press "Extensions" toolbar button and pin "pWebArc".

### Install as a temporary add-on

If you are [building from source](#build), this is a nice way to do development, since to reload the add-on on after making a new build will require a single click.

- In the browser, go to `about:debugging#/runtime/this-firefox`, click "Load Temporary Add-on" button, and select `./extension/dist/pWebArc-firefox-v*/manifest.json`.
- Then you might need to go into `about:addons` and enable "Run in Private Windows" for `pWebArc` if your Firefox is running in Private-Windows-only mode.

## <span id="install-chromium"/>On Chromium, Chrome, etc

Why isn't `pWebArc` on Chrome Web Store?
Because Google appears to dislike the idea of things like `pWebArc` very much, and so `pWebArc` violates their "Terms of Use", see [higher-level README](../README.md#quickstart) for more info.

So, installation on Chromium-based browsers requires a little bit of work.

- Download the latest `pWebArc-chromium-v*.zip` from Releases, unpack it, it's packed with a single directory named `pWebArc-chromium-v*` inside for convenience, then [follow "Install as an unpacked extension" instructions below](#unpacked-zip).

- Alternatively, [build it from source](#build) and then follow those same instructions.

### <span id="unpacked-zip"/>Install as an unpacked extension

- Go to `Extensions > Manage Extensions` in the menu, enable "Developer mode" toggle, press "Load Unpacked", and select `./extension/dist/pWebArc-chromium-v*` directory (or the directory the unpacking of the `.zip` file produced, if you are using the pre-built `.zip`), it should have `manifest.json` file in it, just navigate to that directory select it and then press the "Open" button (or navigate into that directory and then press the "Open" button, that will work too).
- Then press "Extensions" toolbar button and pin "pWebArc".

### Install the CRX

- [The build](#build) will build it, and you can try installing it, but installing the CRX manually does not appear work in modern version of Chromium/Chrome.

# <span id="build"/>Build it from source

- `git clone` this repository.
- `cd extension`.
- Optionally: run `nix-shell ./default.nix` to get the exact build environment I use.
- For Firefox, Tor Browser, LibreWolf, etc: build by running `./build.sh clean firefox` from this directory.
- For Chromium/Chrome/etc: build by running `./build.sh clean chromium` from this directory.
- All outputs can then be found in the `dist` directory.

# Debugging

## On Firefox, Tor Browser, LibreWolf, etc

- To get the debugger console go to `about:debugging` and press extension's "Inspect" button.

## On Chromium, Chrome, etc

- To get the debugger console go to `Extensions > Manage Extensions` and press "Inspect views" link after the extension's ID.
