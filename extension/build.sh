#!/usr/bin/env bash

set -e

if [[ "$1" == clean ]]; then
    rm -rf dist
    shift
fi

timestamp=$(git log --format='%ci' HEAD~1..HEAD)
version=$(jq -r .version ./manifest-common.json)
iconTheme=privateer

for target in "$@"; do
    echo "Building $target..."

    NAME="pWebArc-$target-v${version}"
    DEST="dist/$NAME"
    mkdir -p "$DEST"

    pandocArgs=( \
        -V libScript=compat.js \
        -V libScript=utils.js \
        -V libScript=lutils.js \
        -V cssVersion=3 \
    )

    echo "  Preparing icons..."

    install -d "$DEST"/icon

    if [[ "$target" != firefox ]]; then
        pandocArgs+=(-V iconMIME=image/png -V iconFile=128/main.png)

        makeicons() {
            mkdir -p "$DEST/icon/$1"
            for a in icon/"$iconTheme"/*.svg ; do
                n=$(basename "$a")
                file="$DEST/icon/$1/${n%.svg}.png"
                if ! [[ -e "$file" ]]; then
                    echo "  Building $file..."
                    convert "$a" -geometry "$1x$1" "$file"
                fi
            done
        }

        #makeicons 48
        #makeicons 96
        makeicons 128
    else
        pandocArgs+=(-V iconMIME=image/svg+xml -V iconFile=main.svg)
        install -C -t "$DEST"/icon icon/"$iconTheme"/*.svg
    fi

    runPandoc() {
        local destfile="$DEST/$2".html
        mkdir -p "$(dirname "$destfile")"
        pandoc -f $1 -t html --wrap=none --template="$2".template -M pagetitle="$2" "${pandocArgs[@]}" > "$destfile"
    }

    for p in background/main page/popup page/state page/saved; do
        echo "  Building $p..."
        echo | runPandoc markdown "$p"
    done

    echo "  Building page/help..."

    cat page/help.org | runPandoc org page/help

    echo "  Building page/changelog..."

    cat ../CHANGELOG.md \
        | sed -n '/^## /,$ p' | sed 's/^#\(#*\) /\1 /' \
        | sed 's%\./extension/page/help\.org%./help.html%g' \
        | runPandoc markdown page/changelog

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

    if [[ "$target" == chromium ]]; then
        (
            cd "dist"
            if [[ ! -e "manifest-$target-id.json" ]]; then
                echo "  Generating Chromium key and ID..."
                mkdir -p "../private"
                ../bin/gen-chromium-keys.sh "../private/$target.key.pem" "manifest-$target-id.json"
            fi
        )
    fi

    echo "  Building manifest.json..."

    if [[ "$target" == firefox ]]; then
        jq -s --indent 4 '.[0] * .[1]' manifest-common.json "manifest-$target.json" > "$DEST"/manifest.json
    else
        jq -s --indent 4 '.[0] * .[1] * .[2]' manifest-common.json "dist/manifest-$target-id.json" "manifest-$target.json" > "$DEST"/manifest.json
    fi

    find "$DEST" -exec touch --date="$timestamp" {} \;

    if [[ "$target" == firefox ]]; then
        echo "  Zipping..."

        (
            cd "$DEST"
            zip -qr -9 -X "../$NAME.xpi" .
        )
    else
        echo "  Zipping..."

        cd dist
        zip -qr -9 -X "$NAME.zip" "$NAME"
        cd ..

        echo "  Making CRX..."

        (
            key=$(readlink -f "./private/$target.key.pem")

            cd "$DEST"

            if false && which chromium ; then
                cd ..
                chromium --pack-extension="./$NAME" --pack-extension-key="$key"
            else
                ../../bin/crx.sh "../$NAME" "$key"
            fi
        )
    fi
done

# for `web-ext --watch-file`
touch dist/build-done

echo "Done."
