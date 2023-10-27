#!/usr/bin/env bash

set -e

if [[ "$1" == clean ]]; then
    rm -rf dist
    shift
fi

timestamp=$(git log --format='%ci' HEAD~1..HEAD)
version=$(jq -r .version ./manifest-common.json)

for target in "$@"; do
    echo "Building $target..."

    NAME="pWebArc-$target-v${version}"
    DEST="dist/$NAME"
    mkdir -p "$DEST"

    echo "  Building help page..."

    pandoc -f org -t html --template=page/help.template --metadata pagetitle=help page/help.org > page/help.html

    echo "  Preparing icons..."

    install -d "$DEST"/icon

    if [[ "$target" != firefox ]]; then
        makeicons() {
            mkdir -p "$DEST/icon/$1"
            for a in icon/*.svg ; do
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
        install -C -t "$DEST"/icon icon/*.svg
    fi

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

    echo "  Copying files..."

    install -d "$DEST"/lib
    install -C -t "$DEST"/lib lib/*.js

    install -d "$DEST"/page
    install -C -t "$DEST"/page page/*.html page/*.css page/*.js

    install -d "$DEST"/background
    install -C -t "$DEST"/background background/*.html background/debugger.js background/core.js

    install -C -t "$DEST" ../LICENSE.txt

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

echo "Done."
