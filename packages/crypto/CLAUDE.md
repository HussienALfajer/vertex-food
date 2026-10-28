# packages/crypto

Keyed hashes and sealed values shared by the API, the worker and the WhatsApp gateway (ADR 0032, 0034): `KeyedHash` (HMAC-SHA-256 with a purpose per use), `SecretBox` (AES-256-GCM with a context per value, `v1.<iv>.<sealed>.<tag>`) and `safeEqual`. Copied from Vertex Shifa's `packages/crypto`; moved here from `apps/api` with S03.

## Rules
- No keys here: each caller builds its own instances from its configuration (identity: `IDENTITY_HASH_KEY`, `IDENTITY_ENCRYPTION_KEY`; messaging: `MESSAGING_HASH_KEY`, `MESSAGING_ENCRYPTION_KEY`), so a value of one never opens or matches under the other.
- Every hash names its purpose and every sealed value its context (the row or use it belongs to); never reuse one for another use.
- `open` answers `undefined` for an altered, moved or foreign value: callers treat that as absent, never as an error that logs the value.
- No framework, no I/O beyond `node:crypto`.

Run: `pnpm --filter @vertex-food/crypto test`.
