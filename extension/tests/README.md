# Archival regression tests

From the repository root, with Node.js 22 or newer:

```sh
node --test extension/tests/archival.test.cjs extension/tests/idbp.test.cjs
```

The 15 tests execute actual extension sources. Browser storage and HTTP boundaries are mocked. They cover bounded submission, payload budgets, oversized records, serial opt-out, mixed archival methods, acknowledgements before deletion, failure recovery, pauses, endpoint changes, scheduler priority, metadata bookkeeping, IndexedDB abort handling. One test exercises 32 deterministic combinations of request timing, HTTP errors, connection failures, metadata-write failures, removal failures.

## Real Firefox storage and crash tests

`browser-safety.cjs` generates a disposable Firefox extension using the persistence helpers from this checkout. It runs against real `browser.storage.local` and IndexedDB. Captures are synthetic 32-byte payloads; a separate localhost HTTP server validates their contents, writes them to a temporary directory, calls `fsync` on the files, acknowledges them.

Install `web-ext` in a separate tooling directory. On Linux:

```sh
WEB_EXT_MODULE=/absolute/path/to/web-ext/bin/web-ext.js \
FIREFOX_PATH=/absolute/path/to/firefox \
RESULT_FILE=/tmp/hoardy-safety-results.json \
node extension/tests/browser-safety.cjs
```

The runner creates its own temporary profile. It kills only its own process group for crash tests, restarts Firefox with that profile, reinstalls the same temporary test extension, checks retained records through the real storage traversal helper. It never installs Hoardy-Web or accesses an existing browser profile.

Fourteen cases cover:

- Successful uploads using each storage backend.
- HTTP errors using each backend.
- Injected local-storage metadata-write and removal errors.
- Serial behavior for mixed HTTP/local archival.
- Pause and endpoint changes during preparation.
- Explicit IndexedDB abort, asynchronous transaction callback failure.
- Process crashes before cleanup, between metadata commit and removal, after removal before counter/ID finalization.

The conservation check requires every capture to remain discoverable with its payload locally, or have been written to the test server. Failed uploads must retain their local copies. Other checks cover payload contents, concurrency, counters, batch counts, outstanding uploads.

### Limits

This harness exercises the actual persistence helpers, real storage engines, real HTTP requests. Other background components, including UI updates, loggable normalization, the full scheduler, are stubbed. It checks storage discovery after process restart; it does not run the entire application's startup/recovery sequence.

These tests do not simulate machine power loss, storage hardware failure, every scheduler interleaving, or every combination of export/re-archival/stashing. They establish behavior for the tested cases. End-to-end power-loss safety requires the archive server's acknowledgement to guarantee durable storage. The process-crash tests keep the test server and operating system running.

`storage.local` still commits metadata and record removal separately. Acknowledged uploads may be repeated after an interrupted batch. The payload budget excludes browser/network bookkeeping overhead.

## Building

```sh
git submodule update --init vendor/pako
cd extension
./build.sh firefox-mv2
```
