//! Native (non-wasm) integration tests for the MLS group flow. `cargo test` runs these on
//! the host, so they verify the actual cryptographic behaviour — not just that it compiles.

use samvad_mls::MlsSession;

// `.ok().expect(..)` rather than `.unwrap()`: the wasm-facing error type isn't Debug on host.
fn ok<T>(r: Result<T, wasm_bindgen::JsError>, what: &str) -> T {
    r.ok().unwrap_or_else(|| panic!("{what} failed"))
}

#[test]
fn two_parties_agree_on_the_frame_secret() {
    let mut host = ok(MlsSession::new("host"), "new host");
    let mut guest = ok(MlsSession::new("guest"), "new guest");

    ok(host.create_group(), "create group");

    // Guest publishes a key package; host admits them.
    let kp = ok(guest.key_package(), "guest key package");
    let add = ok(host.add_member(&kp), "add member");
    ok(guest.join(&add.welcome()), "guest join");

    // The whole point: both sides derive the *same* secret, and a non-member never could.
    let hs = ok(host.frame_secret(), "host secret");
    let gs = ok(guest.frame_secret(), "guest secret");
    assert_eq!(hs, gs, "host and guest must derive the same frame secret");
    assert_eq!(hs.len(), 32);
    assert_eq!(ok(host.epoch(), "host epoch"), ok(guest.epoch(), "guest epoch"));
}

#[test]
fn removing_a_member_rotates_the_key() {
    let mut host = ok(MlsSession::new("host"), "new host");
    let mut guest = ok(MlsSession::new("guest"), "new guest");

    ok(host.create_group(), "create group");
    let kp = ok(guest.key_package(), "guest key package");
    let add = ok(host.add_member(&kp), "add member");
    ok(guest.join(&add.welcome()), "guest join");

    let before = ok(host.frame_secret(), "secret before");
    let epoch_before = ok(host.epoch(), "epoch before");

    // Remove the guest (leaf index 1; the host is 0).
    ok(host.remove_member(1), "remove member");

    let after = ok(host.frame_secret(), "secret after");
    assert_ne!(before, after, "removing a member must rotate the key");
    assert!(ok(host.epoch(), "epoch after") > epoch_before, "epoch must advance");
}

#[test]
fn three_parties_all_agree() {
    let mut host = ok(MlsSession::new("host"), "new host");
    let mut a = ok(MlsSession::new("alice"), "new alice");
    let mut b = ok(MlsSession::new("bob"), "new bob");

    ok(host.create_group(), "create group");

    // Add Alice.
    let kp_a = ok(a.key_package(), "alice kp");
    let add_a = ok(host.add_member(&kp_a), "add alice");
    ok(a.join(&add_a.welcome()), "alice join");

    // Add Bob — Alice must process the commit to stay in sync.
    let kp_b = ok(b.key_package(), "bob kp");
    let add_b = ok(host.add_member(&kp_b), "add bob");
    ok(a.process(&add_b.commit()), "alice processes bob's commit");
    ok(b.join(&add_b.welcome()), "bob join");

    let hs = ok(host.frame_secret(), "host secret");
    let as_ = ok(a.frame_secret(), "alice secret");
    let bs = ok(b.frame_secret(), "bob secret");
    assert_eq!(hs, as_, "host and alice agree");
    assert_eq!(hs, bs, "host and bob agree");
}
