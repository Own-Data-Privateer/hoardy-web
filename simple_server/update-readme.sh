#!/bin/sh -e

sed -n "0,/# Usage/ p" README.md > README.new
echo -e '\n```' >> README.new
./hoardy_web_sas.py --help | sed '
s/^\(#\+\) /#\1 /
' >> README.new
echo -e '```' >> README.new
mv README.new README.md
pandoc -f markdown -t html README.md > README.html
