# Onboarding a New Backend Adapter (HOWTO)

This document explains how to add support for a new backend API (e.g., Zscaler, VeloCloud VCO, Nautobot, Infrahub) to **xcfg**, the Universal Configuration Engine.

## Mental Model

xcfg has three layers:

1. **Inbound intent** (`POST /v1/requests`): a stable envelope with `type`, `type_version`, and `payload`.
2. **Translator** (`type@type_version → Execution Plan`): converts intent into a backend-neutral plan (tasks + `depends_on` DAG).
3. **Adapter** (`task → backend API calls`): executes a task against a vendor backend and returns status + `external_id` for traceability.

The adapter is the backend integration point.

For end-to-end flow, see `docs/WORKFLOW.md`.

## Step 1: Pick a Backend Name

Choose a stable string used consistently across:

- `task.backend` in execution plans
- the adapter’s `name`
- callback URLs: `POST /v1/callbacks/{backend}`

Example: `checkpoint`, `zscaler`, `velocloud`, `nautobot`.

## Step 2: Define Task Actions (Your Backend Contract)

Decide which **actions** your backend will support. Actions are strings like:

- `firewall.objects.ensure`
- `firewall.rule.add`
- `firewall.policy.install`

Translators emit tasks with `{ backend, action, input }`. Your adapter interprets `(action, input)` and maps it to concrete API calls.

## Step 3: Implement the Adapter

Create a new module exporting a `BackendAdapter` (see `src/core/adapter.js`).

For the POC, adapters live in `src/examples/adapters/`. For production, you’ll likely move these into `src/backends/<name>/`.

Example skeleton:

```js
export const myBackendAdapter = {
  name: 'my-backend',

  async execute(task, ctx) {
    // task: { id, backend, action, input, depends_on? }
    // ctx:  { request_id, task, config?, secrets?, state? }

    // 1) Switch on task.action
    // 2) Call the vendor API
    // 3) Return a task result

    const now = new Date().toISOString();
    return {
      task_id: task.id,
      backend: task.backend,
      status: 'succeeded', // or 'running' | 'failed'
      external_id: 'vendor-object-or-job-id',
      output: { note: 'safe-to-store output only' },
      started_at: now,
      finished_at: now
    };
  },

  async checkStatus(external_id, ctx) {
    // Optional: if execute returns status:'running', implement polling here.
    // Must return one of: queued|running|succeeded|failed|canceled
    return 'running';
  }
};
```

### Result Shape Guidelines

The engine and store use these fields for traceability:

- `task_id`: must equal `task.id`
- `backend`: should equal the adapter name (and `task.backend`)
- `status`: `queued | running | succeeded | failed | canceled`
- `external_id` (recommended): vendor job id / object id to enable reverse mapping
- `output`: safe response data for audit/debugging (never include secrets)
- `error`: `{ message, ... }` for failures (safe details only)
- `started_at` / `finished_at`: ISO timestamps (optional but helpful)

## Step 4: Support Async Backends (Polling and/or Callbacks)

Backends often apply changes asynchronously (job queues, policy installs, etc.).

xcfg supports two ways to converge task state:

### A) Polling (`checkStatus`)

If `execute()` returns `status: "running"` and an `external_id`, implement:

- `checkStatus(external_id, ctx) → "running" | "succeeded" | "failed" | ...`

The in-process runner will poll `checkStatus()` for tasks that are `running` and have an `external_id`.

### B) Callbacks (`POST /v1/callbacks/{backend}`)

If the vendor supports webhooks, configure it to call:

`POST /v1/callbacks/{backend}`

With a payload like:

```json
{ "external_id": "vendor-job-123", "status": "succeeded", "output": {} }
```

xcfg uses persisted reverse mapping `(backend, external_id) → (request_id, task_id)` to update the correct task.

## Step 5: Configure the Backend (Endpoints + Secrets)

xcfg provides backend configuration to adapters via:

- `ctx.config` from `config/backends.json`
- `ctx.secrets` from `config/secrets.json` (not committed)

See `docs/BACKENDS.md` for the file formats and how profile overrides can be pinned to metadata.

## Step 6: Register the Adapter

Register the adapter in the default engine registry:

- `src/index.js` (`createDefaultEngine`)

Example:

```js
import { myBackendAdapter } from './examples/adapters/myBackendAdapter.js';
registry.registerAdapter(myBackendAdapter);
```

## Step 7: Route Intents to Your Backend

Translators choose the backend by setting `task.backend`. In the POC example, the translator uses:

- `envelope.target.backend_hint` (if provided)
- otherwise a default (e.g., `checkpoint`)

When adding a new backend, ensure the relevant translators can emit tasks with `backend: "<your-adapter-name>"`.

## Step 8: Add a Smoke Test

Recommended minimum test:

- translator emits the intended task set (and dependencies)
- adapter returns a valid task result
- async tasks block dependent tasks until completion

The repo already includes a DAG scheduling test: `test/engine-dag.test.js`.

## Production Checklist (Beyond the POC)

- Secrets management (`ctx.secrets`), redaction, and output sanitization
- Retries/backoff/timeouts and idempotent vendor operations
- Rate limiting and concurrency controls per backend
- Strong auth (mTLS/JWT) + distinct callback authentication
- Better state reconciliation (`operation:"validate"`) and drift detection
