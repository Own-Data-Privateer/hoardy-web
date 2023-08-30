#!/usr/bin/env bash
# Purpose: generate Chromium key in PEM format and generate a JSON with its public key
# based on https://stackoverflow.com/questions/37317779/making-a-unique-extension-id-and-key-for-chrome-extension

set -e

key=${1:-chromium.key.pem}
output=${2:-manifest-chromium-id.json}

if [[ ! -e "$key" ]]; then
    echo "Generating a new key!"
    openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -out "$key"
fi

{
    echo "{"
    #echo -n '"id": "'
    #openssl rsa -in "$key" -pubout -outform DER 2>/dev/null | shasum -a 256 | head -c32 | tr 0-9a-f a-p
    #echo '",'

    echo -n '"key": "'
    openssl rsa -in "$key" -pubout -outform DER 2>/dev/null | openssl base64 -A
    echo '"'
    echo "}"
} > "$output"
