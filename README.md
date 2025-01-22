# Table of Contents
<details><summary>(Click me to see it.)</summary>
<ul>
<li><a href="#what-is-hoardy-web" id="toc-what-is-hoardy-web">What is <code>Hoardy-Web</code>?</a></li>
<li><a href="#who-hoardy-web-is-for" id="toc-who-hoardy-web-is-for">Who <code>Hoardy-Web</code> is for?</a>
<ul>
<li><a href="#the-litmus-test" id="toc-the-litmus-test">The litmus test</a></li>
</ul></li>
<li><a href="#walkthrough" id="toc-walkthrough">Walkthrough</a>
<ul>
<li><a href="#the-magic" id="toc-the-magic">The magic</a></li>
<li><a href="#well-alright-this-is-kinda-nice-but-i.-need.-more-power" id="toc-well-alright-this-is-kinda-nice-but-i.-need.-more-power">Well, alright, this is kinda nice, but I. Need. More! POWER!</a></li>
</ul></li>
<li><a href="#parts-and-pieces" id="toc-parts-and-pieces"><span id="pieces"/>Parts and pieces</a>
<ul>
<li><a href="#the-hoardy-web-webextensions-browser-add-on" id="toc-the-hoardy-web-webextensions-browser-add-on">The <code>Hoardy-Web</code> WebExtensions browser add-on</a></li>
<li><a href="#the-hoardy-web-tool" id="toc-the-hoardy-web-tool">The <code>hoardy-web</code> tool</a></li>
<li><a href="#the-hoardy-web-sas-simple-archiving-server" id="toc-the-hoardy-web-sas-simple-archiving-server">The <code>hoardy-web-sas</code> simple archiving server</a></li>
<li><a href="#a-patch-for-firefox" id="toc-a-patch-for-firefox">A patch for Firefox</a></li>
</ul></li>
<li><a href="#what-hoardy-web-is-most-similar-to" id="toc-what-hoardy-web-is-most-similar-to">What <code>Hoardy-Web</code> is most similar to?</a></li>
<li><a href="#does-the-author-eat-what-he-cooks" id="toc-does-the-author-eat-what-he-cooks">Does the author eat what he cooks?</a></li>
<li><a href="#quickstart" id="toc-quickstart">Quickstart</a>
<ul>
<li><a href="#install-hoardy-web-browser-extensionadd-on" id="toc-install-hoardy-web-browser-extensionadd-on">Install <code>Hoardy-Web</code> browser extension/add-on</a></li>
<li><a href="#check-it-actually-works" id="toc-check-it-actually-works">… check it actually works</a></li>
<li><a href="#and-if-all-you-want-is-archival-you-are-done" id="toc-and-if-all-you-want-is-archival-you-are-done">… and, if all you want is archival, you are done</a></li>
<li><a href="#switch-to-using-an-archiving-server" id="toc-switch-to-using-an-archiving-server">Switch to using an archiving server</a></li>
<li><a href="#or-if-you-are-unable-or-unwilling-to-do-that" id="toc-or-if-you-are-unable-or-unwilling-to-do-that">… or, if you are unable or unwilling to do that</a></li>
</ul></li>
<li><a href="#alternatively-on-a-system-with-nix-package-manager" id="toc-alternatively-on-a-system-with-nix-package-manager">Alternatively, on a system with Nix package manager</a></li>
<li><a href="#setup-recommendations" id="toc-setup-recommendations"><span id="setup"/>Setup recommendations</a></li>
<li><a href="#recommended-next-steps" id="toc-recommended-next-steps">Recommended next steps</a></li>
<li><a href="#why-does-hoardy-web-exists" id="toc-why-does-hoardy-web-exists"><span id="why"/>Why does <code>Hoardy-Web</code> exists?</a></li>
<li><a href="#technical-philosophy" id="toc-technical-philosophy"><span id="philosophy"/>Technical Philosophy</a></li>
<li><a href="#alternatives" id="toc-alternatives"><span id="alternatives"/>Alternatives</a>
<ul>
<li><a href="#downloadnet" id="toc-downloadnet">DownloadNet</a></li>
<li><a href="#mitmproxy" id="toc-mitmproxy">mitmproxy</a></li>
<li><a href="#but-you-could-just-enable-request-logging-in-your-browsers-network-monitor-and-manually-save-your-data-as-har-archives-from-time-to-time" id="toc-but-you-could-just-enable-request-logging-in-your-browsers-network-monitor-and-manually-save-your-data-as-har-archives-from-time-to-time">But you could just enable request logging in your browser’s Network Monitor and manually save your data as <code>HAR</code> archives from time to time</a></li>
<li><a href="#but-you-could-setup-ssl-keys-dumping-then-use-wireshark-or-tcpdump-or-some-such-to-capture-your-web-traffic" id="toc-but-you-could-setup-ssl-keys-dumping-then-use-wireshark-or-tcpdump-or-some-such-to-capture-your-web-traffic">But you could setup SSL keys dumping then use <code>Wireshark</code>, or <code>tcpdump</code>, or some such, to capture your web traffic</a></li>
<li><a href="#archiveweb.page-and-replayweb.page" id="toc-archiveweb.page-and-replayweb.page">archiveweb.page and replayweb.page</a></li>
<li><a href="#singlefile-and-webscrapbook" id="toc-singlefile-and-webscrapbook">SingleFile and WebScrapBook</a></li>
<li><a href="#worldbrain-memex" id="toc-worldbrain-memex">WorldBrain Memex</a></li>
<li><a href="#pywb" id="toc-pywb">pywb</a></li>
<li><a href="#heritrix" id="toc-heritrix">heritrix</a></li>
<li><a href="#archivebox" id="toc-archivebox">ArchiveBox</a></li>
<li><a href="#reminiscence" id="toc-reminiscence">reminiscence</a></li>
<li><a href="#wget--mpk-and-curl" id="toc-wget--mpk-and-curl"><code>wget -mpk</code> and <code>curl</code></a></li>
<li><a href="#wpull" id="toc-wpull">wpull</a></li>
<li><a href="#grab-site" id="toc-grab-site">grab-site</a></li>
<li><a href="#monolith-and-obelisk" id="toc-monolith-and-obelisk">monolith and obelisk</a></li>
<li><a href="#single-file-cli" id="toc-single-file-cli">single-file-cli</a></li>
<li><a href="#archivy" id="toc-archivy">Archivy</a></li>
<li><a href="#others" id="toc-others">Others</a></li>
</ul></li>
<li><a href="#if-you-like-this-you-might-also-like" id="toc-if-you-like-this-you-might-also-like"><span id="also"/>If you like this, you might also like</a>
<ul>
<li><a href="#yt-dlp" id="toc-yt-dlp">yt-dlp</a></li>
<li><a href="#hydrus" id="toc-hydrus">hydrus</a></li>
<li><a href="#syncthing" id="toc-syncthing">syncthing</a></li>
<li><a href="#perkeep" id="toc-perkeep">Perkeep</a></li>
</ul></li>
<li><a href="#meta" id="toc-meta">Meta</a>
<ul>
<li><a href="#changelog" id="toc-changelog">Changelog?</a></li>
<li><a href="#todo" id="toc-todo">TODO?</a></li>
<li><a href="#license" id="toc-license">License</a></li>
<li><a href="#contributing" id="toc-contributing">Contributing</a></li>
</ul></li>
</ul>
</details>

# What is `Hoardy-Web`?

`Hoardy-Web` is a suite of tools that helps you to **passively** capture, archive, and hoard your web browsing history.
Not just the URLs, but also the contents and the requisite resources (images, media, `CSS`, fonts, etc) of the pages you visit.
Not just the last 3 months, but from the beginning of time you start using it.

