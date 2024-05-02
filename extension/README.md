# What is `pWebArc` browser extension/add-on?

`pWebArc` (Personal Private Passive Web Archive) is a browser add-on (extension) that passively collects and archives dumps of HTTP requests and responses to your own private archiving server (like [the dumb archiving server](../dumb_server/)) as you browse the web.

This is most similar to [archiveweb.page](https://github.com/webrecorder/archiveweb.page) but `pWebArc` follows "archive everything now, figure out what to do with it later" philosophy, not forcing you to manually enable it in each new tab.
Also, `pWebArc` works both on Firefox- and Chromium-based browsers.

Basically, you install this, enable it, run the archiving server, and forget about it until you need to refer back to something you've seen before.

See [higher-level README](../README.md) if the above makes little sense, or if you want to see in-depth comparisons to `archiveweb.page` and other similar and related software.

# Screenshots

![Screenshot of browser's viewport with extension's popup shown.](https://oxij.org/asset/demo/software/pwebarc/extension-v1.7.0-popup.png)

![Screenshot of extension's help page. The highlighted setting is referenced by the text under the mouse cursor.](https://oxij.org/asset/demo/software/pwebarc/extension-v1.7.0-help-page.png)

# Installation

## <span id="install-firefox"/>On Firefox/Tor Browser/etc

- [![](https://oxij.org/asset/img/software/amo/get-the-addon-small.png) Install the extension from addons.mozilla.org](https://addons.mozilla.org/en-US/firefox/addon/pwebarc/).

## <span id="install-chromium"/>On Chromium/Chrome

- Download `pWebArc-chromium-v*.zip` from Releases, unpack it, it's packed with a single directory named `pWebArc-chromium-v*` inside for convenience.
- Go to `Extensions > Manage Extensions` in the menu, enable "Developer mode" toggle, press "Load Unpacked", and select the directory the unpack produced, it should have `manifest.json` file in it, just navigate into it and then press the "Open" button.
- Then press "Extensions" toolbar button and pin "pWebArc".

# What does it do exactly? I have questions.

For general technical design description see [the appropriate section in higher-level README](../README.md#technical).

For extension's technical details see the ["Help" page](./page/help.org) (local interactive version available via the "Help" button in the extension settings drop-down pane) and the FAQ there.

If your question is unanswered by these, then open an Issue on GitHub or write me an e-mail.

# Building and installing from source

## Build

- `git clone` this repository.
- For Firefox/Tor Browser/etc: build by running `./build.sh clean firefox` from this directory.
- For Chromium/Chrome/etc: build by running `./build.sh clean chromium` from this directory.

## <span id="build-firefox"/>On Firefox, Tor Browser, etc

1. As a temporary add-on

    - [Bulid it](#build).
    - In the browser, go to `about:debugging#/runtime/this-firefox`, click "Load Temporary Add-on" button, and select `./extension/dist/pWebArc-firefox-v*/manifest.json`.
    - Then you might need to go into `about:addons` and enable "Run in Private Windows" for `pWebArc` if your Firefox is running in Private-Windows-only mode.
    - To get the debugger console go to `about:debugging` and press extension's "Inspect" button.

2. Installing an unsigned XPI

    - [Bulid it](#build).
    - Make sure your browser [supports installation of unsigned add-ons](https://wiki.mozilla.org/Add-ons/Extension_Signing) (Firefox ESR, Nightly, Developer Edition, and Tor Browser do).
    - Go to `about:config`, set `xpinstall.signatures.required` to `false`.
    - Go to `about:addons`, click the gear button, select "Install Add-on from File", and select the XPI file in `./extension/dist` directory (or do `File > Open File` from the menu and then select the XPI file, or drag-and-drop the XPI file into the browser window).

## <span id="build-chromium"/>On Chromium, Chrome, etc

1.  As an unpacked extension

    - [Bulid it](#build).
    - Go to `Extensions > Manage Extensions` in the menu, enable "Developer mode" toggle, press "Load Unpacked", and select `./extension/dist/pWebArc-chromium-v*` directory (navigate into it and then press the "Open" button).
    - Then press "Extensions" toolbar button and pin "pWebArc".
    - To get the debugger console press "Inspect views" link after the extension's ID.

2.  As CRX

    - You can [build it](#build), but
    - installing the CRX manually does not appear work in modern version of Chromium/Chrome.
