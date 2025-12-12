# Policy Guardrails

xcfg can enforce **guardrail policies** before executing requests. This is separate from authentication and authorization: a caller may be authenticated/authorized and still be blocked if the requested change violates safety rules.

Policies answer questions like:

- Is this change within allowed blast radius?
- Is it too permissive (e.g., “ANY service” to/from very large networks)?
- Does it violate environment constraints (prod vs non-prod)?
- Does it violate a change window?

## Where Policies Run

For the POC, policies run in the API layer after translation:

1. Validate envelope + payload
2. Translate to an Execution Plan (tasks + DAG)
3. Evaluate policies against the plan (backend-neutral)
4. If denied, xcfg returns `403` and stores the request with `status:"denied"` (and audit events)

This approach keeps policy logic independent of backend vendors and lets you reason about the impact using the plan IR.

## Current Built-in Policy (POC)

Rule: deny (or warn on) firewall allow rules that are too broad with **ANY** service.

Example that should be denied:

- `source: 10.0.0.0/8`
- `destination: 11.0.0.0/8`
- `services: ANY`
- `action: allow`

## Configuration

Environment variables:

- `XCFG_POLICY_MODE`
  - `enforce` (default): deny requests that violate deny rules
  - `warn`: do not block, but record audit events
  - `disabled`: skip policy evaluation
- `XCFG_POLICY_FIREWALL_ANY_MAX_ADDRESSES` (default `65536`)
  - If ANY-service is requested, any source/destination CIDR larger than this is considered too broad.

## Extending Policies

To add a new rule:

1. Create a policy rule module (see `src/policies/firewallRuleBroadness.js`)
2. Register it in `src/policies/index.js`
3. Emit policy events to the audit trail (already done by `src/server.js`)

Future directions for production:

- Policy-as-code engines (OPA/Rego, Cedar) running as a sidecar
- Tenant-specific policy bundles and versioning
- Policy simulation (“explain why denied”) and safe auto-remediation suggestions

