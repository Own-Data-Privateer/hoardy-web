# What is `pwebarc`?

Personal Private Passive Web Archive (`pwebarc`) is a suite of tools to collect, save, mirror, manage archives of (i.e. hoard), and view web pages and whole websites offline.

In short, `pwebarc`'s main workflow is this: you install an extension/add-on into the browser of your choice (both Firefox- and Chromium-based browsers are supported) and just browse the web while it archives **everything your browser fetches from the network** (by default, the extension has lots of options controlling what data from which tabs should and should not be archived) to your local file system in a way that can be used to reconstruct and replay your browsing session later.

- See ["Why"](#why) section for why you might want to do this.
- See ["Features"](#features) section for a longer description of what `pwebarc` does and does not do.
- See ["Quickstart"](#quickstart) section for setup instructions.

# Screenshots

![Screenshot of browser's viewport with extension's popup shown.](https://oxij.org/asset/demo/software/pwebarc/extension-1.5-popup.png)

![Screenshot of extension's help page. The highlighted setting is referenced by the text under the mouse cursor.](https://oxij.org/asset/demo/software/pwebarc/extension-1.5-help-page.png)

# <span id="why"/>Why does `pwebarc` exists?

So, you wake up remembering something interesting, you try to look it up on Google, you fail, eventually you remember the website you seen it at (or a tool like [recoll](https://www.lesbonscomptes.com/recoll/index.html) or [Promnesia](https://github.com/karlicoss/promnesia) helps you), you go there to look it up… and discover it offline/gone/a parked domain. Not a problem\! Have no fear\! You go to [Wayback Machine](https://web.archive.org/) and look it up there… and discover they only archived an ancient version of it and the thing you wanted is missing there.

Or, say, you read a cool fanfiction on [AO3](https://archiveofourown.org/) years ago, you even wrote down the URL, you go back to it wanting to experience it again… and discover the author made it private.

Or, say, there's a web page/app you use (like a banking app), but it lacks some features you want, and in your browser's Network Monitor you can see it uses JSON RPC or some such to fetch its data, and you want those JSONs for yourself (e.g., to compute statistics and supplement the app output with them), but the app in question has no public API and scraping it with a script is non-trivial (e.g., they do complicated JavaScript+multifactor-based auth, try to detect you are actually using a browser, and they ban you immediately if not).

Or, say, you are in a similar situation with a web page that can not be easily reached via `curl`/`wget` but for accessibility reasons you want to feed it to a custom script that strips HTML markup in a website-specific way and then pretty-prints the result to your terminal, feeds it into a TTS engine, or a Braille display.

"If it is on the Internet, it is on Internet forever\!" they said.
"Everything will have a RESTful API\!" they said.
**They lied\!**

Things vanish from the Internet all the time, [Wayback Machine](https://web.archive.org/) is awesome, but

- you need to be online to use it,
- it has no full text search, even though it was promised for decades now (this is probably a privacy feature by this point),
- they remove/hide archived data sometimes under political pressure,
- they only archive the public web and only what can be reached with GET requests, and
- obviously, you wouldn't want it to archive you banking app's output.

A lot of useful stuff never got RESTful APIs, those RESTful APIs that exists are frequently buggy, you'll probably have to scrape data from HTMLs anyway.

Or, say, you want to fetch a bunch of pages belonging to two recommendation lists on AO3 or [GoodReads](https://www.goodreads.com/), get all outgoing links for each fetched page, union sets for the pages belonging to the same recommendation list, and then intersect the results of the two lists to get a shorter list of things you might want to read with higher probability.

Or, more generally, you want to tag web pages referenced from a certain set of other web pages with some tag in your indexing software, and update it automatically each time you visit any of the source pages.

Or, say, you want to combine a full-text indexing engine, your browsing and derived web link graph data, your states/ratings/notes from [org-mode](https://orgmode.org/), messages from your friends, and other archives, so that you could do arbitrarily complex queries over it all, like "show me all GoodReads pages for all books not marked as `DONE` or `CANCELLED` in my `org-mode` files, ever mentioned by any of my friends, ordered by undirected-graph [Pagerank](https://en.wikipedia.org/wiki/Pagerank) algorithm biased with my own book ratings (so that books sharing GoodReads lists with the books I finished and liked will get higher scores)".
So, basically, you want a private personalized Bayesian recommendation system.

"Semantic Web will allow arbitrarily complex queries spanning multiple data sources\!" they said.
Well, 25 years later ("RDF Model and Syntax Specification" was published in 1999), almost no progress there, the most commonly used subset of RDF does what indexing systems in 1970s did, but less efficiently and with a worse UI.

But none of the above prevents you from building your own little local data paradise.
`pwebarc` gives you some of the tools to do it.

# <span id="features"/>Features and technical details

Unlike [similar tools](#alternatives), `pwebarc`'s main workflow is to passively collect and archive HTTP requests and responses directly from your browser as you browse the web instead of making you to ask some tool or web app to snapshot it for you or forcing you to explicitly snapshot/record separate browsing sessions/tabs, thus

- allowing you to archive any HTTP data, not just the pages available via HTTP `GET` requests (e.g., it can archive answer pages of web search engines fetched via HTTP `POST`, JSON RPC/AJAX data, etc);
- downloading everything only once, **not** once with your browser and then the second time with a separate tool like [ArchiveBox](https://github.com/ArchiveBox/ArchiveBox);
- allowing you to trivially archive web pages hidden behind CAPTCHAs, requiring special cookies, multi-factor logins, paywalls, anti-scraping/`curl`/`wget` measures, and etc; after all, the website in question only interacts with your normal web browser, not with a custom web crawler;
- freeing you from worries of forgetting to archive something because you forgot to press a button somewhere.

In other words, `pwebarc` is your own personal [Wayback Machine](https://web.archive.org/) which passively archives everything you see and, unlike the original Wayback Machine, also archives HTTP `POST` requests and responses, and most other HTTP-level data.

Technically, `pwebarc` is most similar to

- [archiveweb.page](https://github.com/webrecorder/archiveweb.page) project, but following "archive everything with as little user input as needed now, figure out what to do with it later" philosophy, and not limited to Chromium;
- [DiskerNet](https://github.com/dosyago/DownloadNet) project, but with much more tooling and not limited to Chromium.

See [below](#alternatives) for more alternatives and comparisons.
To highlight, unlike most of its alternatives, `pwebarc` **DOES NOT**:

- share your archived data with anyone by default;
- require you to run a database server;
- require you to store all the things in browser's local storage where they can vanish at any moment;
- require you to download the data you want to archive twice;
- force you to use Chromium (yes, this point deserves repeating, because you can use `pwebarc` with Tor Browser);
- require you to archive and/or export recorded data explicitly one page/browsing session at a time.

In general, `pwebarc` is designed to be simple (as in adhering to the Keep It Stupid Simple principle) and efficient (as in running well on ancient hardware):

- [`pWebArc` webextension add-on](./extension/) does almost no actual work, simply generating HTTP request+response dumps, pushing them to the archiving server, and freeing the memory as soon as possible, thus keeping your browsing experience snappy even on ancient hardware (if you ignore the code needed to support Chromium, the leftovers are also pretty small and simple source code-wise);
- [dumb archiving server](./dumb_server/) simply compresses those dumps and saves them to disk as-is (it is tiny, taking less than 200 lines of code);
- anything that is remotely computationally expensive is delegated to the [`wrrarms` CLI tool](./tool/);
- meanwhile, on disk, your dumps get stored using [the simplest, trivially parsable with many third-party libraries, yet most space-efficient on-disk file format representing separate HTTP requests+responses there currently is (aka `Web Request+Response`, `WRR`)](./doc/data-on-disk.md), which is a file format that is both more general and more simple than WARC, much simpler than that `mitmproxy` uses, and much more efficient than HAR.

Currently, the [add-on](./extension/) can collect data from all Firefox- and Chromium-based browsers by hooking into:

- wast `webRequest` API capabilities of Firefox-based browsers (but they give no way to archive WebSockets data ATM, unfortunately);
- meager `webRequest` API and the wast debugging API capabilities of Chromium-based browsers (archival of WebSockets data appears to be theoretically possible, but it's not implemented ATM); which is rather hacky, produces pretty annoying UI (all [alternatives](#alternatives) that use Chromium-based browsers suffer from exactly the same issue), and will probably stop working at least in Chrome eventually, given how persistently Google pushes for Manifest V3 and WebExtension API restrictions in its quest to tame ad-blockers.

Also, as far as I'm aware, `wrrarms` is a tool that can do more useful stuff to your WRR archives than any other tool can do to any other file format for HTTP dumps with the sole exception of WARC.

For example, you can feed [`wrrarms`](./tool/) a subset of your archives produced by the [add-on](./extension/) and it will [generate a static offline website mirror a-la `wget -mpk`](./tool/#mirror), but then you can discover you dislike the result, change some options and re-generate the mirror **without re-downloading anything**.
Or, alternatively, you can use `wrrarms` to simply maintain a tree of symlinks pointing to latest WRR file for each URL and then view them --- by using `w3m`, `pandoc`, or any other HTML reader you want --- via some [scripts](./tool/script/).
(Or, when that gets implemented, use a Wayback Machine-like Web UI for replay.)

Alternatively, you can programmatically access that data by asking [`wrrarms`](./tool/) to dump WRR files into JSONs or verbose CBORs for you, or you can [just parse WRR files yourself](./doc/data-on-disk.md) with readily-available libraries.

Approaching things this way helps immensely when developing scrapers for uncooperative websites: you just visit them via your web browser as normal, then, possibly years later, use [`wrrarms` CLI tool](./tool/) to organize your archives and conveniently programmatically feed the archived data into your scraper without the need to re-fetch anything.

Given how simple the WRR file format is, in principle, you can modify any HTTP library to generate WRR files, thus allowing you to use [`wrrarms`](./tool/) with data captured by other software.

Which is why, personally, I patch some of the commonly available FLOSS website scrapers to dump the data they fetch as WRR files so that in the future I could write my own better scrapers and indexers and test them on a huge collected database of already collected inputs immediately.

To summarize, you can view `pwebarc` as an alternative for [mitmproxy](https://github.com/mitmproxy/mitmproxy) which leaves SSL/TLS layer alone and hooks into target application's runtime instead.
In fact, the unpublished and now irrelevant ancestor project of `pwebarc` was a tool to generate website mirrors from `mitmproxy` stream captures.
([`wrrarms` can do that too.](./tool/#mitmproxy-mirror))
But then I got annoyed by all the sites that don't work under `mitmproxy`, did some research into the alternatives, decided there were none I wanted to use, and so I made my own.

I eat what I cook: since October 2023 I archive all of my web traffic with `pWebArc` add-on, after adding each new feature to [`wrrarms` CLI tool](./tool/), as a rule, I feed at least the last 5 years of my web browsing into it (at the moment, most of it converted from other formats to `.wrr`, obviously) to see if everything works as expected.

## <span id="todo"/>What is left TODO?

### `pWebArc` extension

- Improve UI:
  - Slightly better add-on popup layout.
  - Implement more tab states, display per-tab collection errors.
- Delayed reqres archival: allow to archive or discard pages after they are were fetched.
- Serverless archival into browser's local storage: for easier bootstrap and to allow using Tor Browser securely with its default config.

### `wrrarms` tool

- URL remapping in and `scrub`bing of CSS files.
- Non-dumb HTTP server with time+URL index and replay, i.e. a local HTTP UI a-la [Wayback Machine](https://web.archive.org/).
  (Because re-generating local mirrors all the time can get a bit annoying.)
- Converters from HAR and WARC to WRR.
- Data de-duplication between WRR files and bundle-packing of related WRR files.
- Converter from WRR to WARC.
- Converter from PCAP ito WRR.
- (maybe) Full text indexing and search.

## Parts and pieces

### Required

- The [`pWebArc` browser extension](./extension/) that collects all HTTP requests and responses your browser fetches and sends them to the archiving server.

  The extension is to be considered *stable* for Firefox and derived browsers and *unstable* for Chromium and derived browsers (it is not really tested as much there, I only use Chromium-based browsers very intermittently).

- The [dumb archiving server](./dumb_server/) that simply dumps everything it gets to disk one file per HTTP request+response.

  The dumb archiving server is to be considered *stable* (it's so simple there hardly could be any bugs there).

### Optional, recommended

- The [`wrrarms` tool](./tool/) that allows you to display, search, organize, and manipulate archive files.

  `wrrarms` tool is beta software, it does about 70% of the stuff I want it to do ATM.
  See [the TODO list](#todo) for more info.

### Optional

- [A patch for Firefox](./firefox/) to allow the above extension to collect request POST data as-is. This is not required and even without that patch `pWebArc` will collect everything in most cases, but it could be useful if you want to correctly capture POST requests that upload files.

  See "Quirks and Bugs" section of extension's ["Help" page](./extension/page/help.org) for more info.

# <span id="philosophy"/>Technical philosophy

In general, `pwebarc` is built to follow "**collect and archive all the things as-is now, modify those archives never, convert to other formats and extract values on-demand**" philosophy.

Meaning,

- [`pWebArc` webextension add-on](./extension/) collects data as browser gives it, without any data normalization and conversion (when possible),
- [dumb archiving server](./dumb_server/) simply compresses the dumps the add-on pushes at it and saves them all to disk as-is,
- meanwhile, all data normalization, massaging, post-processing, and extraction of useful values is delegated to the [`wrrarms`](./tool/), which also does not overwrite any WRR files, ever.

`pwebarc` expects you to treat your older pre-`pwebarc` archives you want to convert to WRR similarly:

- `wrrarms import` them into a separate directory, but
- leave your original `mitmproxy` (or whatever) dumps alone (on an external backup drive, if you lack disk space on your machine).

This way, if `wrrarms` has some unexpected bug, or `wrrarms import` adds some new feature, you could always re-import them later without losing anything.

# Quickstart

## <span id="quickstart-with-python"/>On a system with Python installed

- Download [the dumb archiving server `pwebarc_dumb_dump_server.py` script](./dumb_server/pwebarc_dumb_dump_server.py) and run it, it has no dependencies except Python itself, and it's source code is less than 200 lines of pure Python.
  It will start saving data into `pwebarc-dump` directory wherever you run it from.

  Alternatively, install via

  ``` bash
  pip install pwebarc-dumb-dump-server
  ```

  and run as

  ``` bash
  pwebarc-dumb-dump-server
  ```

  See [there](./dumb_server/) for more info.

  (This step will eventually become optional, but not yet.)

- Install the browser extension/add-on:

  - On Firefox/Tor Browser/etc: [![](https://oxij.org/asset/img/software/amo/get-the-addon-small.png) Install the extension from addons.mozilla.org](https://addons.mozilla.org/en-US/firefox/addon/pwebarc/) or see [Installing from source on Firefox/Tor Browser](./extension/README.md#build-firefox).
  - On Chromium/Chrome/etc: See [Installing on Chromium/Chrome](./extension/README.md#install-chromium) or [Installing from source on Chromium/Chrome](./extension/README.md#build-chromium).

- Now load any web page in your browser, the extension will report if everything works okay, or tell you where the problem is if something is broken.

### ... and you are done

Assuming the extension reported success: **Congratulations\!** You are now collecting and archiving all your web browsing traffic originating from that browser.
Repeat extension installation for all browsers/browser profiles as needed.

If you just want to collect everything and don't have time to figure out how to use the rest of this suite of tools right this moment, **you can stop here** and figure out how to use the rest of this suite later.

It took me about 6 months before I had to refer back to previously archived data for the first time when I started using [mitmproxy](https://github.com/mitmproxy/mitmproxy) to sporadically collect my HTTP traffic in 2017.
So, I recommend you start collecting immediately and be lazy about the rest.
Also, I learned a lot about nefarious things some of the websites I visit do in the background while doing that, now you are going to learn the same.

### Recommended next steps

Next, you should read the extension's ["Help" page](./extension/page/help.org).
It has lots of useful details about how it works and quirks of different browsers.
If you open it by clicking the "Help" button in the extension's UI, then hovering over or clicking on links in there will highlight relevant settings.

See ["Setup recommendations"](#setup) section for best practices for configuring your system and browsers to be used with `pwebarc`.

### How to view archived data

See the docs of the [`wrrarms` tool](./tool/).

## On a system with no Python installed

- Install Python:
  - On Windows: [Download Python from the official website](https://www.python.org/downloads/windows/).
  - On Linux/etc: Install via your package manager. Realistically, who am I kidding, it probably is installed already.
- Go back to [Quickstart with Python installed](#quickstart-with-python).

## On a system with [Nix package manager](https://nixos.org/nix/)

- Install by running

  ``` bash
  nix-env -i -f ./default.nix
  ```

- Start [the dumb archiving server](./dumb_server/) by running

  ``` bash
  pwebarc-dumb-dump-server
  ```

- Install the add-on and etc as [above](#quickstart-with-python).

- Alternatively, built XPI and Chromium ZIPs can be taken from

  ``` bash
  ls ~/.nix-profile/pWebArc*
  ```

  see [the extension's README](./extension/#build) for more info on how to install them manually.

# <span id="setup"/>Setup recommendations

- You can add `pwebarc_dumb_dump_server.py` to Autorun or start it from your `~/.xsession`, `systemd --user`, etc.

- You can also make a new browser profile specifically for archived browsing, run Firefox as `firefox -ProfileManager` to get to the appropriate UI. On Windows you can just edit your desktop or toolbar shortcut to target

  ``` cmd
  "C:\Program Files\Mozilla Firefox\firefox.exe" -ProfileManager
  ```

  or similar by default to switch between profiles on browser startup.

- It is highly recommended you make separate browser profiles for anonymous and logged-in browsing with separate extension instances pointing to separate archiving server instances dumping data to different directories on disk.

  Set the "anonymous" browser profile to always run in "Private Browsing" mode to prevent login persistence there.
  If you do accidentally login in "anonymous" profile, move those dumps out of the "anonymous" directory immediately.

  This way you can easily share dumps from the "anonymous" instance without worrying about leaking your private data or login credentials.

## Using with Tor Browser

- Run server as `./pwebarc_dumb_dump_server.py --host 127.0.99.1` or similar.
- Go to `about:config` and add `127.0.99.1` to `network.proxy.no_proxies_on`.
- Set the dumping URL in the extension to `http://127.0.99.1:3210/pwebarc/dump`.

You probably don't want to use `127.0.0.1` and `127.0.1.1` with Tor Browser as those are normal loopback addresses and you probably don't want to allow stuff from under Tor to access your everyday stuff.

Or, you could run both the Tor Browser, and `./pwebarc_dumb_dump_server.py` in a container/VM and use the default `127.0.0.1` address.

# More docs

- [`pWebArc` extension's "Help" page](./extension/page/help.org), which is a must-read (though it will be even more useful if you open it via the "Help" button in the extension's UI), and [its README](./extension/README.md) (which is only useful if you want to build it from source).

- [`dumb_server` archiving server's README](./dumb_server/README.md), or you can read `pwebarc-dumb-dump-server --help` instead.

- [`wrrarms` tool's README](./tool/README.md), which is slightly more useful than `wrrarms --help`, and [its example scripts](./tool/script/README.md).

- [On-disk file format used by all these tools](./doc/data-on-disk.md) is useful for developers.

# <span id="alternatives"/>Alternatives and comparisons

"Cons" and "Pros" are in comparison to the main workflow of `pwebarc`.
Most similar and easier to use projects first, harder to use and less similar projects later.

## [archiveweb.page](https://github.com/webrecorder/archiveweb.page) and [replayweb.page](https://github.com/webrecorder/replayweb.page)

Tools most similar to `pwebarc` in their implementation, though not in their philosophy and intended use.

Cons:

- Chromium-only;
- store data internally in the browser by default, which is both inefficient and dangerous for long-term preservation of said data; and then
- you will have to manually enable `archiveweb.page` for each browser tab; and then
- opening a link in a new tab will fail to archive the first page, as the archival is per-tab;
- it also requires constant user interaction to export the data out.

Pros:

- its replay is much more mature than anything `pwebarc` currently has.

## [DiskerNet](https://github.com/dosyago/DownloadNet)

A self-hosted web app and web crawler written in `Node.js` most similar to `pwebarc` in its intended use.

`DiskerNet` does its web crawling by spawning a Chromium browser instance and attaching to it via its debug protocol, which is a bit weird, but it does work, and with exception of `pwebarc` it is the only other tool I know of that can archive everything passively as you browse, since you can just browse in that debugged Chromium window and it will archive the data it fetches.

Cons:

- Chromium-only;
- uses a custom archive format but gives no tools to inspect or manage them;
- you are expected to do everything from the web UI.

Pros:

- otherwise, it actually does most of what `pwebarc` aims to do on the basic level.

## But you could just enable request logging in your browser's Network Monitor and manually save your data as HAR archives from time to time.

Cons:

- you will have to manually enable it for each browser tab;
- opening a link in a new tab will fail to archive the first page as you will not have Network Monitor open there yet; and then
- you will have to check all your tabs for new data all the time and do \~5 clicks per tab to save it; and then
- HARs are JSON, meaning all that binary data gets encoded indirectly, thus making resulting HAR archives very inefficient for long-term storage, even when compressed.

And then you still need something like this suite to look into the generated archives.

## [mitmproxy](https://github.com/mitmproxy/mitmproxy)

Cons:

- it is rather painful to setup, requiring you to install a custom SSL root certificate; and
- websites using certificate pinning will stop working; and
- some websites detect when you use it and fingerprint you for it or force you to solve CAPTCHAs; and
- `mitmproxy` dump files are flat streams of HTTP requests and responses that use custom frequently changing between versions data format, so you'll have to re-parse them repeatedly using `mitmproxy`'s own parsers to get to the requests you want;
- it provides no tools to use those dumped HTTP request+response streams as website mirrors.

Pros:

- everything is completely automated after you set it all up;
- it captures WebSockets data, which `pWebArc` add-on currently does not.

## But you could setup SSL keys dumping then use Wireshark to capture your web traffic.

Cons:

- it is really painful to setup; and then
- it takes a lot of effort to recover HTTP data from the PCAP dumps; and
- PCAP dumps are IP packet-level, thus also inefficient for this use case; and
- PCAP dumps of SSL traffic can not be compressed much.

Pros:

- things are mostly automated after you set it all up;
- it captures WebSockets data, which `pWebArc` add-on currently does not.

And then you still need something like this suite to look into the generated archives.

## [ArchiveBox](https://github.com/ArchiveBox/ArchiveBox)

A web crawler and self-hosted web app into which you can feed the URLs for them to be archived.

So to make it archive all of your web browsing like `pwebarc` does:

Cons:

- [it requires you](https://github.com/ArchiveBox/ArchiveBox/issues/577) to setup `mitmproxy` with [archivebox-proxy](https://codeberg.org/brunoschroeder/archivebox-proxy) plugin; or,
  - alternatively, you can run [archivefox](https://github.com/layderv/archivefox) add-on and explicitly archive pages one-by-one via a button there;
- in both cases, to archive a URL, ArchiveBox will have to download it by itself in parallel with your browser, thus making you download everything twice;
- which is hacky and inefficient; and
- websites can easily see, fingerprint, and then ban you for doing that;
- and you won't be able to archive your HTTP `POST` requests with it.

Pros:

- written in Python, pretty lightweight;
- produces archives in WARC format, which is a de-facto standard;
- it has a nice web UI;
- it it's an all-in-one archiving solution, also archiving YouTube videos with [yt-dlp](https://github.com/yt-dlp/yt-dlp), `git` repos, etc;
- stable, well-tested, and well-supported.

Still, probably the best of the self-hosted web-app-server kind of tools for this ATM.

## [SingleFile](https://github.com/gildas-lormeau/SingleFile) and [WebScrapBook](https://github.com/danny0838/webscrapbook)

Browser add-ons to capture whole web pages.

Cons:

- you will have to manually capture each page you want to save;
- they only captures web pages, you won't be able to save POST request data or JSONs fetched by web apps.

Pros:

- very simple to use.

## [reminiscence](https://github.com/kanishka-linux/reminiscence)

A system similar to `ArchiveBox`, but has a bulit-in tagging system and archives pages as raw HTML + whole-page PNG rendering/screenshot --- which is a bit weird, but it has the advantage of not needing any replay machinery at all for re-viewing simple web pages, you only need a plain simple image viewer.

## `wget -mpk` and `curl`

Cons:

- you will have to manually capture each page you want to save;
- many websites will refuse to be archived with `wget` and making `wget` play pretend at being a normal web browser is basically impossible;
- similarly with `curl`, `curl` also doesn't have the equivalent to `wget`'s `-mpk` options;
- can't archive dynamic websites;
- changing archival options will force you to re-download a lot.

Pros:

- both are probably already installed on your POSIX-compliant OS.

## [wpull](https://github.com/ArchiveTeam/wpull)

`wget -mpk` done right.

Cons:

- you will have to manually capture each page you want to save;
- you won't be able to archive your HTTP `POST` requests with it;
- does not have replay capabilities, just generates WARC files.

Pros:

- can pause and resume fetching;
- can archive many dynamic websites via PhantomJS;
- produces archives in WARC format, which is a de-facto standard and has a lot of tooling around it;
- stable, well-tested, and well-supported.

## [grab-site](https://github.com/ArchiveTeam/grab-site)

A simpler and lighter crawler made from `wpull`, presented to you by the ArchiveTeam, a group associated with the [Internet Archive](https://web.archive.org/) which appears to be the source of archives for the most of the interesting pages I find there.

Cons:

- you will have to manually capture each page you want to save;
- can't really archive dynamic websites;
- you won't be able to archive your HTTP `POST` requests with it;
- does not have replay capabilities, just generates WARC files.

Pros:

- produces archives in WARC format, which is a de-facto standard and has a lot of tooling around it;
- stable, well-tested, and well-supported.

## [monolith](https://github.com/Y2Z/monolith) and [obelisk](https://github.com/go-shiori/obelisk)

Stand-alone tools doing the same thing SingleFile add-on does: generate single-file HTMLs with bundled resources viewable directly in the browser.

Cons:

- you will have to manually capture each page you want to save;
- can't really archive dynamic websites;
- you won't be able to archive your HTTP `POST` requests with it;
- changing archival options will force you to re-download everything again.

Pros:

- simple to use.

## [heritrix](https://github.com/internetarchive/heritrix3)

The crawler behind the [Internet Archive](https://web.archive.org/).

It's a self-hosted web app into which you can feed the URLs for them to be archived, so to make it archive all of your web browsing:

Cons:

- you have to run it, and it's a rather heavy Java app;
- you'll need to write a separate browser plugin to redirect all links you click to your local instance's `/save/` REST API URLs (which is not hard, but I'm unaware if any such add-on exists);
- and you won't be able to archive your HTTP `POST` requests with it.

Pros:

- produces archives in WARC format, which is a de-facto standard and has a lot of tooling around it;
- stable, well-tested, and well-supported.

## [Archivy](https://github.com/archivy/archivy)

A self-hosted wiki that archives pages you link to in background.

## Others

ArchiveBox wiki [has a long list](https://github.com/ArchiveBox/ArchiveBox/wiki/Web-Archiving-Community) or related things.

# If you like this, you might also like

## [Perkeep](https://perkeep.org/)

It's an awesome personal private archival system adhering to the same [philosophy](#philosophy) as `pwebarc`, but it's basically an abstraction replacing your file system with a content-addressed store that can be rendered into different "views", including a POSIXy file system.

It can do very little in helping you actually archive a web page, but you can start dumping new `pwebarc` `.wrr` files with compression disabled, decompress you existing `.wrr` files, and then feed them all into Perkeep to be stored and automatically replicated to your backup copies forever.
(Perkeep already has a better compression than what `pwebarc` currently does and provides a FUSE FS interface for transparent operation, so compressing things twice would be rather counterproductive.)

# License

GPLv3+, some small library parts are MIT.
