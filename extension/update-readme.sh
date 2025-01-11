#!/bin/sh -e

this_links() {
    sed '
s%\[\([^]]*\)\](\(http[^)]*\))%[\1](\2)%g
t end
s%\[\([^]]*\)\](..\(/[^)]*\))%[\1](https://oxij.org/software/hoardy-web/tree/master\2) (also on [GitHub](https://github.com/Own-Data-Privateer/hoardy-web/tree/master\2))%g
s%\[\([^]]*\)\](.\(/[^)]*\))%[\1](https://oxij.org/software/hoardy-web/tree/master/extension\2) (also on [GitHub](https://github.com/Own-Data-Privateer/hoardy-web/tree/master/extension\2))%g
: end
'
}

parent_links() {
    sed '
s%\[\([^]]*\)\](\(http[^)]*\))%[\1](\2)%g
t end
s%\[\([^]]*\)\](\(#[^)]*\))%[\1](https://oxij.org/software/hoardy-web/\2) (also on [GitHub](https://github.com/Own-Data-Privateer/hoardy-web\2))%g
s%\[\([^]]*\)\](.\(/[^)]*\))%[\1](https://oxij.org/software/hoardy-web/tree/master\2) (also on [GitHub](https://github.com/Own-Data-Privateer/hoardy-web/tree/master\2))%g
: end
'
}

amo_html() {
    pandoc --wrap=none -f markdown -t html | sed '
s%<p>%%g
s%</p>%\n%g
s%\(</\(ul\)>\)%\1\n%g
'
}
{
    cat ./README.md \
        | sed 's%`Hoardy-Web` is a browser extension (add-on) that%`Hoardy-Web`%' \
        | sed -n '3, /# Screenshots/ p' \
        | head -n -1 | this_links | amo_html
} > README.amo.html
