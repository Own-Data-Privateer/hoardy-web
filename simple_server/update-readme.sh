#!/bin/sh -e

{
    sed -n "0,/# Usage/ p" README.md
    echo -e '\n```'

    ./hoardy_web_sas.py --help | sed '
s/^\(#\+\) /#\1 /
'

    echo -e '```'
} > README.new
mv README.new README.md
pandoc -f markdown -t html README.md > README.html
