#!/usr/bin/env bash

set -e

sed -n "0,/^\[/ p" CHANGELOG.md | head -n -1 > CHANGELOG.new

{
    emit() {
        echo "## [$1] - $4" >&4

        if [[ -z $3 ]]; then
            echo "[$1]: https://github.com/Own-Data-Privateer/hoardy-web/releases/tag/$2"
        else
            echo "[$1]: https://github.com/Own-Data-Privateer/hoardy-web/compare/$3...$2"
        fi
    }

    prev_extension=
    prev_tool=
    prev_simple_server=
    git tag --sort=-refname --sort=taggerdate --format '%(taggerdate:short) %(subject) %(refname:short)' | while IFS= read -r -d $'\n' line ; do
        refname=${line##* }
        date=${line%% *}
        title=$line
        title=${title#* }
        title=${title% *}
        title=$(sed 's/ version /-v/' <<< "$title")
        case "$refname" in
        extension-*)
            emit "$title" "$refname" "$prev_extension" "$date"
            prev_extension="$refname"
            ;;
        tool-v0.15.5)
            # skip these
            continue
            ;;
        tool-*)
            emit "$title" "$refname" "$prev_tool" "$date"
            prev_tool="$refname"
            ;;
        dumb_server-*|simple_server-*)
            emit "$title" "$refname" "$prev_simple_server" "$date"
            prev_simple_server="$refname"
            ;;
        esac
    done
} 4> CHANGELOG.spine.rnew | tac >> CHANGELOG.new

{
    echo
    sed -n "/^# TODO/,$ p" CHANGELOG.md
} >> CHANGELOG.new

{
    echo "# Changelog"
    cat CHANGELOG.spine.rnew | tac
} >> CHANGELOG.spine.new
sed -n '/^# TODO/,$ d; /^##\? / p' CHANGELOG.md | sed 's/^\(## [^:]*\): .*/\1/g' > CHANGELOG.spine.old
diff -u CHANGELOG.spine.old CHANGELOG.spine.new || true
rm CHANGELOG.spine.*

mv CHANGELOG.new CHANGELOG.md
