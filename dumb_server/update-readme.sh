#!/bin/sh -e

sed -n "0,/# Usage/ p" README.md > README.new
echo -e '\n```' >> README.new
./pwebarc_dumb_dump_server.py --help | sed '
s/^\(#\+\) /#\1 /
' >> README.new
echo -e '```' >> README.new
mv README.new README.md
pandoc -f markdown -t html README.md > README.html
