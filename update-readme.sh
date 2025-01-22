#!/bin/sh -e

{
    sed -n "/# What is/,$ p" README.md
} > README.new
mv README.new README.md
pandoc -f markdown -t html README.md > README.html
