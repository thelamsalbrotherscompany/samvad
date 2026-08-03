//! Samvad's MLS (RFC 9420) group key agreement, compiled to WASM.
//!
//! MLS gives a room a **shared group secret** with the properties E2EE video needs:
//! forward secrecy, post-compromise security, and cryptographic membership — adding or
//! removing a participant rotates the key, so a departed member cannot read new media and a
//! new member cannot read old media. The exported per-epoch secret keys the insertable-
//! streams frame cipher on the client; the SFU only ever relays ciphertext.
//!
//! This wraps the audited OpenMLS implementation (MIT) — Samvad writes no crypto of its own
//! (a non-negotiable). The app is the *delivery service*: it ships the handshake bytes
//! (key packages, commits, welcomes) between clients over the existing E2EE data channel.

use openmls::prelude::tls_codec::*;
use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;
use wasm_bindgen::prelude::*;

const CIPHERSUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;
/// Label the frame key is exported under. Fixed, so every client derives the same key.
const EXPORTER_LABEL: &str = "samvad frame key";

fn js_err<E: std::fmt::Display>(e: E) -> JsError {
    JsError::new(&e.to_string())
}

/// The commit + welcome produced when admitting a member.
#[wasm_bindgen]
pub struct AddResult {
    commit: Vec<u8>,
    welcome: Vec<u8>,
}

#[wasm_bindgen]
impl AddResult {
    /// The commit to broadcast to existing members, so they advance to the new epoch.
    #[wasm_bindgen(getter)]
    pub fn commit(&self) -> Vec<u8> {
        self.commit.clone()
    }
    /// The welcome to send (only) to the newly added member, so they can join.
    #[wasm_bindgen(getter)]
    pub fn welcome(&self) -> Vec<u8> {
        self.welcome.clone()
    }
}

/// One participant's MLS state: their signing identity and, once created or joined, the
/// group. Held per call; nothing is persisted.
#[wasm_bindgen]
pub struct MlsSession {
    provider: OpenMlsRustCrypto,
    signer: SignatureKeyPair,
    credential: CredentialWithKey,
    group: Option<MlsGroup>,
}

#[wasm_bindgen]
impl MlsSession {
    /// Create a session for `identity` (a display name / stable id), minting a fresh
    /// signature key pair and basic credential.
    #[wasm_bindgen(constructor)]
    pub fn new(identity: &str) -> Result<MlsSession, JsError> {
        let provider = OpenMlsRustCrypto::default();
        let signer = SignatureKeyPair::new(CIPHERSUITE.signature_algorithm()).map_err(js_err)?;
        signer.store(provider.storage()).map_err(js_err)?;

        let credential = CredentialWithKey {
            credential: BasicCredential::new(identity.as_bytes().to_vec()).into(),
            signature_key: signer.public().into(),
        };

        Ok(MlsSession {
            provider,
            signer,
            credential,
            group: None,
        })
    }

    /// A fresh key package to publish so others can add you to their group. Private key
    /// material is kept in this session's provider until a welcome consumes it.
    #[wasm_bindgen(js_name = keyPackage)]
    pub fn key_package(&self) -> Result<Vec<u8>, JsError> {
        let bundle = KeyPackage::builder()
            .build(
                CIPHERSUITE,
                &self.provider,
                &self.signer,
                self.credential.clone(),
            )
            .map_err(js_err)?;
        bundle
            .key_package()
            .tls_serialize_detached()
            .map_err(js_err)
    }

    /// Found a new group (you become its only member and first host).
    #[wasm_bindgen(js_name = createGroup)]
    pub fn create_group(&mut self) -> Result<(), JsError> {
        let config = MlsGroupCreateConfig::builder()
            // Put the ratchet tree in the welcome so joiners need nothing extra.
            .use_ratchet_tree_extension(true)
            .ciphersuite(CIPHERSUITE)
            .build();
        let group = MlsGroup::new(
            &self.provider,
            &self.signer,
            &config,
            self.credential.clone(),
        )
        .map_err(js_err)?;
        self.group = Some(group);
        Ok(())
    }

