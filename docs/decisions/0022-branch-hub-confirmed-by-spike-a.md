# 0022 — Branch hub confirmed by Spike A: a sequenced journal, a checked standby copy, epochs, a branch CA

Status: Accepted (owner, 2026-10-18) · Date: 2026-10-18 · Amends [0008](0008-offline-first-restaurant-and-lan-hub.md); touches [0005](0005-identity-and-access.md) (hub pairing)

## Context
ADR 0008 made one restaurant PC per branch the hub for the kitchen display and the waiter app. It left Spike A to prove the hub and to decide how a standby takes over. The spike ran every scenario in Node and in Electron's main process, and all 91 checks passed in six consecutive runs:
- an offline LAN order on two devices;
- the replay to the server;
- power cuts on the hub, including one between copying a command and committing it;
- LAN splits that isolate the hub and that isolate the standby, with a rejoin cut short;
- a hub lost after a LAN blip;
- a deliberate divergence;
- ten power cuts in the middle of writes.

Report: [`docs/spikes/A-restaurant-hub.md`](../spikes/A-restaurant-hub.md). Items marked *(not tested)* are design decisions the spike did not exercise.

## Decision

### Confirmed from ADR 0008
- Local-first PCs with encrypted SQLite and PowerSync (as amended by Vertex Shifa ADR 0021).
- Commands re-executed by the server.
- UUIDv7 ids from the device.
- Ordered events instead of overwrites.
- A payment is never lost.
- The hub serves the kitchen display and the waiter app over HTTPS on the LAN, paired by a code.

### One writer per branch: the hub journal
- The active hub is the only writer of branch commands. Every client sends its commands to it: waiter phones, kitchen displays, and the cashier screen of every PC, including the hub's own. The hub runs them one at a time.
- The hub resolves what only it may decide:
  - the order number;
  - the line snapshot (the price row in force, the name, station and amount);
  - the kitchen tickets per station.
- It appends the result to a local-only **journal**: sequence number, epoch, command id, origin device, executing PC, resolved payload. The journal, pairings, hub state, number ranges and the last number used are local-only tables: never uploaded, never touched by a checkpoint.
- One local transaction holds the optimistic rows, the journal entry and the upload-queue row, or none of them.
- Command envelope on the wire, added to Vertex Shifa ADR 0021's: `origin_device_id`, `executed_by_device_id`, `hub_epoch`, `hub_seq`. The server checks that the executing PC is an active device of the token's branch.

### Standby and takeover (replaces "Spike A decides how a standby takes over")
- Every other hub-capable PC of the branch is a **standby**: it receives every journal entry in order, applies it to its own database, and queues the same commands for upload.
- **Mirror first:** the hub sends an entry to the standby and waits for its answer before committing locally and answering the client. If no standby answers within 0.8 s, the hub still commits and answers, with `mirrored: false`, and shows "standby not in sync" on the cashier screen.
- **A copy is checked, not counted:** each mirror carries the hub's entry at the previous number, and each heartbeat its latest entry (command id and payload hash). The standby applies an entry only if its own journal matches at that number. Otherwise it answers `diverged` and rejoins; it never skips an entry because of its number alone.
- **Restart:** a restarted hub asks its standby for its state before serving. It takes back the entries it copied but never committed, and mirrors from its first command.
- **Both PCs upload every command.** The server is idempotent by command id whichever PC uploads first: it locks per command id, answers a replay with the stored outcome, and flags a replay whose payload hash differs, for the "needs attention" list.
- The hub sends a heartbeat every 0.5 s. A standby that hears nothing for 3 s **and** holds every entry the hub reported promotes itself with epoch + 1. Otherwise it waits for a manager to promote it with a PIN *(manual promotion not tested)*. Promotion re-checks its condition under the writer lock.
- **Epochs settle every disagreement:** the higher epoch is the hub. A PC that meets a higher epoch demotes itself, catches up from the hub, and forwards the entries it took alone. The hub gives them new sequence numbers, and the server's re-execution records any conflict (for example an overpayment) as `adjusted`.
- **A rejoin always completes:** the "rejoining" flag is saved with the new role and cleared only when every entry the PC took alone has been forwarded. While the flag is set, the PC refuses mirrors and does not promote itself, and it resumes the rejoin on the next heartbeat or start (tested with a rejoin cut short). If the hub vanishes during a rejoin, a manager can still promote the PC; the entries it never forwarded join its new lineage *(not tested)*.
- **A split heals by epoch, in either direction.** A PC cut from the LAN cannot tell whether the other PC died:
  - an isolated hub keeps serving its own cashier screen until it meets the higher epoch;
  - an isolated standby promotes itself, and on heal it becomes the hub while the PC that served the branch hands its work over.

  Nothing is lost either way. Other cashier PCs therefore never "keep working on their own databases" apart from the hub: they are clients of the active hub, standbys, or an isolated PC that forwards on heal. *(Not tested: a tie-break that keeps the hub clients are connected to.)*

