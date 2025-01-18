#!/usr/bin/env bash

#set -x

usage() {
    cat << EOF
# usage: $0 [--help] PATH [PATH ...]

Sanity check \`hoardy-web\` command-line interface under \`wine\`.
EOF
}

raw() {
    wine python -m hoardy_web "$@"
}

repath() {
    sed 's%/%\\%g; s%^%Z:%' <<< "$1"
}

repath_many() {
    sed -z 's%/%\\%g; s%^%Z:%'
}

. ./test-cli-lib.sh

opts=1

while (($# > 0)); do
    if [[ -n "$opts" ]]; then
        case "$1" in
        --help) usage; exit 0; ;;
        --) opts= ; shift ; continue ;;
        esac
    fi

    src=$1
    shift

    set_temp

    if [[ -f "$src" ]] && [[ "$src" =~ .*\.wrrb ]]; then
        echo "# Testing on bundle $src in $td ..."
    elif [[ -f "$src" ]]; then
        die "testing on $src is not supported"
    elif [[ -d "$src" ]]; then
        echo "# Testing on whole dir $src in $td ..."
        find "$src" -type f -print0 | repath_many > "$td/src"
        src="$td/src"
    else
        die "can't run tests on $src"
    fi

    start "import bundle..."

    ok_raw import bundle --quiet --to "$(repath "$td/import-bundle")" "$(repath "$src")"
    fixed_dir "import-bundle" "$src" "$td"

    end

    rm -rf "$td"
done

echo "total: $errors errors"
if ((errors > 0)); then
    exit 1
fi