    /// Admit a member from their published key package. Returns the commit (broadcast to the
    /// room) and the welcome (send to the new member only). The local state advances at once.
    #[wasm_bindgen(js_name = addMember)]
    pub fn add_member(&mut self, key_package: &[u8]) -> Result<AddResult, JsError> {
        let group = self.group.as_mut().ok_or_else(|| JsError::new("no group"))?;

        let kp_in = KeyPackageIn::tls_deserialize_exact(key_package).map_err(js_err)?;
        let kp = kp_in
            .validate(self.provider.crypto(), ProtocolVersion::Mls10)
            .map_err(js_err)?;

        let (commit, welcome, _group_info) = group
            .add_members(&self.provider, &self.signer, &[kp])
            .map_err(js_err)?;
        group.merge_pending_commit(&self.provider).map_err(js_err)?;

        Ok(AddResult {
            commit: commit.tls_serialize_detached().map_err(js_err)?,
            welcome: welcome.tls_serialize_detached().map_err(js_err)?,
        })
    }

    /// Join a group from a welcome message.
    pub fn join(&mut self, welcome: &[u8]) -> Result<(), JsError> {
        let msg = MlsMessageIn::tls_deserialize_exact(welcome).map_err(js_err)?;
        let welcome = match msg.extract() {
            MlsMessageBodyIn::Welcome(w) => w,
            _ => return Err(JsError::new("not a welcome")),
        };
        let staged = StagedWelcome::new_from_welcome(
            &self.provider,
            &MlsGroupJoinConfig::default(),
            welcome,
            None,
        )
        .map_err(js_err)?;
        let group = staged.into_group(&self.provider).map_err(js_err)?;
        self.group = Some(group);
        Ok(())
    }

    /// Apply a commit received from another member (advancing to their epoch).
    pub fn process(&mut self, message: &[u8]) -> Result<(), JsError> {
        let group = self.group.as_mut().ok_or_else(|| JsError::new("no group"))?;
        let msg = MlsMessageIn::tls_deserialize_exact(message).map_err(js_err)?;
        let protocol = msg.try_into_protocol_message().map_err(js_err)?;
        let processed = group
            .process_message(&self.provider, protocol)
            .map_err(js_err)?;
        match processed.into_content() {
            ProcessedMessageContent::StagedCommitMessage(staged) => {
                group
                    .merge_staged_commit(&self.provider, *staged)
                    .map_err(js_err)?;
            }
            ProcessedMessageContent::ProposalMessage(proposal) => {
                group
                    .store_pending_proposal(self.provider.storage(), *proposal)
                    .map_err(js_err)?;
            }
            _ => {}
        }
        Ok(())
    }

    /// Remove the member at `leaf_index`. Returns the commit to broadcast; local state
    /// advances at once. (Map an identity to its index via `members`.)
    #[wasm_bindgen(js_name = removeMember)]
    pub fn remove_member(&mut self, leaf_index: u32) -> Result<Vec<u8>, JsError> {
        let group = self.group.as_mut().ok_or_else(|| JsError::new("no group"))?;
        let (commit, _welcome, _info) = group
            .remove_members(&self.provider, &self.signer, &[LeafNodeIndex::new(leaf_index)])
            .map_err(js_err)?;
        group.merge_pending_commit(&self.provider).map_err(js_err)?;
        commit.tls_serialize_detached().map_err(js_err)
    }

    /// Member identities in leaf-index order (index in the array = MLS leaf index).
    pub fn members(&self) -> Result<Vec<String>, JsError> {
        let group = self.group.as_ref().ok_or_else(|| JsError::new("no group"))?;
        let mut out = Vec::new();
        for member in group.members() {
            let id = BasicCredential::try_from(member.credential)
                .map(|c| String::from_utf8_lossy(c.identity()).into_owned())
                .unwrap_or_default();
            out.push(id);
        }
        Ok(out)
    }

    /// The current epoch (advances on every membership change).
    pub fn epoch(&self) -> Result<u64, JsError> {
        let group = self.group.as_ref().ok_or_else(|| JsError::new("no group"))?;
        Ok(group.epoch().as_u64())
    }

    /// The 32-byte secret for this epoch, from which the frame cipher derives its key. Every
    /// member derives the identical value; a non-member cannot.
    #[wasm_bindgen(js_name = frameSecret)]
    pub fn frame_secret(&self) -> Result<Vec<u8>, JsError> {
        let group = self.group.as_ref().ok_or_else(|| JsError::new("no group"))?;
        group
            .export_secret(self.provider.crypto(), EXPORTER_LABEL, &[], 32)
            .map_err(js_err)
    }
}
