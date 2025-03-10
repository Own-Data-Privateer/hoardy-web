#!/usr/bin/env bash

#set -x

. ../vendor/kisstdlib/devscript/test-cli-lib.sh

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

export PYTHONPATH="$PWD:$PYTHONPATH"

in_wine=
self() {
    if [[ -z "$in_wine" ]]; then
        python3 -m hoardy_web "$@"
    else
        wine python -m hoardy_web "$@"
    fi
}

ok_selfsame() {
    local got="$1"
    local input="$2"
    local stdin0="$3"
    shift 3

    ok_stdio2 "$got.out" "$@" "$input"
    ok_stdio2 "$got.stdin0.out" "$@" --stdin0 < "$stdin0"
    equal_file "$got.out" "$got.stdin0.out"
}

fixed_stdio() {
    local src="$1"
    local got="$2"
    shift 2

    ok_stdio2 "$got.out" "$@"
    sed -i "s%$tmpdir/%./%g" "$got.out"
    fixed_file "$src" "$got.out"
}

fixed_stdio_selfsame() {
    local src="$1"
    local got="$2"
    local input="$3"
    local stdin0="$4"
    shift 4

    ok_selfsame "$got" "$input" "$stdin0" "$@"
    sed -i "s%$tmpdir/%./%g" "$got.out"
    fixed_file "$src" "$got.out"
}

