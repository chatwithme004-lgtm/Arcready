#!/bin/sh
# Copies the shared checker modules into web/ (the page is static, no bundler).
cd "$(dirname "$0")/.." && cp src/source.js src/rules.js web/
