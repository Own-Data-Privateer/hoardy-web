# What is `pwebarc`?

Private Passive Web Archive (`pwebarc`, <code>p<sup>2</sup>webarc</code> for the pedantic), is a suite of tools that allows you to passively collect and archive HTTP requests and responses as you browse the web and then organize and manage the collected data.

In other words, `pwebarc` is your own private [Wayback Machine](https://web.archive.org/) --- which, unlike the original Wayback Machine, can also archive POST requests and responses (e.g., answer pages of web search engines, like Google), and most other HTTP-level data --- that collects data *passively*, saving *everything* your browser sees by default (instead of you asking it to save select pages one-by-one).

Or, in other other words, `pwebarc` is a suite of tools implementing HTTP-level [WebScrapBook](https://github.com/danny0838/webscrapbook) following "archive everything now, figure out what to do with it later" philosophy.

How it works: [you install the browser extension/add-on (available for most browsers), run the archiving server (works both on POSIX and Windows)](#quickstart), and just browse the web while `pwebarc` archives *everything* your browser fetches from the network (by default, the extension has lots of options controlling what data from which tabs should and should not be archived).
Then, some indeterminate time later, [you refer back to your collected data](#why).

[There are some other alternatives to this](#alternatives) but, as far as I'm aware, `pwebarc` is the simplest and easiest to use if you want to archive all or most of your browsing data.

# Screenshots

![Screenshot of browser's viewport with extension's popup shown.](https://oxij.org/software/pwebarc/demo/extension-1.5-popup.png)

![Screenshot of extension's help page. The highlighted setting is referenced by the text under the mouse cursor.](https://oxij.org/software/pwebarc/demo/extension-1.5-help-page.png)

# <span id="why"/>Why does `pwebarc` exists?

So, you wake up remembering something interesting, you try to look it up on Google, you fail, eventually you remember the website you seen it at (or a tool like [Promnesia](https://github.com/karlicoss/promnesia) helps you), you go there to look it up… and discover it offline/gone/a parked domain. Not a problem\! Have no fear\! You go to [Wayback Machine](https://web.archive.org/) and look it up there… and discover they only archived an ancient version of it and the thing you wanted is missing there.

Or, say, you read a cool fanfiction on [AO3](https://archiveofourown.org/) years ago, you even wrote down the URL, you go back to it wanting to experience it again… and discover the author made it private.

Or, say, for accessibility reasons you want to feed some of the web pages your browser loads through a custom script that strips HTML markup in a website-specific way and then pretty-prints the result to your terminal, feeds it into a TTS engine, or a Braille display.

Or, say, there's a web page/app you use (like a banking app), but it lacks some features you want, and in your browser's Network Monitor you can see it uses JSON RPC or some such to fetch its data, and you want those JSONs for yourself (e.g., to compute statistics and supplement the app output with them), but the app in question has no public API and scraping it with a script is non-trivial (e.g., they do complicated JavaScript+multifactor-based auth, try to detect you are actually using a browser, and they ban you immediately if not).

Or, say, you want to fetch a bunch of pages belonging to two recommendation lists on AO3 or [GoodReads](https://www.goodreads.com/), get all outgoing links for each fetched page, union sets for the pages belonging to the same recommendation list, and then intersect the results to get a shorter list of things you might want to read with higher probability.

Or, more generally, you want to tag web pages referenced from a certain set of other web pages with some tag in your indexing software, and update it automatically each time you visit any of the source pages.

Or, say, you notice that modern web search engines suck in general, because solutions for maintaining a curated public index of useful (non-AI-generated non-SEOized) web pages appears to be technically intractable (any automated ranking system gets eaten alive by SEO, link farms, and AI-generated content; meanwhile, all distributed crowd-sourced solutions appear to become similarly easily exploitable if they are sufficiently privacy-preserving, while centralized crowd-sourced solutions appear to be economically unviable).
And so you want to carefully collect and curate (manually, by immediately removing useless pages from your archive) you own web browsing data so that you could satisfy your searches locally via pages you visited before instead of asking Google --- which, with a good indexing software like [recoll](https://www.lesbonscomptes.com/recoll/index.html), is much faster, infinitely more private, and produces much higher quality results when you are trying to solve a problem related to something you researched before --- or, at least, start your research by generating some good starting points, instead of the top 10 AI-generated results Google will give you.
Moreover, since in this scenario you can maintain your own link graph over your web archive data, you can run [Pagerank](https://en.wikipedia.org/wiki/Pagerank) algorithm locally and, if you archived enough data, experience personalized web search with the quality better than that of Google circa year 2005 when SEO did not consume the Internet yet.

Or, say, you want to read or watch something interesting, but you don't know what exactly.
So, you open the pages for some of your favorite scientific articles on [arxiv.org](https://arxiv.org) and Google Scholar, books on AO3 and GoodReads, anime on [MAL](https://myanimelist.net/) and [anidb](https://anidb.net/), click around the topics, collections, lists, recommendations, public bookmarks, related studios, directors, and seiyuu your favorites are mentioned in and then build a link graph out of it all.
(If you passively collect your browsing data long enough you probably did this at least once for all your favorites before, more or less, so this you don't actually need to do anything, you already have the data.)
Then, you parse your [org-mode](https://orgmode.org/) files and extract scores for all the things you ever read or watched, assign those scores to the nodes corresponding to those archived pages, run Pagerank on the undirected graph (Google's Pagerank computes scaled probability of visiting a given page while randomly surfing the web starting from a random page and following the links; you can rapidly generate and update "recommendation scores" by starting from a set of pages you already like and dislike and allowing it to surf and update scores in both directions), list all nodes with scores higher than some constant, filter out nodes of incorrect type (e.g. you want a PDF, not a homepage of its author), filter out the ones that are marked as "DONE", "CANCELED", and etc in your org-mode files, and present the results.
Ta-da! Cheap but very effective private personalized Bayesian recommendation system.

"If it is on the Internet, it is on Internet forever\!" they said.
"Everything will have a RESTful API\!" they said.
"Semantic Web will allow arbitrarily complex queries spanning multiple data sources\!" they said.
**They lied\!**

Things vanish from the Internet all the time, [Wayback Machine](https://web.archive.org/) is awesome, but

- you need to be online to use it,
- it has no full text search, even though it was promised for decades now (this is probably a privacy feature by this point),
- they remove/hide archived data sometimes under political pressure,
- they only archive the public web and only what can be reached with GET requests, and
- obviously, you wouldn't want it to archive you banking app's output.

A lot of useful stuff never got RESTful APIs, those RESTful APIs that exists are frequently buggy, you'll probably have to scrape data from HTMLs anyway.

Semantic Web never took off, and with large AI companies hungrily scraping the web for data and never giving anything in return it probably never will.

But none of the above prevents you from building your own little data paradise.
`pwebarc` gives you some of the tools to do it.

# Quickstart

## <span id="quickstart-with-python"/>On a system with Python installed

- Download [the dumb archiving server `pwebarc_dumb_dump_server.py` script](./dumb_server/pwebarc_dumb_dump_server.py) and run it, it has no dependencies except Python itself, and it's source code is less than 200 lines of pure Python.
  It will start saving data into `pwebarc-dump` directory wherever you run it from.

  Alternatively, install via `pip install pwebarc-dumb-dump-server` and run as `pwebarc-dumb-dump-server`.
  See [there](./dumb_server/) for more info.
- Install the browser extension/add-on:
  - On Firefox/Tor Browser/etc: [Install the extension from addons.mozilla.org](https://addons.mozilla.org/en-US/firefox/addon/pwebarc/) or see [Installing from source on Firefox/Tor Browser](#build-firefox).
  - On Chromium/Chrome/etc (experimental): See [Installing on Chromium/Chrome](#install-chromium) or [Installing from source on Chromium/Chrome](#build-chromium).
- Now load any web page in your browser, the extension will report if everything works okay, or tell you where the problem is if something is broken.

Assuming the extension reported success: Congratulations\! You are now collecting and archiving all your web browsing traffic originating from that browser.
Repeat extension installation for all browsers/browser profiles as needed.

If you just want to collect everything and don't have time to figure out how to use the rest of this suite of tools right this moment, **you can stop here** and figure out how to use the rest of this suite later.

(It took me about 6 months before I had to refer back to previously archived data for the first time when I started using `mitmproxy` to sporadically collect my HTTP traffic in 2017.
So, I recommend you start collecting immediately and be lazy about the rest.
Also, I learned a lot about nefarious things some of the websites I visit do in the background while doing that, now you are going to learn the same.)

Next, you should read the extension's ["Help" page](./extension/page/help.org).
It has lots of useful details about how it works and quirks of different browsers.
If you open it by clicking the "Help" button in the extension's UI, then hovering over or clicking on links in there will highlight relevant settings.

As a *best-practice king of thing* it is highly recommended you make separate browser profiles for anonymous and logged-in browsing with separate extension instances pointing to separate archiving server instances dumping data to different directories on disk.
Set the "anonymous" browser profile to always run in "Private Browsing" mode to prevent login persistence there.
If you do accidentally login in "anonymous" profile, move those dumps out of the "anonymous" directory immediately ([`pwebarc-wrrarms` tool](./tool/) can help there).
This way you can easily share dumps from the "anonymous" instance without worrying about leaking your private data or login credentials.

Finally, you should install and learn to use [`pwebarc-wrrarms` tool](./tool/) which allows you to view and manage files produced by the extension and the archiving server.

## On a system with no Python installed

- Install Python:
  - On Windows: [Download Python from the official website](https://www.python.org/downloads/windows/).
  - On Linux/etc: Install via your package manager. Realistically, who am I kidding, it probably is installed already.
- Go back to [Quickstart with Python installed](#quickstart-with-python).

## On a system with [Nix package manager](https://nixos.org/nix/)

- Install by running
  ```
  nix-env -i -f ./default.nix
  ```
- Start [the dumb archiving server](./dumb_server/) by running
  ```
  pwebarc-dumb-dump-server
  ```
- Install the add-on and etc as [above](#quickstart-with-python).

# Parts and pieces

- Required:
    - The [`pWebArc` browser extension](./extension/) that collects all HTTP requests and responses your browser fetches and sends them to the archiving server.
    - The [`pwebarc-dumb-dump-server` dumb archiving server](./dumb_server/) that simply dumps everything it gets to disk one file per HTTP request+response.
- Optional:
    - The [`pwebarc-wrrarms` tool](./tool/) that allows you to display, search, organize, and manipulate archive files.
- Recommended:
    - [A patch for Firefox](./firefox/) to allow the above extension to properly collect request POST data. This is not required, but could be useful if you want to archive POST requests properly.
      See "Quirks and Bugs" section of extension's ["Help" page](./extension/page/help.org) for more info.

## Project Status

- [`pwebarc-dumb-dump-server` dumb archiving server](./dumb_server/) is stable and well-tested.

- [`pWebArc` browser extension](./extension/) is stable and well-tested in Firefox and Tor Browser (for me and the users I know of), it also appears to be stable in Chromium, but it is not really tested as much there, I only use Chromium very intermittently.
  Archival of normal HTTP request+responses works perfectly in Firefox and derived browsers, but it lacks the ability to archive WebSockets data, which would be nice to have, but WebExtension API provides no API for doing that, unfortunately.

- [`pwebarc-wrrarms` tool](./tool/) is in beta, it does about 70% of the stuff I want it to do ATM.
  See [the TODO list there](./tool/#todo) for more info.

# <span id="alternatives"/>Alternatives, aka "But you could do X instead"

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

- it is rather painful to setup, requiring you to install a custom SSL root certificate, and
- websites using certificate pinning will stop working, and
- some websites detect when you use it and fingerprint you for it or force you to solve CAPTCHAs.

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

- You can add `pwebarc_dumb_dump_server.py` to Autorun or start it from your `~/.xsession`, `systemd --user`, etc.

- You can also make a new browser profile specifically for archived browsing, run Firefox as `firefox -ProfileManager` to get to the appropriate UI. On Windows you can just edit your desktop or toolbar shortcut to target

  ``` cmd
  "C:\Program Files\Mozilla Firefox\firefox.exe" -ProfileManager
  ```

  or similar by default to switch between profiles on browser startup.

## Using with Tor Browser

- Run server as `./pwebarc_dumb_dump_server.py --host 127.0.99.1` or similar.
- Go to `about:config` and add `127.0.99.1` to `network.proxy.no_proxies_on`.
- Set the dumping URL in the extension to `http://127.0.99.1:3210/pwebarc/dump`.

You probably don't want to use `127.0.0.1` and `127.0.1.1` with Tor Browser as those are normal loopback addresses and you probably don't want to allow stuff from under Tor to access your everyday stuff.

Or, you could run both the Tor Browser, and `./pwebarc_dumb_dump_server.py` in a container/VM and use the default `127.0.0.1` address.

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
