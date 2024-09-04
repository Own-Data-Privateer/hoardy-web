#!/usr/bin/env bash

set -e

{
    echo "# Changelog"
    git tag --sort=-taggerdate --format '## [%(refname:short)] - %(taggerdate:short)'
} > CHANGELOG.spine.new

sed -n '/^##\? / p' CHANGELOG.md > CHANGELOG.spine.old
diff -u CHANGELOG.spine.old CHANGELOG.spine.new || true
rm CHANGELOG.spine.*

{
    sed -n "0,/^\[/ p" CHANGELOG.md | head -n -1
} > CHANGELOG.new

{
    emit() {
        if [[ -z $2 ]]; then
            echo "[$1]: https://github.com/Own-Data-Privateer/hoardy-web/releases/tag/$1"
        else
            echo "[$1]: https://github.com/Own-Data-Privateer/hoardy-web/compare/$2...$1"
        fi
    }

    prev_extension=
    prev_tool=
    prev_simple_server=
    git tag --sort=taggerdate --format '%(refname:short)' | while IFS= read -r -d $'\n' refname ; do
        case "$refname" in
        extension-*)
            emit "$refname" "$prev_extension"
            prev_extension="$refname"
            ;;
        tool-*)
            emit "$refname" "$prev_tool"
            prev_tool="$refname"
            ;;
        dumb_server-*|simple_server-*)
            emit "$refname" "$prev_simple_server"
            prev_simple_server="$refname"
            ;;
        esac
    done
} | tac >> CHANGELOG.new

mv CHANGELOG.new CHANGELOG.md
