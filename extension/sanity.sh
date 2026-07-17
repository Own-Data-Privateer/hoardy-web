#!/usr/bin/env bash

set -e

sed -i -E '
# in all HTML tags, always put the `id` first
s%<([^!> ]+)(( [^=>]+(="[^">]*")?)*)( id="[^">]*")(( [^=>]+(="[^">]*")?)*)>%<\1\5\2\6>%g
' {lib,background,inject,page}/* manifest-*

if type -P prettier; then
    fmt() {
        prettier --plugin "$PRETTIER_CURLY" --write "$@"
    }
else
    fmt() {
        oxfmt --config .prettierrc "$@"
    }
fi

fmt "$@" {lib,background,inject,page}/*.js *.json .prettierrc .*.json

biljs=$(mktemp --tmpdir biome-XXXXXXX.js)
oxljs=$(mktemp --tmpdir oxlint-XXXXXXX.js)
trap 'rm -f "$biljs" "$oxljs"' 0

if type -P biome; then
    bil() {
        biome lint --config-path ./.biome.json "$@"
    }
else
    bil() {
        :
    }
fi

if type -P oxlint; then
    oxl() {
        local args=()
        while (($# > 0)); do
            case "$1" in
            -A)
                args+=("$1" "$2")
                shift 2
                ;;
            *)
                break;
                ;;
            esac
        done

        for f in "$@"; do
            sed -E '
s%biome-ignore lint/correctness/noUnusedVariables.*%eslint-disable-next-line no-unused-vars%
s%biome-ignore lint/suspicious/noPrototypeBuiltins:.*%eslint-disable-next-line no-prototype-builtins%
s%biome-ignore lint/suspicious/noDoubleEquals:.*%eslint-disable-next-line eqeqeq%
' "$f" > "$oxljs"
            oxlint --config ./.oxlintrc.json "${args[@]}" "$oxljs"
        done
    }
else
    oxl() {
        :
    }
fi

lint() {
    bil "$@"
    oxl "$@"
}
lint-a() {
    bil --skip lint/correctness/noUnusedVariables "$@"
    oxl -A no-unused-vars "$@"
}
lint-b() {
    bil  --skip lint/suspicious/noRedeclare "$@"
    oxl -A no-redeclare "$@"
}

# lint standalone *.js files
for f in inject/*.js; do
    lint "$f"
done

# lint *.js file combinations
source ./build-env.sh

prelude() {
    echo '"use strict";'
    echo
    echo "// eslint-disable-next-line no-unassigned-vars"
    echo "var pako;"
    echo
}

## lint each page separately, ignoring unused variables and functions
for kind in main popup minimal state saved; do
    {
        prelude

        for f in $(eval "echo \${SCRIPTS_$kind[@]}"); do
            if [[ "$f" != "vendor/pako.js" ]]; then
                cat "$f"
            fi
        done | sed -E '/"use strict"/ d'
    } > "$biljs"
    lint-a "$biljs"
done

## lint all the code together, ignoring re-declarations
{
    prelude

    cat lib/*.js background/*.js page/*.js | sed -E '
/"use strict"/ d
s/let (WEBEXT_RPC_MODE|DEBUG_WEBEXT_RPC|dbody|pbody)( =|;)/var \1\2/
s%^(function broadcast|var DEBUG_WEBEXT_RPC)%\n//biome-ignore lint: lint/correctness/noUnusedVariables: skip\n\1%
'
} > "$biljs"
lint-b "$biljs"
