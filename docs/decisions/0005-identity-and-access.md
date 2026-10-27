# 0005 — Identity and access: one person, many roles; devices and PIN; no email or SMS

Status: Accepted (implementation, PIN and staff onboarding amended by [0032](0032-identity-in-house-and-branch-pins.md)) · Date: 2026-10-18

## Context
A cashier may work in two restaurants and order food as a customer; a driver may drive for a restaurant and for Vertex. Restaurant PCs are shared by several cashiers per shift and often offline. The platform uses neither email nor SMS (ADR 0012).

## Decision
- **One account per person,** identified by a verified phone number (E.164; Syrian and Turkish numbers). It can hold staff roles in several tenants, a driver profile and a customer profile.
- **Staff sign-in:** phone + password with a WhatsApp OTP on a new device. **Customers:** phone + WhatsApp OTP, long-lived sessions. **Drivers:** phone + password with OTP on a new phone. **Vertex staff:** separate console accounts with mandatory TOTP.
- **Restaurant devices:** a device is registered to a tenant and branch by the owner or a manager. On a registered device, staff switch with a personal PIN (fast cashier change between shifts, offline sign-in within an offline window). Revocation applies on the next connection and wipes local data.
- **Hub clients:** the kitchen display and waiter phones pair with the branch hub by a code shown on the hub; a waiter still signs in with their PIN (ADR 0008).
- **Authorization:** role presets (owner, manager, cashier, waiter, kitchen, driver) map to permissions; owners adjust within limits; branch scope. Sensitive actions (void, refund, discount above a limit, price change, cash correction) need the permission and are audited; a manager can approve on the cashier's device with their PIN.
- **Every endpoint and sync command declares** the permission and the entitlement it needs (ADR 0013, 0020).
- **Recovery without email:** staff passwords reset by their owner; owners through Vertex support after identity checks; customers by WhatsApp OTP.
- Implementation follows Vertex Shifa ADR 0005 and its S02 (Better Auth, phone number and two-factor capabilities; devices and PIN in platform code).

## Consequences
- A person never needs a second account for a second role.
- Losing all platform OTP numbers blocks new sign-ins until a backup number is active; existing sessions and PINs keep working.
