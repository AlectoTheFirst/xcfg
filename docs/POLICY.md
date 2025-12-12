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

Rules (POC):

- **ANY service broadness**: deny/warn on firewall allow rules that use **ANY** service and are too broad (based on CIDR prefix length).
- **Unknown services**: warn/deny when a firewall allow rule contains ambiguous/unknown service entries (to prevent accidental “ANY”).

Example that should be denied:

- `source: 10.0.0.0/8`
- `destination: 11.0.0.0/8`
- `services: ANY`
- `action: allow`

## Configuration

Policies are configured via a file so different environments can use different rules without relying on environment variables.

Default path: `config/policy.json`

### Example

```json
{
  "default": {
    "mode": "enforce",
    "firewall": {
      "allow_rules": {
        "any_service": { "mode": "enforce", "min_prefixlen": 16 },
        "unknown_service": { "mode": "warn" }
      }
    }
  },
  "profiles": [
    {
      "name": "prod-untrust-strict",
      "priority": 100,
      "match": { "environment": "prod", "tags.zone": "untrust" },
      "override": {
        "firewall": {
          "allow_rules": { "any_service": { "min_prefixlen": 24, "mode": "enforce" } }
        }
      }
    },
    {
      "name": "mgmt-zone-lenient",
      "priority": 200,
      "match": { "tags.zone": "mgmt" },
      "override": {
        "firewall": {
          "allow_rules": { "any_service": { "mode": "disabled" } }
        }
      }
    }
  ]
}
```

xcfg can “pin” different policy behavior to metadata via `profiles[].match`.

xcfg computes `environment` using:

- `envelope.tags.environment` (preferred)
- otherwise `envelope.target.environment`
  - This can be set by the caller (e.g., ServiceNow) as metadata and used for routing/policy selection.

### Fields

- `default.mode`: global fallback `enforce | warn | disabled`
- `profiles[]`: optional overrides based on metadata matchers
  - `name`: label (for audit/debug)
  - `priority`: higher numbers apply later (override wins)
  - `match`: key/value matchers (AND)
  - `override`: partial settings to merge into `default`

Firewall guardrails:

- `firewall.allow_rules.any_service.mode`: `enforce | warn | disabled`
- `firewall.allow_rules.any_service.min_prefixlen`: if ANY-service is requested, any source/destination CIDR broader than `/<min_prefixlen>` is considered too broad (e.g., `/8` is broader than `/16`)
  - Set to `null` to treat ANY service as a violation regardless of CIDR size.
- `firewall.allow_rules.any_service.require_explicit`: default `true`; if `true`, only explicitly-specified ANY is treated as ANY (unknown service entries are handled by `unknown_service`)
- `firewall.allow_rules.unknown_service.mode`: `warn | enforce | disabled`

### Match Keys (POC)

Common match keys:

- `environment` (computed from envelope)
- `type`, `type_version`, `operation`
- `tags.<key>` (e.g., `tags.zone`, `tags.business_unit`)
- `target.<key>` (e.g., `target.backend_hint`)
- `plan.backends` (array of backends in the translated plan)
- `plan.actions` (array of actions in the translated plan)

## Extending Policies

To add a new rule:

1. Create a policy rule module (see `src/policies/firewallRuleBroadness.js`)
2. Register it in `src/policies/index.js`
3. Emit policy events to the audit trail (already done by `src/server.js`)

Future directions for production:

- Policy-as-code engines (OPA/Rego, Cedar) running as a sidecar
- Tenant-specific policy bundles and versioning
- Policy simulation (“explain why denied”) and safe auto-remediation suggestions
