#!/bin/sh -e

black $1 .
mypy
pytest -k 'not slow'
pylint .
./update-readme.sh
