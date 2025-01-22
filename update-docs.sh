#!/bin/sh -e

./update-changelog.sh
./update-readme.sh
(cd extension; ./update-readme.sh)
(cd tool; ./update-readme.sh)
(cd simple_server; ./update-readme.sh)
