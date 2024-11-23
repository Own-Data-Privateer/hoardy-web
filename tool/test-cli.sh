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
    echo -n "$*" >&2
    echo -e "\e[0m" >&2
    ((errors+=1))
    ((task_errors+=1))
}

die() {
    error "$*"
    exit 1
}

equal_file() {
    if ! diff -U 0 "$2" "$3"; then
        error "$1: equal_file failed"
    fi
}

equal_dir() {
    if ! diff -U 0 <(./development/describe-dir.py --no-mtime "$2") <(./development/describe-dir.py --no-mtime "$3"); then
        error "$1: equal_dir failed"
    fi
}

fixed_target() {
    local target="$1"
    local expected="$2.$target"
    local got="$3/$target"

    if ! [[ -e "$expected" ]]; then
        cp "$got" "$expected"
        echo " created $expected"
    elif ! diff -U 0 "$expected" "$got"; then
        cp "$got" "$expected.new"
        error "$target: fixed_target failed"
    else
        rm -f "$expected.new"
    fi
}

fixed_dir() {
    ./development/describe-dir.py --no-mtime "$3/$1" > "$3/$1.describe-dir"
    fixed_target "$1.describe-dir" "$2" "$3"
}

raw() {
    python3 -m hoardy_web "$@"
}

ok_raw() {
    raw "$@"
    code=$?
    if ((code != 0)); then
        die "$*: return code $code"
    fi
}

ok_separate() {
    local target="$1"
    local dst="$2"
    shift 2

    raw "$@" > "$dst/$target.stdout" 2> "$dst/$target.stderr"
    code=$?
    if ((code != 0)); then
        cat "$dst/$target.stderr" >&2
        die "$target: $*: return code $code"
    fi
}

ok_mixed() {
    local target="$1"
    local dst="$2"
    shift 2

    raw "$@" &> "$dst/$target.out"
    code=$?
    if ((code != 0)); then
        cat "$dst/$target.out" >&2
        die "$target: $*: return code $code"
    fi
}

no_stderr() {
    local target="$1"
    local dst="$2"
    shift 2

    ok_separate "$target" "$dst" "$@"
    if [[ -s "$dst/$target.stderr" ]]; then
        cat "$dst/$target.stderr" >&2
        error "$target: $*: stderr is not empty"
    fi
}

