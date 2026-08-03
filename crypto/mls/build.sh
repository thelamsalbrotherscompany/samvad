#!/usr/bin/env sh
# Rebuild the MLS WASM module and vendor it into the web app.
#
# Prereqs:
#   - the wasm32-unknown-unknown target for your Rust toolchain
#       (rustup target add wasm32-unknown-unknown, or drop the rust-std component in)
#   - wasm-bindgen CLI matching the wasm-bindgen crate version in Cargo.lock
#       (cargo install wasm-bindgen-cli --version <that version>, or a prebuilt binary)
set -e
cd "$(dirname "$0")"

# Strip absolute machine paths (dependency panic locations, etc.) out of the binary so the
# committed .wasm never embeds a developer's home or project path. Values come from the
# environment — nothing hardcodes a path.
HOME_DIR="${USERPROFILE:-$HOME}"
PROJ="$(pwd -W 2>/dev/null || pwd)"
US=$(printf '\037') # unit separator: CARGO_ENCODED_RUSTFLAGS is \x1f-delimited (handles spaces)
export CARGO_ENCODED_RUSTFLAGS="--remap-path-prefix=${HOME_DIR}=~${US}--remap-path-prefix=${PROJ}=crate"

cargo build --release --target wasm32-unknown-unknown
wasm-bindgen target/wasm32-unknown-unknown/release/samvad_mls.wasm \
  --out-dir pkg --target web --out-name samvad_mls

DEST=../../web/src/core/crypto/mls
mkdir -p "$DEST"
cp pkg/samvad_mls.js pkg/samvad_mls.d.ts pkg/samvad_mls_bg.wasm pkg/samvad_mls_bg.wasm.d.ts "$DEST/"
echo "vendored MLS module -> $DEST"
