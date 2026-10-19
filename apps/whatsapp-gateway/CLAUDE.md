# apps/whatsapp-gateway

The WhatsApp gateway (ADR 0012, layout ADR 0020): a long-running NestJS process, ESM, Node 24. Today it is the shell only: its configuration and `GET /health` on a loopback port for the process manager. S03 brings the transport interface, Baileys, sessions and sending from Vertex Shifa's gateway (`transport/`, `sessions/`, `sending/`, and its ADR 0022 disconnect rules).

## Layout
- `src/main.ts` starts the process; `src/gateway.module.ts` (`GatewayModule.forRoot(config)`) imports the rest; `src/app.ts` (`configureApp`) holds what production and tests both apply.
- `src/core/config/`: the environment checked by Zod at start-up (`loadConfig`: `GATEWAY_HOST` default loopback, `GATEWAY_PORT` default 3102), provided as `CONFIG`.
- `src/core/health/`: `GET /health`, answering `livenessSchema` from `packages/contracts`.
- `test/`: the gateway booted over HTTP. Unit tests sit next to the code.

## Rules
- The health port listens on loopback only; it is never exposed through the reverse proxy.
- Never log a message body, a phone number or a QR code: logs hold session ids and reasons (ADR 0012, 0016).
- Tests never connect to WhatsApp and never send a real message; synthetic numbers only.
- Injection is always explicit, `@Inject(TOKEN)`, as in `apps/api`.

Run: `pnpm --filter @vertex-food/whatsapp-gateway test` · start (after `build`): `pnpm --filter @vertex-food/whatsapp-gateway start`.
