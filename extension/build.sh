#!/usr/bin/env bash

set -e

if [[ "$1" == clean ]]; then
    rm -rf dist
    shift
    timestamp=$(git log --format='%ci' HEAD~1..HEAD)
fi

VERSION=$(jq -r .version ./manifest-common.json)
iconTheme=privateer

for target in "$@"; do
    echo "Building $target..."

    NAME="Hoardy-Web-$target"
    NAME_VERSION="$NAME-v$VERSION"
    DEST="dist/$NAME"
    install -d "$DEST"

    if [[ "$target" == tiles ]]; then
        echo "  Tailing all icons into a single image..."

        icons=()
        for a in icon/"$iconTheme"/{main,work_offline,off,idle,limbo,neglimbo,bothlimbo,tracking,problematic,bar,in_limbo,archiving,failed,unsnapshottable,unreplayable,error,dot}.svg icon/"$iconTheme"/*.svg; do
            n=$(basename "$a")
            file="$DEST/$n.png"
            if [[ "$a" -nt "$file" ]]; then
                echo "    Building $file..."
                convert -geometry 128x128 -background none "$a" "$file"
            fi
            l="${#icons[@]}"
            found=
            for ((i=0; i<l; ++i)); do
                if [[ "${icons[$i]}" == "$file" ]]; then
                    found=1
                    break
                fi
            done
            if [[ -z "$found" ]]; then
                icons+=("$file")
            fi
        done

        l="${#icons[@]}"

        maketile() {
            x=$1; y=$2; bg=$3

            local args=()
            s=$((x*y))
            for ((i=0; i<s; i++)); do
                e=$((i % l))
                args+=("${icons[$e]}")
            done

            file="$DEST/tile-$x-$y-$bg.png"
            echo "    Building $file..."
            montage -geometry +3+3 -tile "${x}x" -background "$bg" "${args[@]}" "$file"
        }

        maketile $l 1 white
        maketile $l 1 black
        maketile $l 6 white
        maketile $l 6 black
        maketile $((l+1)) 6 white
        maketile $((l+1)) 6 black
        maketile $((l-1)) 6 white
        maketile $((l-1)) 6 black

        continue
    fi

    pandocArgs=( \
        -V "version=$VERSION" \
    )

    echo "  Preparing icons..."

    if [[ "$target" =~ firefox-* ]]; then
        pandocArgs+=(-V iconMIME=image/svg+xml -V iconFile=main.svg)
        install -d "$DEST"/icon
        install -C -t "$DEST"/icon icon/"$iconTheme"/*.svg
    elif [[ "$target" =~ chromium-* ]]; then
        pandocArgs+=(-V iconMIME=image/png -V iconFile=128/main.png)

        install -d "$DEST"/icon

        makeicons() {
            install -d "$DEST/icon/$1"
            for a in icon/"$iconTheme"/*.svg ; do
                n=$(basename "$a")
                file="$DEST/icon/$1/${n%.svg}.png"
                if [[ "$a" -nt "$file" ]]; then
                    echo "  Building $file..."
                    convert -geometry "$1x$1" -background none "$a" "$file"
                fi
            done
        }

        #makeicons 48
        #makeicons 96
        makeicons 128
    fi

    runPandoc() {
        local format=$1
        local path=$2
        local template="--template=$2.template"
        shift 2

        while (($# > 0)); do
            case "$1" in
            --template) template="--template=$2.template"; shift 2 ;;
            *) break; ;;
            esac
        done

        local destfile="$DEST/$path".html
        mkdir -p "$(dirname "$destfile")"
        pandoc -f "$format" -t html --wrap=none "$template" \
               -M pagetitle="$path" "${pandocArgs[@]}" "$@" > "$destfile"
    }

    for p in background/main page/popup page/state page/saved; do
        echo "  Building $p..."
        echo | runPandoc markdown "$p"
    done

    echo "  Building page/help..."

    cat page/help.org \
        | sed '
s%\.\./\.\./doc/data-on-disk\.md%./data-on-disk.html%g
s%\.\./\.\./CHANGELOG\.md%./changelog.html%g

s%\[\[\.\./\.\.\/\]\[\([^]]*\)\]\]%[[https://oxij.org/software/hoardy-web/][\1]] (also on [[https://github.com/Own-Data-Privateer/hoardy-web][GitHub]])%g
t end
s%\[\[\.\./\.\.\/\([^]]*\)/\]\[\([^]]*\)\]\]%[[https://oxij.org/software/hoardy-web/tree/master/\1/][\2]] (also on [[https://github.com/Own-Data-Privateer/hoardy-web/tree/master/\1][GitHub]])%g
t end
s%\[\[\.\./\.\.\/\([^]]*\)\]\[\([^]]*\)\]\]%[[https://oxij.org/software/hoardy-web/tree/master/\1][\2]] (also on [[https://github.com/Own-Data-Privateer/hoardy-web/tree/master/\1][GitHub]])%g
: end
' \
        | runPandoc org page/help --toc

    # hackity hack, because pandoc does not support ":UNNUMBERED: notoc" property
    sed -i '/id="toc-top"/ d' "$DEST/page/help.html"

    echo "  Building page/changelog..."

    cat ../CHANGELOG.md \
        | sed '
s%\./doc/data-on-disk\.md%./data-on-disk.html%g
s%\./extension/page/help\.org%./help.html%g
s%#state-in-extension-ui-only%./state.html%g
t end
s%\[\([^]]*\)\](\./\([^)]*\))%[\1](https://oxij.org/software/hoardy-web/tree/master/\2) (also on [GitHub](https://github.com/Own-Data-Privateer/hoardy-web/tree/master/\2))%g

s%#\([0-9]\+\) on GitHub%[#\1 on GitHub](https://github.com/Own-Data-Privateer/hoardy-web/issues/\1)%g
s%@\(\S\+\) on GitHub%[\\@\1 on GitHub](https://github.com/\1)%g
: end
' \
        | runPandoc markdown page/changelog --template page/minimal -V title=Changelog

    cat ../doc/data-on-disk.md \
        | sed '
s%\[\([^]]*\)\](\.\./\([^)]*\))%[\1](https://oxij.org/software/hoardy-web/tree/master/\2) (also on [GitHub](https://github.com/Own-Data-Privateer/hoardy-web/tree/master/\2))%g

s%#\([0-9]\+\) on GitHub%[#\1 on GitHub](https://github.com/Own-Data-Privateer/hoardy-web/issues/\1)%g
s%@\(\S\+\) on GitHub%[\\@\1 on GitHub](https://github.com/\1)%g
' \
        | runPandoc markdown page/data-on-disk --template page/minimal -V title="The WRR Data File Format"

    echo "  Copying files..."

    install -d "$DEST"/lib
    install -C -t "$DEST"/lib lib/*.js
    install -C -t "$DEST"/lib ../vendor/pako/dist/pako.js

    install -d "$DEST"/page
    install -C -t "$DEST"/page page/*.css page/*.js

    install -d "$DEST"/background
    install -C -t "$DEST"/background background/*.js

    install -d "$DEST"/inject
    install -C -t "$DEST"/inject inject/*.js

    install -C -t "$DEST" ../LICENSE.txt

    if [[ "$target" =~ chromium-* ]]; then
        (
            cd "dist"
            if [[ ! -e "manifest-chromium-key.json" ]]; then
                echo "  Generating Chromium ID..."
                mkdir -p "../private"
                res=$(../bin/gen-chromium-key.sh "../private/chromium.key.pem" "manifest-chromium")
                if [[ -n "$res" ]]; then
                    echo -e "\e[1;31m"
                    echo "    $res"
                    echo -e "\e[0m"
                fi
            fi
        )
    fi

    echo "  Building manifest.json..."

    if [[ "$target" =~ firefox-* ]]; then
        jq -s --indent 4 '.[0] * .[1]' manifest-common.json "manifest-$target.json" > "$DEST"/manifest.json
    elif [[ "$target" =~ chromium-* ]]; then
        jq -s --indent 4 '.[0] * .[1] * .[2]' manifest-common.json "dist/manifest-chromium-key.json" "manifest-$target.json" > "$DEST"/manifest.json
    fi

    if [[ -n "$timestamp" ]]; then
        find "$DEST" -exec touch --date="$timestamp" {} \;
    fi

    if [[ "$target" =~ firefox-* ]]; then
        echo "  Zipping..."

        (
            cd "$DEST"
            zip -qr -9 -X "../$NAME_VERSION.xpi" .
        )
    elif [[ "$target" =~ chromium-* ]]; then
        echo "  Zipping..."

        cd dist
        zip -qr -9 -X "$NAME_VERSION.zip" "$NAME"
        cd ..

        echo "  Making CRX..."

        (
            key=$(readlink -f "./private/chromium.key.pem")

            cd "$DEST"

            if false && which chromium ; then
                cd ..
                chromium --pack-extension="./$NAME_VERSION" --pack-extension-key="$key"
            else
                ../../bin/crx.sh "../$NAME_VERSION" "$key"
            fi
        )

        chromium_id=$(cat "dist/manifest-chromium-id.txt")
        chromium_crx_url="https://github.com/Own-Data-Privateer/hoardy-web/releases/download/extension-v$VERSION/$NAME_VERSION.crx"

        echo "  Making update.xml..."

        sed "
s%@VERSION@%${VERSION}%g
s%@ID@%${chromium_id}%g
s%@CRX_URL@%${chromium_crx_url}%g
" gupdate.xml.template > "dist/update-$target.xml"

        if [[ -d ../metadata ]]; then
            cp "dist/update-$target.xml" ../metadata/
        fi
    fi
done

# for `web-ext --watch-file`
touch dist/build-done

echo "Done."
