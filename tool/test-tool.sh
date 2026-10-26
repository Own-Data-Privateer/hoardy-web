#!/usr/bin/env bash

#set -x

. ../vendor/kisstdlib/devscript/test-cli-lib.sh

usage() {
    cat << EOF
# usage: $0 [--help] [--set-tag TAG] [--wine] [--all|--subset NUM] [--long|--short NUM] [--include TARGET]* [--exclude TARGET]* [--keep] PATH [PATH ...]

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

## Preparing inputs for this script

- Make an \`--stdin0\` input and test on it, as if it was a WRR bundle:

  \`\`\`
  hoardy-web find -z ~/hoardy-web/latest/archiveofourown.org ~/hoardy-web/latest/example.org > ./bunch.wrrtest
  $0 ./bunch.wrrtest
  \`\`\`

- Update the contents of a \`*.wrrtest\` file under \`hoardy-web organize --move\`:

  \`\`\`
  hoardy-web organize --quiet --dry-run --zero-terminated --print-remap --move --to-one-of ~/hoardy-web/raw/* --stdin0 < ./bunch.wrrtest > ./bunch.wrrtest.new
  \`\`\`
EOF
}

PACKAGE=hyweb
TAG=$(git log --format="%H" | head -n 1)

ORIG_PWD=$PWD
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
    local dst="$1"
    local input="$2"
    local stdin0="$3"
    shift 3

    ok_stdio "$dst" "$@" "$input"
    ok_stdio "$dst-stdin0" "$@" --stdin0 < "$stdin0"
    equal_file "$dst.stdio" "$dst-stdin0.stdio"
}

ok_fixed_stdio_selfsame() {
    local src="$1"
    local dst="$2"
    local input="$3"
    local stdin0="$4"
    shift 4

    ok_selfsame "$dst" "$input" "$stdin0" "$@"
    sed -i "s%$TESTS_DIR/%./%g" "$dst.stdio"
    fixed_file "$src" "$dst.stdio"
}

[[ $# < 1 ]] && die "need at least one source"

subset=
short=
keep=
args=()

while (($# > 0)); do
    case "$1" in
        --help)
            usage;
            exit 0;
            ;;
        --set-tag)
            TAG="$2"
            shift
            ;;
        --wine)
            in_wine=1
            ;;
        --all)
            subset=
            ;;
        --subset)
            subset=$2
            shift
            ;;
        --long)
            short=
            ;;
        --short)
            short=$2
            shift
            ;;
        --include)
            INCLUDE+=("$2")
            shift
            ;;
        --exclude)
            EXCLUDE+=("$2")
            shift
            ;;
        --keep)
            keep=1
            ;;
        --)
            shift
            args+=("$@")
            break
            ;;
        *)
            args+=("$1")
            ;;
    esac
    shift
done

for arg in "${args[@]}"; do
    src=$(readlink -f "$arg")

    # generate an ID for this `$src`
    INPUT=$(echo "$src" | sha256sum - | sed -E 's/^(......).*/\1/')

    setup_tests

    do_fixed_dir=1
    if [[ -z "$in_wine" ]]; then
        if [[ -f "$src" ]] && [[ "$src" =~ .*\.wrrb ]]; then
            # these can be made with `cat`ting a bunch of .wrr files together
            echo "# Testing fixed-outputness on bundle $src in $TESTS_DIR ..."
            stdin0="$TESTS_DIR/input"
            find "$src" -type f -print0 > "$stdin0"
        elif [[ -f "$src" ]]; then
            # these can be made with `hoardy-web find -z`
            echo "# Testing fixed-outputness on stdin0 $src in $TESTS_DIR ..."
            stdin0="$src"
        elif [[ -d "$src" ]]; then
            stdin0="$TESTS_DIR/input"
            if [[ -z "$subset" ]]; then
                echo "# Testing fixed-outputness on whole dir $src in $TESTS_DIR ..."
                find "$src" -type f -print0 | sort -z > "$stdin0"
            else
                echo "# Testing fixed-outputness on a random subset (n=$subset) of dir $src in $TESTS_DIR ..."
                find "$src" -type f -print0 | shuf -z | head -zn "$subset" > "$stdin0"
                do_fixed_dir=
            fi
        else
            error "can't run tests on $src"
            continue
        fi
    else
        if [[ -f "$src" ]] && [[ "$src" =~ .*\.wrrb ]]; then
            echo "# Testing fixed-outputness on bundle $src in $TESTS_DIR ..."
        elif [[ -f "$src" ]]; then
            error "testing on $src is not supported"
            continue
        elif [[ -d "$src" ]]; then
            echo "# Testing fixed-outputness on whole dir $src in $TESTS_DIR ..."
            find "$src" -type f -print0 | win32path0_many > "$TESTS_DIR/src"
            src="$TESTS_DIR/src"
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

    cd "$TESTS_DIR"

    # import the inputs
    begin import bundle source
    idir=import-bundle
    if [[ -z "$in_wine" ]]; then
        ok_no_stderr import-bundle self import bundle --quiet --stdin0 --to $idir < "$stdin0"
    else
        ok self import bundle --quiet --to $idir "$(win32path "$src")"
    fi
    describe-forest $idir > $idir.describe-dir
    num_inputs=$(cat $idir.describe-dir | grep reg | wc -l)
    [[ -n "$do_fixed_dir" ]] && fixed_file "$src" $idir.describe-dir
    end

    # create `--stdin0` input
    input0=input0
    find $idir -type f -print0 | sort -z > "$input0"

    # ... and its short subset
    if [[ -n "$short" ]]; then
        sinput0=sinput0
        cat "$input0" | shuf -z | head -zn "$short" > "$sinput0"
    else
        sinput0="$input0"
    fi

    if [[ -z "$in_wine" ]] && start "stream .part filter"; then
        # test that `.part` files get filtered out properly

        # run `stream`
        ok_stdio dotpart-1 self stream --format=raw -ue url $idir

        # generate some `.part` files
        while IFS= read -r -d $'\0' fname; do
            cp "$fname" "$fname.part"
        done < "$sinput0"

        # run `stream` again
        ok_stdio dotpart-2 self stream --format=raw -ue url $idir

        # remove `.part` files
        while IFS= read -r -d $'\0' fname; do
            rm "$fname.part"
        done < "$sinput0"

        # ensure the above two `stream`s produced same results
        equal_file dotpart-1.stdio dotpart-2.stdio
    fi

    if [[ -z "$in_wine" ]] && start "find snapshot"; then
        # test `find` outputs
        ok_fixed_stdio_selfsame "$src" find-200-1024 $idir "$input0" \
            self find --status-re .200C --and "response.body|len|> 1024"

        ok_fixed_stdio_selfsame "$src" find-html-potter $idir "$input0" \
            self find --response-mime text/html --grep-re '\bPotter\b'
    fi

    if [[ -z "$in_wine" ]] && start "pprint sanity"; then
        # test `pprint`
        ok_selfsame pprint $idir "$input0" self pprint
        ok_selfsame pprint-u $idir "$input0" self pprint -u
    fi

    if [[ -z "$in_wine" ]] && start "stream sanity"; then
        # test `stream`
        ok_selfsame stream $idir "$input0" self stream "${exprs[@]}"
        ok_selfsame stream-u $idir "$input0" self stream -u "${exprs[@]}"
    fi

    if [[ -z "$in_wine" ]] && start "organize sanity"; then
        # ensure `organize --copy` works
        ok_no_stderr organize-main self organize --quiet --no-defer --no-fsync --copy --to organize-main $idir
        equal_forest_dir $idir.describe-dir organize-main

        # ensure `organize --(copy|hardlink|symlink) --keep-duplicates` actually duplicate things
        ok_no_stderr organize-copydup self organize --quiet --no-defer --no-fsync --copy --keep-duplicates --to organize-main $idir
        ok_no_stderr organize-harddup self organize --quiet --no-defer --no-fsync --hardlink --keep-duplicates --to organize-main $idir
        # do it twice so that some files would be reported as "ref" by `describe-forest`
        ok_no_stderr organize-harddup self organize --quiet --no-defer --no-fsync --hardlink --keep-duplicates --to organize-main $idir
        ok_no_stderr organize-symdup self organize --quiet --no-defer --no-fsync --symlink --keep-duplicates --to organize-main $idir

        describe-forest organize-main > organize-main.describe-dir
        num_reg=$(cat organize-main.describe-dir | grep 'wrr reg ' | wc -l)
        num_ref=$(cat organize-main.describe-dir | grep 'wrr ref ' | wc -l)
        num_sym=$(cat organize-main.describe-dir | grep 'wrr sym ' | wc -l)
        if ((num_reg != 3 * num_inputs)) || ((num_ref != num_inputs)) || ((num_sym != num_inputs)); then
            error "organize --(copy|hardlink|symlink) --keep-duplicates: did not duplicate all the inputs properly"
        fi

        for defer in defer no-defer; do
            suffix=
            if [[ "$defer" != "defer" ]]; then
                suffix=-$defer
            fi

            if start "organize --$defer --copy sanity"; then
                # ensure `--copy` works and deduplicates things
                ok_no_stderr organize-copy$suffix self organize --quiet --$defer --copy --to organize-copy$suffix organize-main
                equal_forest_dir $idir.describe-dir organize-copy$suffix
            fi

            if start "organize --$defer --hardlink sanity"; then
                # ensure `organize --hardlink` works and deduplicates things
                ok_no_stderr organize-hardlink$suffix self organize --quiet --$defer --hardlink --to organize-hardlink$suffix organize-main
                equal_forest_dir $idir.describe-dir organize-hardlink$suffix
            fi

            if start "organize --$defer --symlink sanity"; then
                # ensure `organize --symlink` works and deduplicates things
                ok_no_stderr organize-symlink$suffix self organize --quiet --$defer --symlink --output hupq_msn --to organize-symlink$suffix organize-main
                describe-forest organize-symlink$suffix > organize-symlink$suffix.describe-dir
                num_sym=$(cat organize-symlink$suffix.describe-dir | grep 'wrr sym ' | wc -l)
                if ((num_sym != num_inputs)); then
                    error "organize --$defer --symlink: some outputs appear to be missing"
                fi
            fi

            if start "organize --$defer --move sanity"; then
                # make a `organize --hardlink --keep-duplicates` copy of `organize-main` and ensure it looks like `organize-main`, except without symlinks
                ok_no_stderr organize-main-copy$suffix self organize --quiet --hardlink --keep-duplicates --$defer --to organize-main-copy$suffix organize-main
                describe-forest organize-main-copy$suffix > organize-main-copy$suffix.describe-dir
                num_reg=$(cat organize-main-copy$suffix.describe-dir | grep 'wrr reg ' | wc -l)
                num_ref=$(cat organize-main-copy$suffix.describe-dir | grep 'wrr ref ' | wc -l)
                num_sym=$(cat organize-main-copy$suffix.describe-dir | grep 'wrr sym ' | wc -l)
                if ((num_reg != 3 * num_inputs)) || ((num_ref != 2 * num_inputs)) || ((num_sym != 0)); then
                    error "organize --hardlink --keep-duplicates --$defer: did not duplicate all the inputs properly"
                fi

                # ensure `organize --move` works and deduplicates things
                ok_no_stderr organize-move$suffix self organize --quiet --$defer --move --to organize-move$suffix organize-main-copy$suffix
                equal_forest_dir $idir.describe-dir organize-move$suffix

                # ensure `organize --move` left no leftovers
                describe-forest organize-main-copy$suffix > organize-main-copy$suffix.describe-dir2
                leftovers=$(cat organize-main-copy$suffix.describe-dir2 | grep -vE ' dir$' | wc -l)
                if ((leftovers != 0)); then
                    abbrev_file organize-main-copy$suffix.describe-dir2
                    error "organize --$defer --move: left some files over in organize-main-copy$suffix"
                fi

                if [[ -e "organize-symlink$suffix" ]]; then
                    # ensure `organize --move` fails and is a noop for symlink inputs
                    retcode_stdio 1 organize-move-symlink$suffix self organize --quiet --$defer --move --to organize-move-symlink$suffix organize-symlink$suffix
                    if [[ -e organize-move-symlink$suffix ]]; then
                        error "organize --$defer --move: produced some outputs for symlink inputs"
                    fi
                    equal_forest_dir organize-symlink$suffix.describe-dir organize-symlink$suffix
                fi
            fi
        done

        # ensure the following are noops

        if [[ -e organize-copy ]] && start "organize --copy repeatedly is noop"; then
            organize-reorganize-copy() {
                ok self organize --copy --to organize-main organize-copy
                ok self organize --copy --to organize-copy organize-main
                ok self organize --hardlink --to organize-copy organize-main
            }
            ok_no_stderr organize-reorganize-copy organize-reorganize-copy
        fi

        if [[ -e organize-hardlink ]] && start "organize --hardlink repeatedly is noop"; then
            organize-reorganize-hardlink() {
                ok self organize --hardlink --to organize-main organize-hardlink
                ok self organize --hardlink --to organize-hardlink organize-main
                ok self organize --copy --to organize-hardlink organize-main
            }
            ok_no_stderr organize-reorganize-hardlink organize-reorganize-hardlink
        fi

        if [[ -e organize-symlink ]] && start "organize --(copy|hardlink) symlinks repeatedly is noop"; then
            organize-reorganize-isymlinks() {
                ok self organize --copy --to organize-main organize-symlink
                ok self organize --hardlink --to organize-main organize-symlink
            }
            ok_no_stderr organize-reorganize-isymlinks organize-reorganize-isymlinks
        fi

        if [[ -e organize-copy ]] && [[ -e organize-hardlink ]] && [[ -e organize-symlink ]] && start "organize --symlink repeatedly is noop"; then
            organize-reorganize-symlink() {
                ok self organize --symlink --output hupq_msn --to organize-symlink organize-main
                ok self organize --symlink --output hupq_msn --to organize-symlink organize-copy
                ok self organize --symlink --output hupq_msn --to organize-symlink organize-hardlink
            }
            ok_no_stderr organize-reorganize-symlink organize-reorganize-symlink
        fi
    fi

    if [[ -z "$in_wine" ]] && start "organize --dry-run sanity"; then
        # ensure than `organize --dry-run` generates no results
        for kind in copy hardlink symlink move; do
            ok_no_stderr organize-dry-run-$kind self organize --quiet --dry-run --$kind --to organize-dry-run-$kind $idir
            if [[ -e organize-dry-run-$kind ]]; then
                error "organize --dry-run --$kind: produced some outputs"
            fi
        done
    fi

    if [[ -z "$in_wine" ]] && start "organize --symlink --latest snapshot"; then
        # test `organize --symlink --latest` outputs
        ok_fixed_stdio "$src" organize-sl \
            self organize --symlink --latest --output hupq --to organize-sl $idir

        ok_fixed_stdio "$src" organize-sls \
            self organize --symlink --latest --output hupq --paths-sorted --walk-sorted --to organize-sls $idir

        # TODO: this, currently broken
        # equal_dir organize-sl organize-sls
    fi

    if [[ -z "$in_wine" ]] && start "organize --symlink --latest sanity"; then
        lines=$(cat "$input0" | tr '\0' '\n' | wc -l)

        cat "$input0" | head -zn $((lines/3 + 1)) | \
            ok_fixed_stdio "$src" organize-seq1 \
                self organize --symlink --latest --output hupq --to organize-seq --stdin0

        cat "$input0" | head -zn $((lines*2/3 + 1)) | \
            ok_fixed_stdio "$src" organize-seq2 \
                self organize --symlink --latest --output hupq --to organize-seq --stdin0

        cat "$input0" | tail -zn $((lines*2/3 + 1)) | \
            ok_fixed_stdio "$src" organize-seq3 \
                self organize --symlink --latest --output hupq --to organize-seq --stdin0

        equal_dir organize-sl organize-seq
    fi

    if start "serve sanity"; then
        # feed results of `import bundle` to `serve` via `curl`, then check
        # that the results are the same

        mkdir -p serve
        if [[ -z "$in_wine" ]]; then
            python3 -m hoardy_web serve --host 127.1.1.1 --implicit --archive-to serve &>serve.stdout </dev/null &disown
        else
            wine python -m hoardy_web serve --host 127.1.1.1 --implicit --archive-to serve &>serve.stdout </dev/null &disown
        fi
        to_kill $!

        # wait for it to start
        ok=
        for ((i=0; i<30; ++i)); do
            curl "http://127.1.1.1:3210/hoardy-web/server-info" >serve.info 2>/dev/null
            if [[ $? == 0 ]]; then
                ok=1
                break
            fi
            sleep 1
        done

        if [[ -z "$ok" ]]; then
            tail serve.stdout
            error "serve: startup failed"
        else
            fixed_file "$src" serve.info

            submit() {
                curl --data-binary "@-" -H "Content-type: application/x-wrr+cbor" "http://127.1.1.1:3210/pwebarc/dump" 2>/dev/null
                if [[ $? != 0 ]]; then
                    error "serve: curl submission failed"
                fi
            }

            # feed it some trash
            echo -n ABC | submit
            echo -n BCD | submit

            # feed it some data
            while IFS= read -r -d $'\0' fname; do
                zcat "$fname" | submit
            done < "$sinput0"

            # kill immediately, which must work
            kill_all_to_kill

            # ensure the trash was put into fallback-default
            describe-forest serve/fallback-default > serve-fallbacks.describe-dir
            num_fallbacks=$(cat serve-fallbacks.describe-dir | grep 'wrr reg ' | wc -l)
            if ((num_fallbacks != 2)); then
                abbrev_file serve-fallbacks.describe-dir
                error "serve: fallbacks number is incorrect"
            fi
            if ! grep b5d4045c3f466fa91fe2cc6abe79232a1a57cdf104f7a26e716e0a1e2789df78 serve-fallbacks.describe-dir &>/dev/null || \
               ! grep eff1f7c83bd8f6918571a75d6e1905cc97c246c5d4cf5f16efaeeb9a0141edbb serve-fallbacks.describe-dir &>/dev/null ; then
                error "serve: fallbacks content is incorrect"
            fi

            # ensure no .part files are left
            find serve -name '*.part' > serve.parts
            if [[ -s serve.parts ]]; then
                cat serve.parts
                error "serve: left some \`.part\` files"
            fi

            # test equality to import-bundle
            while IFS= read -r -d $'\0' fname; do
                if ! diff -U 0 "$fname" "serve/default/${fname#import-bundle/}" ; then
                    error "serve: $fname is not the same"
                fi
            done < "$sinput0"
        fi
    fi

    if [[ -z "$in_wine" ]] && start "mirror urls snapshot"; then
        # test URL rendering
        ok_fixed_stdio "$src" mirror-urls \
            self mirror --copy --to mirror-urls --output hupq_n "${uexprs[@]}" $idir
        [[ -n "$do_fixed_dir" ]] && fixed_dir "$src" mirror-urls
    fi

    if [[ -z "$in_wine" ]] && start "mirror responses snapshot"; then
        # test `mirror` outputs
        ok_fixed_stdio "$src" mirror-responses \
            self mirror --to mirror-responses --output hupq_n $idir
        [[ -n "$do_fixed_dir" ]] && fixed_dir "$src" mirror-responses
    fi

    if [[ -z "$in_wine" ]] && start "get sanity"; then
        # test `get`
        while IFS= read -r -d $'\0' path; do
            ok_no_stderr get-1 self get "${exprs[@]}" "$path"
            ok_no_stderr get-2 self get --sniff-force "${exprs[@]}" "$path"
            ok_no_stderr get-3 self get --sniff-paranoid "${exprs[@]}" "$path"
        done < "$sinput0"
    fi

    if [[ -z "$in_wine" ]] && start "run sanity"; then
        # test `run`
        while IFS= read -r -d $'\0' path; do
            ok_no_stderr run-1 self run cat "$path"
            ok_no_stderr run-2 self run -n 2 -- diff "$path" "$path"
        done < "$sinput0"
    fi

    # test `stream`
    if [[ -z "$in_wine" ]] && start "stream raw sanity"; then
        ok_selfsame stream-raw   $idir "$input0" self stream --format=raw "${exprs[@]}"
        ok_selfsame stream-raw-u $idir "$input0" self stream --format=raw -u "${exprs[@]}"
    fi

    if [[ -z "$in_wine" ]] && start "stream json sanity"; then
        ok_selfsame stream-json    $idir "$input0" self stream --format=json "${exprs[@]}"
        ok_selfsame stream-json-u  $idir "$input0" self stream --format=json -u "${exprs[@]}"
    fi

    # currently broken
    if false && [[ -z "$in_wine" ]] && start "stream cbor sanity"; then
        ok_selfsame stream-cbor    $idir "$input0" self stream --format=cbor "${exprs[@]}"
        ok_selfsame stream-cbor-u  $idir "$input0" self stream --format=cbor -u "${exprs[@]}"
    fi

    # ensure none of the above modified the source dir
    begin "no source changes"
    equal_forest_dir $idir.describe-dir $idir
    end

    cd "$ORIG_PWD"
    if [[ -z "$keep" ]]; then
        rm -rf "$TESTS_DIR"
    else
        echo "keeping $TESTS_DIR"
        TESTS_DIR=
    fi
done

finish
