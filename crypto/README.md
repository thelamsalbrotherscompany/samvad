# crypto/ — end-to-end encryption

Native crypto compiled to WASM for the browser client. Samvad **writes no cryptographic
primitives of its own** (a non-negotiable) — this vendors audited implementations.

## `mls/` — MLS (RFC 9420) group key agreement

A thin Rust wrapper around [OpenMLS](https://github.com/openmls/openmls) (MIT), compiled to
`wasm32`. It gives a room a **shared per-epoch secret** with the properties E2EE video needs:

- **forward secrecy** — a compromised key doesn't expose past media;
- **post-compromise security** — the group heals after a member rotates keys;
- **cryptographic membership** — adding or removing a participant rotates the key, so a
  departed member can't read new media and a newcomer can't read old media.

The exported epoch secret keys the frame cipher (`web/src/core/crypto/frameCrypto.ts`), so
media can flow through an SFU that **cannot read it**. The app is only the *delivery
service*: it ferries the MLS handshake bytes (key packages, commits, welcomes) between
clients over the existing E2EE data channel.

### API (`MlsSession`)

`new MlsSession(identity)` · `keyPackage()` · `createGroup()` · `addMember(kp) → {commit,
welcome}` · `join(welcome)` · `process(commit)` · `removeMember(leafIndex)` · `members()` ·
`epoch()` · `frameSecret()`.

### Build

```sh
cd crypto/mls
./build.sh    # cargo build --target wasm32 → wasm-bindgen → vendor into web/
```

The built module (`.wasm` + JS glue) is **committed** under
`web/src/core/crypto/mls/`, so the web app builds without a Rust toolchain — the Rust
source here is what regenerates it. `target/` and `pkg/` are git-ignored (build output;
they also embed absolute paths).

### Status

- ✅ Compiles to `wasm32`, full group API, loads on demand in the app.
- ⏳ Not yet wired into a live call: the mesh is already E2EE by construction (DTLS-SRTP,
  no middlebox), so this layer activates when media starts flowing through the **SFU**
  transport. The handshake-delivery plumbing over the data channel, MLS↔lobby membership
  sync, and multi-party interop testing are the remaining work.
