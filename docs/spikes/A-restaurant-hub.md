# Spike A — Restaurant hub (PowerSync, Electron, LAN hub, standby)

Date: 2026-10-18 · Branch: `spike/restaurant-hub` · Code: `spikes/restaurant-hub/` (throwaway, adapted from Vertex Shifa's `spikes/offline-sync`) · Decision: [ADR 0022](../decisions/0022-branch-hub-confirmed-by-spike-a.md) (proposed), which confirms and amends [ADR 0008](../decisions/0008-offline-first-restaurant-and-lan-hub.md)

## Verdict

**The branch hub works as ADR 0008 describes, with a more precise protocol.** A Windows restaurant PC running PowerSync on an encrypted SQLite database serves a waiter phone and a kitchen display over the LAN with no internet. An order taken offline on two devices replays to the server with the same events in the same order. A second PC holds a live copy of everything and takes over in about 3.1 to 3.3 s when the hub loses power. LAN splits, in either direction, heal with nothing lost and every money conflict reported. Thirteen power cuts in the middle of writes lost no acknowledged command.

The same 91 checks pass in Node 24.21 and with each PC in Electron 44.4.3's main process (Node 24.21). After the last fix, six consecutive runs (three Node, three Electron) passed 91 of 91.

What ADR 0008 left open, and what the spike settles (ADR 0022):
- **How the hub orders writes:** one writer per branch with a sequenced journal.
- **How a standby takes over:** the hub copies every command to the standby before it answers ("mirror first"); the standby checks every copy against its own journal; epochs settle disagreements; a PC that took work alone forwards it when the LAN heals.
- **How hub clients trust the hub:** a branch certificate authority (CA), and pairing windows a manager opens.
- **Order numbers:** per-device daily ranges, not a hub counter.

Open:
- The browser side on real phones: a browser refuses the hub's pages unless the branch CA is installed on the device (new open question Q17).
- A real power cut on pilot hardware.

## What was built

| Part | Choice | Version |
|---|---|---|
| Source database | PostgreSQL 17 in Docker, `wal_level=logical`, RLS forced on every table, publication `powersync`; published on loopback only | `postgres:17` |
| Sync service | PowerSync Open Edition, PostgreSQL bucket storage, Sync Streams (edition 3), as in Vertex Shifa ADR 0021 | `journeyapps/powersync-service:1.26.1` |
| API | Node HTTP on loopback; runs as `food_app` (no BYPASSRLS); device tokens (EdDSA, 5 minutes); daily number ranges; `POST /api/commands` re-executes `OpenOrder`, `AddLines`, `SendToKitchen`, `SetTicketStatus`, `TakePayment` | `pg` 8.23.1, `zod` 4.6.5, `jose` 6.2.12 |
| Restaurant PC | One process per PC:<br>- `@powersync/node` in worker threads with SQLite3MultipleCiphers (key set in the worker, `synchronous=FULL`) and the upload connector;<br>- an HTTPS LAN server;<br>- the hub journal, mirroring with checks, heartbeats, promotion, demotion and a resumable rejoin.<br>Run in Node and in Electron's main process | `@powersync/node` 1.1.1, `better-sqlite3-multiple-ciphers` 13.0.3, `electron` 44.4.3 |
| LAN trust | A branch CA signs each PC's certificate (IP addresses in the SAN). Pairing data: hub address, CA fingerprint, and a 6-digit code that a manager opens for 2 minutes and 5 attempts | `node-forge` 1.3.1 |
| Hub clients | Node clients acting as a waiter phone and a kitchen display: pairing, commands with failover and re-sends, live snapshots over server-sent events; bare browser pages for a manual test | — |
| Faults | As in Vertex Shifa, TCP proxies cut each PC's internet (sync and API). A PC's LAN cut refuses and drops every LAN connection. A power cut is `SIGKILL` (Windows `TerminateProcess`). Fault hooks kill the hub between mirroring and committing, and cut a rejoin short before it forwards | — |

Fixtures are synthetic (`Synthetic shawarma`, prices in SYP, two PCs of one branch, one item of another tenant).

### The hub protocol in short

1. **One writer.** Every client of the branch sends typed commands to the **active hub**, with an id made on the client (UUIDv7): waiter phones, kitchen displays, and the cashier screen of each PC. The hub runs commands one at a time.
2. **Resolve and journal.** The hub resolves what only it may decide: the order number from its own range, the price and name snapshot from the menu it holds, and the kitchen tickets per station. It then appends a **journal entry**: sequence number, epoch, command, origin device, executing PC, resolved payload.
3. **Mirror first.** The hub sends the entry to the standby with its own previous entry (command id and payload hash), and waits for the answer (timeout 0.8 s). The standby applies the entry only if the entry it holds at that previous number is the same. Otherwise it answers `diverged` and rejoins; it never skips an entry because of its number alone. Only after the answer does the hub apply the entry to its own database and answer the client. One local transaction holds the optimistic rows, the journal row and the upload-queue row.
4. **Both PCs upload.** The standby applies the same entries in the same order, so both PCs hold the same data and both upload the same commands. The server is idempotent by command id across uploaders (a lock per id), so the second upload is a replay.
5. **Heartbeats and recovery.** The hub sends a heartbeat every 0.5 s, carrying its latest entry; the standby compares it with its own journal. A restarted hub first takes back from the standby any entries it sent but never committed.
6. **Takeover.** A standby that hears nothing for 3 s, and holds every entry the hub reported, **promotes itself** with epoch + 1.
7. **Demotion and rejoin.** A PC that meets a higher epoch **demotes** itself. It saves a "rejoining" flag with its new role, catches up, and **forwards** the entries it took alone; the new hub gives them new sequence numbers. The flag clears only when everything has been forwarded, so a rejoin cut short resumes. While rejoining, the PC refuses mirrors and never promotes.
8. **Clients.** Clients find the hub by asking every PC from the pairing data (`/hub/hello`) and taking the highest epoch. They re-send unanswered commands with the same id. A command answered `mirrored: false` is re-sent after a failover **with the version the old hub resolved**, so the new hub applies it instead of resolving it again.

## Results

Run: `docker compose up -d`, `pnpm server`, then `pnpm scenarios` (Node) and `pnpm scenarios:electron` (Electron). Times are the range over the six final runs on the owner's Windows 11 PC, idle, with every device on one machine (LAN over loopback). Earlier runs on a loaded machine, where the PCs took 2 to 3 s to start instead of 0.6 s, also passed, with times up to four times longer.

| Scenario | What was shown | Result |
|---|---|---|
| Setup | Both PCs sync the branch menu (2.3 to 2.6 s, with bucket storage grown over many runs) and get daily ranges of 500 numbers that do not overlap. A PC holds no row of another tenant. Cashier-2 follows cashier-1 as standby (epoch 1) | Pass |
| Pairing, offline | With both PCs off the internet:<br>- pairing is closed until a manager opens it;<br>- a hub whose CA does not match the QR fingerprint is refused;<br>- five wrong codes close pairing, and even the right code is then refused;<br>- a code is single-use;<br>- a waiter phone and a kitchen display pair in 24 to 38 ms;<br>- the pairing reaches the standby, so clients can use it without pairing again;<br>- a LAN server with a certificate the branch CA did not sign is refused;<br>- unpaired clients get 401, and the standby refuses client commands while a hub is active (409) | Pass |
| Order on the LAN, offline | The waiter opens table T1, adds lines and sends them to the kitchen; three commands are answered in 58 to 69 ms, each copied to the standby first. The kitchen display shows the two station tickets 77 to 92 ms after the waiter tapped. The cashier adds a line to the same order on the hub PC. The kitchen marks a ticket ready and the waiter sees it in 35 to 44 ms. A backward status is refused locally. Payment is taken offline. Both PCs hold identical journals and upload queues | Pass |
| Replay to the server | On reconnect, both upload queues empty in 0.22 to 0.34 s. The server re-executes the 8 commands:<br>- all accepted;<br>- its order events follow the hub's sequence, with waiter, cashier and kitchen commands interleaved;<br>- the subtotal is recomputed from the price rows the lines reference;<br>- each command arrived twice (once per PC), and the second arrival was a replay with an identical payload.<br>A price raised in the cloud during the cut was not applied to the offline order; the server reported it (`price_superseded`). Both PCs converge to the server's rows, and the outcomes reach the standby | Pass |
| Cloud order | An order created in the cloud reaches the kitchen display through the hub in 77 to 99 ms | Pass |
| Power cut between mirror and commit | The hub copies a command to the standby, then dies before committing or answering, and restarts. It takes the command back from the standby and stays hub (epoch 1); the restart answers the waiter's pending command in 0.64 to 0.68 s. The waiter's retry is answered `duplicate`: the command was resolved once, and both PCs hold the order once with the same number | Pass |
| Power cut on the hub | The waiter streams one-line commands; the hub process is killed in the middle. The waiter's next answer comes from cashier-2 3.1 to 3.3 s after the cut (epoch 2):<br>- no acknowledged command is missing;<br>- every acknowledged line is on the order exactly once (retries reuse the command id);<br>- the kitchen display moves to the new hub on its own;<br>- new orders take numbers from cashier-2's range.<br>With no standby running, the hub still answers and reports `mirrored: false`. The old hub restarts in 0.66 to 0.73 s: the encrypted database opens and passes `integrity_check`. It sees epoch 2, becomes the standby and catches up; it had nothing to forward, and every journal entry has its rows | Pass |
| LAN split, the hub isolated | The hub (cashier-2) is cut from the LAN but keeps running. Cashier-1 promotes itself in 3.0 to 3.1 s (epoch 3), and for a while there are two hubs:<br>- the waiter fails over to cashier-1 and takes payment for T3;<br>- the isolated PC's cashier takes the same payment again and a takeaway order;<br>- order numbers stay distinct (different ranges).<br>When the LAN returns, the isolated PC demotes itself and catches up. Its first rejoin is cut short before forwarding (a fault): it stays pending and resumes on the next heartbeat, then forwards its 4 commands (heal 0.87 to 1.0 s). The kitchen display shows the takeaway ticket, and both journals hold the union. Online, the server records both payments: one `accepted`, one `adjusted: overpaid` for a person to resolve. No command is rejected or loses its number, and both PCs converge | Pass |
| LAN split, the standby isolated | The standby (cashier-2) is cut from the LAN. It cannot tell that the hub is alive, so it promotes itself to epoch 4, above the hub that keeps serving the branch (3 commands, `mirrored: false`). When the LAN returns, the higher epoch wins (heal 0.55 to 0.89 s):<br>- the hub that served the branch demotes itself and forwards its 3 commands;<br>- the kitchen display follows cashier-2;<br>- the waiter's re-sent unmirrored commands are all recognised as duplicates;<br>- the journals are identical | Pass (finding) |
| Hub lost after a LAN blip | During a short LAN blip on the standby, the hub answers three commands `mirrored: false`, then loses power. The standby had heard nothing newer, so it promotes itself without them (epoch 5). The waiter re-sends the three commands with the version the old hub resolved. The new hub checks each version against its own data (the price row in force and its amount, the number inside the executor's range, the lines and tickets of the order) and keeps the old hub's order number and ticket ids. A forged version with a zero price is refused, and the hub resolves that line itself at the menu's price. The old hub then rejoins with no payload conflict and nothing to forward. Online, the server sees no payload mismatch and rejects nothing, and both PCs converge | Pass |
| Divergence (the residual case) | The hub copies a command, dies, and restarts while the standby is unreachable. The waiter's retry carries no answer, so the hub resolves the same command id again, with different ticket ids. When the LAN returns, the standby detects it (heartbeat mismatch), rejoins and counts a payload conflict. Online, the server keeps the first version it receives and flags the other (`replay_payload_mismatch`). The next checkpoint replaces the losing PC's version, and both PCs converge | Pass (finding) |
| Repeated power cuts | A one-PC branch (standby off) loses power 10 times at random points while the waiter streams writes. After every cut:<br>- the encrypted database reopens (≤ 0.67 s) and passes `integrity_check`;<br>- 0 of 199 to 257 acknowledged commands are lost;<br>- journal entries and rows match, so no command is half-written.<br>0 or 1 command per run was committed whose answer never reached the waiter (up to 3 in earlier runs). The server receives every line once | Pass (finding) |

## Findings

1. **Mirror first is what makes failover lossless.** The hub copies an entry to the standby *before* committing it locally and answering. So an acknowledged command is always on the standby. A command the hub copied but did not commit before it lost power comes back to it when it restarts (tested). With "commit, then copy", a hub that died between the two steps would hold a command nobody else had. The cost is one LAN round trip per command: 3 commands in about 60 ms on an idle PC.
2. **A copy must be checked, not counted.** The first version of the standby accepted any entry whose sequence number it already had, without checking that it was the same command (reviewer finding). A hub that restarted without its standby could then hand out a number the standby already held, and be told "mirrored". Each mirror and heartbeat now carries the hub's entry at the previous or latest number (command id and payload hash). On a mismatch the standby answers `diverged`, never `ok`, and rejoins. A restarted hub records its standby's state before it serves; one run showed that otherwise it answers its first commands without a copy.
3. **One command id can still be resolved twice, in one narrow case.** It happens when a hub dies after copying a command but before answering, and then restarts while its standby is unreachable. The client has no answer to re-send, so the hub resolves the command again, and the two PCs hold different versions (tested, "divergence"). The standby detects it at once and counts it. Online, the server keeps the first version and flags the second, and the checkpoint replaces the losing version on its PC. Until then, while offline, the two PCs disagree on that one command (here: the kitchen ticket ids). The rule for S04 *(not tested)*: a PC that finds a different version on rejoin adopts the hub's version by replacing its own rows and queued command. The server's flag goes to the "needs attention" list. The common case, a hub that answered `mirrored: false` and then died, is closed: the client re-sends the old hub's resolved version, and the new hub applies it (tested). That version comes from a client, so the new hub first checks it against its own data, and resolves the command itself if any check fails (reviewer finding; a forged zero price was refused, tested):
   - the order is the one the command names;
   - the price row is the newest in force, with its amount, name and station;
   - the number lies inside the executing PC's synced range;
   - the lines and tickets belong to the order.

   In production the executing PC should also sign the resolved version with its peer credential *(not tested)*. One more effect of the narrow case: the copied `OpenOrder`'s number never reached the restarted hub's counter, so it can give the same number again; the server then stores one order without a number (`number_taken`) and flags it.
4. **A rejoin must resume.** The first version saved the new role before the rejoin and then never retried it (reviewer finding). A power cut or a LAN flap during the rejoin would have stranded the commands a PC took alone. The PC now saves a "rejoining" flag with the role. It forwards everything still marked as its own, clears the flag only at the end, and refuses mirrors and automatic promotion until then. A fault that cuts the first rejoin short before it forwards shows the rejoin resuming on the next heartbeat (tested). If the hub vanishes during a rejoin, a manager can still promote the PC: its unforwarded entries join its new lineage *(not tested)*. A second, needless rejoin triggered by a heartbeat during the first was also removed.
5. **Promotion needs fencing and a re-check.** A first version promoted a PC right after it had demoted itself: its watchdog had read a stale heartbeat time while the demotion was running (a flip-flop to epoch 4). Two rules fixed it: promotion re-checks its condition under the writer lock, and a demotion resets the heartbeat clock. Automatic promotion happens only when the standby holds every entry the hub reported; otherwise a manager promotes by hand *(manual promotion not tested)*. One loaded run showed the cost: a hub that answered commands without a copy and then died left a standby that, correctly, would not promote itself. Nothing was lost, since the clients and the dead PC hold those commands, but the branch had no hub until a manager acted.
6. **Two hubs for a few seconds cannot be avoided; it only needs to be safe.** A PC cut from the LAN cannot tell whether the other PC died. When the hub is isolated, its own cashier screen keeps working. When the standby is isolated, it promotes itself above the real hub, and on heal the higher epoch wins: the hub that served the branch hands over to the PC that served nobody (tested). Both directions lose nothing, thanks to three things:
   - per-device number ranges (no duplicate number);
   - forwarding on heal (the kitchen sees it);
   - server re-execution, which records conflicts instead of overwriting (a double payment became `overpaid`).

   A better tie-break on heal, such as keeping the hub that clients are connected to, is a refinement for S04. Money conflicts need the "needs attention" list in S09 and S10 (Vertex Shifa ADR 0021 already requires one).
7. **Both PCs upload everything, and that is fine.** A command reaches the server if either PC gets internet. The server needs only:
   - idempotency across uploaders (a lock per command id);
   - the envelope fields `origin_device_id`, `executed_by_device_id`, `hub_epoch` and `hub_seq`;
   - a check that the executing PC belongs to the branch.

   On a replay it compares a payload hash and flags a mismatch. `received_at` is the transaction start, not the order in which the server ran the commands, so reports must not order by it.
8. **Hub state belongs in local-only tables.** A PC with commands waiting to upload receives no new checkpoint (Vertex Shifa finding 2). A number range fetched while commands are queued would therefore not appear until the queue empties. The spike keeps all hub state in local-only tables, so checkpoints never touch it: the range and a counter of the last number used, the journal, pairings, and role and epoch.
9. **The hub resolves, the server re-checks.**
   - The client sends only the item and the quantity.
   - The hub fills in the price row in force, the name, the station and the amount it holds.
   - The server re-reads the price row by id and recomputes every amount. It corrects a mismatched amount (`adjusted: price_corrected`), and reports a newer price the branch could not see (`price_superseded`) without applying it.

   Whether a stale price should ever be charged differently is a business rule for S07 and S09; the spike keeps the order exactly as the customer was told. *(Not tested: the server does not yet check that the price row was in force at the device time.)*
10. **Clients need an outbox.** In the repeated power cuts, up to 3 commands per run (0 or 1 in the final runs) were committed but their answers never reached the waiter. If the waiter app showed "failed" and the waiter tapped again, the line would be ordered twice. A hub client must keep every unanswered command, with its id, and re-send it until it gets an answer; its UI shows "sending", not "failed". It must also keep commands answered `mirrored: false`, with the resolved version, until a later command is mirrored. The spike's client does both, but only in memory and for 20 s. A persistent outbox on the phone (for example IndexedDB) is *not tested*.
11. **Trust on the LAN: a branch CA, and pairing only on demand.**
    - **Branch CA:** with a self-signed certificate per PC, every client would have to trust each PC separately and pair again on failover. With a branch CA, the client checks the CA's fingerprint from the QR code once and then trusts every PC of the branch; a rogue PC is refused.
    - **Pairing on demand:** restaurant Wi-Fi is often shared with customers. A code that is always open could be guessed (reviewer finding), so pairing opens only when a manager asks, for 2 minutes and 5 wrong codes, and every code is single-use.
    - **No plain HTTP:** anyone on the Wi-Fi could read orders or forge commands.
    - **Peers:** they authenticate with a branch secret in the spike; production should give each PC its own credential *(not tested)*.
12. **Browsers are the weak point** *(partly tested)*. The built-in browser refused the hub page outright, because the certificate is signed by a CA it does not know. On real phones, Chrome trusts a user-installed CA. Without it, a browser shows a warning at best, with no installable app and no wake lock (both need a secure context). A failover moves the page to a different origin, so the page cannot follow the standby by itself. The options for Q17:
    - the branch CA installed on each waiter phone and kitchen screen at onboarding, with one stable hub address;
    - a small app that trusts the branch CA and talks to both PCs (an Android wrapper for the waiter and kitchen screens).
13. **Live updates: a full snapshot over server-sent events is enough.** The hub sends all open orders, with their lines and tickets, on every change, whether from a local command or a checkpoint. A client that reconnects gets the current state; no event replay is needed. Updates arrive in tens of milliseconds at restaurant volumes; a large branch may need deltas later.
14. **Durability against process kills, not yet against real power cuts.** With `synchronous=FULL`, 13 kills per run during writes lost nothing and corrupted nothing: one failover, two between mirror and commit, ten in a row. A real power cut also drops the disk cache, so the procedure below must run on pilot hardware before S04 closes (Vertex Shifa finding 7 still applies).
15. **Operations:**
    - After a restart, PowerSync waited about 37 s for the old replication lock ("Replication stream is locked by another process, standing by"); sync stalled for that time.
    - An idle PostgreSQL connection was reset through Docker Desktop's port proxy, and the spike API crashed until its pools got error handlers. The product API needs the same.
    - Footprint after the runs (`docker stats`): PowerSync 277 to 333 MiB of RAM, PostgreSQL 109 to 138 MiB. Vertex Shifa measured 125 MiB for PowerSync at rest.
    - First sync slowed from 0.8 s to 1.9 s over many runs: the bucket storage keeps the history of the truncated test data.
16. **Setup snags on the owner's PC:**
    - Docker Desktop 4.65 would not start: it crashed trying to remove stale Unix socket files that Windows reported as inaccessible (error 1920). Moving `%LOCALAPPDATA%\Docker\run` and `%LOCALAPPDATA%\docker-secrets-engine` aside fixed it; the old folders are kept as `*.stale-20261018*`.
    - Port 8090 was taken by another project's container, so the spike's PowerSync listens on 8095.

## Manual tests left for the owner and the pilot

- **Real phone and kitchen screen:** run `pnpm demo` on a PC on a **private test network**, not the restaurant's customer Wi-Fi. Only the hub's pages listen on the LAN; the API and the databases stay on loopback. Open the printed address on an Android phone and on the kitchen screen, and pair with the printed code (2 minutes). Then cut the internet (the command is printed). Record:
  - what the browser shows for the branch certificate, with the CA installed and without it;
  - the time from a waiter tap to the kitchen display.
- **Real power cut:** run the waiter stream from a second machine against the hub PC, pull the hub's power cord, restart it, then compare the waiter's acknowledged list with the PC's lines (`integrity_check`, nothing missing). Repeat 10 times on the pilot hardware (Q8), with and without a UPS.

## Not covered (next steps or open)

- **Real devices:** phones and browsers (Q17); a persistent client outbox; Wi-Fi drops without a TCP reset (a stuck router or a phone leaving the Wi-Fi), and how fast a client notices.
- **Hub protocol:**
  - adopting the hub's version on rejoin (finding 3);
  - manual promotion, also during a pending rejoin (number re-added entries from the highest sequence in the lineage, and bound the mirror catch-up retry, so a gap can never loop);
  - signing the resolved version that clients re-send (until then a client can attribute a re-sent `OpenOrder` to another PC of the branch and pick an unused number in its range);
  - a better tie-break on heal (finding 6);
  - re-checking forwarded entries on the hub: a forwarded `SendToKitchen` could re-send lines already sent;
  - more than two hub-capable PCs: the code takes a list of peers, but only two were tested;
  - the hub's LAN address changing (DHCP): onboarding needs a fixed address (DHCP reservation) or discovery on the LAN (mDNS or a broadcast).
- **Identity:** the acting user on hub clients (PIN sessions and the per-user command proof of Vertex Shifa ADR 0021, which a browser client cannot hold the same way); the peer credential per PC; who issues the branch CA and PC certificates (recommended: the platform, online, at branch setup).
- **Numbers and money:** ranges reserved several business days ahead, since a cut can start before the day does; the "needs attention" list for adjusted money commands; the server's check that a price was in force at the device time.
- **Operations and scale:**
  - heartbeats to the cloud that pause online ordering while a branch is offline (ADR 0008);
  - app updates that wait for an empty queue;
  - Windows firewall rules and the installer;
  - volume: a full day of a busy branch, and snapshot size.
- **Printing:** Spike B.
