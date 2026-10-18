# 0017 — Deployment and hosting: provider-independent, simple, recoverable

Status: Accepted (provider, region and domain open: Q1) · Date: 2026-10-18

## Context
Several global cloud services are blocked or restricted for Syrian users, and Cloudflare is blocked in Syria. The owner already runs Ubuntu VPS servers with PM2 and nginx for other Vertex projects. Vertex Shifa ADR 0017 set the same shape.

## Decision
- **Provider-independent:** only portable components: PostgreSQL 17, the sync service (PowerSync self-hosted, ADR 0008), an S3-compatible object store, the Node apps, the map tiles (ADR 0021), a reverse proxy. No proprietary managed service the system depends on.
- **Shape at launch:** one Ubuntu VPS (or two: apps and database) at a provider that serves Syrian users; Node apps under PM2; containers (sync service, object storage if self-hosted) under Docker Compose; nginx or Caddy as the only public gateway; apps on `127.0.0.1` only.
- **Releases:** atomic releases with rollback and health checks; migrations by the owner role; production deploys once per phase in their own session (ADR 0019).
- **Desktop updates:** the restaurant app updates itself from our server only when its upload queue is empty and no cash session is mid-close (ADR 0008).
- **Backups:** daily encrypted database and object-store backups off the server; a restore tested before the pilot.
- **Monitoring:** error tracking without personal data, uptime and health checks, branch hub connectivity and gateway health in the console (S24).
- The provider, region and platform domain are decided before the deploy skeleton (Q1).

## Consequences
- Moving providers is an operational task, not a rewrite.
- The server shape is described in `deploy/` with its own `CLAUDE.md` when Phase 0 adds it.
