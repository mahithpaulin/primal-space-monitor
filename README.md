# Primal Space Monitor

Live monitoring backend and dashboard for the Primal Space end-to-end device
connection test. Deployed on Vercel. State is persisted in a private Vercel Blob
store, so no external database account is required for v0.1.

## What it does

- Registers Android/Termux devices with an enrollment key.
- Issues an individual bearer token per device (only a SHA-256 hash is stored).
- Receives periodic heartbeats with real device metrics.
- Marks devices offline when the heartbeat expires.
- Queues deterministic compute tasks and verifies results server-side.
- Shows registered, connected, offline, and executing devices in a responsive
  dashboard.

## API

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/v1/register` | enrollment key | Register/recover a device, issue token |
| POST | `/api/v1/heartbeat` | device bearer token | Update metrics and worker state |
| GET | `/api/v1/devices` | none (read-only) | Device list + summary |
| GET | `/api/v1/devices/{id}` | none (read-only) | Device detail + recent tasks |
| POST | `/api/v1/tasks` | none | Queue a task; omit `device_id` for any worker |
| POST | `/api/v1/tasks/claim` | device bearer token | Claim the next pending task |
| POST | `/api/v1/tasks/result` | device bearer token | Submit and verify a result |
| GET | `/api/v1/tasks/{id}` | none (read-only) | Task status / cancellation flag |
| POST | `/api/v1/tasks/{id}` | none | Request cancellation |
| POST | `/api/v1/disconnect` | device bearer token | Mark device offline immediately |

Task queueing and cancellation are open in this low-level v0.1 experiment. A task
without `device_id` remains pending until any eligible worker claims it.
## Environment variables

See `.env.example`.

- `PRIMAL_ENROLLMENT_KEY` — shared secret required for registration.
- `PRIMAL_OFFLINE_SECONDS` — heartbeat expiry, default `90`.
- `BLOB_READ_WRITE_TOKEN` — injected by connecting the Vercel Blob store.
- `PRIMAL_STATE_PATH` — optional state object key, default `primal-space/state.json`.

## Local development

```sh
npm install
cp .env.example .env.local
npm run dev
```

## Deploy

```sh
vercel link --yes --project primal-space-monitor
vercel storage connect primal-space-state --project primal-space-monitor
vercel env add PRIMAL_ENROLLMENT_KEY production
vercel env add PRIMAL_OFFLINE_SECONDS production
vercel deploy --prod --yes
```

## Security notes and limitations

- Registration is protected by a shared enrollment key, not per-user accounts.
- The dashboard and device/task/job/message endpoints require the operator key.
- State is a single JSON object stored in Neon Postgres (with private Blob
  fallback). Writes are serialized with a Postgres advisory lock.
- Device metrics are self-reported by the device and are not attested.
- Task creation is operator-gated (admin key). The allow-listed workloads are
  `python` (sandboxed, safe-stdlib imports only), `shell` (operator-only
  `sh -c`, CPU/time limited), and `http` (device-side request).
- The service never downloads or executes remote binaries; all execution happens
  on the enrolled device.

## License

MIT