[[ $# < 1 ]] && die "need at least one source"

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

    set_tmpdir

    do_fixed_dir=1
    if [[ -z "$in_wine" ]]; then
        if [[ -f "$src" ]] && [[ "$src" =~ .*\.wrrb ]]; then
            # these can be made with `cat`ting a bunch of .wrr files together
            echo "# Testing fixed-outputness on bundle $src in $tmpdir ..."
            stdin0="$tmpdir/input"
            find "$src" -type f -print0 > "$stdin0"
        elif [[ -f "$src" ]]; then
            # these can be made with `hoardy-web find -z`
            echo "# Testing fixed-outputness on stdin0 $src in $tmpdir ..."
            stdin0="$src"
        elif [[ -d "$src" ]]; then
            stdin0="$tmpdir/input"
            if [[ -z "$subset" ]]; then
                echo "# Testing fixed-outputness on whole dir $src in $tmpdir ..."
                find "$src" -type f -print0 | sort -z > "$stdin0"
            else
                echo "# Testing fixed-outputness on a random subset (n=$subset) of dir $src in $tmpdir ..."
                find "$src" -type f -print0 | shuf -z | head -zn "$subset" > "$stdin0"
                do_fixed_dir=
            fi
        else
            error "can't run tests on $src"
            continue
        fi
    else
        if [[ -f "$src" ]] && [[ "$src" =~ .*\.wrrb ]]; then
            echo "# Testing fixed-outputness on bundle $src in $tmpdir ..."
        elif [[ -f "$src" ]]; then
            error "testing on $src is not supported"
            continue
        elif [[ -d "$src" ]]; then
            echo "# Testing fixed-outputness on whole dir $src in $tmpdir ..."
            find "$src" -type f -print0 | win32path0_many > "$tmpdir/src"
            src="$tmpdir/src"
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

    cd "$tmpdir"

    start "import bundle"

    if [[ -z "$in_wine" ]]; then
        ok_no_stderr self import bundle --quiet --stdin0 --to import-bundle < "$stdin0"
    else
        ok self import bundle --quiet --to import-bundle "$(win32path "$src")"
    fi
    [[ -n "$do_fixed_dir" ]] && fixed_dir "$src" import-bundle

    end

    idir=import-bundle

    input0=input0
    find "$idir" -type f -print0 | sort -z > "$input0"

    if [[ -n "$short" ]]; then
        sinput0=sinput0
        cat "$input0" | shuf -z | head -zn "$short" > "$sinput0"
    else
        sinput0="$input0"
    fi

    if [[ -z "$in_wine" ]]; then
        start "filter out \`.part\`s"

        ok_stdio2 dotpart.1.out self stream --format=raw -ue url "$idir"

        while IFS= read -r -d $'\0' fname; do
            cp "$fname" "$fname.part"
        done < "$sinput0"

        ok_stdio2 dotpart.2.out self stream --errors skip --format=raw -ue url "$idir"

        while IFS= read -r -d $'\0' fname; do
            rm "$fname.part"
        done < "$sinput0"

        equal_file dotpart.1.out dotpart.2.out

        end

        start find

        fixed_stdio_selfsame "$src" find-200-1024 "$idir" "$input0" \
                             self find --status-re .200C --and "response.body|len|> 1024"

        fixed_stdio_selfsame "$src" find-html-potter "$idir" "$input0" \
                             self find --response-mime text/html --grep-re '\bPotter\b'

        end

        start pprint

        ok_selfsame pprint "$idir" "$input0" self pprint
        ok_selfsame pprint-u "$idir" "$input0" self pprint -u

        end

        start stream

        ok_selfsame stream "$idir" "$input0" self stream "${exprs[@]}"
        ok_selfsame stream-u "$idir" "$input0" self stream -u "${exprs[@]}"

        end

        start organize

        ok_no_stderr self organize --quiet --copy --to organize "$idir"
        equal_dir organize "$idir"

        ok_no_stderr self organize --quiet --hardlink --to organize2 organize
        equal_dir organize2 "$idir"

        ok_no_stderr self organize --quiet --symlink --output hupq_msn \
                       --to organize3 organize

        {
            ok self organize --copy --to organize organize2
            ok self organize --hardlink --to organize organize2
            ok self organize --copy --to organize2 organize
            ok self organize --hardlink --to organize2 organize

            ok self organize --hardlink --to organize organize3
            ok self organize --symlink --output hupq_msn --to organize3 organize
        } &> reorganize.log

        if [[ -s reorganize.log ]]; then
            cat reorganize.log
            die "re-organize is not a noop"
        fi

        end

        start "organize --symlink --latest"

        fixed_stdio "$src" organize-sl \
                    self organize --symlink --latest --output hupq \
                    --to organize-sl \
                    "$idir"

        fixed_stdio "$src" organize-sls \
                    self organize --symlink --latest --output hupq \
                    --paths-sorted --walk-sorted \
                    --to organize-sls \
                    "$idir"

        # TODO: this, currently broken
        # equal_dir organize-sl organize-sls

        lines=$(cat "$input0" | tr '\0' '\n' | wc -l)

        cat "$input0" | head -zn $((lines/3 + 1)) | \
            fixed_stdio "$src" organize-seq1 \
                        self organize --symlink --latest --output hupq \
                        --to organize-seq --stdin0

        cat "$input0" | head -zn $((lines*2/3 + 1)) | \
            fixed_stdio "$src" organize-seq2 \
                        self organize --symlink --latest --output hupq \
                        --to organize-seq --stdin0

        cat "$input0" | tail -zn $((lines*2/3 + 1)) | \
            fixed_stdio "$src" organize-seq3 \
                        self organize --symlink --latest --output hupq \
                        --to organize-seq --stdin0

        equal_dir organize-sl organize-seq

        # ensure `organize` did not touch the source dir
        describe-forest import-bundle > import-bundle.describe-dir.2
        equal_file import-bundle.describe-dir import-bundle.describe-dir.2

        end
    fi

    start "serve archival"
    # feed results of `import bundle` to `serve` via `curl`, then check
    # that the results are the same

    mkdir -p serve
    if [[ -z "$in_wine" ]]; then
        python3 -m hoardy_web serve --host 127.1.1.1 --implicit --archive-to serve &
    else
        wine python -m hoardy_web serve --host 127.1.1.1 --implicit --archive-to serve &
    fi
    tmppid=$!
    sleep 3

    # just to be sure
    curl "http://127.1.1.1:3210/hoardy-web/server-info" > serve.info 2> /dev/null
    fixed_file "$src" serve.info

    # feed it some data
    while IFS= read -r -d $'\0' fname; do
        zcat "$fname" | curl --data-binary "@-" -H "Content-type: application/x-wrr+cbor" "http://127.1.1.1:3210/pwebarc/dump"
    done < "$sinput0"

    # kill immediately, which must work
    kill "$tmppid"
    tmppid=

    # ensure no .part files are left
    find serve -name '*.part' > serve.parts

    if [[ -s serve.parts ]]; then
        cat serve.parts
        error "serve left some \`.part\` files"
    fi

    # check equality to import-bundle
    while IFS= read -r -d $'\0' fname; do
        if ! diff "$fname" "serve/default/${fname#import-bundle/}" > /dev/null ; then
            error "$fname is not the same"
        fi
    done < "$sinput0"

    end

    if [[ -z "$in_wine" ]]; then
        start "mirror urls"

        fixed_stdio "$src" mirror-urls \
                    self mirror --copy --to mirror-urls --output hupq_n \
                    "${uexprs[@]}" \
                    "$idir"
        [[ -n "$do_fixed_dir" ]] && fixed_dir "$src" mirror-urls

        end

        start "mirror responses"

        fixed_stdio "$src" mirror-responses \
                    self mirror --to mirror-responses --output hupq_n \
                    "$idir"
        [[ -n "$do_fixed_dir" ]] && fixed_dir "$src" mirror-responses

        end

        start get

        while IFS= read -r -d $'\0' path; do
            ok_no_stderr self get "${exprs[@]}" "$path"
            ok_no_stderr self get --sniff-force "${exprs[@]}" "$path"
            ok_no_stderr self get --sniff-paranoid "${exprs[@]}" "$path"
        done < "$sinput0"

        end

        start run

        while IFS= read -r -d $'\0' path; do
            ok_no_stderr self run cat "$path"
            ok_no_stderr self run -n 2 -- diff "$path" "$path"
        done < "$sinput0"

        end

        start "stream --format=raw"

        ok_selfsame stream-raw   "$idir" "$input0" self stream --format=raw "${exprs[@]}"
        ok_selfsame stream-raw-u "$idir" "$input0" self stream --format=raw -u "${exprs[@]}"

        end

        start "stream --format=json"

        ok_selfsame stream-json    "$idir" "$input0" self stream --format=json "${exprs[@]}"
        ok_selfsame stream-json-u  "$idir" "$input0" self stream --format=json -u "${exprs[@]}"

        end

        #start "stream --format=cbor"

        #ok_selfsame stream-cbor    "$idir" "$input0" self stream --format=cbor "${exprs[@]}"
        #ok_selfsame stream-cbor-u  "$idir" "$input0" self stream --format=cbor -u "${exprs[@]}"

        #end
    fi

    cd /
    rm -rf "$tmpdir"
done

finish
