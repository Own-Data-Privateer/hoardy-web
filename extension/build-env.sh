VERSION=$(cat VERSION)
ICON_THEME=privateer

SCRIPTS_main=(
    lib/compat.js
    lib/base.js
    lib/schedule-timeout.js
    lib/ui.js
    lib/webext.js
    lib/webext-rpc-server.js
    lib/cbor-s.js
    vendor/pako.js
    lib/pako-ext.js
    lib/idbp.js
    lib/lslot.js
    lib/caydarsc.js
    lib/util.js
    background/issue-acc.js
    background/state-global.js
    background/state-tab.js
    background/notifier.js
    background/scheduler.js
    background/display.js
    background/capture.js
    background/capture-snapshot.js
    background/loggable-dump.js
    background/persistence.js
    background/reload.js
    background/main.js
)

PAGE=(
    lib/compat.js
    lib/base.js
    lib/schedule-timeout.js
    lib/ui.js
    lib/webext.js
    lib/webext-rpc-client.js
    lib/util.js
)

SCRIPTS_popup=(
    "${PAGE[@]}"
    page/popup.js
)

SCRIPTS_minimal=(
    "${PAGE[@]}"
    page/minimal.js
)

SCRIPTS_help=(
    "${PAGE[@]}"
    page/help.js
)

RPAGE=(
    "${PAGE[@]}"
    page/reqres-ui.js
)

SCRIPTS_state=(
    "${RPAGE[@]}"
    page/state.js
)

SCRIPTS_saved=(
    "${RPAGE[@]}"
    page/saved.js
)