### Numbers
- Order and ticket numbers come from **per-device daily ranges** allocated by the server while online, stored locally with a counter of the last number used. A hub numbers orders from its own range, so two hubs during a split never collide. The hub daily counter in ADR 0008 is dropped.
- *(Not tested)* Ranges are reserved for several business days ahead, because a cut can start before the day does.

### Hub clients
- A client finds the hub by asking every PC listed at pairing and taking the highest epoch. It follows a failover by itself.
- **A command is resolved once.** A client keeps every command answered `mirrored: false` together with the version the hub resolved (number, prices, tickets). After a failover it re-sends that version, and the new hub applies it instead of resolving it again.
- **The hub still decides.** The re-sent version comes from a client, so the new hub checks it against its own data before applying it, and resolves the command itself if any check fails (a forged zero price was refused in the spike):
  - the order is the one the command names;
  - the price row is the newest in force, with its amount, name and station;
  - the number lies inside the executing PC's range;
  - the lines and tickets belong to the order.

  *(Not tested)* The executing PC also signs the resolved version with its peer credential.
- **Residual case:** a hub dies after copying a command but before answering, then restarts without its standby. It can resolve the retried command again, and reuse the copied order's number. The standby detects this, the server keeps the first version and flags the second (`replay_payload_mismatch`, or `number_taken` for a number), and the checkpoint corrects the other PC. *(Not tested)* On rejoin, a PC that finds a different version adopts the hub's version by replacing its own rows and its queued command.
- **Outbox:** a client keeps every unanswered command and re-sends it with the same id until it is answered, and its UI shows "sending", never "failed", so a waiter never re-taps an order into a duplicate. *(Not tested: the outbox persisted on the phone; the spike kept it in memory.)*
- Live state is a full snapshot of the branch's open orders over server-sent events, sent on every change from a command or a checkpoint.

### Trust on the LAN (amends the pairing in ADR 0005)
- Each branch has a **certificate authority**. Every hub-capable PC holds a certificate signed by it.
- **Pairing:**
  - The QR code holds the hub's address, the CA's fingerprint and a code. The client accepts the CA only if its fingerprint matches, then trusts every PC of the branch, so a failover needs no second pairing.
  - Pairing is closed by default. A manager opens it on the hub for 2 minutes; 5 wrong codes close it; every code is single-use.
  - *(Not tested)* Growing delays between attempts and an audit entry per pairing (ADR 0016).
- The hub copies pairings to the standby. Unpaired clients get 401.
- *(Not tested)* The platform issues the branch CA and the PC certificates online at branch setup, with private LAN addresses in the certificates. The CA's key never leaves the platform. Each PC also gets its own peer credential, replacing the spike's shared branch secret.
- No plain HTTP on the LAN: restaurant Wi-Fi is often shared with customers.
- How a browser on a phone or kitchen screen trusts the branch CA is open (Q17).

## Consequences
- `packages/sync` owns the hub protocol: the journal, the checked mirroring, heartbeats, epochs, catch-up, the resumable rejoin and forwarding, and the client outbox. S04 builds it with the spike's scenarios as its test suite: crash between mirror and commit, power cut, both kinds of split, a rejoin cut short, LAN blip, forged re-send, divergence, repeated cuts, replay. These join the sync tests of ADR 0020.
- Each mirrored command costs one LAN round trip: three commands took 58 to 69 ms on an idle PC in the spike.
- A takeover leaves the waiter without an answer for about 3.2 s.
- Upload traffic doubles with a standby. In return, a command reaches the server if either PC gets internet.
- Money commands that conflict across a split (a double payment) become `adjusted` and need the "needs attention" list in S09 and S10. So do replays the server flags as payload mismatches.
- Onboarding:
  - gives the hub PCs fixed LAN addresses (a DHCP reservation) or adds LAN discovery *(not tested)*;
  - opens the Windows firewall for the hub port;
  - recommends a UPS for both PCs and the router.
- Operations: PowerSync can hold replication for about 40 s after a restart (a replication-lock timeout), and the API's database pools must survive connection resets.
- A real power-cut test on pilot hardware (Q8) closes S04. The spike's process kills lost nothing with `synchronous=FULL`, but they do not drop the disk cache.
- Still open after the spike:
  - real phones and browsers (Q17);
  - Wi-Fi drops without a TCP reset;
  - more than two hub-capable PCs;
  - the acting-user proof for hub clients;
  - cloud heartbeats that pause online ordering;
  - app updates that wait for an empty queue;
  - volume over a full day;
  - printing (Spike B).
