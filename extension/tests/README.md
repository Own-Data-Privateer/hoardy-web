# Popup layout regression tests

Build the Firefox template using the existing toolchain:

```sh
git submodule update --init vendor/pako
cd extension
./build.sh firefox-mv2
cd ..
```

Install Playwright in your test environment, then run:

```sh
node --test extension/tests/popup-layout.cjs
BROWSER=firefox node --test extension/tests/popup-layout.cjs
```

Environment variables:

- `PLAYWRIGHT_MODULE`: optional absolute path to an existing Playwright installation.
- `CHROMIUM_PATH`: optional Chromium executable.
- `SCREENSHOT_DIR`: optional screenshot output directory.

The tests render the built template with the real UI-generation helpers. They exercise growing counters, long scheduler labels, reload controls, attention highlights, sparse/dense layouts, narrow viewports, and full settings tabs. They check that live updates preserve row geometry and that the toolbar viewport remains scrollable when screen space is limited.

These are page-layout tests using synthetic counters. Before release, manually check the actual browser-action popup in Firefox and Chromium, keyboard navigation, high zoom, light/dark themes, emoji/plain-text labels, help links, and the embedded popup on the Help page. The tests do not install an extension or touch an existing browser profile.
