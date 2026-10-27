# 0032 — Identity built in-house; branch-wide PINs on registered PCs

Status: Accepted (owner, 2026-10-27) · Date: 2026-10-27 · Amends [0002](0002-stack-and-repository.md) (Better Auth) and [0005](0005-identity-and-access.md) (implementation, PIN, staff onboarding)

## Context
ADR 0005 said identity would follow Vertex Shifa with Better Auth. Vertex Shifa dropped Better Auth (its ADR 0025, after its 2026-10-20 audit): the library's tables and sessions would not follow forced RLS, UUIDv7 ids and the audit log, and it built identity on `node:crypto` instead. A restaurant also differs from a clinic: cashiers share two or three PCs per branch and switch every few minutes, many waiters and kitchen staff will never sign in from their own phone, and the restaurant must keep working through long internet outages. The S02 interview settled these points with the owner (2026-10-27).

## Decision
- **In-house identity,** copied from Vertex Shifa and adapted: Argon2id from `node:crypto` for passwords and PINs, HMAC-SHA-256 keyed hashes for codes and tokens, AES-256-GCM for secrets read back (TOTP), EdDSA JWTs for access and device tokens, Ed25519 device keys, RFC 6238 TOTP for Vertex staff. No Better Auth.
- **Staff added directly** by an owner, or by a branch manager for cashier, waiter, kitchen and driver roles in their branches; no invitation message. The phone is verified by the first OTP, which only members who sign in online receive (owners, managers, drivers). Cashiers, waiters and kitchen staff work by PIN only.
- **Branch-wide PINs:** a six-digit PIN chosen by the member on a registered PC; the server stores an Argon2id verifier (64 MiB, 3 passes) and sends it to every registered PC of the member's branches, never to hub clients or browsers, so a member signs in on any PC of the branch, offline too. The hub checks waiter PINs for paired phones (S04).
- **Accepted risk:** a stolen PC holds the branch's verifiers, encrypted with a `safeStorage` (DPAPI) key; guessing a PIN offline costs days per member, and a guessed PIN works only in person on another registered PC of that branch. Revocation, quarantine of the revoked PC's pending work and online lockouts bound the damage.
- **Soft offline window:** 7 days after the last member-list refresh; after it the PC keeps working for members who already used it, with a persistent warning, and commands are marked for the owner (S04). The kitchen never stops.
- **Password for sensitive actions:** staff and device management need the password within the last 5 minutes; a PIN is enough for daily work and manager approvals.
- **Personal devices:** owners and managers may sign in from their own browser or an unregistered install, online, back office only; OTP once per device, then password only for 90 days after last use.
- **Station hub clients:** the kitchen display has no personal sign-in; its actions are recorded as the paired station.

## Consequences
- Identity code is ours to maintain and review as security work; key rotation is not designed yet.
- `crypto.argon2` needs Node 24.7 or later; the Electron main process must offer it or a vetted Argon2id implementation (checked when S02 is implemented).
- S04 moves the member list into the local encrypted database and builds the quarantine and the per-command checks on these rules.
