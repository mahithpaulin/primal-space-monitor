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

## Install the apps

The dashboard has an **Apps** section with one-click installers:

| App | Link |
| --- | --- |
| Desktop (Windows, macOS, Linux) | <https://github.com/mahithpaulin/primal-space-cli/releases/latest> |
| Android APK | <https://github.com/mahithpaulin/primalspace-android/releases/latest> |
| Command line / source | <https://github.com/mahithpaulin/primal-space-cli> |

## API

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/v1/register` | enrollment key | Register/recover a device, issue token |
| POST | `/api/v1/enroll` | enrollment key | Register/recover an Android device, issue token |
| POST | `/api/v1/heartbeat` | device bearer token | Update metrics, capabilities and worker state |
| GET | `/api/v1/devices` | operator | Device list + summary |
| GET | `/api/v1/devices/{id}` | operator or owning device | Device detail + recent tasks |
| GET | `/api/v1/history` | device bearer token | Device-scoped job and task history |
| POST | `/api/v1/tasks` | operator | Queue a task; omit `device_id` for any compatible worker |
| POST | `/api/v1/tasks/claim` | device bearer token | Claim the next compatible pending task |
| POST | `/api/v1/tasks/executing` | device bearer token | Move a claimed task to executing |
| POST | `/api/v1/tasks/result` | device bearer token | Submit a result and settle compute credits |
| GET | `/api/v1/tasks/{id}` | operator or owning device | Task status / cancellation flag |
| POST | `/api/v1/tasks/{id}` | operator | Request cancellation |
| POST | `/api/v1/disconnect` | device bearer token | Mark device offline immediately |

Task queueing and cancellation require the operator key. A task without
`device_id` remains pending until any compatible worker claims it.
## Environment variables

See `.env.example`.

- `PRIMAL_ENROLLMENT_KEY` — shared secret required for registration.
- `PRIMAL_ADMIN_KEY` — operator key for the dashboard and privileged APIs.
- `PRIMAL_OFFLINE_SECONDS` — heartbeat expiry, default `90`.
- `DATABASE_URL` — optional Neon/Postgres state database.
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
vercel env add PRIMAL_ADMIN_KEY production
vercel env add PRIMAL_OFFLINE_SECONDS production
vercel deploy --prod --yes
```

## Security notes and limitations

- Registration is protected by a shared enrollment key, not per-user accounts.
- The dashboard and privileged device/task/job/message endpoints require the
  operator key when `PRIMAL_ADMIN_KEY` is configured.
- State is a single JSON object stored in Neon Postgres (with private Blob
  fallback). Writes are serialized with a Postgres advisory lock.
- Device metrics are self-reported by the device and are not attested.
- Task creation is operator-gated (admin key). The allow-listed workloads are
  `python` (sandboxed CLI runtime), `shell` (operator-only `sh -c`, CPU/time
  limited), and `http` (device-side request).
- Devices advertise their actual capabilities in every heartbeat. Jobs are
  offered only to compatible workers, while unclaimed shards remain available
  to any compatible device as a fallback.
- Compute-unit balances, hourly lending allowances and earned totals are
  settled by the server from capped execution time and reported CPU use.
- The service never downloads or executes remote binaries; all execution happens
  on the enrolled device.

## License

MIT
