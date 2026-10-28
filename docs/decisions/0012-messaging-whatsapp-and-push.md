# 0012 — Messaging: push and WhatsApp only, through our own gateway

Status: Accepted (numbers, send queue, opt-out and alerts amended by [0034](0034-platform-messaging-numbers-and-send-queue.md)) · Date: 2026-10-18

## Context
Syria is not eligible for Meta's WhatsApp Business Platform; SMS is costly and unreliable; email is not used by most customers. Vertex Shifa built and tested a WhatsApp gateway on Baileys and Expo push from Azaz (Vertex Shifa ADR 0012, 0022, `docs/spikes/B-whatsapp-gateway.md` there).

## Decision
- **Channels:** push notifications in the customer and driver apps (and an in-app notification list), and WhatsApp messages from platform numbers. No SMS, no email.
- **Gateway:** `apps/whatsapp-gateway`, copied and adapted from Vertex Shifa: the `WhatsAppTransport` interface, the Baileys transport, the session lease, the disconnect-code table, durable per-number rate limits with warm-up, the OTP budget, one-way OTP.
- **Platform numbers only in V1:** OTPs and order-status messages to customers go from a pool of platform numbers with failover. Linking a restaurant's own WhatsApp number is later.
- **What is sent:** OTP; order accepted with time, rejected, out for delivery, delivered; nothing else in V1. Transactional only, no marketing, an opt-out keyword ("إيقاف").
- **Order of preference:** push when the customer has the app and a valid token; WhatsApp otherwise or when push fails; drivers and restaurant staff get push or in-app alerts only.
- **Privacy:** message bodies are not logged; messages carry no data beyond what the customer needs for that order.

## Consequences
- S03 reuses the Vertex Shifa gateway's code and tests; its spike findings apply without a new spike.
- Ban risk on platform numbers is managed by the same rate limits and failover; push is the primary channel for app users.
