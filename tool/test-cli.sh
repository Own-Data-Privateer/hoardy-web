#!/usr/bin/env bash

#set -x

usage() {
    cat << EOF
# usage: $0 [--help] [--all|--subset NUM] [--long|--short NUM] PATH [PATH ...]

Sanity check and test \`hoardy-web\` command-line interface.

## Examples

- Run tests on each of given WRR bundles:

  \`\`\`
  $0 ~/Downloads/Hoardy-Web-export-*.wrrb
  \`\`\`

- Run tests on all WRR files in a given directory:

  \`\`\`
  $0 ~/hoardy-web/latest/archiveofourown.org
  \`\`\`

- Run tests on a random subset of WRR files in a given directory:

  \`\`\`
  $0 --subset 100 ~/hoardy-web/raw
  \`\`\`

- Run tests on each of given WRR bundles, except run long tests on a small subset of each:

  \`\`\`
  $0 --short 16 ~/Downloads/Hoardy-Web-export-*.wrrb
  \`\`\`

- Make \`--stdin0\` input and test on it, as if it was a WRR bundle:

  \`\`\`
  hoardy-web find -z ~/hoardy-web/latest/archiveofourown.org ~/hoardy-web/latest/example.org > ./bunch.wrrtest
  $0 ./bunch.wrrtest
  \`\`\`
EOF
}

errors=0
task_errors=0
error() {
    echo -e "\e[1;31m" >&2
    echo -n "$@" >&2
    echo -e "\e[0m" >&2
    ((errors+=1))
    ((task_errors+=1))
}

die() {
    error "$@"
    exit 1
}

[[ $# < 1 ]] && die "need at least one source"

umask 077
trap '[[ -n "$td" ]] && rm -rf "$td"' 0

opts=1
subset=
short=

while (($# > 0)); do
    if [[ -n "$opts" ]]; then
        case "$1" in
        --help) usage; exit 0; ;;
        --all) subset= ; shift ; continue ;;
        --subset) subset=$2 ; shift 2 ; continue ;;
        --long) short= ; shift ; continue ;;
        --short) short=$2 ; shift 2 ; continue ;;
        --) opts= ; shift ; continue ;;
        esac
    fi

    src=$1
    shift

    td=$(mktemp --tmpdir -d hoadry-web-test-cli-XXXXXXXX)
    echo "tmpdir $td"

    raw() {
        python3 -m hoardy_web "$@"
    }

    noerr_quiet() {
        raw "$@" > "$td/stdout" 2> "$td/stderr"
        code=$?
        if ((code != 0)); then
            cat "$td/stderr" >&2
            die "failed with code $code"
        fi
    }

    noerr() {
        noerr_quiet "$@"
        cat "$td/stderr" >&2
    }

    nostderr() {
        noerr "$@"
        if [[ -s "$td/stderr" ]]; then
            error "$@ failed because stderr is not empty"
        fi
    }

    nostderr_eq() {
        input=$1
        stdin0=$2
        shift 2

        nostderr "$@" "$input"
        mv "$td/stdout" "$td/stdout_a"

        nostderr "$@" --stdin0 < "$stdin0"
        mv "$td/stdout" "$td/stdout_b"

        if ! diff -U 0 "$td/stdout_a" "$td/stdout_b" ; then
            error "$@ failed because outputs on plain PATHs and on \`--stdin0\` are not equal"
        fi
    }

    uexprs=( \
        -e net_url \
        -e url \
        -e pretty_url \
    )
    exprs=( \
        "${uexprs[@]}" \
        -e "net_url|to_ascii|sha256|take_prefix 4" \
        -e "response.body|eb|to_utf8|sha256" \
    )

    do_compare=1
    if [[ -f "$src" ]] && [[ "$src" =~ .*\.wrrb ]]; then
        # these can be made with `cat`ting a bunch of .wrr files together
        echo "Running tests on bundle $src..."
        stdin0="$td/input"
        find "$src" -type f -print0 > "$stdin0"
    elif [[ -f "$src" ]]; then
        # these can be made with `hoardy-web find -z`
        echo "Running tests on stdin0 $src..."
        stdin0="$src"
    elif [[ -d "$src" ]]; then
        stdin0="$td/input"
        if [[ -z "$subset" ]]; then
            echo "Running tests on all of $src..."
            find "$src" -type f -print0 | sort -z > "$stdin0"
        else
            echo "Running tests on a random subset (n=$subset) of $src..."
            find "$src" -type f -print0 | shuf -z | head -zn "$subset" > "$stdin0"
            do_compare=
        fi
    else
        die "can't run tests on $src"
    fi

    compare_dir() {
        if [[ -z "$do_compare" ]]; then
            return
        fi

        expected="$src.$1.describe-dir"
        got="$td/$1.describe-dir"

        ./development/describe-dir.py --no-mtime "$td/$1" > "$got"

        if ! [[ -e "$expected" ]]; then
            mv "$got" "$expected"
            echo -n " created $expected"
            return
        fi

        if ! diff -U 0 "$expected" "$got"; then
            mv "$got" "$expected.got"
            error "failed to compare_dir on $1"
        fi
    }

    task_started=

    start() {
        echo -n "$1"
        task_started=$(date +%s)
        task_errors=0
    }

    end() {
        now=$(date +%s)
        echo " $task_errors errors, $((now-task_started)) seconds"
    }

    start "  import bundle..."

    noerr_quiet import bundle --stdin0 --to "$td/import-bundle" < "$stdin0"
    compare_dir "import-bundle"

    end

    idir="$td/import-bundle"

    input0="$td/input0"
    find "$idir" -type f -print0 | sort -z > "$input0"

    start "  find..."

    nostderr_eq "$idir" "$input0" find --and "status|~= .200C" --and "response.body|len|> 1024"

    end

    start "  pprint..."

    nostderr_eq "$idir" "$input0" pprint
    nostderr_eq "$idir" "$input0" pprint -u

    end

    start "  stream..."

    nostderr_eq "$idir" "$input0" stream "${exprs[@]}"
    nostderr_eq "$idir" "$input0" stream -u "${exprs[@]}"

    end

    start "  organize..."

    noerr_quiet organize --copy --to "$td/organize" "$idir"
    noerr_quiet organize --hardlink --to "$td/organize2" "$td/organize"
    noerr_quiet organize --symlink --output hupq_msn --to "$td/organize3" "$td/organize"

    {
        raw organize --copy --to "$td/organize" "$td/organize2"
        raw organize --hardlink --to "$td/organize" "$td/organize2"
        raw organize --copy --to "$td/organize2" "$td/organize"
        raw organize --hardlink --to "$td/organize2" "$td/organize"

        raw organize --hardlink --to "$td/organize" "$td/organize3"
        raw organize --symlink --output hupq_msn --to "$td/organize3" "$td/organize"
    } &> "$td/reorganize-log"

    if [[ -s "$td/reorganize-log" ]]; then
        cat "$td/reorganize-log"
        die "re-organize is not a noop"
    fi

    end

    start "  export urls..."

    noerr export mirror --to "$td/export-urls" --output hupq_n \
          "${uexprs[@]}" \
          "$idir"
    compare_dir "export-urls"

    end

    start "  export mirror..."

    noerr export mirror --to "$td/export-mirror" --output hupq_n \
          "$idir"
    compare_dir "export-mirror"

    end

    if [[ -n "$short" ]]; then
        sinput0="$td/sinput0"
        cat "$input0" | shuf -z | head -zn "$short" > "$sinput0"
    else
        sinput0="$input0"
    fi

    start "  get..."

    cat "$sinput0" | while IFS= read -r -d $'\0' path; do
        nostderr get "${exprs[@]}" "$path"
        nostderr get --sniff-force "${exprs[@]}" "$path"
        nostderr get --sniff-paranoid "${exprs[@]}" "$path"
    done

    end

    start "  run..."

    cat "$sinput0" | while IFS= read -r -d $'\0' path; do
        nostderr run cat "$path"
        nostderr run -n 2 -- diff "$path" "$path"
    done

    end

    start "  stream --format=raw..."

    nostderr_eq "$idir" "$input0" stream --format=raw "${exprs[@]}"
    nostderr_eq "$idir" "$input0" stream --format=raw -u "${exprs[@]}"

    end

    start "  stream --format=json..."

    nostderr_eq "$idir" "$input0" stream --format=json "${exprs[@]}"
    nostderr_eq "$idir" "$input0" stream --format=json -u "${exprs[@]}"

    end

    #start "  stream --format=cbor..."

    #nostderr_eq "$idir" "$input0" stream --format=cbor "${exprs[@]}"
    #nostderr_eq "$idir" "$input0" stream --format=cbor -u "${exprs[@]}"

    #end

    rm -rf "$td"
done

echo "total: $errors errors"
if ((errors > 0)); then
    exit 1
fi
