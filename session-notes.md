# Session Notes — Fly backend restore (2026-06-18)

> Decision log + handoff for the task "verify the Fly backend actually works."
> The step-by-step **runbook** to finish is in [`RESUME-fly-backend-restore.md`](./RESUME-fly-backend-restore.md);
> this file is the narrative (why we did what we did, what's done, what's left).

## Summary

The Fly app `wikinaut-api` was crash-looping with
`OSError: Specified SQLite file "./sdow.sqlite" does not exist`. Diagnosis: the `wikinaut_data`
volume was **empty** — the graph DB had never been loaded onto it. We kept the crash-looping machine
alive, started streaming the real 14 GiB graph from GCS onto the volume, and began fixing the
deployment docs. Transfer + final verification are still pending (see Next Steps).

## Key decisions (with rationale)

1. **Diagnosed against the live app, not assumptions.** A recent commit changed `primary_region`
   iad→sjc, so a region/volume mismatch looked likely — but `fly volumes list` showed the volume is
   in `sjc` and attached. Ruled it out; the real cause is an **empty volume**. Lesson: verify with
   read-only `fly` inspection before theorizing.
2. **Load the real graph now** (user choice) rather than smoke-testing with the mock DB first.
3. **Keep the machine alive with a `sleep infinity` command override.** `fly ssh console` needs a
   *started* VM, but the app crashes ~7s after each boot (missing DB) and ends up `stopped`. The
   override (`fly machine update <id> -C "sleep infinity" --yes`) is the only way to get a stable
   shell to write to the volume. (Approved by user; the more aggressive variant with
   `--skip-health-checks --restart no` was blocked by the auto-approval classifier.)
4. **Stream the DB with locally-authed `gsutil`, no creds on the host.** The staged GCS object turned
   out to be **private** (not public as the docs implied). Putting a GCP access token on the Fly host
   was blocked as credential leakage. Per the user's choice ("local round-trip"), we stream
   `gsutil cp gs://… -` → `fly ssh … 'cat > …'` so data flows through the pipe and no secret lands on
   the host.
5. **Resumable chunked transfer.** A single 14 GiB SSH stream dropped at ~10% (`EOF in violation of
   protocol`). Switched to `gsutil cat -r <offset>-` appends that resume from the current `.part`
   size, with a guard so a failed size-probe never re-appends from byte 0 (which would corrupt it).

## Completed this session

- ✅ Root cause confirmed (empty `/data` volume; `server.py:18` opens both DBs at import).
- ✅ Machine `7812324a965208` kept alive via `sleep infinity` override + `fly machine start`.
- ✅ Download tooling sorted out: image is `python:3.12-slim` (no wget/curl/sqlite3 CLI) → use python.
- ✅ Resumable GCS→volume transfer in progress (~1.66 GiB+/14.12 GiB; `/data/sdow.sqlite.part`).
- ✅ `docs/deployment.md` partial fixes: DB size (~14 GB), volume `--region sjc --size 25`, staged
  object name `wikinaut.sqlite`.
- ✅ Wrote `RESUME-fly-backend-restore.md` (operational runbook) + this file.
- ✅ Added an "Operating the deployed Fly backend" gotchas section to `CLAUDE.md`.

## Bugs / issues found

- **The actual outage:** `wikinaut_data` volume empty — DB never loaded (Step 4 of deployment.md
  never completed against this volume).
- **`docs/deployment.md` drift (multiple):**
  - Volume created `--region iad` while `fly.toml` is `sjc` (would strand the volume / give an empty
    one on boot).
  - States DB is ~5 GB; it's actually **14.12 GiB**.
  - Staged object is `wikinaut.sqlite`, docs said `sdow.sqlite`.
  - **Step 4 is unworkable as written:** uses `fly ssh console` on a crash-looping (unreachable) VM,
    and `wget` / `sqlite3` which don't exist in the slim image.
- **GCS object is private** (anonymous GET → 403) — contradicted the "public" assumption.
- **`server.py` builds `Database` at import time**, so a single missing DB file crash-loops the
  whole app (and then blocks SSH access).

## Exact next steps (next session)

Follow `RESUME-fly-backend-restore.md` Steps A–H. In short:
1. **A** — finish the resumable transfer to exactly `15162654720` bytes (`bash /tmp/wn_resume.sh`).
2. **B/C** — verify integrity (md5 `e71a0f6977aa420dc238b4dd0615313a` / byte count), then
   `mv /data/sdow.sqlite.part /data/sdow.sqlite`.
3. **D** — seed `/data/searches.sqlite` from `/app/sql/createSearchesTable.sql` via the python sqlite3 module.
4. **E** — `fly deploy` to restore the real gunicorn command (clears the `sleep infinity` override);
   confirm the override is gone.
5. **F** — verify: `fly status`, `curl /ok`, `curl POST /paths` Cat→Dog (expect non-empty paths).
6. **G** — rewrite `docs/deployment.md` **Step 4** with the verified procedure.
7. **H** — cleanup remote scratch (`/data/dl.*`, leftover `.part`), local `/tmp/wn_resume.sh`, and
   delete `RESUME-…md` + this file + the plan once verified.

## Risks / open items

- ⚠️ **The machine is still on the `sleep infinity` override** — the app will NOT serve until Step E
  restores gunicorn. Don't forget it.
- Transfer is bounded by the local uplink to Fly and may need several resume rounds.
- Confirm `fly deploy` actually clears the machine-level command override; if not, reset it
  explicitly (see RESUME Step E).
