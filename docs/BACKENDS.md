# Backend Configuration

This document describes how xcfg is configured to talk to backend systems (Check Point, Zscaler, VeloCloud, Nautobot, Infrahub, etc.).

## Two Files

xcfg separates non-secret backend configuration from secrets:

- `config/backends.json` (committed): endpoints, domains/tenants, non-secret defaults
- `config/secrets.json` (not committed): tokens, client secrets, passwords

`config/secrets.json` is ignored by git (`.gitignore`) and should be provided via a secure mechanism (Kubernetes secret mount, Vault agent, encrypted file, etc.).

An example is provided in `config/secrets.example.json`.

## How Configuration Reaches Adapters

When executing a task, xcfg calls the backend adapter with an `AdapterContext`.

xcfg will populate:

- `ctx.config`: selected backend config (from `config/backends.json`)
- `ctx.secrets`: selected backend secrets (from `config/secrets.json` if present)

Adapters should never log secrets and should be careful about what they return in `output` and `error`.

## Selecting the Backend

Which backend is used is determined by translation (tasks emitted by the translator):

- A translator sets `task.backend` (e.g., `checkpoint`, `zscaler`, `nautobot`)
- For the POC, the example translator uses `envelope.target.backend_hint` as a routing hint

The backend name must match:

- the adapter `name`
- a key in `config/backends.json` and `config/secrets.json`

## Profile Overrides (“Pinning” Config to Metadata)

Different environments, zones, or business areas may need different backend settings.

`config/backends.json` supports a `profiles[]` list to override backend config when the request matches metadata.

Each profile:

- `match`: key/value matchers (AND)
- `priority`: higher numbers apply later (override wins)
- `override`: merged into the base config

Common match keys:

- `environment` (computed from `envelope.tags.environment` or `envelope.target.environment`)
- `backend` (the selected backend for the task)
- `tags.<key>` (e.g., `tags.zone`, `tags.business_unit`)
- `target.<key>` (e.g., `target.domain`)

## Roadmap (Production)

For MVP/production, this should evolve into:

- pluggable secrets/config providers (Vault/KMS/Keychain/etc.)
- per-tenant isolation and RBAC for who can target which backends
- strong audit logs for config/policy bundle changes

