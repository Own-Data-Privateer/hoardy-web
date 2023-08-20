#!/usr/bin/env bash

rm -rf dist
mkdir -p dist

DEST=dist/build
mkdir -p $DEST

echo "Copying files..."

install -d $DEST/icon
install -t $DEST/icon icon/*.svg
install -d $DEST/lib
install -t $DEST/lib lib/*.js
install -d $DEST/page
install -t $DEST/page page/*.html page/*.css page/*.js
install -t $DEST *.js
install -t $DEST manifest.json
install -t $DEST ../LICENSE.txt

(
    cd $DEST
    zip ../pWebArc.xpi -qr *
)

echo "Done."
