#!/usr/bin/env bash

self() {
    python3 -m hoardy_web "$@"
}

[[ $# < 1 ]] && echo "need at least a source" && exit 1
src="$1"
num="${2:-128}"
target="${3:-random}"

set -e

trap '[[ -n "$td" ]] && rm -rf "$td"' 0
td=$(mktemp --tmpdir -d hoadry-web-test-cli-XXXXXXXX)

if [[ "$target" == "all" ]]; then
    echo "Running comprehensive tests..."

    find "$src" -type f -print0 | sort -z > "$td/input"
elif [[ "$target" == "random" ]]; then
    echo "Running random tests..."

    find "$src" -type f -print0 | shuf -z | head -zn "$num" > "$td/input"
fi

exprs=( \
    -e "net_url" \
    -e "net_url|to_ascii|sha256|take_prefix 4" \
    -e "response.body|eb" \
    -e "response.body|eb|scrub response defaults" \
    -e "response.body|eb|scrub response &all_refs,+scripts,+pretty" \
)

echo "  pprint, stream..."

cat "$td/input" | self pprint --stdin0 > /dev/null
cat "$td/input" | self pprint --stdin0 -u > /dev/null
cat "$td/input" | self stream --stdin0 "${exprs[@]}" > /dev/null
cat "$td/input" | self stream --stdin0 -u "${exprs[@]}" > /dev/null
cat "$td/input" | self stream --stdin0 --format=raw -u "${exprs[@]}" > /dev/null
cat "$td/input" | self stream --stdin0 --format=json -u "${exprs[@]}" > /dev/null
#cat "$td/input" | self stream --stdin0 --format=cbor -u "${exprs[@]}" > /dev/null

echo "  find..."

cat "$td/input" | self find --stdin0 --and "status|~= .200C" --and "response.body|len|> 1024" > /dev/null

echo "  organize..."

cat "$td/input" | self organize --stdin0 --copy --to "$td/organize" &> /dev/null
cat "$td/input" | self organize --stdin0 --copy --to "$td/organize"

echo "  get, run..."

cat "$td/input" | while IFS= read -r -d $'\0' path; do
    self get "${exprs[@]}" "$path"
    self get --sniff-force "${exprs[@]}" "$path"
    self get --sniff-paranoid "${exprs[@]}" "$path"
    self run cat "$path"
    self run -n 2 -- diff "$path" "$path"
done > /dev/null
