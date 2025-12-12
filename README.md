# xcfg (Universal Configuration Engine)

xcfg is a translation and orchestration layer between intent-driven frontends (e.g., ServiceNow) and heterogeneous network backends (e.g., Check Point MDS, VMware/VeloCloud VCO, Zscaler, Nautobot, Infrahub, or other domain orchestrators).

The engine accepts a stable **intent envelope** from callers, validates/normalizes it, translates it into one or more backend-specific tasks, executes those tasks either statelessly or with durable state, and exposes full auditability, traceability, and monitoring.

## Core Ideas

- **Intent-first inbound API**: Callers send a `type` + `payload` that represents desired change, not vendor-specific actions.
- **Translators**: For each `type` and `type_version`, a translator produces an **Execution Plan** (tasks + dependencies) in a backend-neutral IR.
- **Adapters**: Backend adapters execute tasks, poll/check state, and accept callbacks/webhooks.
- **Statefulness on demand**: Some intents can be fully stateless; others persist state and reconcile with backends over time.
- **Audit/Trace/Monitor everything**: Every request and task emits audit events with correlation IDs, timestamps, actors, inputs, outputs, and errors.

## Stable Inbound API (ServiceNow → xcfg)

### Endpoint

`POST /v1/requests`

### Request Envelope

```json
{
  "api_version": "1",
  "type": "firewall-rule-change",
  "type_version": "1",
  "operation": "apply",
  "idempotency_key": "SNOW:CHG003210",
  "correlation_id": "CHG003210",
  "requested_by": {
    "system": "servicenow",
    "user": "jsmith",
    "email": "jsmith@example.com"
  },
  "target": {
    "backend_hint": "checkpoint",
    "domain": "prod",
    "site": "dc-1"
  },
  "payload": { },
  "tags": {
    "ticket": "CHG003210",
    "environment": "prod"
  },
  "created_at": "2025-12-12T12:00:00Z"
}
```

#### Field Semantics

- `api_version`: Version of the xcfg envelope. Changes rarely.
- `type`: High-level intent identifier. Stable and human-readable (kebab-case).
- `type_version`: Schema/behavior version for this type. Use semantic versioning or integer major versions.
- `operation`:
  - `plan`: Translate only (no backend calls).
  - `apply`: Translate + execute tasks.
  - `validate`: Translate + validate against current backend state.
  - `rollback`: Request rollback of a prior request.
- `idempotency_key`: Caller-supplied dedupe key (ServiceNow change/request ID).
- `correlation_id`: Optional cross-system trace ID (e.g., SNOW ticket).
- `requested_by`: Actor and originating system metadata.
- `target`: Optional hints to assist routing (backend, domain, site, tenant).
- `payload`: Type-specific schema.
- `tags`: Free-form labels for audit/metrics.
- `created_at`: Optional caller timestamp for audit ordering.

### Response

`202 Accepted`

```json
{
  "request_id": "6a2e6f7d-7e50-4f28-9e93-09a5e4edc1a6",
  "status": "queued",
  "links": {
    "self": "/v1/requests/6a2e6f7d-7e50-4f28-9e93-09a5e4edc1a6"
  }
}
```

### Status / Results

`GET /v1/requests/{request_id}` returns current status, per-task state, and audit trail.  
Backends can also send updates via callbacks (e.g., `POST /v1/callbacks/{backend}`).

### Reverse Mapping / Callbacks

Adapters should return an `external_id` for each task (job id, change id, rule uid, etc).  
xcfg persists a mapping `(backend, external_id) → (request_id, task_id)` so that:

- Backends can call xcfg with async results.
- xcfg can poll/check status later.
- Frontends can trace a ServiceNow ticket to vendor-native objects.

Generic callback endpoint:

`POST /v1/callbacks/{backend}`

```json
{
  "external_id": "vendor-job-123",
  "status": "running",
  "output": { },
  "error": { "message": "..." }
}
```

xcfg will update the matching task and roll up request status.

## Workflow / Visual Mapping (Future)

Execution Plans are DAGs of backend-neutral tasks. Translators can be:

- **Code-based** (TypeScript): full flexibility and complex logic.
- **Declarative** (YAML/JSON): map intent fields to tasks + dependencies.

A visual workflow editor can sit on top of the same plan IR, letting operators
drag/drop tasks, set dependencies, and publish a new `type_version` without
changing engine code. This stays optional so xcfg remains headless and testable.

### Example Payload: `firewall-rule-change` (v1)

```json
{
  "change_kind": "add",
  "rule": {
    "name": "allow-app-to-db",
    "action": "allow",
    "source": [{ "cidr": "10.10.0.0/24" }],
    "destination": [{ "cidr": "10.20.0.10/32" }],
    "services": [{ "protocol": "tcp", "port": 5432, "service_id": "postgres" }],
    "comment": "Requested via CHG003210",
    "enabled": true,
    "position": { "after": "rule-id-123" }
  },
  "policy": {
    "package": "corp-policy",
    "layer": "network",
    "domain": "mds1"
  }
}
```

### Adding New Intent Types

1. Define a stable `type` name and `type_version`.
2. Publish a JSON Schema for `payload`.
3. Implement a translator producing an execution plan.
4. Ensure adapters exist for targeted backends.
5. Add tests and observability for the new type.

## Repo Layout (initial)

- `src/core`: Envelope, translator/adapter contracts, registry, engine, audit.
- `src/examples`: Example translator + adapter.

This repo is currently a scaffold. Next steps are to add:

- HTTP API gateway (validation, auth, rate limiting).
- Durable state store + workflow runner.
- Real adapters for each backend.
- OpenTelemetry tracing + Prometheus metrics.
- Append-only audit/event store.
- Declarative translator format + optional visual editor.
