#!/bin/sh -e

(cd extension; ./update-readme.sh)
(cd simple_server; ./update-readme.sh)
(cd tool; ./update-readme.sh)
./update-readme.sh
./update-changelog.sh
