// Network and trust anchors, overridable by environment (endpoints moved once mid-event, prd.md P-24).

export const V3_WS = process.env.TALYX_V3_WS ?? 'wss://test-node-v3.portaldot.dev';

/** BEEFY authorities' Ethereum addresses, from Beefy.Authorities (prd.md A.1). */
export const AUTHORITIES = [
  '0x4d13b6aea6cd423cc48d7159ac10b26927c2b421',
  '0x4a69b8f722a9b486f9db0d243c908170012d7413',
];
export const KEYSET_COMMITMENT = '0xc745b6c2eca708396dde733c7b93f344da8eee0eb435e68fac6a77bce9c1a7d5';

/** Prefix of a Revive contract's child trie in the main trie: ":child_storage:default:" ++ trie_id. */
export const CHILD_STORAGE_PREFIX = ':child_storage:default:';
