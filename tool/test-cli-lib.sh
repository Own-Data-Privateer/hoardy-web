#!/usr/bin/env bash

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

task_started=0
start() {
    echo -n "## $1"
    task_started=$(date +%s)
    task_errors=0
}

end() {
    local now=$(date +%s)
    echo " $task_errors errors, $((now-task_started)) seconds"
}

equal_file() {
    if ! diff -U 0 "$2" "$3"; then
        error "$1: equal_file failed"
    fi
}

equal_dir() {
    if ! diff -U 0 <(describe-dir --no-mode --no-mtime "$2") <(describe-dir --no-mode --no-mtime "$3"); then
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
    describe-dir --no-mode --no-mtime "$3/$1" > "$3/$1.describe-dir"
    fixed_target "$1.describe-dir" "$2" "$3"
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

td=
tpid=

set_temp() {
    td=$(mktemp --tmpdir -d hoardy-web-test-cli-XXXXXXXX)
    td=$(readlink -f "$td")
}

[[ $# < 1 ]] && die "need at least one source"
umask 077
trap '[[ -n "$td" ]] && rm -rf "$td" ; [[ -n "$tpid" ]] && kill -9 "$tpid"' 0
