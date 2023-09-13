# What?

`pwebarc` is a suite of tools implementing a Private Web Archive, basically your own private [Wayback Machine](https://web.archive.org/) that can also archive POST requests, or HTTP-level [WebScrapBook](https://github.com/danny0838/webscrapbook) following "archive everything now, figure out what to do with it later" philosophy.

Basically, [you install the browser extension, run the archiving server](#quickstart), and just browse the web while `pwebarc` archives *everything* your browser fetches from the network (by default, the extension has lots of options controlling what should and should not be archived).
Then, some indeterminate time later, [you refer back to your collected data](#why).

This is different from all other similar tools, including the [Wayback Machine](https://web.archive.org/) itself, in that they require you to archive and replay things one-by-one.

[There are some other alternatives to this](#alternatives), but AFAIK `pwebarc` is the simplest and easiest to use if you want to archive everything.

# Why?

So, you wake up remembering something interesting, you try to look it up on Google, you fail, eventually you remember the website you seen it at (or a tool like [Promnesia](https://github.com/karlicoss/promnesia) helps you), you go there to look it up… and discovered it offline/gone/a parked domain. Not a problem\! Have no fear\! You go to [Wayback Machine](https://web.archive.org/) and look it up there… and discover they only archived an ancient version of it and the thing you wanted is missing there.

Or, say, you read a cool fanfiction on [AO3](https://archiveofourown.org/) years ago, you even wrote down the URL, you go back to it wanting to experience it again… and discover the author made it private.

Or, say, there's a web page/app you use (like a banking app), but it lacks some features you want, and in your browser's Network Monitor you can see it uses JSON RPC or some such to fetch its data, and you want those JSONs for yourself (e.g. to compute statistics and supplement the app output with them), but the app in question has no public API and scraping it with a script is non-trivial (e.g. they do complicated JavaScript+multifactor-based auth, try to detect you are actually using a browser, and they ban you immediately if not).

All of these scenarios happen all the time to me. "If it is on the Internet, it is on Internet forever\!" they said. "Everything will have a REST API\!" they said. **They lied\!**

Things vanish from the Internet all the time, [Wayback Machine](https://web.archive.org/) is awesome, but

- you need to be online to use it,
- it has no full text search, even though it was promised for decades now (this is probably a privacy feature by this point),
- they remove/hide archived data sometimes under political pressure,
- they only archive the public web and only what can be reached with GET requests.

And, obviously, you wouldn't want it to archive you banking app's output.

# Quickstart

## <span id="quickstart-with-python"/>On a system with Python installed

- Download [the dumb archiving server script](./dumb_server/pwebarc-dumb-dump-server.py) (aka `pwebarc-dumb-dump-server.py`) and run it, it has no dependencies except Python itself, and it's source code is less than 200 lines of pure Python and is very simple. It will start saving data into `pwebarc-dump` directory wherever you run it from.
- On Firefox/Tor Browser/etc: [Install the extension from addons.mozilla.org](https://addons.mozilla.org/en-US/firefox/addon/pwebarc/) or see [Installing from source on Firefox/Tor Browser](#build-firefox).

- On Chromium/Chrome/etc (experimental): See [Installing on Chromium/Chrome](#install-chromium) or [Installing from source on Chromium/Chrome](#build-chromium).

Congratulations, you are now collecting your network traffic.

Next, you should read the extension's ["Help" page](./extension/page/help.org).
It has lots of useful details about how it works and quirks of different browsers.
If you open it by clicking the "Help" button in the extension's UI, then hovering over or clicking on links in there will highlight relevant settings.

It took me about 6 months before I had to refer back to previously archived data for the first time when I started using `mitmproxy` to sporadically collect my HTTP traffic in 2017.
So, I recommend you start collecting immediately and figure out how to use the rest of this suite later.

## On a system with no Python installed

- On Windows: [Download Python from the official website](https://www.python.org/downloads/windows/).
- On Linux/etc: Install via package manager.
- Go back to [Quickstart with Python installed](#quickstart-with-python).

# Parts and pieces

- Required:
    - The [browser extension](./extension/) that collects all HTTP requests and responses your browser fetches and sends them to the archiving server.
    - The [dumb archiving server](./dumb_server/) that simply dumps everything it gets to disk one file per HTTP request+response.
- Recommended:
    - [A patch for Firefox](./firefox/) to allow the above extension to properly collect request POST data. This is not required, but could be useful if you want to archive POST requests properly.
      See "Quirks and Bugs" section of extension's ["Help" page](./extension/page/help.org) for more info.
- WIP:
    - A tool to display, search, manipulate, and deduplicate archive files.
    - A set of tools to convert mitmproxy, WARC, HAR, and PCAP files into the internal format used by `pwebarc` and from the internal format to at least WARC.
    - (eventually) A non-dumb server with data deduplication, timelines, full text search, and etc.

# <span id="alternatives"/>But you could do X instead

## But you could use [WebScrapBook](https://github.com/danny0838/webscrapbook) instead

Sure, but

- you will have to manually capture each page you want to save (and if this is what you want you should use that extension instead of this),
- you won't be able to get JSONs fetched by web apps you run with it, it only captures web pages.

## But you could just enable request logging in your browser's Network Monitor and manually save your data as HAR archives from time to time.

Well, yes, but

- you will have to manually enable it for each browser tab,
- opening a link in a new tab will fail to archive the first page as you will not have Network Monitor open there yet, and then
- you will have to check all your tabs for new data all the time and do \~5 clicks per tab to save it, and then
- HARs are JSON, meaning all that binary data gets encoded indirectly, thus making resulting HAR archives very inefficient for long-term storage, even when compressed (TODO on-disk space comparison).

And then you still need something like this suite to look into the generated archives.

## But you could use [archiveweb.page](https://github.com/webrecorder/archiveweb.page) instead.

Yes, but

- it's Chromium/Chrome-only,
- stores data internally in the browser, which is inefficient, and then
- you will have to manually enable it for each browser tab, and then
- opening a link in a new tab will fail to archive the first page, as the archival is per-tab,
- it also requires constant user interaction to export the data out.

And then you still need something like this suite to look into the generated archives.

## But you could use [mitmproxy](https://github.com/mitmproxy/mitmproxy) instead.

Yes, but

- websites using certificate pinning do not work under it,
- it is rather painful to setup, needing you to install a custom SSL root certificate, and
- websites can detect when you use it and fingerprint you for it or force you to solve CAPTCHAs.

And then you still need something like this suite to look into the generated archives.

## But you could setup SSL keys dumping then use Wireshark to capture your web traffic.

Yes, but

- it is really painful to setup, and then
- it takes a lot of effort to recover HTTP data from the PCAP dumps, and
- PCAP dumps are IP packet-level, thus also inefficient for this use case, and
- PCAP dumps of SSL traffic can not be compressed much.

And then you still need something like this suite to look into the generated archives.

# How it works

With `pwebarc`, [the extension](./extension/) simply collect all the data as you browse, immediately sends it to the archiving sever, and [the dumb archiving server implementation](./dumb_server/) simply dumps data it gets to disk, one file per HTTP request+response pair.

`pwebarc` uses [compressed CBOR (RFC8949) of decoded HTTP request+responses](#data-format) as on-disk representation format.
This is actually more efficient than storing raw HTTP request dumps.
After converting all my previous `wget`, `curl`, `mitmproxy`, and HAR archives into this, it is about as efficient as compressed `mitmproxy` dumps, with some (WIP) data-deduplication and xdelta compression between same-URL revisions it is much more efficient.
For me, it uses about **3GiB per year of browsing** on average (\~5 years of mostly uninterrupted data collection ATM) but I use things like [uBlock Origin](https://github.com/gorhill/uBlock) and [uMatrix](https://github.com/gorhill/uMatrix) to cut things down, and image boorus and video hosting sites have their own pipelines.

# How to use

Start with [Quickstart](#quickstart).

## Installing the extension

### <span id="install-firefox"/>Installing on Firefox/Tor Browser/etc

- [Install the extension from addons.mozilla.org](https://addons.mozilla.org/en-US/firefox/addon/pwebarc/).

### <span id="install-chromium"/>Experimental: Installing on Chromium/Chrome

- Download `pWebArc-chromium-v*.zip` from Releases, unpack it, it's packed with a single directory named `pWebArc-chromium-v*` inside for convenience.
- Go to `Extensions > Manage Extensions` in the menu, enable "Developer mode" toggle, press "Load Unpacked", and select the directory the unpack produced, it should have `manifest.json` file in it, just navigate into it and then press the "Open" button.
- Then press "Extensions" toolbar button and pin "pWebArc".

## System setup

- You can add `pwebarc-dumb-dump-server.py` to Autorun or start it from your `~/.xsession`, `systemd --user`, etc.

- You can also make a new browser profile specifically for archived browsing, run Firefox as `firefox -ProfileManager` to get to the appropriate UI. On Windows you can just edit your desktop or toolbar shortcut to target

  ``` cmd
  "C:\Program Files\Mozilla Firefox\firefox.exe" -ProfileManager
  ```

  or similar by default to switch between profiles on browser startup.

## Using with Tor Browser

- Run server as `./pwebarc-dumb-dump-server.py --host 127.0.99.1` or similar.
- Go to `about:config` and add `127.0.99.1` to `network.proxy.no_proxies_on`.
- Set the dumping URL in the extension to `http://127.0.99.1:3210/pwebarc/dump`.

You probably don't want to use `127.0.0.1` and `127.0.1.1` with Tor Browser as those are normal loopback addresses and you probably don't want to allow stuff from under Tor to access your everyday stuff.

Or, you could run both the Tor Browser, and `./pwebarc-dumb-dump-server.py` in a container/VM and use the default `127.0.0.1` address.

## Installing from source

### Build

- `git clone` this repository.
- For Firefox/Tor Browser/etc: build by running `./build.sh clean firefox` from the `./extension` directory.
- For Chromium/Chrome/etc: build by running `./build.sh clean chromium` from the `./extension` directory.

### <span id="build-firefox"/>On Firefox, Tor Browser, etc

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

### <span id="build-chromium"/>On Chromium, Chrome, etc

1.  As an unpacked extension

    - [Bulid it](#build).
    - Go to `Extensions > Manage Extensions` in the menu, enable "Developer mode" toggle, press "Load Unpacked", and select `./extension/dist/pWebArc-chromium-v*` directory (navigate into it and then press the "Open" button).
    - Then press "Extensions" toolbar button and pin "pWebArc".
    - To get the debugger console press "Inspect views" link after the extension's ID.

2.  As CRX

    - You can [build it](#build), but
    - installing the CRX manually does not appear work in modern version of Chromium/Chrome.

# Data format

[CBOR (RFC8949)](https://datatracker.ietf.org/doc/html/rfc8949) encoding of the following structure:

    reqres = reqresV1

    reqresV1 = [
        "WEBREQRES/1",
        source,
        protocol,
        requestV1,
        responseV1,
        endTimeStamp,
        optionalData,
    ]

    requestV1 = [
        requestTimeStamp,
        requestMethod,
        requestURL,
        requestHeaders,
        isRequestComplete,
        requestBody,
    ]

    responseV1 = null | [
        responseTimeStamp,
        responseStatusCode,
        responseReason,
        responseHeaders,
        isResponseComplete,
        responseBody,
    ]

    optionalData = <map from str to anything>

- `source` is a short description of the data source, like `Firefox/102.0+pWebArc/0.1`;
- `optionalData` currently stores optional `origin_url` and `document_url` when different from both the URL in question and `Referer` request header (this is useful for indexing and search by URL);
- `responseV1` can be `null` when the request got no response, like when experiencing a network issue (archival of such request+response pairs is disabled by default, see extension's settings).

On-disk these are stored as compressed files. [The dumb archiving server](./dumb_server/) stores them one file per `reqres` and only compresses them with `GZip`, since `zlib` compression comes bundled with Python.

# License

GPLv3+, some small library parts are MIT.
