#!/bin/sh -e

echo '$table-of-contents$' > toc.template
for i in 0 1; do
{
    echo "# Table of Contents"
    echo "<details><summary>(Click me to see it.)</summary>"
    pandoc --wrap=none --toc --template=toc.template --metadata title=toc -f markdown -t html README.md \
        | sed '/Table of Contents/ d'
    echo "</details>"
    echo

    sed -n "/# What is/,$ p" README.md
} > README.new
mv README.new README.md
done
pandoc -f markdown -t html README.md > README.html
