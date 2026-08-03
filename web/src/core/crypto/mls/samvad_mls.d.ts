/* tslint:disable */
/* eslint-disable */

/**
 * The commit + welcome produced when admitting a member.
 */
export class AddResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The commit to broadcast to existing members, so they advance to the new epoch.
     */
    readonly commit: Uint8Array;
    /**
     * The welcome to send (only) to the newly added member, so they can join.
     */
    readonly welcome: Uint8Array;
}

/**
 * One participant's MLS state: their signing identity and, once created or joined, the
 * group. Held per call; nothing is persisted.
 */
export class MlsSession {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Admit a member from their published key package. Returns the commit (broadcast to the
     * room) and the welcome (send to the new member only). The local state advances at once.
     */
    addMember(key_package: Uint8Array): AddResult;
    /**
     * Found a new group (you become its only member and first host).
     */
    createGroup(): void;
    /**
     * The current epoch (advances on every membership change).
     */
    epoch(): bigint;
    /**
     * The 32-byte secret for this epoch, from which the frame cipher derives its key. Every
     * member derives the identical value; a non-member cannot.
     */
    frameSecret(): Uint8Array;
    /**
     * Join a group from a welcome message.
     */
    join(welcome: Uint8Array): void;
    /**
     * A fresh key package to publish so others can add you to their group. Private key
     * material is kept in this session's provider until a welcome consumes it.
     */
    keyPackage(): Uint8Array;
    /**
     * Member identities in leaf-index order (index in the array = MLS leaf index).
     */
    members(): string[];
    /**
     * Create a session for `identity` (a display name / stable id), minting a fresh
     * signature key pair and basic credential.
     */
    constructor(identity: string);
    /**
     * Apply a commit received from another member (advancing to their epoch).
     */
    process(message: Uint8Array): void;
    /**
     * Remove the member at `leaf_index`. Returns the commit to broadcast; local state
     * advances at once. (Map an identity to its index via `members`.)
     */
    removeMember(leaf_index: number): Uint8Array;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_addresult_free: (a: number, b: number) => void;
    readonly __wbg_mlssession_free: (a: number, b: number) => void;
    readonly addresult_commit: (a: number, b: number) => void;
    readonly addresult_welcome: (a: number, b: number) => void;
    readonly mlssession_addMember: (a: number, b: number, c: number, d: number) => void;
    readonly mlssession_createGroup: (a: number, b: number) => void;
    readonly mlssession_epoch: (a: number, b: number) => void;
    readonly mlssession_frameSecret: (a: number, b: number) => void;
    readonly mlssession_join: (a: number, b: number, c: number, d: number) => void;
    readonly mlssession_keyPackage: (a: number, b: number) => void;
    readonly mlssession_members: (a: number, b: number) => void;
    readonly mlssession_new: (a: number, b: number, c: number) => void;
    readonly mlssession_process: (a: number, b: number, c: number, d: number) => void;
    readonly mlssession_removeMember: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export: (a: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export3: (a: number, b: number) => number;
    readonly __wbindgen_export4: (a: number, b: number, c: number, d: number) => number;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
