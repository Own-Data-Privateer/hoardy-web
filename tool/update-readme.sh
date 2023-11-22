#!/bin/sh -e

sed -n "0,/# Usage/ p" README.md > README.new
echo >> README.new
python3 -m wrrarms.__main__ --help --markdown | sed '
s/^\(#\+\) /#\1 /
s/^\(#\+\) \(wrrarms[^[({]*\) [[({].*/\1 \2/
' >> README.new
mv README.new README.md
pandoc -f markdown -t html README.md > README.html
