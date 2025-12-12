# Ideas: Declarative YAML Specs + Compiled Go Runtime

This document captures a potential future direction for xcfg: a **high-performance core** (Go) that executes **declarative specs** (YAML) for inbound intents, backend connectors, and policy guardrails.

This is an architectural idea only; it is not implemented.

## Goal

Make xcfg:

- Safer to operate (strong guardrails, smaller runtime surface area)
- More portable (single binary + bundles)
- Easier to extend (add/modify types and connectors without code changes)
- Faster and more scalable (compiled runtime, efficient concurrency)

## Keep a Stable Internal IR

Even with YAML, xcfg should keep a stable internal representation (IR) like the current **Execution Plan** DAG:

- `tasks[]` with `{ id, backend, action, input, depends_on }`

The IR is the contract that:

- Policies evaluate (backend-neutral)
- The runner executes (dependency scheduling, async resume)
- Auditing/traceability targets (consistent records)

YAML and plugins compile/translate into IR.

## YAML-IN (Intent Type Catalog)

Intent specs could be shipped as YAML “type bundles”:

- `type` + `type_version`
- Envelope expectations (required fields, routing hints)
- Payload schema (JSON Schema-like or native constraints)
- Mapping rules from payload → IR tasks (including `depends_on`)

This can enable:

- Versioned type publishing
- Validation without code deployments
- Visual editing on top of a well-defined schema/mapping model

## YAML-OUT (Backend Connector Catalog)

Backend “connectors” could define how an IR task becomes real vendor calls:

- Supported backends and actions
- HTTP request templates (method/path/query/body headers)
- Auth methods (referencing secret keys, not embedding secrets)
- Response mapping (extract `external_id`, normalize outputs)
- Async job patterns (polling endpoints, terminal states)

This would let adapters become largely declarative for common patterns.

## Policy as YAML (Guardrails per Type)

Guardrails can be expressed as YAML rules evaluated against:

- the inbound intent (payload constraints)
- and/or the translated plan (impact analysis / blast radius)

Examples:

- Deny “ANY service” with overly broad CIDRs
- Deny changes outside approved environments
- Deny changes outside maintenance windows
- Warn-only mode for lower environments

## Compiled Go Core (Execution Runtime)

The runtime could be a Go service that:

- Loads YAML bundles at startup (or via a controlled bundle API)
- Compiles specs into an internal IR + evaluators
- Executes plans with strong concurrency controls
- Provides audit/trace/metrics as first-class outputs

Why Go:

- Efficient concurrency (per-backend workers, rate limiting)
- Easy to ship (single binary) and run as a hardened container
- Lower dependency surface area vs large JS dependency graphs

## Escape Hatches for Expressiveness

Pure YAML won’t cover all real-world complexity (lookups, conditionals, object resolution).

To avoid “YAML becoming a programming language,” consider:

- A small, sandboxed expression language for mapping (strictly limited)
- Optional signed plugins for vendor-specific hard cases
- A strict boundary: plugins can only produce IR tasks or execute a single action

## Governance and Safety

If YAML defines behavior, it must be treated like code:

- Signed bundle artifacts and provenance
- Review/promotion pipelines (dev → stage → prod)
- Per-tenant isolation and policy overlays
- Audit log of who published what bundle/version

## Suggested Migration Path (from the POC)

1. Keep the current IR + runner semantics as the stable core contract.
2. Add a “declarative translator” format for simple types first.
3. Add “connector specs” for simple HTTP backends/actions.
4. Introduce bundle versioning and signed artifacts.
5. Only then consider moving the runtime from Node to Go.

