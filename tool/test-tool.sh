#!/usr/bin/env bash

#set -x

usage() {
    cat << EOF
# usage: $0 [--help] [--wine] [--all|--subset NUM] [--long|--short NUM] PATH [PATH ...]

Sanity check and test \`hoardy-web\` command-line interface.

## Examples

- Run fixed-output tests on each of given WRR bundles:

  \`\`\`
  $0 ~/Downloads/Hoardy-Web-export-*.wrrb
  \`\`\`

- Run fixed-output tests on all WRR files in a given directory:

  \`\`\`
  $0 ~/hoardy-web/latest/archiveofourown.org
  \`\`\`

- Run fixed-output tests on a random subset of WRR files in a given directory:

  \`\`\`
  $0 --subset 100 ~/hoardy-web/raw
  \`\`\`

- Run fixed-output tests on each of given WRR bundles, except run long tests on a small subset of each:

  \`\`\`
  $0 --short 16 ~/Downloads/Hoardy-Web-export-*.wrrb
  \`\`\`

- Make an \`--stdin0\` input and test on it, as if it was a WRR bundle:

  \`\`\`
  hoardy-web find -z ~/hoardy-web/latest/archiveofourown.org ~/hoardy-web/latest/example.org > ./bunch.wrrtest
  $0 ./bunch.wrrtest
  \`\`\`
EOF
}

in_wine=
raw() {
    if [[ -z "$in_wine" ]]; then
        python3 -m hoardy_web "$@"
    else
        wine python -m hoardy_web "$@"
    fi
}

no_stderr_selfsame() {
    local target="$1"
    local dst="$2"
    local input="$3"
    local stdin0="$4"
    shift 4

    ok_mixed "$target" "$dst" "$@" "$input"
    ok_mixed "$target.stdin0" "$dst" "$@" --stdin0 < "$stdin0"
    equal_file "$target: selfsame: $*" "$dst/$target.out" "$dst/$target.stdin0.out"
}

fixed_output_selfsame() {
    local target="$1"
    local src="$2"
    local dst="$3"
    local input="$4"
    local stdin0="$5"
    shift 5

    no_stderr_selfsame "$target" "$dst" "$input" "$stdin0" "$@"
    sed -i "s%$dst/%./%g" "$dst/$target.out"
    fixed_target "$target.out" "$src" "$dst"
}

repath() {
    sed 's%/%\\%g; s%^%Z:%' <<< "$1"
}

repath_many() {
    sed -z 's%/%\\%g; s%^%Z:%'
}

. ./test-cli-lib.sh

opts=1
subset=
short=

while (($# > 0)); do
    if [[ -n "$opts" ]]; then
        case "$1" in
        --help) usage; exit 0; ;;
        --wine) in_wine=1 ; shift ; continue ;;
        --all) subset= ; shift ; continue ;;
        --subset) subset=$2 ; shift 2 ; continue ;;
        --long) short= ; shift ; continue ;;
        --short) short=$2 ; shift 2 ; continue ;;
        --) opts= ; shift ; continue ;;
        esac
    fi

    src=$1
    shift

    set_temp

    do_fixed_dir=1
    if [[ -z "$in_wine" ]]; then
        if [[ -f "$src" ]] && [[ "$src" =~ .*\.wrrb ]]; then
            # these can be made with `cat`ting a bunch of .wrr files together
            echo "# Testing fixed-outputness on bundle $src in $td ..."
            stdin0="$td/input"
            find "$src" -type f -print0 > "$stdin0"
        elif [[ -f "$src" ]]; then
            # these can be made with `hoardy-web find -z`
            echo "# Testing fixed-outputness on stdin0 $src in $td ..."
            stdin0="$src"
        elif [[ -d "$src" ]]; then
            stdin0="$td/input"
            if [[ -z "$subset" ]]; then
                echo "# Testing fixed-outputness on whole dir $src in $td ..."
                find "$src" -type f -print0 | sort -z > "$stdin0"
            else
                echo "# Testing fixed-outputness on a random subset (n=$subset) of dir $src in $td ..."
                find "$src" -type f -print0 | shuf -z | head -zn "$subset" > "$stdin0"
                do_fixed_dir=
            fi
        else
            error "can't run tests on $src"
            continue
        fi
    else
        if [[ -f "$src" ]] && [[ "$src" =~ .*\.wrrb ]]; then
            echo "# Testing fixed-outputness on bundle $src in $td ..."
        elif [[ -f "$src" ]]; then
            error "testing on $src is not supported"
            continue
        elif [[ -d "$src" ]]; then
            echo "# Testing fixed-outputness on whole dir $src in $td ..."
            find "$src" -type f -print0 | repath_many > "$td/src"
            src="$td/src"
        else
            error "can't run tests on $src"
            continue
        fi
    fi

    uexprs=( \
        -e net_url \
        -e url \
        -e pretty_url \
    )
    exprs=( \
        "${uexprs[@]}" \
        -e "net_url|to_ascii|sha256|take_prefix 2|to_hex" \
        -e "response.body|eb|to_utf8|sha256|to_hex" \
    )

    start "import bundle..."

    if [[ -z "$in_wine" ]]; then
        no_stderr import-bundle "$td" import bundle --quiet --stdin0 --to "$td/import-bundle" < "$stdin0"
    else
        ok_raw import bundle --quiet --to "$(repath "$td/import-bundle")" "$(repath "$src")"
    fi
    [[ -n "$do_fixed_dir" ]] && fixed_dir import-bundle "$src" "$td"

    end

    idir="$td/import-bundle"

    input0="$td/input0"
    find "$idir" -type f -print0 | sort -z > "$input0"

    if [[ -n "$short" ]]; then
        sinput0="$td/sinput0"
        cat "$input0" | shuf -z | head -zn "$short" > "$sinput0"
    else
        sinput0="$input0"
    fi

    if [[ -z "$in_wine" ]]; then
        start "filter out \`.part\`s..."

        ok_mixed dotpart.1 "$td" stream --format=raw -ue url "$idir"

        while IFS= read -r -d $'\0' fname; do
            cp "$fname" "$fname.part"
        done < "$sinput0"

        ok_mixed dotpart.2 "$td" stream --errors skip --format=raw -ue url "$idir"

        while IFS= read -r -d $'\0' fname; do
            rm "$fname.part"
        done < "$sinput0"

        equal_file "\`.part\`s are ignored" "$td/dotpart.1.out" "$td/dotpart.2.out"

        end

        start "find..."

        fixed_output_selfsame find-200-1024 "$src" "$td" "$idir" "$input0" \
                              find --status-re .200C --and "response.body|len|> 1024"

        fixed_output_selfsame find-html-potter "$src" "$td" "$idir" "$input0" \
                              find --response-mime text/html --grep-re '\bPotter\b'

        end

        start "pprint..."

        no_stderr_selfsame pprint "$td" "$idir" "$input0" pprint
        no_stderr_selfsame pprint-u "$td" "$idir" "$input0" pprint -u

        end

        start "stream..."

        no_stderr_selfsame stream "$td" "$idir" "$input0" stream "${exprs[@]}"
        no_stderr_selfsame stream-u "$td" "$idir" "$input0" stream -u "${exprs[@]}"

        end

        start "organize..."

        no_stderr organize-copy "$td" \
                  organize --quiet --copy --to "$td/organize" "$idir"
        equal_dir "organize-copy == import-bundle" "$td/organize" "$idir"

        no_stderr organize-hardlink "$td" \
                  organize --quiet --hardlink --to "$td/organize2" "$td/organize"
        equal_dir "organize-hardlink == organize-copy" "$td/organize2" "$idir"

        no_stderr organize-symlink "$td" \
                  organize --quiet --symlink --output hupq_msn \
                  --to "$td/organize3" "$td/organize"

        {
            ok_raw organize --copy --to "$td/organize" "$td/organize2"
            ok_raw organize --hardlink --to "$td/organize" "$td/organize2"
            ok_raw organize --copy --to "$td/organize2" "$td/organize"
            ok_raw organize --hardlink --to "$td/organize2" "$td/organize"

            ok_raw organize --hardlink --to "$td/organize" "$td/organize3"
            ok_raw organize --symlink --output hupq_msn --to "$td/organize3" "$td/organize"
        } &> "$td/reorganize-log"

        if [[ -s "$td/reorganize-log" ]]; then
            cat "$td/reorganize-log"
            die "re-organize is not a noop"
        fi

        end

        start "organize --symlink --latest..."

        fixed_output organize-sl "$src" "$td" \
                     organize --symlink --latest --output hupq \
                     --to "$td/organize-sl" \
                     "$idir"

        fixed_output organize-sls "$src" "$td" \
                     organize --symlink --latest --output hupq \
                     --paths-sorted --walk-sorted \
                     --to "$td/organize-sls" \
                     "$idir"

        # TODO: this, currently broken
        # equal_dir "organize-sls == organizes-sl" "$td/organize-sl" "$td/organize-sls"

        lines=$(cat "$input0" | tr '\0' '\n' | wc -l)

        cat "$input0" | head -zn $((lines/3 + 1)) | \
            fixed_output organize-seq1 "$src" "$td" \
                         organize --symlink --latest --output hupq \
                         --to "$td/organize-seq" --stdin0

        cat "$input0" | head -zn $((lines*2/3 + 1)) | \
            fixed_output organize-seq2 "$src" "$td" \
                         organize --symlink --latest --output hupq \
                         --to "$td/organize-seq" --stdin0

        cat "$input0" | tail -zn $((lines*2/3 + 1)) | \
            fixed_output organize-seq3 "$src" "$td" \
                         organize --symlink --latest --output hupq \
                         --to "$td/organize-seq" --stdin0

        equal_dir "organize-seq = organize-sl" "$td/organize-sl" "$td/organize-seq"

        # ensure `organize` did not touch the source dir
        describe-dir --no-mode --no-mtime "$td/import-bundle" > "$td/import-bundle.describe-dir.2"
        equal_file "organize-seq is src-pure" "$td/import-bundle.describe-dir" "$td/import-bundle.describe-dir.2"

        end
    fi

    start "serve archival..."
    # feed results of `import bundle` to `serve` via `curl`, then check
    # that the results are the same

    mkdir -p "$td/serve"
    if [[ -z "$in_wine" ]]; then
        python3 -m hoardy_web serve --host 127.1.1.1 --implicit --archive-to "$td/serve" &
    else
        wine python -m hoardy_web serve --host 127.1.1.1 --implicit --archive-to "$(repath "$td/serve")" &
    fi
    tpid=$!
    sleep 3

    # just to be sure
    curl "http://127.1.1.1:3210/hoardy-web/server-info" > "$td/serve.info" 2> /dev/null
    fixed_target serve.info "$src" "$td"

    # feed it some data
    while IFS= read -r -d $'\0' fname; do
        zcat "$fname" | curl --data-binary "@-" -H "Content-type: application/x-wrr+cbor" "http://127.1.1.1:3210/pwebarc/dump"
    done < "$sinput0"

    # kill immediately, which must work
    kill "$tpid"
    tpid=

    # ensure no .part files are left
    find "$td/serve" -name '*.part' > "$td/serve.parts"

    if [[ -s "$td/serve.parts" ]]; then
        cat "$td/serve.parts"
        error "serve left some \`.part\` files"
    fi

    # check equality to import-bundle
    tdlen=${#td}
    while IFS= read -r -d $'\0' fname; do
        fname=${fname:$tdlen}
        fname=${fname#/import-bundle/}
        if ! diff "$td/import-bundle/$fname" "$td/serve/default/$fname"; then
            error "$fname is not the same"
        fi
    done < "$sinput0"

    end

    if [[ -z "$in_wine" ]]; then
        start "mirror urls..."

        fixed_output mirror-urls "$src" "$td" \
            mirror --copy --to "$td/mirror-urls" --output hupq_n \
            "${uexprs[@]}" \
            "$idir"
        [[ -n "$do_fixed_dir" ]] && fixed_dir mirror-urls "$src" "$td"

        end

        start "mirror responses..."

        fixed_output mirror-responses "$src" "$td" \
           mirror --to "$td/mirror-responses" --output hupq_n \
           "$idir"
        [[ -n "$do_fixed_dir" ]] && fixed_dir mirror-responses "$src" "$td"

        end

        start "get..."

        while IFS= read -r -d $'\0' path; do
            no_stderr get-sniff-default "$td"  get "${exprs[@]}" "$path"
            no_stderr get-sniff-force "$td"    get --sniff-force "${exprs[@]}" "$path"
            no_stderr get-sniff-paranoid "$td" get --sniff-paranoid "${exprs[@]}" "$path"
        done < "$sinput0"

        end

        start "run..."

        while IFS= read -r -d $'\0' path; do
            no_stderr run-cat "$td"  run cat "$path"
            no_stderr run-diff "$td" run -n 2 -- diff "$path" "$path"
        done < "$sinput0"

        end

        start "stream --format=raw..."

        no_stderr_selfsame stream-raw "$td"   "$idir" "$input0" stream --format=raw "${exprs[@]}"
        no_stderr_selfsame stream-raw-u "$td" "$idir" "$input0" stream --format=raw -u "${exprs[@]}"

        end

        start "stream --format=json..."

        no_stderr_selfsame stream-json "$td"   "$idir" "$input0" stream --format=json "${exprs[@]}"
        no_stderr_selfsame stream-json-u "$td" "$idir" "$input0" stream --format=json -u "${exprs[@]}"

        end

        #start "stream --format=cbor..."

        #no_stderr_selfsame stream-cbor "$td"   "$idir" "$input0" stream --format=cbor "${exprs[@]}"
        #no_stderr_selfsame stream-cbor-u "$td" "$idir" "$input0" stream --format=cbor -u "${exprs[@]}"

        #end
    fi

    rm -rf "$td"
done

echo "total: $errors errors"
if ((errors > 0)); then
    exit 1
fi
