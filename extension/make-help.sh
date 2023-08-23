#!/usr/bin/env bash

echo "Building help page..."

pandoc -f org -t html --template=page/help.template --metadata pagetitle=help page/help.org > page/help.html
