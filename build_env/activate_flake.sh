#!/usr/bin/env bash
# Setup development environment variables.
#
# Useful for configuring IDE environment. E.g as a Jetbrains toolchain
# environment file.
#
# This script assumes `direnv` is installed, and uses it along with .envrc via
# nix-direnv to load the development environment defined in flake.nix.

set -xeo pipefail

DIR=$(dirname "$(readlink --canonicalize --no-newline "${BASH_SOURCE[0]}")")
pushd "$DIR" || return
direnv allow .
eval "$(direnv export bash)"
popd