fixed_output() {
    local target="$1"
    local src="$2"
    local dst="$3"
    shift 3

    ok_mixed "$target" "$dst" "$@"
    sed -i "s%$dst/%./%g" "$dst/$target.out"
    fixed_target "$target.out" "$src" "$dst"
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
    td=$(readlink -f "$td")

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

    do_fixed_dir=1
    if [[ -f "$src" ]] && [[ "$src" =~ .*\.wrrb ]]; then
        # these can be made with `cat`ting a bunch of .wrr files together
        echo "# Testing on bundle $src in $td ..."
        stdin0="$td/input"
        find "$src" -type f -print0 > "$stdin0"
    elif [[ -f "$src" ]]; then
        # these can be made with `hoardy-web find -z`
        echo "# Testing on stdin0 $src in $td ..."
        stdin0="$src"
    elif [[ -d "$src" ]]; then
        stdin0="$td/input"
        if [[ -z "$subset" ]]; then
            echo "# Testing on whole dir $src in $td ..."
            find "$src" -type f -print0 | sort -z > "$stdin0"
        else
            echo "# Testing on a random subset (n=$subset) of dir $src in $td ..."
            find "$src" -type f -print0 | shuf -z | head -zn "$subset" > "$stdin0"
            do_fixed_dir=
        fi
    else
        die "can't run tests on $src"
    fi

    task_started=

    start() {
        echo -n "## $1"
        task_started=$(date +%s)
        task_errors=0
    }

    end() {
        local now=$(date +%s)
        echo " $task_errors errors, $((now-task_started)) seconds"
    }

    start "import bundle..."

    no_stderr "import-bundle" "$td" import bundle --quiet --stdin0 --to "$td/import-bundle" < "$stdin0"
    [[ -n "$do_fixed_dir" ]] && fixed_dir "import-bundle" "$src" "$td"

    end

    idir="$td/import-bundle"

    input0="$td/input0"
    find "$idir" -type f -print0 | sort -z > "$input0"

    start "find..."

    fixed_output_selfsame "find-200-1024" "$src" "$td" "$idir" "$input0" \
                          find --status-re .200C --and "response.body|len|> 1024"

    fixed_output_selfsame "find-html-potter" "$src" "$td" "$idir" "$input0" \
                          find --response-mime text/html --grep-re '\bPotter\b'

    end

    start "pprint..."

    no_stderr_selfsame "pprint" "$td" "$idir" "$input0" pprint
    no_stderr_selfsame "pprint-u" "$td" "$idir" "$input0" pprint -u

    end

    start "stream..."

    no_stderr_selfsame "stream" "$td" "$idir" "$input0" stream "${exprs[@]}"
    no_stderr_selfsame "stream-u" "$td" "$idir" "$input0" stream -u "${exprs[@]}"

    end

    start "organize..."

    no_stderr "organize-copy" "$td" \
              organize --quiet --copy --to "$td/organize" "$idir"
    equal_dir "organize-copy == import-bundle" "$td/organize" "$idir"

    no_stderr "organize-hardlink" "$td" \
              organize --quiet --hardlink --to "$td/organize2" "$td/organize"
    equal_dir "organize-hardlink == organize-copy" "$td/organize2" "$idir"

    no_stderr "organize-symlink" "$td" \
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

    fixed_output "organize-sl" "$src" "$td" \
                 organize --symlink --latest --output hupq \
                 --to "$td/organize-sl" \
                 "$idir"

    fixed_output "organize-sls" "$src" "$td" \
                 organize --symlink --latest --output hupq \
                 --paths-sorted --walk-sorted \
                 --to "$td/organize-sls" \
                 "$idir"

    # TODO: this, currently broken
    # equal_dir "organize-sls == organizes-sl" "$td/organize-sl" "$td/organize-sls"

    lines=$(cat "$input0" | tr '\0' '\n' | wc -l)

    cat "$input0" | head -zn $((lines/3 + 1)) | \
        fixed_output "organize-seq1" "$src" "$td" \
                     organize --symlink --latest --output hupq \
                     --to "$td/organize-seq" --stdin0

    cat "$input0" | head -zn $((lines*2/3 + 1)) | \
        fixed_output "organize-seq2" "$src" "$td" \
                     organize --symlink --latest --output hupq \
                     --to "$td/organize-seq" --stdin0

    cat "$input0" | tail -zn $((lines*2/3 + 1)) | \
        fixed_output "organize-seq3" "$src" "$td" \
                     organize --symlink --latest --output hupq \
                     --to "$td/organize-seq" --stdin0

    equal_dir "organize-seq = organize-sl" "$td/organize-sl" "$td/organize-seq"

    # ensure `organize` did not touch the source dir
    ./development/describe-dir.py --no-mtime "$td/import-bundle" > "$td/import-bundle.describe-dir.2"
    equal_file "organize-seq is src-pure" "$td/import-bundle.describe-dir" "$td/import-bundle.describe-dir.2"

    end

    start "export urls..."

    fixed_output "export-urls" "$src" "$td" \
        export mirror --to "$td/export-urls" --output hupq_n \
        "${uexprs[@]}" \
        "$idir"
    [[ -n "$do_fixed_dir" ]] && fixed_dir "export-urls" "$src" "$td"

    end

    start "export mirror..."

    fixed_output "export-mirror" "$src" "$td" \
       export mirror --to "$td/export-mirror" --output hupq_n \
       "$idir"
    [[ -n "$do_fixed_dir" ]] && fixed_dir "export-mirror" "$src" "$td"

    end

    if [[ -n "$short" ]]; then
        sinput0="$td/sinput0"
        cat "$input0" | shuf -z | head -zn "$short" > "$sinput0"
    else
        sinput0="$input0"
    fi

    start "get..."

    cat "$sinput0" | while IFS= read -r -d $'\0' path; do
        no_stderr "get-sniff-default" "$td"  get "${exprs[@]}" "$path"
        no_stderr "get-sniff-force" "$td"    get --sniff-force "${exprs[@]}" "$path"
        no_stderr "get-sniff-paranoid" "$td" get --sniff-paranoid "${exprs[@]}" "$path"
    done

    end

    start "run..."

    cat "$sinput0" | while IFS= read -r -d $'\0' path; do
        no_stderr "run-cat" "$td"  run cat "$path"
        no_stderr "run-diff" "$td" run -n 2 -- diff "$path" "$path"
    done

    end

    start "stream --format=raw..."

    no_stderr_selfsame "stream-raw" "$td"   "$idir" "$input0" stream --format=raw "${exprs[@]}"
    no_stderr_selfsame "stream-raw-u" "$td" "$idir" "$input0" stream --format=raw -u "${exprs[@]}"

    end

    start "stream --format=json..."

    no_stderr_selfsame "stream-json" "$td"   "$idir" "$input0" stream --format=json "${exprs[@]}"
    no_stderr_selfsame "stream-json-u" "$td" "$idir" "$input0" stream --format=json -u "${exprs[@]}"

    end

    #start "stream --format=cbor..."

    #no_stderr_selfsame "stream-cbor" "$td"   "$idir" "$input0" stream --format=cbor "${exprs[@]}"
    #no_stderr_selfsame "stream-cbor-u" "$td" "$idir" "$input0" stream --format=cbor -u "${exprs[@]}"

    #end

    rm -rf "$td"
done

echo "total: $errors errors"
if ((errors > 0)); then
    exit 1
fi
