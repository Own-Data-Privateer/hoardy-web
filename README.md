# What is `Hoardy-Web`?

`Hoardy-Web` is a suite of tools for passive capture and archival of web pages and whole websites for later offline viewing, mirroring, and/or indexing.

In short, `Hoardy-Web`'s main workflow is this: you install its extension/add-on into your browser and just browse the web while it passively captures and archives **everything your browser fetches from the network**.

- If you ask for it, `Hoardy-Web` can also collect and archive DOM snapshots.
- It runs under desktop versions of both Firefox- and Chromium-based browsers as well as under Firefox-for-Android-based browsers.
- It can archive collected data into browser's local storage (the default), into files saved to your local file system (by generating fake-Downloads containing bundles of [`WRR`-formatted](./doc/data-on-disk.md) dumps), to a self-hosted archiving server ([like this](./simple_server/)), or any combination of those.
- It does not send any of your data anywhere unless you explicitly configure it to do so.
- It does not collect any telemetry.

To learn more:

- See ["Why"](#why) section for why you might want to do this.
- See ["Highlights"](#highlights) section for a longer description of what `Hoardy-Web` does and does not do.
- See ["Alternatives"](#alternatives) for comparisons to alternatives.
- See ["Frequently Asked Questions"](./extension/page/help.org#faq) for the answers to those, including the questions about common quirks you can encounter while using `Hoardy-Web`.
- See ["Quickstart"](#quickstart) section for setup instructions.

If you are reading this on GitHub, be aware that this repository is [a mirror of a repository on the author's web site](https://oxij.org/software/hoardy-web/).
In author's humble opinion, the rendering of the documentation pages there is superior to what can be seen on GitHub (its implemented via [`pandoc`](https://pandoc.org/) there).

`Hoardy-Web` was previously known as "Personal Private Passive Web Archive" aka "pwebarc".

# Screenshots

![Screenshot of Firefox's viewport with extension's popup shown.](https://oxij.org/asset/demo/software/hoardy-web/extension-v1.13.0-popup.png)

![Screenshot of Chromium's viewport with extension's popup shown.](https://oxij.org/asset/demo/software/hoardy-web/extension-v1.10.0-chromium.png)

See [there](./doc/gallery.md) for more screenshots.

# <span id="why"/>Why does `Hoardy-Web` exists?

## For a relatively layman user

So, you wake up remembering something interesting, you try to look it up on Google, you fail, eventually you remember the website you seen it at (or a tool like [recoll](https://www.lesbonscomptes.com/recoll/index.html) or [Promnesia](https://github.com/karlicoss/promnesia) helps you), you go there to look it up… and discover it offline/gone/a parked domain. Not a problem\! Have no fear\! You go to [Wayback Machine](https://web.archive.org/) and look it up there… and discover they only archived an ancient version of it and the thing you wanted is missing there.

Or, say, you read a cool fanfiction on [AO3](https://archiveofourown.org/) years ago, you even wrote down the URL, you go back to it wanting to experience it again… and discover the author made it private... and Wayback Machine saved only the very first chapter.

"If it is on the Internet, it is on Internet forever\!" they said.
**They lied\!**

Things vanish from the Internet all the time, [Wayback Machine](https://web.archive.org/) is awesome, but

- you need to be online to use it,
- it has no full-text search, even though it was promised for decades now (this is probably a privacy feature by this point),
- they remove/hide archived data under political pressure sometimes,
- they only archive the public web and only what can be reached with GET requests,
- and even then, they do not archive everything.

Meanwhile, `Hoardy-Web` solves all of the above out-of-the-box (though, the full-text search is currently being done by other tools running on top of it).

## For a user with accessibility or comfort requirements

Say, there is a web page that can not be easily reached via `curl`/`wget` (because it is behind a paywall or complex authentication method that is hard to reproduce outside of a browser) but for accessibility or just simple reading comfort reasons each time you visit that page you want to automatically feed its source to a script that strips and/or modifies its HTML markup in a website-specific way and feeds it into a TTS engine, a Braille display, or a book reader app.

With most modern web browsers you can do TTS either out-of-the-box or by installing an add-on (though, be aware of privacy issues when using most of these), but tools that can do website-specific accessibility without also being website-specific UI apps are very few.

Meanwhile, `Hoardy-Web` with [some scripts](./tool/script/) can do it.

## For a technical user

Say, there's a web page/app you use (like a banking app), but it lacks some features you want, and in your browser's Network Monitor you can see it uses JSON RPC or some such to fetch its data, and you want those JSONs for yourself (e.g., to compute statistics and supplement the app output with them), but the app in question has no public API and scraping it with a script is non-trivial (e.g., they do complicated JavaScript+multifactor-based auth, try to detect you are actually using a browser, and they ban you immediately if not).

Or, maybe, you want to parse those behind-auth pages with a script, save the results to a database, and then do interesting things with them (e.g., track price changes, manually classify, annotate, and merge pages representing the same product by different sellers, do complex queries, like sorting by price/unit, limit results by geographical locations extracted from text labels, etc).

Or, say, you want to fetch a bunch of pages belonging to two recommendation lists on AO3 or [GoodReads](https://www.goodreads.com/), get all outgoing links for each fetched page, union sets for the pages belonging to the same recommendation list, and then intersect the results of the two lists to get a shorter list of things you might want to read with higher probability.

Or, more generally, say, you want to tag web pages referenced from a certain set of other web pages with some tag in your indexing software, and update it automatically each time you visit any of the source pages.

Or, say, you want to combine a full-text indexing engine, your browsing and derived web link graph data, your states/ratings/notes from [org-mode](https://orgmode.org/), messages from your friends, and other archives, so that you could do arbitrarily complex queries over it all, like "show me all GoodReads pages for all books not marked as `DONE` or `CANCELED` in my `org-mode` files, ever mentioned by any of my friends, ordered by undirected-graph [Pagerank](https://en.wikipedia.org/wiki/Pagerank) algorithm biased with my own book ratings (so that books sharing GoodReads lists with the books I finished and liked will get higher scores)".
So, basically, you want a private personalized Bayesian recommendation system.

"Everything will have a RESTful API\!" they said.
**They lied\!**
A lot of useful stuff never got RESTful APIs, those RESTful APIs that exists are frequently buggy, you'll probably have to scrape data from HTMLs anyway.

"Semantic Web will allow arbitrarily complex queries spanning multiple data sources\!" they said.
Well, 25 years later ("RDF Model and Syntax Specification" was published in 1999), almost no progress there, the most commonly used subset of RDF does what indexing systems in 1970s did, but less efficiently and with a worse UI.

Meanwhile, `Hoardy-Web` provides some of the tools to help you build your own little local data paradise.

# <span id="highlights"/>Highlights

`Hoardy-Web`'s main workflow

- is to passively collect and archive HTTP requests and responses (and, if you ask, also [DOM snapshots](./extension/page/help.org#faq-snapshot), i.e. the contents of the page after all JavaScript was run) directly from your browser as you browse the web, thus

- allowing you to archive any HTTP data, not just the pages available via HTTP `GET` requests (e.g., it can archive answer pages of web search engines fetched via HTTP `POST`, JSON RPC/AJAX data, etc);

- downloading everything only once, **not** once with your browser and then the second time with a separate tool like [ArchiveBox](https://github.com/ArchiveBox/ArchiveBox);

- allowing you to trivially archive web pages hidden behind CAPTCHAs, requiring special cookies, multi-factor logins, paywalls, anti-scraping/`curl`/`wget` measures, and etc; after all, the website in question only interacts with your normal web browser, not with a custom web crawler;

- freeing you from worries of forgetting to archive something because you forgot to press a button somewhere.

In other words, `Hoardy-Web` is your own personal [Wayback Machine](https://web.archive.org/) which passively archives everything you see and, unlike the original Wayback Machine, also archives HTTP `POST` requests and responses, and most other HTTP-level data.

Also, unless configured otherwise, `Hoardy-Web` will dump and archive collected data immediately, to both prevent data loss and to free the used RAM as soon as possible, keeping your browsing experience snappy even on ancient hardware.

Unlike most of [its alternatives](#alternatives), `Hoardy-Web` **DOES NOT**:

- require you to capture and/or collect and/or archive and/or export recorded data explicitly one page/browsing session at a time (the default behaviour is to archive everything completely automatically, though it implements optional [limbo mode](./extension/page/help.org#faq-limbo) which delays archival of collected data and provides optional manual/semi-automatic control if you want it);

- force you to use a Chromium-based browser (you can use `Hoardy-Web` with [Firefox](https://www.mozilla.org/en-US/firefox/all/), [Tor Browser](https://www.torproject.org/download/), [LibreWolf](https://librewolf.net/installation/), [Fenix aka Firefox for Android](https://www.mozilla.org/en-US/firefox/browsers/mobile/android/), [Fennec](https://f-droid.org/en/packages/org.mozilla.fennec_fdroid/), [Mull](https://f-droid.org/packages/us.spotco.fennec_dos/), etc, which is not a small thing, since if you tried using any of the close alternatives running under Chromium-based browsers, you might have noticed that the experience there is pretty awful: the browser becomes even slower than usual, large files don't get captured, random stuff fails to be captured at random times because Chromium randomly detaches its debugger from its tabs... none of these problems exist on Firefox-based browsers because Firefox does not fight ad-blocking and hardcore ad-blocking extensions and `Hoardy-Web` use the same browser APIs);

- require you to download the data you want to archive twice or more (you'd be surprised how commonly other tools will either ask you to do that explicitly, or just do that silently when you ask them to save something);

- require you to store all the things in browser's local storage where they can vanish at any moment;
- require you to run a database server;
- share your archived data with anyone by default;

- require you to run a web browser to view the data you already archived (in fact, [the `hoardy-web` tool](./tool/) comes with [a bunch of scripts](./tool/script/) which allow you to use other tools for that; e.g., a script to view HTML documents via `pandoc` piped into `less` in [your favorite tty emulator](https://st.suckless.org/)).

Technically, `Hoardy-Web` is most similar to

- [archiveweb.page](https://github.com/webrecorder/archiveweb.page) project, but following "capture and archive everything with as little user input as needed now, figure out what to do with it later" philosophy, and not limited to Chromium;
- [DiskerNet](https://github.com/dosyago/DownloadNet) project, but with much more tooling and also not limited to Chromium.

Or, to summarize it another way, you can view `Hoardy-Web` as an alternative for [mitmproxy](https://github.com/mitmproxy/mitmproxy) which leaves SSL/TLS layer alone and hooks into target application's runtime instead.

In fact, an unpublished and now irrelevant ancestor project of `Hoardy-Web` was a tool to generate website mirrors from `mitmproxy` stream captures.
[(By the way, if you want that, `hoardy-web` CLI tool can do that for you. It can take `mitmproxy` dumps as inputs.)](./tool/#mitmproxy-mirror)
But then I got annoyed by all the sites that don't work under `mitmproxy`, did some research into the alternatives, decided there were none I wanted to use, and so I made my own.

## Parts and pieces

### Required

- [The `Hoardy-Web` browser extension](./extension/) that captures all HTTP requests and responses (and [DOM snapshots](./extension/page/help.org#faq-snapshot)) your browser fetches, dumps them [into `WRR` format](./doc/data-on-disk.md), and then exports them by generating fake-Downloads containing bundles of those dumps, submits them to the specified archiving server (by `POST`ing them to the specified URL), or saves the to browser's local storage.

  The extension is

  - *stable* while running under desktop versions of both Firefox- and Chromium-based browsers;

  - *beta* while running under Fenix-based (Firefox-for-Android-based) browsers.

  See [the "Quirks and Bugs" section of extension's `Help` page](./extension/page/help.org#bugs) for known issues.
  Also, `Hoardy-Web` is tested much less on Chromium than on Firefox.

### Optional, but convenient

- [The simple archiving server](./simple_server/) that simply dumps everything the `Hoardy-Web` extension submits to it to disk, one file per HTTP request+response.

  The simple archiving server is *stable* (it's so simple there hardly could be any bugs there).

### Optional, but almost always required at some point

- [The `hoardy-web` tool](./tool/) that allows you to display, search, organize, and manipulate archived data.

  `hoardy-web` tool is deep in its *beta* stage.
  At the moment, it does about 70% of the stuff I want it to do, and the things it does it does not do as well as I'd like.
  See [the TODO list](#todo) for more info.

### Optional, but useful

- [A patch for Firefox](./firefox/) to allow `Hoardy-Web` extension to collect request POST data as-is. This is not required and even without that patch `Hoardy-Web` will collect everything in most cases, but it could be useful if you want to correctly capture POST requests that upload files.

  See "Quirks and Bugs" section of [extension's `Help` page](./extension/page/help.org) for more info.

## <span id="philosophy"/>Technical Philosophy

Firstly, `Hoardy-Web` is designed to be simple (as in adhering to the Keep It Stupid Simple principle) and efficient (as in running well on ancient hardware) while providing guarantees that all collected data gets actually written to disk:

- [the `Hoardy-Web` WebExtension add-on](./extension/) does almost no actual work, simply generating HTTP request+response dumps, archiving them, and then freeing the memory as soon as possible (unless you enable [limbo mode](./extension/page/help.org#faq-limbo), but then you asked for it), thus keeping your browsing experience snappy even on ancient hardware;

- the dumps are generated using [the simplest, trivially parsable with many third-party libraries, yet most space-efficient on-disk file format representing separate HTTP requests+responses there currently is (aka `Web Request+Response`, `WRR`)](./doc/data-on-disk.md), which is a file format that is both more general and more simple than WARC, much simpler than that `mitmproxy` uses, and much more efficient than HAR;

- `Hoardy-Web` extension can write the dumps it produces to disk by itself by generating fake-Dowloads containing bundles of WRR-dumps, but because of limitations of browser APIs, `Hoardy-Web` can't tell if a file generated this way succeeds at being written to disk;

- which is why, for users who want write guarantees and error reporting, the extension has other archival methods, which includes archival by submission via HTTP;

  server-side part of submission via HTTP uses [the simple archiving server](./simple_server/), which is tiny (less than 200 lines of code) pure-Python script that provides an HTTP interface for archival of dumps given via HTTP POST requests, it simply (optionally) compresses those dumps with gzip and saves them to disk as-is while properly reporting any errors;

- anything that is remotely computationally expensive is delegated to [the `hoardy-web` tool](./tool/).

Secondly, `Hoardy-Web` is built to follow "capture and archive all the things as they are now, as raw as possible, modify those archives never, convert to other formats and extract values on-demand" philosophy.

Meaning,

- [the `Hoardy-Web` WebExtension add-on](./extension/) collects data as browser gives it, without any data normalization and conversion (when possible),

- both `Hoardy-Web` and [the simple archiving server](./simple_server/) write those dumps to disk as-is (with optional compression),

- meanwhile, all data normalization, massaging, post-processing, and extraction of useful values is delegated to [the `hoardy-web` tool](./tool/), which also does not overwrite any WRR files, ever.

`Hoardy-Web` expects you to treat your older pre-`Hoardy-Web` archives you want to convert to WRR similarly:

- `hoardy-web import` them into a separate directory, but
- leave your original `mitmproxy` (or whatever) dumps alone (on an external backup drive, if you lack disk space on your machine).

This way, if `hoardy-web` has some unexpected bug, or `hoardy-web import` adds some new feature, you could always re-import them later without losing anything.

## Supported use cases

### For a relatively layman user

Currently, `Hoardy-Web` has two main use cases for regular users, in both of which you first capture some data using [the add-on](./extension/) and then you either

- feed [`hoardy-web`](./tool/) a subset of your archives to [generate a static offline website mirror a-la `wget -mpk`](./tool/#mirror), which you can then view with your favorite web-browser as normal;
  except, unlike with `wget` you can discover you dislike the result, change some options, and re-generate the mirror **without re-downloading anything**;

- you use `hoardy-web` to simply maintain a tree of symlinks pointing to latest WRR file for each URL and then read them --- by using `w3m`, `pandoc`, any other HTML reader you want, or feed them to TTS engine, or a Braille display --- via some [scripts](./tool/script/);
  personally, I prefer this one, because I hate web browsers and prefer to read most things from a TTY;

- (TODO: eventually, when that gets implemented, a Wayback Machine-like Web UI for replay).

### For a more technical user

Alternatively, you can programmatically access that data by asking [`hoardy-web`](./tool/) to dump WRR files into JSONs or verbose CBORs for you, or you can [just parse WRR files yourself](./doc/data-on-disk.md) with readily-available libraries.

Since the whole of `Hoardy-Web` adheres to [the philosophy described above](#philosophy), the simultaneous use of `Hoardy-Web` and `hoardy-web` helps immensely when developing scrapers for uncooperative websites: you just visit them via your web browser as normal, then, possibly years later, use `hoardy-web` to organize your archives and conveniently programmatically feed the archived data into your scraper without the need to re-fetch anything.

Given how simple the WRR file format is, in principle, you can modify any HTTP library to generate WRR files, thus allowing you to use `hoardy-web` with data captured by other software.

Which is why, personally, I patch some of the commonly available FLOSS website scrapers to dump the data they fetch as WRR files so that in the future I could write my own better scrapers and indexers and test them on a huge collected database of already collected inputs immediately.

Also, as far as I'm aware, `hoardy-web` is a tool that can do more useful stuff to your WRR archives than any other tool can do to any other file format for HTTP dumps with the sole exception of WARC.

## <span id="more-docs"/>What does it do, exactly? I have questions.

- See [extension's `Help` page](./extension/page/help.org) (or the `Help` button in the extension's UI, which will make it interactive) for a long detailed description of what the extension does step-by-step.

    It is a must-read, though instead of reading that file raw I highly recommend you read it via the `Help` button of the extension's UI, since doing that will make the whole thing pretty interactive.

  - See [the "Frequently Asked Questions" section of extension's `Help` page](./extension/page/help.org#faq) for the answers to the frequently asked questions, including those about common quirks you can encounter while using it.

  - See [the "Quirks and Bugs" section of extension's `Help` page](./extension/page/help.org#bugs) for more info on quirks and limitations of `Hoardy-Web` when used on different browsers.

- See [below](#alternatives) for a long list of comparisons to its alternatives.

- Then notice that `Hoardy-Web` is the best among them, and go follow ["Quickstart"](#quickstart) section for setup instructions. （ •̀ ω •́ ）✧

- To follow the development:

  - See [the TODO list](#todo) below for the list of things that are not implemented/ready yet.

  - See [CHANGELOG.md](./CHANGELOG.md) for the progress log and human-readable description of recent changes (which is much shorter and more comprehensible than the commit log).

- If you want to learn to use `hoardy-web` tool, see [its README](./tool/README.md), which has a bunch of extended and explained usage examples.

  - Also, a lot of info on that page can be seen by running `hoardy-web --help`.

  - See [example scripts](./tool/script/) to learn how to do various interesting things with your archived data.

- In the unlikely case you have problems with the simple archiving server, see [its README](./simple_server/README.md).
  Or you can read `hoardy-web-sas --help` instead.

- If you want to build the extension from source, see [its README](./extension/README.md).

- If you are a developer, see all the `hoardy-web`-related links above, and also see the description of [the on-disk file format used by all these tools](./doc/data-on-disk.md).

- If your questions are not unanswered by these, then [open an issue on GitHub](https://github.com/Own-Data-Privateer/hoardy-web/issues) or [get in touch otherwise](https://oxij.org/#contact).

# Does the author eat what he cooks?

Yes, as of September 2024, I archive all of my web traffic using `Hoardy-Web`, without any interruptions, since October 2023.
Before that my preferred tool was [mitmproxy](https://github.com/mitmproxy/mitmproxy).

After adding each new feature to [the `hoardy-web` tool](./tool/), as a rule, I feed at least the last 5 years of my web browsing into it (at the moment, most of it converted from other formats to `.wrr`, obviously) to see if everything works as expected.

# TODO

## `Hoardy-Web` extension

- Improved UI:

  - Roll/unroll popup UI in steps, a-la uBlock Origin.
    The number of settings `Hoardy-Web` now has is kind of ridiculous (and I still want more), I find it hard to find stuff in there myself now, so.
    Alternatively, make a separate `Settings` page, but I kind of dislike that idea, I like having everything on a single page which can be `Control+F`ed.

  - Track navigations and allow to use them as boundaries between batches of reqres saved in limbo mode.

  - Reorganize tracking- and problematic-related options into config profiles (~25% done), allow them to override each over, and then implement per-host profiles.

- Automatic capture of DOM snapshots when a page changes.
- Automatic management of `network.proxy.no_proxies_on` setting to allow `Hoardy-Web` archival to an archiving server to work out of the box when using proxies.
- Maybe: Dumping straight into WARC, so that third-party tools (i.e. not just `hoardy-web`) could be used for everything except capture.

## `hoardy-web` tool

- On-the-fly mangling of reqres when `export`ing, so that, e.g. you could `organize` or `export` a reqres containing `https://web.archive.org/web/<something>/<URL>` as if it was just a `<URL>`.
- URL remapping in and `scrub`bing of CSS files.
- Non-dumb HTTP server with time+URL index and replay, i.e. a local HTTP UI a-la [Wayback Machine](https://web.archive.org/).
  (Because re-generating local mirrors all the time can get a bit annoying.)
- Converters from HAR and WARC to WRR.
- Data de-duplication between WRR files and bundle-packing of related WRR files.
- Converter from WRR to WARC.
- Converter from PCAP ito WRR.
- Maybe: Full text indexing and search. "Maybe", because offloading (almost) everything search-related to third-party tools may be a better idea.

# Quickstart

## Install `Hoardy-Web` browser extension/add-on

- On Firefox, Tor Browser, LibreWolf, Fenix aka Firefox for Android, Fennec, Mull, etc: [![](https://oxij.org/asset/img/software/amo/get-the-addon-small.png) Install the extension from addons.mozilla.org](https://addons.mozilla.org/en-US/firefox/addon/hoardy-web/) or see [Build from source](./extension/README.md#build).

- On Chromium, Google Chrome, Ungoogled Chromium, Brave, etc: See [Installing on Chromium-based browser](./extension/README.md#install-chromium) or [Build from source](./extension/README.md#build).

  Unfortunately, this requires a bit more work than clicking `Install` button on [Chrome Web Store](https://chromewebstore.google.com/), yes.

  "Why isn't `Hoardy-Web` on Chrome Web Store?"
  I'm not a lawyer, but to me it looks like `Hoardy-Web` violates [Chrome Web Store's "Terms of Use"](https://web.archive.org/web/20240604062520/https://developer.chrome.com/docs/webstore/program-policies/terms).
  Specifically, the "enables the unauthorized download of streaming content or media" clause.
  In my personal opinion, any content you web browser fetches while you are browsing the web normally you are "authorized" to download.
  This is especially true for `Hoardy-Web` since, unlike most of [its alternatives](#alternatives), *does not generate any requests itself*, it only ever captures the data that a web page in question generates by itself while you browse it.
  But given the context of that clause in that document, I feel like Google would disagree with my the interpretation above.
  Even though, technically speaking, separation between "streamed" and "downloaded" content or media is a complete delusion.

  Meanwhile, `Hoardy-Web` tries its best to collect all web traffic you browser generates, which, obviously, includes streaming content.

  On Chromium (but not on Firefox), technically, at the moment, `Hoardy-Web` does fail to collect streaming media properly because Chromium has a bug that prevents collection of the first few KiB of all audio and video files, and its API design prevents collection of large files in general, but if we are talking about YouTube, then most of the data of those streaming media files Chromium will fetch while you watch a video there will, in fact, get collected even on Chromium.

  So, in principle, to conform to those terms, `Hoardy-Web` would need to add artificial limitations, which I'm unwilling to do.

  (Meanwhile, on Firefox, `Hoardy-Web` will just silently collect everything you browser fetches.
  And [addons.mozilla.org's policies do not restrict this](https://web.archive.org/web/20240611083716/https://extensionworkshop.com/documentation/publish/add-on-policies/).)

  (Also, Chrome Web Store actually requires developers to pay Google to host their add-ons there while Mozilla's service is free.
  Meaning, you should go and donate to any free add-ons that do not violate your privacy and sell your data you installed from there.
  Their authors paid Google so that you could conveniently install their add-ons with a single click.
  Who else will pay the authors?)

## ... check it actually works

Now load any web page in your browser.
The extension will report if everything works okay, or tell you where the problem is if something is broken.

## ... and you are done

Assuming the extension reported success: **Congratulations\!** You are now collecting and archiving all your web browsing traffic originating from that browser.
Repeat extension installation for all browsers/browser profiles as needed.

**Technically speaking**, if you just want to collect everything and don't have time to figure out how to use the rest of this suite of tools right this moment, **you can stop here** and figure out how to use the rest of this suite later.

It took me about 6 months before I had to refer back to previously archived data for the first time when I started using [mitmproxy](https://github.com/mitmproxy/mitmproxy) to sporadically collect my HTTP traffic in 2017.
So, I recommend you start collecting immediately and be lazy about the rest.
Also, I learned a lot about nefarious things some of the websites I visit do in the background while doing that, now you are going to learn the same.

In practice, though, your will probably want to install at least [the simple archiving server](./simple_server/) (see below for instructions) and switch `Hoardy-Web` to `Archive 'collected' reqres by > ... submitting them via HTTP` mode pretty soon [**because it is very easy to accidentally loose data using other archival methods**](./extension/page/help.org#faq-unsafe) and, assuming you have Python installed on your computer, it is also the most convenient archival method there is.

Or, alternatively, you can use the combination of archiving by saving of data to browser's local storage (the default) followed by manual export into WRR-bundles [as described below in the section on using `Hoardy-Web` together with Tor Browser](#in-tb).

Or, alternatively, you can switch to `Archive 'collected' reqres by > ... exporting them via 'saveAs'` mode by default and simply accept the resulting slightly more annoying UI ([on Firefox, it can be fixed with a small `about:config` change](./extension/page/help.org#faq-firefox-saveas)) and the facts that [you can now lose some data if your disk ever gets out of space or if you accidentally mis-click a button in your browser's `Downloads` UI](./extension/page/help.org#faq-unsafe).

## Recommended next steps

Next, you should read [extension's `Help` page](./extension/page/help.org).
It has lots of useful details about how it works and quirks of different browsers.
If you open it by clicking the `Help` button in the extension's UI, then hovering over or clicking on links in there will highlight relevant settings.

See ["Setup recommendations"](#setup) section for best practices for configuring your system and browsers to be used with `Hoardy-Web`.

## How to view archived data

Install and see the docs of [the `hoardy-web` tool](./tool/).

## Installing the Pythonic parts

### <span id="quickstart-with-python"/>On a system with Python installed

- Download [the simple archiving server `hoardy_web_sas.py` script](./simple_server/hoardy_web_sas.py) and run it, it has no dependencies except Python itself, and it's source code is less than 200 lines of pure Python.
  It will start saving data into `pwebarc-dump` directory wherever you run it from.

  Alternatively, install via

  ``` bash
  pip install hoardy-web-sas
  ```

  and run as

  ``` bash
  hoardy-web-sas
  ```

  See [there](./simple_server/) for more info.

- Install [the `hoardy-web` tool](./tool/):

  ```bash
  pip install hoardy-web
  ```

  and run as

  ```bash
  hoardy-web --help
  ```

  See [there](./tool/) for more info.

### On a system with no Python installed

- Install Python:
  - On Windows: [Download Python from the official website](https://www.python.org/downloads/windows/).
  - On Linux/etc: Install via your package manager. Realistically, who am I kidding, it probably is installed already.
- Go back to [Quickstart with Python installed](#quickstart-with-python).

### On a system with [Nix package manager](https://nixos.org/nix/)

- Install by running

  ``` bash
  nix-env -i -f ./default.nix
  ```

- Start [the simple archiving server](./simple_server/) by running

  ``` bash
  hoardy-web-sas
  ```

- Run [the `hoardy-web` tool](./tool/) by running

  ``` bash
  hoardy-web --help
  ```

- Also, instead of installing the add-on from `addons.mozilla.org` or from Releases on GitHub you can take freshly built XPI and Chromium ZIPs from

  ``` bash
  ls ~/.nix-profile/Hoardy-Web*
  ```

  instead.
  See [the extension's README](./extension/#build) for more info on how to install them manually.

# <span id="setup"/>Setup recommendations

## In general

- You can add `hoardy_web_sas.py` to Autorun or start it from your `~/.xsession`, `systemd --user`, etc.

- You can also make a new browser profile specifically for archived browsing, run Firefox as `firefox -ProfileManager` to get to the appropriate UI. On Windows you can just edit your desktop or toolbar shortcut to target

  ``` cmd
  "C:\Program Files\Mozilla Firefox\firefox.exe" -ProfileManager
  ```

  or similar by default to switch between profiles on browser startup.

- It is highly recommended you make separate browser profiles for anonymous and logged-in browsing with separate extension instances pointing to separate archiving server instances dumping data to different directories on disk.

  Set the "anonymous" browser profile to always run in `Private Browsing` mode to prevent login persistence there.
  If you do accidentally login in "anonymous" profile, move those dumps out of the "anonymous" directory immediately.

  This way you can easily share dumps from the "anonymous" instance without worrying about leaking your private data or login credentials.

## <span id="in-tb"/>Using `Hoardy-Web` with Tor Browser

When using `Hoardy-Web` with Tor Browser, you probably want to configure it all in such a way so that all of the machinery of `Hoardy-Web` is completely invisible to web pages running under your Tor Browser, to prevent fingerprinting.

### Mostly convenient, paranoid

So, in the mostly convenient yet sufficiently paranoid setup, you would only ever use `Hoardy-Web` extension configured to archive captured data to browser's local storage (which is the default) and then export your dumps manually at the end of a browsing session.

You can do that by

- enabling `Archive 'collected' reqres by > ... exporting them via 'saveAs'` option,
- while keeping the `Archive 'collected' reqres by > ... saving them into local storage` option set, for safety,
- and then exporting everything saved in local storage and wiping the exported data out.

To do the latter:

- press the `Show` button on `Saved into LS` line in the main popup to open the `Saved in Local Storage` page;
- set `Exported via 'saveAs'` filter there to `false` (red) to make it only display reqres that were not exported yet;
- press the `Re-queue` button there;
- wait for `Hoardy-Web` to generate new fake-Downloads containing all that data;
- wait for the browser to save the resulting WRR-bundles;
- (if you are running on a truly ancient hardware and the above is slow, you can disable all GZip compression options);
- confirm the file was properly saved (i.e. you did not run out of disk space);
- repeat until everything is exported;

and then

- set `Exported via 'saveAs'` filter there to `true` (green);
- press the `Delete` button there;
- repeat until everything is deleted.

Yes, this is slightly annoying, but this is [the only absolutely safe way to export data out of `Hoardy-Web` without using submission via HTTP](./extension/page/help.org#faq-unsafe), and you don't need to do this at the end of each and every browsing session.

### Simpler, but slightly unsafe

You can also simply switch to using `Archive 'collected' reqres by > ... exporting them via 'saveAs'` by default instead.

I expect this to work fine for 99.99% of the users 99.99% of the time, but, technically speaking, [this is unsafe](./extension/page/help.org#faq-unsafe).
Also, by default, browser's UI will be slightly annoying, since `Hoardy-Web` will be generating new "Downloads" all the time, but that issue [can be fixed with a small `about:config` change](./extension/page/help.org#faq-firefox-saveas).

### Most convenient, less paranoid

In theory, running `./hoardy_web_sas.py` listening on a loopback IP address should prevent any web pages from accessing it, since the browsers disallow such cross-origin requests, thus making the normal `Archive 'collected' reqres by > ... submitting them via HTTP` mode setup quite viable.
However, Tor Browser is configured to proxy everything via the TOR network by default, so you need to configure it to exclude the requests to `./hoardy_web_sas.py` from being proxied.

A slightly more paranoid than normal way to do this is:

- Run the server as `./hoardy_web_sas.py --host 127.0.99.1` or similar.
- Go to `about:config` in your Tor Browser and add `127.0.99.1` to `network.proxy.no_proxies_on`.
- Set the submission URL in the extension to `http://127.0.99.1:3210/pwebarc/dump`.

Why?
When using Tor Browser, you probably don't want to use `127.0.0.1` and `127.0.1.1` as those are normal loopback IP addresses used by most things, and you probably don't want to allow any JavaScript code running in Tor Browser to (potentially, if there are any bugs) access to those.
Yes, if there are any bugs in the cross-domain check code, with this setup JavaScript could discover you are using `Hoardy-Web` (and then, in the worst case, DOS your system by flooding your disk with garbage dumps), but it won't be able to touch the rest of your stuff listening on your other loopback addresses.

So, while this setup is not super-secure if your Tor Browser allows web pages to run arbitrary JavaScript (in which case, let's be honest, no setup is secure), with JavaScript always disabled, to me, it looks like a completely reasonable thing to do.

### Best of both

In theory, you can have the benefits of both invisibility of archival to local storage and convenience, guarantees, and error reporting of archival to an archiving server at the same time:

- Run the server as `./hoardy_web_sas.py --host 127.0.99.1` or similar.
- But archive to browser's local storage while browsing.
- Then, at the end of the session, after you closed all the tabs, set `network.proxy.no_proxies_on`, enable submission via HTTP while disabling saving to local storage, re-archive, your local storage should now be empty, unset `network.proxy.no_proxies_on` again.

In practice, doing this manually all the time is prone to errors.
Automating this away is on [the TODO list](#todo).

Then, you can improve on this setup even more by running both the Tor Browser and `./hoardy_web_sas.py` in separate containers/VMs.

# <span id="alternatives"/>Alternatives

"Cons" and "Pros" are in comparison to the main workflow of `Hoardy-Web`.
Most similar and easier to use projects first, harder to use and less similar projects later.

## [archiveweb.page](https://github.com/webrecorder/archiveweb.page) and [replayweb.page](https://github.com/webrecorder/replayweb.page)

Tools most similar to `Hoardy-Web` in their implementation, though not in their philosophy and intended use.

Pros:

- their replay is much more mature than anything `Hoardy-Web` currently has.

Cons:

- they are Chromium-only;
- to make it archive all of your web browsing like `Hoardy-Web` does:
  - you will have to manually enable `archiveweb.page` for each browser tab; and then
  - opening a link in a new tab will fail to archive the first page, as the archival is per-tab;
- `archiveweb.page` also requires constant manual effort to export the data out.

Differences in design:

- `archiveweb.page` captures whole browsing sessions, while `Hoardy-Web` captures separate HTTP requests and responses;
- `archiveweb.page` implements ["Autopilot"](https://archiveweb.page/en/features/autopilot/), which [`Hoardy-Web` will never get](./extension/page/help.org#faq-lazy) (if you want that, `Hoardy-Web` expects you to use UserScripts instead).

Same issues:

- Both `Hoardy-Web` and `archiveweb.page` store captured data internally in the browser's local storage/IndexedDB by default.

  This is both convenient for on-boarding new users and helps in preserving the captured data when your computer looses power unexpectedly, your browser crashes, you quit from it before everything gets archived, or the extension crashes or gets reloaded unexpectedly.

  On the other hand, this is both inefficient and dangerous for long-term preservation of said data, since [it is very easy to accidentally loose data archived to browser's local storage (e.g., by uninstalling the extension)](./extension/page/help.org#faq-unsafe).

  Which is why [`Hoardy-Web`](./extension/) has `Archive 'collected' reqres by > ... submitting them via HTTP` mode which will automatically submit your dumps to [the simple archiving server](./simple_server/) instead.

- When `Hoardy-Web` extension is run under Chromium, [a bunch of Chromium's bugs](./extension/page/help.org#chromium-bugs) make many things [pretty annoying](./extension/page/help.org#faq-debugger).

  Both `Hoardy-Web` and `archiveweb.page` suffer from exactly the same issues, which --- if you know what to look for --- you can notice straight in the advertisement animation [on their "Usage" page](https://archiveweb.page/en/usage/).

  Those issues have no workarounds known to me (except for "switch to Firefox-based browser").
  But because they exists, I made `Hoardy-Web` instead of forking `archiveweb.page`, trying to port it to Firefox, and making the fork follow my preferred workflow.

## [DiskerNet](https://github.com/dosyago/DownloadNet)

A self-hosted web app and web crawler written in `Node.js` most similar to `Hoardy-Web` in its intended use.

`DiskerNet` does its web crawling by spawning a Chromium browser instance and attaching to it via its debug protocol, which is a bit weird, but it does work, and with exception of `Hoardy-Web` it is the only other tool I know of that can archive everything passively as you browse, since you can just browse in that debugged Chromium window and it will archive the data it fetches.

Pros:

- it's very similar to what `Hoardy-Web` aims to do, except

Cons:

- it's Chromium-only;
- it uses a custom archive format but gives no tools to inspect or manage them;
- you are expected to do everything from the web UI.

Same issues:

- when run under Chromium, same [bugs](./extension/page/help.org#chromium-bugs) and [annoyances](./extension/page/help.org#faq-debugger) apply.

## [SingleFile](https://github.com/gildas-lormeau/SingleFile) and [WebScrapBook](https://github.com/danny0838/webscrapbook)

Browser add-ons that capture whole web pages by taking their DOM snapshots and saving all resources (images, media, etc) the captured page references.

Pros:

- very simple to use;
- they implement annotations, which `Hoardy-Web` currently does not.

Cons:

- to make them archive all of your web browsing like `Hoardy-Web` does, you will have to manually capture each page you want to save;
- they only captures web pages, you won't be able to save POST request data or JSONs fetched by web apps;
- since they do not track and save HTTP requests and responses, capturing a page will make the browser re-download non-cached page resources a second time.

Differences in design:

- they capture DOM snapshots, while `Hoardy-Web` captures HTTP requests and responses (though, it can capture DOM snapshots too).

## [WorldBrain Memex](https://github.com/WorldBrain/Memex)

A browser extension that implements an alternative mechanism to browser bookmarks.
Saving a web page into Memex saves a DOM snapshot of the tab in question into an in-browser database.
Memex then implements full-text search engine for saved snapshots and PDFs.

Pros:

- pretty, both in UI and in documentation;
- it implements annotations, which `Hoardy-Web` currently does not;
- lots of other features.

Cons:

- to make it archive all of your web browsing like `Hoardy-Web` does, you will have to manually save each page you visit;
- it only captures web pages and PDFs, you won't be able to save POST request data or JSONs fetched by web apps;
- compared to `Hoardy-Web`, it is very fat --- it's `.xpi` is more than 40 times larger;
- it takes about 7 times more RAM to do comparable things (measured via `about:performance`);
- it is slow enough to be hard to use on an older or a very busy system;
- it injects content scripts to every page you visit, making your whole browsing experience much less snappy;
- it performs a lot of HTTP requests to third-party services in background (`Hoardy-Web` does **none** of that);
- you are expected to do everything from the web UI.

Differences in design:

- it captures DOM snapshots and PDFs, while `Hoardy-Web` captures HTTP requests and responses (though, it can capture DOM snapshots too);
- it has a builtin full-text search engine, while `Hoardy-Web` expects you to do that with third-party tools;
- it has a builtin synchronization between instances, while `Hoardy-Web` expects you to use normal file backup tools for that.

## But you could just enable request logging in your browser's Network Monitor and manually save your data as HAR archives from time to time.

Cons:

- to do what `Hoardy-Web` does, you will have to manually enable it for each browser tab;
- opening a link in a new tab will fail to archive the first page as you will not have Network Monitor open there yet; and then
- you will have to check all your tabs for new data all the time and do \~5 clicks per tab to save it; and then
- HARs are JSON, meaning all that binary data gets encoded indirectly, thus making resulting HAR archives very inefficient for long-term storage, even when compressed.

And then you still need something like this suite to look into the generated archives.

## [mitmproxy](https://github.com/mitmproxy/mitmproxy)

A Man-in-the-middle SSL proxy.

Pros:

- after you set it up, it will capture **absolutely everything completely automatically**;
- including WebSockets data, which `Hoardy-Web` add-on currently does not capture.

Cons:

- it is rather painful to setup, requiring you to install a custom SSL root certificate; and
- websites using certificate pinning will stop working; and
- some websites detect when you use it and fingerprint you for it or force you to solve CAPTCHAs; and
- `mitmproxy` dump files are flat streams of HTTP requests and responses that use custom frequently changing between versions data format, so you'll have to re-parse them repeatedly using `mitmproxy`'s own parsers to get to the requests you want;
- it provides no tools to use those dumped HTTP request+response streams as website mirrors or some such.

Though, the latter issue can be solved via [this project's `hoardy-web` tool](./tool/) as it can take `mitmproxy` dumps as inputs.

## But you could setup SSL keys dumping then use Wireshark to capture your web traffic.

Pros:

- after you set it up, it will capture **absolutely everything completely automatically**;
- it captures WebSockets data, which `Hoardy-Web` add-on currently does not.

Cons:

- it is really painful to setup; and then
- you are very likely to screw it up, loose/mismatch encryption keys, and make your captured data unusable; and even if you don't,
- it takes a lot of effort to recover HTTP data from the PCAP dumps; and
- PCAP dumps are IP packet-level, thus also inefficient for this use case; and
- PCAP dumps of SSL traffic can not be compressed much, thus storing the raw captures will take a lot of disk space.

And then you still need something like this suite to look into the generated archives.

## [ArchiveBox](https://github.com/ArchiveBox/ArchiveBox)

A web crawler and self-hosted web app into which you can feed the URLs for them to be archived.

Pros:

- it's pretty lightweight and is written in Python;
- it produces archives in WARC format, which is a de-facto standard;
- it has a very nice web UI;
- it it's an all-in-one archiving solution, also archiving YouTube videos with [yt-dlp](https://github.com/yt-dlp/yt-dlp), `git` repos, etc;
- stable, well-tested, and well-supported.

Cons:

- to make it archive all of your web browsing like `Hoardy-Web` does,
  - [it requires you](https://github.com/ArchiveBox/ArchiveBox/issues/577) to setup `mitmproxy` with [archivebox-proxy](https://codeberg.org/brunoschroeder/archivebox-proxy) plugin;
  - alternatively, you can run [archivefox](https://github.com/layderv/archivefox) add-on and explicitly archive pages one-by-one via a button there;
- in both cases, to archive a URL, ArchiveBox will have to download it by itself in parallel with your browser, thus making you download everything twice, which is hacky and inefficient; and
- websites can easily see, fingerprint, and then ban you for doing that;
- and you won't be able to archive your HTTP `POST` requests with it.

Still, probably the best of the self-hosted web-app-server kind of tools for this ATM.

## [reminiscence](https://github.com/kanishka-linux/reminiscence)

A system similar to `ArchiveBox`, but has a bulit-in tagging system and archives pages as raw HTML + whole-page PNG rendering/screenshot --- which is a bit weird, but it has the advantage of not needing any replay machinery at all for re-viewing simple web pages, you only need a plain simple image viewer.

Pros and Cons are almost identical to those of `ArchiveBox` above, except it has less third-party tools around it so less stuff can be automated easily.

## `wget -mpk` and `curl`

Pros:

- both are probably already installed on your POSIX-compliant OS.

Cons:

- to do what `Hoardy-Web` does, you will have to manually capture each page you want to save;
- many websites will refuse to be archived with `wget` and making `wget` play pretend at being a normal web browser is basically impossible;
- similarly with `curl`, `curl` also doesn't have the equivalent to `wget`'s `-mpk` options;
- can't archive dynamic websites;
- changing archival options will force you to re-download a lot.

## [wpull](https://github.com/ArchiveTeam/wpull)

`wget -mpk` done right.

Pros:

- it can pause and resume fetching;
- it can archive many dynamic websites via PhantomJS;
- it produces archives in WARC format, which is a de-facto standard and has a lot of tooling around it;
- stable, well-tested, and well-supported.

Cons:

- to do what `Hoardy-Web` does, you will have to manually capture each page you want to save;
- you won't be able to archive your HTTP `POST` requests with it;
- does not have replay capabilities, just generates WARC files.

## [grab-site](https://github.com/ArchiveTeam/grab-site)

A simple web crawler built on top of `wpull`, presented to you by the ArchiveTeam, a group associated with the [Internet Archive](https://web.archive.org/) which appears to be the source of archives for the most of the interesting pages I find there.

Pros:

- it produces archives in WARC format, which is a de-facto standard and has a lot of tooling around it;
- stable, well-tested, and well-supported.

Cons:

- to do what `Hoardy-Web` does, you will have to manually capture each page you want to save;
- it can't really archive dynamic websites;
- you won't be able to archive your HTTP `POST` requests with it;
- it does not have replay capabilities, just generates WARC files.

## [monolith](https://github.com/Y2Z/monolith) and [obelisk](https://github.com/go-shiori/obelisk)

Stand-alone tools doing the same thing SingleFile add-on does: generate single-file HTMLs with bundled resources viewable directly in the browser.

Pros:

- simple to use.

Cons:

- to make them archive all of your web browsing like `Hoardy-Web` does, you will have to manually capture each page you want to save;
- they can't really archive dynamic websites;
- you won't be able to archive your HTTP `POST` requests using them;
- changing archival options will force you to re-download everything again.

## [single-file-cli](https://github.com/gildas-lormeau/single-file-cli)

Stand-alone tool based on `SingleFile`, using a headless browser to capture pages.

A more robust solution to do what `monolith` and `obelisk` do, if you don't mind `nodejs` and the need to run a headless browser.

## [heritrix](https://github.com/internetarchive/heritrix3)

The crawler behind the [Internet Archive](https://web.archive.org/).

It's a self-hosted web app into which you can feed the URLs for them to be archived, so to make it archive all of your web browsing:

Pros:

- it produces archives in WARC format, which is a de-facto standard and has a lot of tooling around it;
- stable, well-tested, and well-supported.

Cons:

- you have to run it, and it's a rather heavy Java app;
- you'll need to write a separate browser plugin to redirect all links you click to your local instance's `/save/` REST API URLs (which is not hard, but I'm unaware if any such add-on exists);
- and you won't be able to archive your HTTP `POST` requests with it.

## [Archivy](https://github.com/archivy/archivy)

A self-hosted wiki that archives pages you link to in background.

## Others

ArchiveBox wiki [has a long list](https://github.com/ArchiveBox/ArchiveBox/wiki/Web-Archiving-Community) or related things.

# If you like this, you might also like

## [Perkeep](https://perkeep.org/)

It's an awesome personal private archival system adhering to the same [philosophy](#philosophy) as `Hoardy-Web`, but it's basically an abstraction replacing your file system with a content-addressed store that can be rendered into different "views", including a POSIXy file system.

It can do very little in helping you actually archive a web page, but you can start dumping new `Hoardy-Web` `.wrr` files with compression disabled, decompress you existing `.wrr` files, and then feed them all into Perkeep to be stored and automatically replicated to your backup copies forever.
(Perkeep already has a better compression than what `Hoardy-Web` currently does and provides a FUSE FS interface for transparent operation, so compressing things twice would be rather counterproductive.)

# Meta

## Changelog?

See [CHANGELOG.md](./CHANGELOG.md).

## License

[GPLv3](./LICENSE.txt)+, some small library parts are MIT.

## Contributions

Contributions are accepted both via GitHub issues and PRs, and via pure email.
In the latter case I expect to see patches formatted with `git-format-patch`.

If you want to perform a major change and you want it to be accepted upstream here, you should probably write me an email or open an issue on GitHub first.
In the cover letter, describe what you want to change and why.
I might also have a bunch of code doing most of what you want in my stash of unpublished patches already.
