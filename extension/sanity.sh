#!/bin/sh

sed -i -E '
# in all HTML tags, always put the `id` first
s%<([^!> ]+)(( [^=>]+(="[^">]*")?)*)( id="[^">]*")(( [^=>]+(="[^">]*")?)*)>%<\1\5\2\6>%g
' lib/* page/* background/* manifest-*
