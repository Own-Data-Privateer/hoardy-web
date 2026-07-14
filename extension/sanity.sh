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

fmt "$@" {lib,background,inject,page}/*.js *.json .prettierrc
