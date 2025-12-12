# xcfg Roadmap (near-term)

This is a living document. Versions are indicative.

## 0.1 Scaffold (now)

- Stable inbound intent envelope (`/v1/requests`).
- Translator/adapter contracts + registry.
- Minimal execution engine (sequential).
- In‑memory request store + external ID reverse mapping.
- HTTP gateway + callback endpoint.
- Console audit + lightweight telemetry + `/v1/metrics`.

## 0.2 MVP Execution

- Durable stores:
  - Request/event store (Postgres or similar).
  - Secrets/config store abstraction (Vault/KMS).
- Async workflow runner with retries/backoff and task DAG scheduling.
- Message bus / queue abstraction (DB-backed queue/outbox first; pluggable NATS/RabbitMQ/Kafka later).
- Idempotency enforcement on `idempotency_key`.
- Authentication/authorization (mTLS + JWT/OIDC) and RBAC.
- Schema validation per `type@type_version` (JSON Schema).

## 0.3 Backend Depth

- Real adapters:
  - Check Point MDS (policy/rule lifecycle).
  - VeloCloud VCO (edge config, segments, profiles).
  - Zscaler (location/groups/policy).
  - Nautobot/Infrahub for SoT sync.
- State reconciliation loops (`validate` + drift detection).
- Rollback strategy per intent (compensating plans).

## 0.4 Declarative & Visual Authoring

- Declarative translator format (YAML/JSON to plan IR).
- Optional visual editor for composing task DAGs per type/version.
- Type catalog + schema publishing pipeline.

## 0.5 Production Hardening

- OpenTelemetry tracing integration.
- Prometheus metrics + SLO dashboards.
- Append‑only audit/event store with immutability guarantees.
- Multi‑tenant isolation and per‑tenant quotas.