Practically speaking, you [install `Hoardy-Web`'s extension/add-on into your web browser](#quickstart) and just browse the web normally while it passively, in background, captures and archives `HTTP` requests and responses your web browser does in the process.
The extension has a lot configuration options to help you tweak what should or should not be archived, provides indicators that can help you fully capture each page you do want to archive (it can notify you when some parts of a page failed to load in various ways), and has a very low memory footprint, keeping you browsing experience snappy even on ancient hardware (unless you explicitly configure it to do otherwise to, e.g., minimize writes to disk instead).

You can then view, replay, mirror, scrape, and/or index your archived data later by [using `Hoardy-Web`'s own tool set](./tool/), by plugging these tools into others, and/or by parsing and processing its [outputs](./doc/data-on-disk.md) with your own tools.

`Hoardy-Web` was previously known as "Personal Private Passive Web Archive" aka "pwebarc".

# Who `Hoardy-Web` is for?

- Do you happen to use your browser's open tabs as a "To Read Later" list?

  Isn't it kind of annoying you have to re-fetch web pages in old tabs after your browser unloads them, you restart it, or you reboot your PC?

  Wouldn't it be nice if there was a tool that would allow you to **view your old tabs, instantly, even if your browser unloaded them, without re-loading anything from the Internet, re-loading previously captured states from disk instead**, making things both more convenient (since you can now read those old tabs on a plane, or at sea) and more private (since the origin web servers will not learn about you returning to an old tab).

- Have you ever wanted to re-visit a web page you visited awhile ago, but then discovered that that page no longer exists, and [Wayback Machine](https://web.archive.org/) did not save any visits to it, or it only has versions that do not contain the information you need?

  **How many web pages you visited today you could potentially need to re-visit in the future, in their current versions?**

  **What proportion of them won't ever be archived by the [Wayback Machine](https://web.archive.org/) or any similar archiving service (because those pages are hidden behind CAPTCHAs, authentications, paywalls, `HTTP POST`s, etc)**, is not versioned by the origin website (e.g. Wikipedia), is not archived by Wayback Machine currently, or only have outdated versions there?
  (The latter you can count by substituting those `<URL>`s into `https://web.archive.org/web/2/<URL>` and trying the result out.)

  **Now, what, do you think, is the probability that the origin website and/or Wayback Machine would remove any of those pages in the future?**
  (I.e., are those pages potentially politically or commercially sensitive?
  Would somebody benefit if they were removed?
  Pages like that vanish both from Wikipedia --- where pages can be deleted with their edit history --- and from Wayback Machine --- where host owners can simply request their websites to be deleted from history --- all the time.)

  Now multiply all those values.
  **That's, on average, how many useful pages you unrecoverably lost today.**

  Wouldn't it be nice if there was a tool that would allow you to **automatically and efficiently archive everything your browser fetches from the network while you surf the web, allowing you to search and replay captured versions of previously visited web pages later**.

- Do you frequently find yourself making custom website data scrapers, for accessibility and/or data extraction reasons?

  Wouldn't it be nice if you could simply **visit those websites with your web browser, record all `HTTP` requests and responses performed in the process, and then, possibly years later, reuse those captures as inputs to your data scraping pipelines**.

`Hoardy-Web` does this, and more, but mainly this.

## The litmus test

If you are running multiple browsers or browser profiles to isolate different browsing sessions from each other, and you now want to introduce some historic persistence into your setup, then `Hoardy-Web` is for you.

If you are not isolating your browsing sessions already, however, then introducing `Hoardy-Web` into your setup, in the long run, will probably be a liability.
In which case, `Hoardy-Web` is not for you, navigate away, please.
If you let it, `Hoardy-Web` will happily capture and archive all your login credentials, in plain text.

# Walkthrough

If you are reading this on GitHub, be aware that this repository is a [mirror of a repository on the author's web site](https://oxij.org/software/hoardy-web/).
In author's humble opinion, the rendering of the documentation pages there is superior to what can be seen on GitHub (its implemented via [`pandoc`](https://pandoc.org/) there).

With `Hoardy-Web`, technically speaking, capture, archival, and replay are all independent.
This allows `Hoardy-Web` to be used in rather complex setups.
When all the pieces are used together, however, they integrate into a rather smooth workflow, demonstrated below.

So, for illustrative purposes, I [added the `Hoardy-Web` extension to a new browser profile in my Firefox, started a `hoardy-web serve` archiving server instance](#quickstart), ensured the extension is running in `Submit dumps via 'HTTP'` mode and its `Server URL` setting points to my `hoardy-web serve` instance ([like this screenshot of the `P&R` tab shows](https://oxij.org/asset/demo/software/hoardy-web/extension-v1.19.0-pr.png)), and then visited a Wikipedia page:

![Screenshot of Firefox's viewport with extension's popup shown.](https://oxij.org/asset/demo/software/hoardy-web/extension-v1.19.0-popup.png)

Also note that, for illustrative purposes, I had enabled [limbo mode](./extension/page/help.org#faq-limbo) before visiting it so that `Hoardy-Web` would capture that page and all its requisite resources and then put them all into "limbo" instead of immediately archiving them, thus allowing me to look at the page first.
This is most useful for when you are about to visit a new page and you are not yet sure you will want to archive that visit.
Or for dynamically generated pages that update all the time with only some versions deserving being archived.

So, then, I decided I do want to save that page and its resources.
Hence, I pressed the lower of "In limbo" check-mark buttons there to collect and archive everything from that tab to my `hoardy-web serve` archiving server instance.

Then, I pressed the "Replay" button to switch to a replay page generated by `hoardy-web serve` for the above capture (i.e. that button re-navigated that tab to <http://127.0.0.1:3210/web/2/https://en.wikipedia.org/wiki/Bibliometrics>, which `hoardy-web serve` then immediately redirected to the latest archived replay version of that URL):

![Screenshot of Firefox's viewport with a replay of the page from the previous screenshot.](https://oxij.org/asset/demo/software/hoardy-web/extension-v1.19.0-replay.png)

... and closed the browser.

(Also, when not doing this for illustrative purposes, in practice, the above series of actions usually takes less than a second, via keyboard shortcuts, which `Hoardy-Web` has in abundance.
Note how the tooltip on the above screenshot shows which shortcut that action is currently bound to.)

## The magic

**Then, later, I reopened my browser, restored the last session, and that tab was restored back with zero requests to the Internet.**

Now note that `Hoardy-Web` also has a button (the one with the "eject" symbol on the "Globally" line) which re-navigates all open tabs that do not yet point to replay pages --- excluding those for which `Include in global replays` per-tab setting is disabled --- to their replays.

That is, you can use `Hoardy-Web` to implement the following browser workflow:

- You re-navigate most of your tabs to their replays and allow the browser to unload them as it pleases.

- You refer back to those tabs at future times, like usual, but now, with `Hoardy-Web`, you no longer need to worry about those tabs being unloaded and later reloaded while you experience

  - intermittent Internet connection issues, like when on a plane or at sea;

  - the original website going down exactly when you want to refer back to it;

  - the page in question becoming unpublished, removed, edited, or censored;

  - all those web servers learning that you use your browser's tabs as a "To Read Later" list and you just selected that old tab to start reading.

  After all, with `Hoardy-Web`, re-loading an old replayed tab won't load anything from the Internet.

- If you feel like you have too many open tabs, you can simply bookmark and close some of them, re-open them later, and get the exact version of the page you bookmarked.

  You don't even need to use your browser's own bookmark machinery for this.
  Put those URLs into your [org-mode](https://orgmode.org/) files or some such and return to them later as you please.

- You can now quit your browser, crash your OS, let your PC loose power, and then get back all those tabs exactly as you left them off, even if the Internet is currently down.
  Simply restore your last browsing session.

**This is simply a superior way to live.**

## Well, alright, this is kinda nice, but I. Need. More! POWER!

Now, assuming you've been using `Hoardy-Web` for a while, capturing and archiving a bunch of stuff, you can now also use [`hoardy-web` command-line interface](./tool/) to query and process your archived data in various ways.
For instance:

- You can generate a static offline website mirror from (a subset of) your archives:

  ```bash
  hoardy-web mirror --to ~/hoardy-web/mirror-ao3 \
    --root-url-prefix 'https://archiveofourown.org/' \
    ~/hoardy-web/raw
  ```

  producing a bunch of interlinked `HTML`, `CSS`, images, and other files.

  - You can then share them by putting those results onto a private `HTTP` server and sharing a link.
    Or just `zip` them and share the resulting file.

  - Or, can you can sync that `~/hoardy-web/mirror-ao3` directory to your phone with `adb push`, [syncthing](https://syncthing.net/), or some such, and then read/listen them with a e-book reading app there.

    (There is a ton of website-specific alternatives to this --- like, for example, specifically `archiveofourown.org` provides `EPUB` downloads for its fiction pages, which might be more convenient in some cases --- but a combination of `hoardy-web` with `syncthing` (or some such) will work for all and any websites, and can be completely automated.)

  - Or, you can feed those files to [recoll](https://www.lesbonscomptes.com/recoll/index.html) or some such to get full-text search.

- Alternatively, you can use some [ready-made scripts distributed with `hoardy-web`](./tool/script/) to

  - view archived `HTML` documents via `pandoc` piped into `less` in [your favorite tty emulator](https://st.suckless.org/),

  - listen their contents with a TTS engine via `spd-say`,

  - open files stored inside those dumps via `xdg-open` (so, e.g., you can view images stored inside without first running `hoardy-web mirror`),

  - etc.

- Or, you can use [`hoardy-web get`](./tool/) and `run` sub-commands to make your own scripts for processing archived web pages and files in arbitrary ways.

  Or, you can use `hoardy-web find` to find paths of dumps matching a specified criteria and then parse the original [`CBOR`-formatted `WRR` files](./doc/data-on-disk.md) yourself with readily-available libraries.

- Then, suddenly, you feel a need to see the list of the last 10 domains you visited that used CloudFlare:

  ```bash
  hoardy-web stream --walk-reversed --format=raw -ue hostname \
    --response-headers-grep-re '^server: cloudflare' \
    ~/hoardy-web/raw | uniq | head -n 10
  ```

- Or, say, you just encountered a very uncooperative web app that does various tricks to prevent you from inspecting its web traffic in browser's Network Monitor (it's not hard to fingerprint you using it), but you want to inspect `JSON RPC` calls it does anyway:

  ```bash
  hoardy-web pprint -u --url-re 'https://app\.example\.org/rpc/.*' \
    --response-mime text/json \
    ~/hoardy-web/raw
  ```

The possibilities are, essentially, endless.

# <span id="pieces"/>Parts and pieces

At the moment, `Hoardy-Web` tool set consists of the following pieces, all developed simultaneously in this repository.

## [The `Hoardy-Web` WebExtensions browser add-on](./extension/)

... which can capture all `HTTP` requests and responses (and [`DOM` snapshots](./extension/page/help.org#faq-snapshot), i.e. the contents of the page after all `JavaScript` was run) your browser fetches, dump them [into `WRR` format](./doc/data-on-disk.md), and then archive those dumps

- into browser's local storage (the default),

- into files saved to your local file system (by generating fake-Downloads containing bundles of `WRR`-formatted dumps),

- to a self-hosted archiving server (like the archival+replay [`hoardy-web serve`](./tool/) or the trivial archival-only [`hoardy-web-sas`](./simple_server/) described below),

- any combination of the above.

**That is, the `Hoardy-Web` browser extension can be used independently of other tools developed here.
You can install it and start saving your browsing history immediately, and then delay learning to use the rest for later.**

Also, unless configured otherwise, the extension will dump and archive collected data immediately, to both prevent data loss and to free the used RAM as soon as possible, keeping your browsing experience snappy even on ancient hardware.

The extension can be run under

- [Firefox](https://www.mozilla.org/en-US/firefox/all/), [Tor Browser](https://www.torproject.org/download/), [LibreWolf](https://librewolf.net/installation/), and other Firefox-based browsers;

- [Fenix aka Firefox for Android](https://www.mozilla.org/en-US/firefox/browsers/mobile/android/), [Fennec](https://f-droid.org/en/packages/org.mozilla.fennec_fdroid/), [Mull](https://f-droid.org/packages/us.spotco.fennec_dos/), and other Fenix-based browsers;
- [Chromium](https://www.chromium.org/getting-involved/download-chromium/), Google Chrome, [Ungoogled Chromium](https://github.com/ungoogled-software/ungoogled-chromium), [Brave](https://brave.com/download/), and other Chromium-based browsers.

(See the [gallery](./doc/gallery.md) for screenshots).

Note, however, that while `Hoardy-Web` works under Chromium-based browsers, users of those browsers will have a worse experience, both with `Hoardy-Web` and with [its alternatives](#alternatives), because

- `Hoardy-Web` uses many of the same browser APIs as ad-blocking extensions, and Google is doing its best to make those APIs unusable;

- hence, on Chromium-based browsers, `Hoardy-Web` (and its alternatives) have to use various debugging APIs instead, which are rather flaky;

- also, Google dislikes tools like `Hoardy-Web` and [specifically forbids extensions that "enable unauthorized downloads of streaming content or media"](https://web.archive.org/web/20240604062520/https://developer.chrome.com/docs/webstore/program-policies/terms) from being hosted on [Chrome Web Store](https://chromewebstore.google.com/);

  yes, this makes absolutely no technical sense, all "streaming content" is "downloaded" before being played, you can't both "authorize" a streaming and "unauthorize" its download, but that is what Chrome Web Store's "Terms of Use" say;

  ¯\\（◉◡◔）/¯

  the latter is especially true for `Hoardy-Web` since, unlike most of [its alternatives](#alternatives), **it does not generate any requests itself, it only captures the data that a web page generates while you browse it**.

The extension does, however, try its best to collect all web traffic you browser generates.
Therefore, it can

- trivially archive web pages hidden behind CAPTCHAs, requiring special cookies, multi-factor logins, paywalls, anti-scraping/`curl`/`wget` measures, and etc (after all, the website in question only interacts with your normal web browser, not with a custom web crawler);

- archive most `HTTP`-level data, not just web pages, and not just things available via `HTTP GET` requests (e.g., it can archive answer pages of web search engines fetched via `HTTP POST`, `AJAX` data, `JSON RPC` calls, etc; though, at the moment, [it can not archive `WebSockets` data](./extension/page/help.org#bugs));

all the while

- being invisible to websites you are browsing;
- downloading everything only once, **not** once with your browser and then the second time with a separate tool like [ArchiveBox](https://github.com/ArchiveBox/ArchiveBox) (which will download everything the second time) or an extension like [SingleFile](https://github.com/gildas-lormeau/SingleFile) (which will re-download invalidated cached data when you ask it to save a page);
- freeing you from worries of forgetting to archive something because you forgot to press a button somewhere.

See the ["Quirks and Bugs" section of extension's `Help` page](./extension/page/help.org#bugs) for known issues.

Nevertheless, capture-wise, the extension appears to be *stable*.
However, the UI and additional features are being tweaked continuously at the moment.
Also, `Hoardy-Web` is tested much less on Chromium than on Firefox.

## [The `hoardy-web` tool](./tool/)

... which does a bunch of stuff, to quote from there:

> `hoardy-web` is a tool to inspect, search, organize, programmatically extract values and generate static website mirrors from, archive, view, and replay `HTTP` archives/dumps in `WRR` ("Web Request+Response", produced by the [`Hoardy-Web` Web Extension browser add-on](https://oxij.org/software/hoardy-web/tree/master/), also on [GitHub](https://github.com/Own-Data-Privateer/hoardy-web/tree/master/)) and [`mitmproxy`](https://github.com/mitmproxy/mitmproxy) (`mitmdump`) file formats.

With the `hoardy-web` tool, you can view your archived data by:

- replaying your archives over `HTTP` with `hoardy-web serve` sub-command, similar to [Wayback Machine](https://web.archive.org/), [heritrix](https://github.com/internetarchive/heritrix3), and [pywb](https://github.com/webrecorder/pywb);

- generating local offline static website mirrors with `hoardy-web mirror` sub-command, similar to `wget -mpk` (`wget --mirror --page-requisites --convert-links`);

  except `hoardy-web mirror` has a ton of cool options `wget` does not (e.g. it can `scrub` generated pages in various ways, de-duplicate the files it generates, including between different websites and different generated mirrors, etc), and should you discover you dislike the generated result for some reason, you can change some or all of those options and re-generate the mirror **without re-downloading anything**;

- using one of the [ready-made scripts](./tool/script/); or

- making you own scripts built on top of `hoardy-web`.

`hoardy-web serve` can also play a role of an advanced archiving server for the `Hoardy-Web` browser extension.
I.e., it can do archival, replay, or both at the same time.

`hoardy-web` allows you to search your archives

- directly from `hoardy-web serve` by using glob-URL links like <http://127.0.0.1:3210/web/*/https://archiveofourown.org/works/[0-9]*>, a-la Wayback Machine;
- via [`hoardy-web find` or `hoardy-web stream`](./tool/README.md#filter) sub-commands.

Also note that

- most sub-commands of `hoardy-web` tool can do full-text search via the `--*grep*` options;

  though, at the moment, it's rather slow since there is no built-in full-text indexing;

  you can, however, full-text index you data by `hoardy-web mirror`ing it first and then feeding the result to an arbitrary desktop search engine, or by using `hoardy-web get` as a filter for [recoll](https://www.lesbonscomptes.com/recoll/index.html);

- with a bit of CLI hackery, you can also make `hoardy-web stream` generate links to <http://127.0.0.1:3210/web/*/*> pages matching arbitrary criteria.

`hoardy-web` tool is deep in its *beta* stage.
At the moment, it does about 85% of the stuff I want it to do, and the things it does it does not do as well as I'd like.

See the [TODO list](./CHANGELOG.md#todo) for more info.

## [The `hoardy-web-sas` simple archiving server](./simple_server/)

... which simply dumps everything the `Hoardy-Web` extension submits to it to disk, one file per `HTTP` request+response.

This is useful in case when you can't or do not want to use the fully-featured `hoardy-web serve`.
E.g., say, you want to stick it onto a `Raspberry Pi` or something.
Or if you are feeling paranoid and want to archive data from a browser which must not have any replay capability.
Or if you want archival and replay to be done by separate processes.

The simple archiving server is *stable* (it's so simple there hardly could be any bugs there).

## [A patch for Firefox](./firefox/)

... to allow `Hoardy-Web` extension to collect request `POST` data as-is.

This is not required and even without that patch `Hoardy-Web` will collect everything in most cases, but it could be useful if you want to correctly capture `POST` requests that upload files.

See the ["Quirks and Bugs" section of extension's `Help` page](./extension/page/help.org#bugs) for more info.

# What `Hoardy-Web` is most similar to?

In essence, `Hoardy-Web` tool set allows you to setup your own personal private [Wayback Machine](https://web.archive.org/) which

- passively archives everything you see,
- including `HTTP POST` requests and responses, and most other `HTTP`-level data,
- makes uses other than the conventional browser-only reading-only workflow pretty easy.

Compared to [most of its alternatives](#alternatives), `Hoardy-Web` **DOES NOT**:

- force you to use a Chromium-based browser, which is not a small thing, since if you tried using any of the close alternatives running under Chromium-based browsers, you might have noticed that the experience there is pretty awful: the browser becomes even slower than usual, large files don't get captured, random stuff fails to be captured at random times because Chromium randomly detaches its debugger from its tabs... none of these problems exist on Firefox-based browsers;

- require you to capture, collect, and archive recorded data one page/browsing session at a time (the default behaviour is to archive everything completely automatically, though it implements optional [limbo mode](./extension/page/help.org#faq-limbo) which delays archival of collected data and provides optional manual/semi-automatic control if you want it);

- require you to download the data you want to archive twice or more (you'd be surprised how commonly other tools will either ask you to do that explicitly, or just do that silently when you ask them to save something);

- send [any of your data anywhere (unless you explicitly configure it to do so)](./extension/page/help.org#faq);
- send [any telemetry anywhere](./extension/page/help.org#faq);

- require you to store all the things in browser's local storage where they can vanish at any moment (though, saving to local storage is the default because it simplifies on-boarding, but switching to another archival method takes a couple of clicks and [re-archival of old data from browser's local storage to elsewhere is easy](./extension/page/help.org#re-archival));
- require you to run a database server;
- require you to run a web browser to view the data you've already archived.

Technically, the `Hoardy-Web` project is most similar to

- [DownloadNet](https://github.com/dosyago/dn) project, but with collection, archival, and replay all (optionally) independent from each other, with an advanced command-line interface, and not limited to Chromium;
- [mitmproxy](https://github.com/mitmproxy/mitmproxy) project, but `Hoardy-Web` leaves SSL/TLS layer alone and hooks into browser's runtime instead, and its tooling is designed primarily for web archival purposes, not traffic inspection and protocol reverse-engineering;
- [archiveweb.page](https://github.com/webrecorder/archiveweb.page) project, but following "capture and archive everything with as little user input as needed now, figure out what to do with it later" philosophy, and also not limited to Chromium;
- [pywb](https://github.com/webrecorder/pywb) project, but with collection, archival, and replay all (optionally) independent from each other, with a simpler web interface, and more advanced command-line interface.

In fact, an unpublished and now irrelevant ancestor project of `Hoardy-Web` was a tool to generate website mirrors from `mitmproxy` stream captures.
[(If you want that, `hoardy-web` tool can do that for you. It can take `mitmproxy` dumps as inputs.)](./tool/README.md#mirror)
But then I got annoyed by all the sites that don't work under `mitmproxy`, did some research into the alternatives, decided there were none I wanted to use, and so I started adding stuff to my tool until it became `Hoardy-Web`.

For more info see the [list of comparisons to alternatives](#alternatives).

# Does the author eat what he cooks?

Yes, as of December 2024, I archive all of my web traffic using `Hoardy-Web`, without any interruptions, since October 2023.
Before that my preferred tool was [mitmproxy](https://github.com/mitmproxy/mitmproxy).

After adding each new feature to the [`hoardy-web` tool](./tool/), as a rule, I feed at least the last 5 years of my web browsing into it (at the moment, most of it converted from other formats to `.wrr`, obviously) to see if everything works as expected.

# Quickstart

## Install `Hoardy-Web` browser extension/add-on

- On Firefox, Tor Browser, LibreWolf, Fenix aka Firefox for Android, Fennec, Mull, etc:

  - [![](https://oxij.org/asset/img/software/amo/get-the-addon-small.png) Install the extension from addons.mozilla.org](https://addons.mozilla.org/en-US/firefox/addon/hoardy-web/).

  - Alternatively, see [Installing on Firefox-based browser](./extension/README.md#install-firefox).

- On Chromium, Google Chrome, Ungoogled Chromium, Brave, etc:

  - See [Installing on Chromium-based browser](./extension/README.md#install-chromium).

  This requires a bit more work than clicking `Install` button on [Chrome Web Store](https://chromewebstore.google.com/) because Google does not want you to run extensions like `Hoardy-Web` and [forbids them from being hosted there (see the "enables the unauthorized download of streaming content or media" clause)](https://web.archive.org/web/20240604062520/https://developer.chrome.com/docs/webstore/program-policies/terms).

  Quite understandable, after all `Hoardy-Web` does make it very hard to continue deluding yourself that "streaming content" and "downloaded content" are not exactly the same thing.

- Alternatively, [build it from source](./extension/README.md#build).

## ... check it actually works

Now load any web page --- [except for browser's extension store pages (like `addons.mozilla.org`, `chromewebstore.google.com`, etc), as browsers disallow extensions from accessing these](./extension/page/help.org#store-pages)) --- in your browser.

The extension will report if everything works okay, or tell you where the problem is if something is broken.

## ... and, if all you want is archival, you are done

Assuming the extension reported success: **Congratulations\!**
You are now collecting and archiving all your web browsing traffic originating from that browser.
Repeat extension installation for all browsers/browser profiles as needed.

**If you just want to collect and archive everything and don't have time to figure out how to use the rest of this suite of tools right this moment, you can stop here.**

**Except, if you use your browser to login into things, be sure to see ["Setup recommendations"](#setup) below.
If you let it, `Hoardy-Web` will happily capture and archive all your login credentials, in plain text.
So, in this case you should learn to use it properly as soon as possible.**

It took me about 6 months before I had to refer back to previously archived data for the first time when I started using [mitmproxy](https://github.com/mitmproxy/mitmproxy) to sporadically collect my `HTTP` traffic in 2017.
So, I recommend you start collecting immediately and be lazy about the rest.

(Also, I learned a lot about nefarious things some of the websites I visit do in background by inspecting the logs `Hoardy-Web` produces.
You'd be surprised how many big websites generate `HTTP` requests with evil tracking data at the moment you close the containing tab.
They do this because such requests can't be captured and inspected with browser's own Network Monitor, so most people are completely unaware.)

## Switch to using an archiving server

In practice, though, your will probably want to [install the `hoardy-web` tool and run `hoardy-web serve` archiving server](./tool/README.md#quickstart), then, [switch `Hoardy-Web` to `Submit dumps via 'HTTP'` mode](https://oxij.org/asset/demo/software/hoardy-web/extension-v1.19.0-pr.png), and then enjoy safe persistent archival with replay and search, like on the screenshots above.

Or, alternatively, you might want to use the [`hoardy-web-sas` simple archiving server](./simple_server/) instead.

Technically speaking, archiving methods other than `Submit dumps via 'HTTP'` [are all unsafe, since you can lose some or all of your archived data if your disk ever gets out of space, or if you accidentally uninstall the `Hoardy-Web` extension, or mis-click a button in your browser's UI](./extension/page/help.org#faq-unsafe).

## ... or, if you are unable or unwilling to do that

Alternatively, you can use the combination of archiving by saving of data to browser's local storage (the default) followed by [semi-manual export into `WRR` bundles](./extension/page/help.org#re-archival).

Or, alternatively, you can switch to `Export dumps via 'saveAs'` mode by default and simply accept the resulting slightly more annoying UI ([on Firefox, it can be fixed with a small `about:config` change](./extension/page/help.org#faq-firefox-saveas)) and [slight unsafety](./extension/page/help.org#faq-unsafe).

Which is most useful when using `Hoardy-Web` under Tor Browser or similar.

# Alternatively, on a system with [Nix package manager](https://nixos.org/nix/)

- Install everything by running

  ```bash
  nix-env -i -f ./default.nix
  ```

- Test the results work:

  ```bash
  hoardy-web --help
  hoardy-web-sas --help
  ```

- Also, instead of installing the add-on from `addons.mozilla.org` or from Releases on GitHub you can take freshly built XPI and Chromium ZIPs from

  ```bash
  ls ~/.nix-profile/Hoardy-Web*
  ```

  instead.
  See the [extension's README](./extension/#build) for more info on how to install them manually.

# <span id="setup"/>Setup recommendations

- It's highly recommended to make a new browser profile specifically for archived anonymous browsing.

  - Run Firefox as `firefox -no-remote -ProfileManager` to get to the appropriate UI.
    On Windows you can just edit your desktop or toolbar shortcut to target

    ``` cmd
    "C:\Program Files\Mozilla Firefox\firefox.exe" -no-remote -ProfileManager
    ```

    or similar by default to switch between profiles on browser startup.

  - Or just use different browsers for this, e.g. LibreWolf for anonymous browsing, Firefox for logged-in.

  - Then, set the "anonymous" browser profile to always run in `Private Browsing` mode to prevent login persistence there.

  - Then, in `Hoardy-Web`, either

    - set different extension instances to use different default `Bucket` values;

    - or, alternatively, in a more paranoid setup, point them to separate archiving server instances dumping data to different directories on disk.

  If you do accidentally login in "anonymous" profile, move those dumps out of the "anonymous" directory immediately.

  This way, in the future, you can easily share dumps from the "anonymous" instance without worrying about leaking your private data or login credentials.

- In a logged-in browser/profile you should either

  - train yourself to perform logins in separate tabs with capture disabled, or

  - disable capture by default and only enable it in tabs you never login in, or

  - (which, in author's humble opinion, is both most convenient and sufficiently paranoid)
    enable "limbo" mode by default, disable `Stash 'collected' reqres into local storage`,
    and then train yourself to perform logins in separate tabs (which is rather simple in this case: simply middle-click all "Login" links), the collected data of which you then discard.

  This way, no login credentials will ever get accidentally saved by `Hoardy-Web`.

- You can add `hoardy-web serve`/`hoardy-web-sas` to Autorun or start it from your `~/.xsession`, `systemd --user`, etc.

# Recommended next steps

After you've installed all the parts you want to use, you should read:

- The [`Hoardy-Web` extension's `Help` page](./extension/page/help.org) for a long detailed description of what the extension does step-by-step.

  It is a must-read, though instead of reading that file raw I highly recommend you read it by pressing the `Help` button in extension's UI, since doing that will make the whole thing pretty interactive, see the [screenshot gallery](./doc/gallery.md) for screenshots of how this will look.

  In there, especially see:

  - the ["Frequently Asked Questions" section](./extension/page/help.org#faq) for the answers to the frequently asked questions, including those about common quirks you can encounter while using it; and

  - the ["Quirks and Bugs" section](./extension/page/help.org#bugs) for more info on quirks and limitations of `Hoardy-Web` when used on different browsers.

- The [`hoardy-web`'s `README`](./tool/README.md) and/or the [`hoardy-web-sas`'s `README`](./simple_server/README.md).

  The [former](./tool/README.md) of which has a bunch of advanced usage examples.

  Also, you might want to see [`hoardy-web`'s example scripts](./tool/script/).

Then, to follow the development:

- See the ["Changelog" page](./CHANGELOG.md) for the progress log and human-readable description of recent changes (which is much shorter and more comprehensible than the commit log).

  You can simply bookmark that URL and return to it periodically to follow new releases.

  Alternatively, you can also read that page from extension's UI by pressing the button labeled with extension's version, but that version gets bundled with the extension, so it might be outdated sometimes.

- See the [TODO list](./CHANGELOG.md#todo) for the list of things that are not implemented/ready yet.

If you are a developer yourself:

- See the ["Development" section of extension's `README.md`](./extension/README.md#development) for building from source and debugging instructions.

- See all the `hoardy-web`'s-related links above, and also see the description of the [on-disk file format used by all these tools](./doc/data-on-disk.md).

Finally, if your questions are still unanswered, then [open an issue on GitHub](https://github.com/Own-Data-Privateer/hoardy-web/issues) or [get in touch otherwise](https://oxij.org/#contact).

# <span id="why"/>Why does `Hoardy-Web` exists?

So, you wake up remembering something interesting you saw a long time ago.
Knowing you won't find it in your normal browsing history, which only contains the URLs and the titles of the pages you visited in the last 3 months, you try looking it up on Google.
You fail.
Eventually, you remember the website you seen it at, or maybe you re-discovered the link in question in an old message to/from a friend, or maybe a tool like [recoll](https://www.lesbonscomptes.com/recoll/index.html) or [Promnesia](https://github.com/karlicoss/promnesia) helped you.
You open the link… and discover it offline/gone/a parked domain.
Not a problem\! Have no fear\!
You go to [Wayback Machine](https://web.archive.org/) and look it up there… and discover they only archived an ancient version of it and the thing you wanted is missing there.

Or, say, you read a cool fanfiction on [AO3](https://archiveofourown.org/) years ago, you even wrote down the URL, you go back to it wanting to experience it again… and discover the author made it private... and Wayback Machine saved only the very first chapter.

Or, say, there is a web page that can not be easily reached via `curl`/`wget` (because it is behind a paywall or complex authentication method that is hard to reproduce outside of a browser) but for accessibility or just simple reading comfort reasons each time you visit that page you want to automatically feed its source to a script that strips and/or modifies its `HTML` markup in a website-specific way and feeds it into a TTS engine, a Braille display, or a book reader app.

With most modern web browsers you can do TTS either out-of-the-box or by installing an add-on (though, be aware of privacy issues when using most of these), but tools that can do website-specific accessibility without also being website-specific UI apps are very few.

Or, say, there's a web page/app you use (like a banking app), but it lacks some features you want, and in your browser's Network Monitor you can see it uses `JSON RPC` or some such to fetch its data, and you want those `JSON`s for yourself (e.g., to compute statistics and supplement the app output with them), but the app in question has no public API and scraping it with a script is non-trivial (e.g., the site does complicated `JavaScript`+multifactor-based auth, tries to detect you are actually using a browser, and bans you immediately if not).

Or, maybe, you want to parse those behind-auth pages with a script, save the results to a database, and then do interesting things with them (e.g., track price changes, manually classify, annotate, and merge pages representing the same product by different sellers, do complex queries, like sorting by price/unit or price/weight, limit results by geographical locations extracted from text labels, etc).

Or, say, you want to fetch a bunch of pages belonging to two recommendation lists on AO3 or [GoodReads](https://www.goodreads.com/), get all outgoing links for each fetched page, union sets for the pages belonging to the same recommendation list, and then intersect the results of the two lists to get a shorter list of things you might want to read with higher probability.

Or, more generally, say, you want to tag web pages referenced from a certain set of other web pages with some tag in your indexing software, and update it automatically each time you visit any of the source pages.

Or, say, you want to combine a full-text indexing engine, your browsing and derived web link graph data, your states/ratings/notes from [org-mode](https://orgmode.org/), messages from your friends, and other archives, so that you could do arbitrarily complex queries over it all, like "show me all GoodReads pages for all books not marked as `DONE` or `CANCELED` in my `org-mode` files, ever mentioned by any of my friends, ordered by undirected-graph [Pagerank](https://en.wikipedia.org/wiki/Pagerank) algorithm biased with my own book ratings (so that books sharing GoodReads lists with the books I finished and liked will get higher scores)".
So, basically, you want a private personalized Bayesian recommendation system.

"If it is on the Internet, it is on Internet forever\!" they said.
"Everything will have a RESTful API\!" they said.
"Semantic Web will allow arbitrarily complex queries spanning multiple data sources\!" they said.
**They lied\!**

Things vanish from the Internet, and from [Wayback Machine](https://web.archive.org/), all the time.

A lot of useful stuff never got RESTful APIs, those RESTful APIs that exists are frequently buggy, you'll probably have to scrape data from `HTML`s anyway.

As to the RDF, well, 25 years later ("RDF Model and Syntax Specification" was published in 1999), almost no progress there, the most commonly used subset of RDF does what indexing systems in 1970s did, but less efficiently and with a worse UI.

Meanwhile, `Hoardy-Web` provides tools to help with all of the above.

# <span id="philosophy"/>Technical Philosophy

`Hoardy-Web` is designed to

- be simple (as in adhering to the Keep It Stupid Simple principle),
- be efficient (as in running well on ancient hardware),
- capture data from the browser as raw as possible (i.e., not try to fix any web browser quirks before archival, just capture everything as-is),
- ensure that all captured and collected data gets actually archived to disk,
- treat the resulting archives as read-only files,
- view, convert to other formats, extract useful values, and perform any expensive computations lazily and on-demand,
- make it easy to use tools other than a web browser to do interesting things with your archived data.

To conform to the above design principles

- the [`Hoardy-Web` Web Extension browser add-on](./extension/) does almost no actual work, simply generating `HTTP` request+response dumps, archiving them, and then freeing the memory as soon as possible (unless you enable [limbo mode](./extension/page/help.org#faq-limbo), but then you asked for it), thus keeping your browsing experience snappy even on ancient hardware;

- also the `Hoardy-Web` extension collects data as browser gives it, without any data normalization and conversion, when possible;

- the dumps are generated using the [simplest, trivially parsable with many third-party libraries, yet most space-efficient on-disk file format representing separate `HTTP` requests+responses there currently is (aka `Web Request+Response`, `WRR`)](./doc/data-on-disk.md), which is a file format that is [both more general and more simple than `WARC`, much simpler than that `mitmproxy` uses, and much more efficient than `HAR`](./tool/README.md#glossary);

- the `Hoardy-Web` extension can write the dumps it produces to disk by itself by generating fake-Dowloads containing bundles of `WRR` dumps, but because of limitations of browser APIs, `Hoardy-Web` can't tell if a file generated this way succeeds at being written to disk;

- which is why, for users who want write guarantees and error reporting, the extension has other archival methods, which includes archival by submission via `HTTP`;

  server-side part of submission via `HTTP` can be done either

  - via the [`hoardy-web-sas` simple archiving server](./simple_server/), which is tiny (less than 300 lines of code) pure-Python script that provides an `HTTP` interface for archival of dumps given via `HTTP POST` requests;

  - or via the [`hoardy-web serve`](./tool/), which is not tiny at all, but it can combine both archival and replay;

- all of the `Hoardy-Web` extension, `hoardy-web-sas`, and `hoardy-web serve` write those dumps to disk as-is, with optional compression for data storage efficiency;

- meanwhile, viewing/replay of, generation of website mirrors from, organization and management, data normalization (massaging), post-processing, other ways of extraction of useful values from archived `WRR` files --- i.e. basically everything that is complex and/or computationally expensive --- is delegated to [`hoardy-web` tool](./tool/);

- the `hoardy-web` tool is [very easy to use in your own scripts](./tool/script/);

- by default, none these tools ever overwrite any files on disk (to prevent accidental data loss);

  this way, if something breaks, you can always trivially return to a known-good state by simply copying some old files from a backup as there's no need to track versions or anything like that.

# <span id="alternatives"/>Alternatives

Sorted by similarity to `Hoardy-Web`, most similar projects first.
"Cons" and "Pros" are in comparison to the main workflow of `Hoardy-Web`.

## [DownloadNet](https://github.com/dosyago/dn)

A self-hosted web crawler and web replay system written in `Node.js`.

Of all the tools known to me, `DownloadNet` is most similar to the intended workflow of the `Hoardy-Web`.
Similarly to the combination of [`Hoardy-Web` extension](./extension/) and [`hoardy-web serve`](./tool/) and unlike `pywb`, `heritrix`, and other similar tools discussed below, `DownloadNet` captures web data directly from browser's runtime.
The difference is that `Hoardy-Web` does this using [`webRequest` `WebExtensions` API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest) and Chromium's `debugger` API while `DownloadNet` is actually a web crawler that crawls the web by spawning a Chromium browser instance and attaching to it via its debug protocol (which are not the same thing).
This is a bit weird, but it does work, and it allows you to use `DownloadNet` to archive everything passively as you browse, similarly to `Hoardy-Web`, since you can just browse in that debugged Chromium window and it will archive the data it fetches.

Pros:

- it's very similar to what `Hoardy-Web` aims to do, except

Cons:

- it's Chromium-only;
- it uses a custom archive format but gives no tools to inspect or manage those archives;
- you are expected to do everything from the web UI.

Same issues:

- When running under Chromium, a [bunch of Chromium's bugs](./extension/page/help.org#chromium-bugs) make many things [pretty annoying](./extension/page/help.org#faq-debugger) and somewhat flaky.

  Those issues have no workarounds known to me except for "switch to Firefox-based browser", which you can do with `Hoardy-Web`.

## [mitmproxy](https://github.com/mitmproxy/mitmproxy)

A Man-in-the-middle SSL proxy.

`Hoardy-Web` was heavily inspired by `mitmproxy` and, essentially, aims to be to an in-browser alternative to it.
I.e., unlike other alternatives discussed here, both `Hoardy-Web` and `mitmproxy` capture mostly-raw `HTTP` traffic, not just web pages.
Unlike `mitmproxy`, however, `Hoardy-Web` is designed primarily for web archival purposes, not traffic inspection and protocol reverse-engineering, even though you can do some of that with `Hoardy-Web` too.

Pros:

- after you set it up, it will capture **absolutely everything completely automatically**;
- including WebSockets data, which `Hoardy-Web` add-on currently does not capture.

Cons:

- it is rather painful to setup, requiring you to install a custom SSL root certificate; and
- websites using certificate pinning will stop working; and
- some websites detect when you use it and fingerprint you for it or force you to solve CAPTCHAs; and
- `mitmproxy` dump files are flat streams of `HTTP` requests and responses that use custom frequently changing between versions data format, so you'll have to re-parse them repeatedly using `mitmproxy`'s own parsers to get to the requests you want;
- and then you'll still need some more tools to use those archives for Wayback Machine-like replay and generation of website mirrors.

Though, the latter issue can be solved via [this project's `hoardy-web` tool](./tool/) as it can take `mitmproxy` dumps as inputs.

## But you could just enable request logging in your browser's Network Monitor and manually save your data as `HAR` archives from time to time

Cons:

- to do what `Hoardy-Web` does, you will have to manually enable it for each browser tab;
- opening a link in a new tab will fail to archive the first page as you will not have Network Monitor open there yet; and then
- you will have to check all your tabs for new data all the time and do \~5 clicks per tab to save it; and then
- [`HAR`](./tool/README.md#glossary)s are `JSON`, meaning all that binary data gets encoded indirectly, thus making resulting `HAR` archives very inefficient for long-term storage, as they take a lot of disk space, even when compressed;
- and then you'll still need something like this suite to inspect the generated archives;
- and then you'll still need some more tools to use those archives for Wayback Machine-like replay and generation of website mirrors.

Though, the latter issue can be solved via [this project's `hoardy-web` tool](./tool/) as it can take `HAR` dumps as inputs.

## But you could setup SSL keys dumping then use `Wireshark`, or `tcpdump`, or some such, to capture your web traffic

Pros:

- after you set it up, it will capture **absolutely everything completely automatically**;
- it captures WebSockets data, which `Hoardy-Web` add-on currently does not.

Cons:

- it is really painful to setup; and then
- you are very likely to screw it up, loose/mismatch encryption keys, and make your captured data unusable; and even if you don't,
- it takes a lot of effort to recover `HTTP` data from the [`PCAP`](./tool/README.md#glossary) dumps; and
- `PCAP` dumps are IP packet-level, thus also inefficient for this use case; and
- `PCAP` dumps of SSL traffic can not be compressed much, thus storing the raw captures will take a lot of disk space.
- and then you'll still need something like this suite to inspect the generated archives;
- and then you'll still need some more tools to use those archives for Wayback Machine-like replay and generation of website mirrors.

And `hoardy-web` tool can't help you with the latter, at the moment.

## [archiveweb.page](https://github.com/webrecorder/archiveweb.page) and [replayweb.page](https://github.com/webrecorder/replayweb.page)

Browser extensions similar to the [`Hoardy-Web` extension](./extension/) in their implementation, though not in their philosophy and intended use.

Overall, `Hoardy-Web` and `archiveweb.page` extensions have a similar vibe, but the main difference is that `archiveweb.page` and related tools are designed for capturing web pages with the explicit aim to share the resulting archives with the public, while `Hoardy-Web` is designed for private capture of personally visited pages first.

In practical terms, `archiveweb.page` has a "Record" button, which you need to press to start recording a browsing session in a separate tab into a separate [`WARC`](./tool/README.md#glossary) file.
In contrast, `Hoardy-Web`, by default, in background, captures and archives all successful `HTTP` requests and their responses from all your open browser tabs.

Pros:

- they produce and consume archives in `WARC` format, which is a de-facto standard;
- their replay is more mature than what `Hoardy-Web` currently has.

Cons:

- they produce and consume archives in `WARC` format, which is rather limited in what it can capture (compared to `WRR`, `HAR`, `PCAP`, and `mitmproxy`);
- they are Chromium-only;
- to make `archiveweb.page` archive all of your web browsing like `Hoardy-Web` does:
  - you will have to manually enable `archiveweb.page` for each browser tab; and then
  - opening a link in a new tab will fail to archive the first page, as the archival is per-tab;
- it has no equivalent to [`problematic`](./extension/page/help.org#problematic) reqres status of `Hoardy-Web`, which is super useful for ensuring your captures are actually good, and not broken in some non-obvious ways because of networking or intermittent server errors;
- `archiveweb.page` also requires constant manual effort to export the data out.

Differences in design:

- `archiveweb.page` captures whole browsing sessions, while `Hoardy-Web` captures separate `HTTP` requests and responses;
- `archiveweb.page` implements ["Autopilot"](https://archiveweb.page/en/features/autopilot/), which [`Hoardy-Web` will never get](./extension/page/help.org#faq-lazy) (if you want that, `Hoardy-Web` expects you to use UserScripts instead).

Same issues:

- Both `Hoardy-Web` and `archiveweb.page` store captured data internally in the browser's local storage/IndexedDB by default.

  This is both convenient for on-boarding new users and helps in preserving the captured data when your computer looses power unexpectedly, your browser crashes, you quit from it before everything gets archived, or the extension crashes or gets reloaded unexpectedly.

  On the other hand, this is both inefficient and dangerous for long-term preservation of said data, since [it is very easy to accidentally loose data archived to browser's local storage (e.g., by uninstalling the extension)](./extension/page/help.org#faq-unsafe).

  Which is why [`Hoardy-Web`](./extension/) has `Submit dumps via 'HTTP'` mode which will automatically submit your dumps to an [archiving server](#pieces) instead.

- When running under Chromium, a [bunch of Chromium's bugs](./extension/page/help.org#chromium-bugs) make many things [pretty annoying](./extension/page/help.org#faq-debugger) and flaky,
  which --- if you know what to look for --- you can notice straight in the advertisement animation on their ["Usage" page](https://archiveweb.page/en/usage/).

  Those issues have no workarounds known to me except for "switch to Firefox-based browser", which you can do with `Hoardy-Web`.

## [SingleFile](https://github.com/gildas-lormeau/SingleFile) and [WebScrapBook](https://github.com/danny0838/webscrapbook)

Browser add-ons that capture whole web pages by taking their `DOM` snapshots and saving all requisite resources the captured page references.

Capturing a page with `SingleFile` generates a single (usually, quite large) `HTML` file with all the resources embedded into it.
`WebScrapBook` saves its captures to browser's local storage or to a remote server instead.

Pros:

- very simple to use;
- they implement annotations, which `Hoardy-Web` currently does not.

Cons:

- to make them archive all of your web browsing like `Hoardy-Web` does, you will have to manually capture each page you want to save;
- they only captures web pages, you won't be able to save `POST` request data or JSONs fetched by web apps;
- since they do not track and save `HTTP` requests and responses, capturing a page will make the browser re-download non-cached page resources a second time;
- the resulting archives take a lot of disk space, since they duplicate requisite resources (images, media, `CSS`, fonts, etc) for each web page to make each saved page self-contained.

Differences in design:

- they capture `DOM` snapshots, while `Hoardy-Web` captures `HTTP` requests and responses (though, it can capture `DOM` snapshots too).

## [WorldBrain Memex](https://github.com/WorldBrain/Memex)

A browser extension that implements an alternative mechanism to browser bookmarks.
Saving a web page into Memex saves a `DOM` snapshot of the tab in question into an in-browser database.
Memex then implements full-text search engine for saved snapshots and `PDF`s.

Pros:

- pretty, both in UI and in documentation;
- it implements annotations, which `Hoardy-Web` currently does not;
- it has a builtin full-text search engine with indexing;
  meanwhile, at the moment, `Hoardy-Web` only has the non-indexed [`hoardy-web * --*grep*` options](./tool/);
  though, you can use [recoll](https://www.lesbonscomptes.com/recoll/index.html) with `hoardy-web` as an input filter;
- lots of other features.

Cons:

- to make it archive all of your web browsing like `Hoardy-Web` does, you will have to manually save each page you visit;
- it only captures web pages and `PDFs`, you won't be able to save `POST` request data or JSONs fetched by web apps;
- compared to `Hoardy-Web`, it is very fat --- it's `.xpi` is more than 40 times larger;
- it takes about 7 times more RAM to do comparable things (measured via `about:performance`);
- it is slow enough to be hard to use on an older or a very busy system;
- it injects content scripts to every page you visit, making your whole browsing experience much less snappy;
- it performs a lot of `HTTP` requests to third-party services in background (`Hoardy-Web` does **none** of that);
- you are expected to do everything from the web UI;
- the resulting archives take a lot of disk space.

Differences in design:

- it captures `DOM` snapshots and `PDF`s, while `Hoardy-Web` captures `HTTP` requests and responses (though, it can capture `DOM` snapshots too);
- it has a builtin synchronization between instances, while `Hoardy-Web` expects you to use normal file backup tools for that.

## [pywb](https://github.com/webrecorder/pywb)

A web archive replay system with a builtin web crawler and `HTTP` proxy.
Brought to you by the people behind the [Wayback Machine](https://web.archive.org/) and then adopted by the people behind `archiveweb.page`.

A tool similar to [`hoardy-web serve`](./tool/).

Pros:

- it produces and consumes archives in [`WARC`](./tool/README.md#glossary) format, which is a de-facto standard;
- its replay capabilities are more mature than what `hoardy-web serve` currently has;
- it can update its configuration without a restart and re-index of given inputs.

Cons:

- it produces and consumes archives in `WARC` format, which is rather limited in what it can capture (compared to `WRR`, `HAR`, `PCAP`, and `mitmproxy`);
- it has no equivalents to most other sub-commands of `hoardy-web` tool;

- compared to `hoardy-web serve`, it's much more complex, it has a builtin web crawler (aka "`pywb` Recorder", which does not work for uncooperative websites anyway), and can also do capture by trying to be an `HTTP` proxy (which also does not work for many websites);

  I assume it has all these features because `archiveweb.page` is Chromium-only, which forces it to be rather unreliable (see a [list of relevant Chromium's bugs](./extension/page/help.org#chromium-bugs)) and annoying to use when you want to be sure the whole page was captured properly (since it has no equivalent to [`problematic`](./extension/page/help.org#problematic) reqres status of `Hoardy-Web`).

  Meanwhile, `Hoardy-Web` has `problematic` reqres tracking and the extension works perfectly well under Firefox-based browsers, which allow for much more reliable captures.

- since `hoardy-web serve` uses a much simpler and faster to parse `WRR` file format, it is able to add new dumps to its index synchronously with their archival, allowing for their immediate replay.

## [heritrix](https://github.com/internetarchive/heritrix3)

The crawler behind the [Wayback Machine](https://web.archive.org/).
It's a self-hosted web app into which you can feed the URLs for them to be archived, so to make it archive all of your web browsing:

A tool similar to [`hoardy-web serve`](./tool/).

Pros:

- it produces and consumes archives in [`WARC`](./tool/README.md#glossary) format, which is a de-facto standard;
- stable, well-tested, and well-supported.

Cons:

- it produces and consumes archives in `WARC` format, which is rather limited in what it can capture (compared to `WRR`, `HAR`, `PCAP`, and `mitmproxy`);
- it has no equivalents to most other sub-commands of `hoardy-web` tool;
- you have to run it, and it's a rather heavy Java app;
- to make it archive all of your web browsing like `Hoardy-Web` does, you'll need to write a separate browser plugin to redirect all links you click to your local instance's `/save/` `REST` API URLs (which is not hard, but I'm unaware if any such add-on exists);
- and you won't be able to archive your `HTTP` `POST` requests with it;
- as with other similar tools, an `HTTP` server of a web page that is being archived can tell it is being crawled.

## [ArchiveBox](https://github.com/ArchiveBox/ArchiveBox)

A web crawler and self-hosted web app into which you can feed the URLs for them to be archived.

Pros:

- it produces and consumes archives in [`WARC`](./tool/README.md#glossary) format, which is a de-facto standard;
- it has a very nice web UI;
- it it's an all-in-one archiving solution, also archiving YouTube videos with [yt-dlp](https://github.com/yt-dlp/yt-dlp), `git` repos, etc;
- stable, well-tested, and well-supported.

Cons:

- it produces and consumes archives in `WARC` format, which is rather limited in what it can capture (compared to `WRR`, `HAR`, `PCAP`, and `mitmproxy`);
- to make it archive all of your web browsing like `Hoardy-Web` does,
  - [it requires you](https://github.com/ArchiveBox/ArchiveBox/issues/577) to setup `mitmproxy` with [archivebox-proxy](https://codeberg.org/brunoschroeder/archivebox-proxy) plugin;
  - alternatively, you can run [archivefox](https://github.com/layderv/archivefox) add-on and explicitly archive pages one-by-one via a button there;
- in both cases, to archive a URL, ArchiveBox will have to download it by itself in parallel with your browser, thus making you download everything twice, which is hacky and inefficient; and
- websites can easily see, fingerprint, and then ban you for doing that;
- and you won't be able to archive your `HTTP POST` requests with it.

Still, probably the best of the self-hosted web-app-server kind of tools for this ATM.

## [reminiscence](https://github.com/kanishka-linux/reminiscence)

A system similar to `ArchiveBox`, but has a bulit-in tagging system and archives pages as raw `HTML` + whole-page `PNG` rendering/screenshot --- which is a bit weird, but it has the advantage of not needing any replay machinery at all for re-viewing simple web pages, you only need a plain simple image viewer, though it will take a lot of disk space to store those huge whole-page "screenshot" images.

Pros and Cons are almost identical to those of `ArchiveBox` above, except it has less third-party tools around it so less stuff can be automated easily.

## `wget -mpk` and `curl`

Pros:

- both are probably already installed on your POSIX-compliant OS,
- `wget` can produce archives in [`WARC`](./tool/README.md#glossary) format, which is a de-facto standard.

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
- it produces archives in [`WARC`](./tool/README.md#glossary) format, which is a de-facto standard and has a lot of tooling around it;
- stable, well-tested, and well-supported.

Cons:

- to do what `Hoardy-Web` does, you will have to manually capture each page you want to save;
- you won't be able to archive your `HTTP POST` requests with it;
- does not have replay capabilities, just generates `WARC` files.

## [grab-site](https://github.com/ArchiveTeam/grab-site)

A simple web crawler built on top of `wpull`, presented to you by the ArchiveTeam, a group associated with the [Wayback Machine](https://web.archive.org/) which appears to be the source of archives for the most of the interesting pages I find there.

Pros:

- it produces archives in `WARC` format, which is a de-facto standard and has a lot of tooling around it;
- stable, well-tested, and well-supported.

Cons:

- to do what `Hoardy-Web` does, you will have to manually capture each page you want to save;
- it can't really archive dynamic websites;
- you won't be able to archive your `HTTP POST` requests with it;
- it does not have replay capabilities, just generates [`WARC`](./tool/README.md#glossary) files.

## [monolith](https://github.com/Y2Z/monolith) and [obelisk](https://github.com/go-shiori/obelisk)

Stand-alone tools doing the same thing SingleFile add-on does: generate single-file `HTML`s with bundled resources viewable directly in the browser.

Pros:

- simple to use.

Cons:

- to make them archive all of your web browsing like `Hoardy-Web` does, you will have to manually capture each page you want to save;
- they can't really archive dynamic websites;
- you won't be able to archive your `HTTP POST` requests using them;
- changing archival options will force you to re-download everything again.

## [single-file-cli](https://github.com/gildas-lormeau/single-file-cli)

Stand-alone tool based on `SingleFile`, using a headless browser to capture pages.

A more robust solution to do what `monolith` and `obelisk` do, if you don't mind `Node.js` and the need to run a headless browser.

## [Archivy](https://github.com/archivy/archivy)

A self-hosted wiki that archives pages you link to in background.

## Others

ArchiveBox wiki [has a long list](https://github.com/ArchiveBox/ArchiveBox/wiki/Web-Archiving-Community) or related things.

# <span id="also"/>If you like this, you might also like

## [yt-dlp](https://github.com/yt-dlp/yt-dlp)

Essentially, a maintained fork of `youtube-dl`, with a bunch of cool features that are not in `youtube-dl`.

## [hydrus](https://github.com/hydrusnetwork/hydrus)

Which is a desktop (QT) app which does Danbooru-like image tagging and search.
It also has optional tag data sharing and downloader/scraper for various image boorus.

It's pretty cool, but rather memory hungry and slow.

## [syncthing](https://syncthing.net/)

A very nice file synchronization system, quite useful for backing up your `WRR` files, or anything else.

## [Perkeep](https://perkeep.org/)

It's an awesome personal private archival system adhering to the same [philosophy](#philosophy) as `Hoardy-Web`, but it's basically an abstraction replacing your file system with a content-addressed store that can be rendered into different "views", including a POSIXy file system.

It can do very little in helping you actually archive a web page, but you can start dumping new `Hoardy-Web` `.wrr` files with compression disabled, decompress you existing `.wrr` files, and then feed them all into Perkeep to be stored and automatically replicated to your backup copies forever.
(Perkeep already has a better compression than what `Hoardy-Web` currently does and provides a FUSE FS interface for transparent operation, so compressing things twice would be rather counterproductive.)

# Meta

## Changelog?

See [`CHANGELOG.md`](./CHANGELOG.md).

## TODO?

See the [bottom of `CHANGELOG.md`](./CHANGELOG.md#todo).

## License

[GPLv3](./LICENSE.txt)+, some small library parts are MIT.

## Contributing

Contributions are accepted both via GitHub issues and PRs, and via pure email.
In the latter case I expect to see patches formatted with `git-format-patch`.

If you want to perform a major change and you want it to be accepted upstream here, you should probably write me an email or open an issue on GitHub first.
In the cover letter, describe what you want to change and why.
I might also have a bunch of code doing most of what you want in my stash of unpublished patches already.
