import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDefaultEngine } from './index.js';
import { ConsoleAuditSink, FanoutAuditSink, InMemoryAuditSink } from './core/audit.js';
import { InMemoryRequestStore } from './core/requestStore.js';
import { InProcessRunner } from './core/runner.js';
import { isXcfgEnvelope } from './core/envelope.js';
import { ConsoleTelemetry } from './core/telemetry.js';
import { isTaskStatus } from './core/plan.js';
import { stableStringify } from './core/stableJson.js';
import { readFile } from 'node:fs/promises';
import { createPolicyEngine, DEFAULT_POLICY_CONFIG } from './policies/index.js';
import {
  DEFAULT_BACKENDS_CONFIG,
  DEFAULT_SECRETS_CONFIG,
  resolveBackendConfig,
  resolveBackendSecrets
} from './core/backendConfig.js';

const telemetry = new ConsoleTelemetry();
const storeKind = process.env.XCFG_STORE ?? 'memory';
const dbPath = process.env.XCFG_DB_PATH ?? 'data/xcfg.db';

const { store, auditSink } = await createStorage(storeKind, dbPath);
const backendsConfig = await loadBackendsConfig();
const secretsConfig = await loadSecretsConfig();
const contextProvider = createBackendContextProvider(backendsConfig, secretsConfig);
const engine = createDefaultEngine({
  telemetry,
  audit: auditSink,
  contextProvider
});
const runner = new InProcessRunner(engine, store);
const policyConfig = await loadPolicyConfig();

const requiredApiKey = process.env.XCFG_API_KEY;

function isAuthorized(req) {
  if (!requiredApiKey) return true;
  const headerKey = req.headers['x-api-key'];
  if (typeof headerKey === 'string' && headerKey === requiredApiKey) {
    return true;
  }
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const token = auth.slice('Bearer '.length);
    return token === requiredApiKey;
  }
  return false;
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload)
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON body');
  }
}

async function createStorage(kind, path) {
  if (kind === 'sqlite') {
    const { SQLiteRequestStore, SQLiteAuditSink } = await import('./sqlite.js');
    return {
      store: new SQLiteRequestStore(path),
      auditSink: new SQLiteAuditSink(path)
    };
  }

  const memoryAudit = new InMemoryAuditSink();
  return {
    store: new InMemoryRequestStore(),
    auditSink: new FanoutAuditSink([new ConsoleAuditSink(), memoryAudit])
  };
}

async function loadPolicyConfig() {
  try {
    const raw = await readFile('config/policy.json', 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : DEFAULT_POLICY_CONFIG;
  } catch {
    return DEFAULT_POLICY_CONFIG;
  }
}

async function loadBackendsConfig() {
  try {
    const raw = await readFile('config/backends.json', 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : DEFAULT_BACKENDS_CONFIG;
  } catch {
    return DEFAULT_BACKENDS_CONFIG;
  }
}

async function loadSecretsConfig() {
  try {
    const raw = await readFile('config/secrets.json', 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : DEFAULT_SECRETS_CONFIG;
  } catch {
    return DEFAULT_SECRETS_CONFIG;
  }
}

function createBackendContextProvider(backends, secrets) {
  return async ({ envelope, plan, task }) => {
    const resolved = resolveBackendConfig(backends, envelope, plan, task);
    const resolvedSecrets = resolveBackendSecrets(secrets, task);
    return { config: resolved.config, secrets: resolvedSecrets.secrets };
  };
}

function fingerprintEnvelope(envelope) {
  return stableStringify({
    api_version: envelope.api_version,
    type: envelope.type,
    type_version: envelope.type_version,
    operation: envelope.operation,
    target: envelope.target ?? null,
    payload: envelope.payload
  });
}

function denyRecordResults(plan, violations) {
  const now = new Date().toISOString();
  const message =
    violations.length > 0 ? violations[0].message : 'Request denied by policy';
  return (plan?.tasks ?? []).map(t => ({
    task_id: t.id,
    backend: t.backend,
    status: 'canceled',
    error: { message },
    started_at: now,
    finished_at: now
  }));
}

export const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/healthz') {
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'GET' && url.pathname === '/v1/metrics') {
      const snapshot =
        telemetry.metrics.snapshot?.() ?? { counters: {}, histograms: {} };
      return sendJson(res, 200, snapshot);
    }

    if (!isAuthorized(req)) {
      return sendJson(res, 401, { error: 'Unauthorized' });
    }

    if (req.method === 'GET' && url.pathname === '/v1/requests') {
      const key = url.searchParams.get('idempotency_key');
      if (!key) {
        return sendJson(res, 400, {
          error: 'Missing idempotency_key query parameter'
        });
      }
      const record = await store.findByIdempotencyKey(key);
      if (!record) return sendJson(res, 404, { error: 'Not found' });
      return sendJson(res, 200, record);
    }

    if (req.method === 'POST' && url.pathname === '/v1/requests') {
      const body = await readBody(req);
      if (!isXcfgEnvelope(body)) {
        return sendJson(res, 400, {
          error: 'Invalid envelope',
          hint:
            'Check api_version/type/type_version/operation/idempotency_key/payload'
        });
      }

      const existing = await store.findByIdempotencyKey(body.idempotency_key);
      if (existing) {
        if (fingerprintEnvelope(existing.envelope) !== fingerprintEnvelope(body)) {
          return sendJson(res, 409, {
            error: 'Idempotency key already used for a different request',
            request_id: existing.request_id,
            links: { self: `/v1/requests/${existing.request_id}` }
          });
        }
        if (existing.status === 'denied') {
          return sendJson(res, 403, {
            error: 'Request denied by policy',
            request_id: existing.request_id,
            links: { self: `/v1/requests/${existing.request_id}` }
          });
        }
        return sendJson(res, 202, {
          request_id: existing.request_id,
          status: existing.status,
          idempotent_replay: true,
          links: { self: `/v1/requests/${existing.request_id}` }
        });
      }

      const request_id = randomUUID();
      const handleResult = await engine.handle(body, {
        request_id,
        execute: false
      });

      const policy = await createPolicyEngine(
        policyConfig,
        body,
        handleResult.plan
      ).evaluate({
        request_id,
        envelope: body,
        plan: handleResult.plan
      });
      if (policy.violations.length > 0) {
        await auditSink.write({
          request_id,
          timestamp: new Date().toISOString(),
          level: policy.decision === 'deny' ? 'warn' : 'info',
          stage: 'policy',
          message:
            policy.decision === 'deny' ? 'Policy denied request' : 'Policy warnings',
          data: policy
        });
      }

      if (body.operation === 'apply' && policy.decision === 'deny') {
        await store.create({
          request_id,
          envelope: body,
          plan: handleResult.plan,
          results: denyRecordResults(handleResult.plan, policy.violations),
          status: 'denied',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });

        return sendJson(res, 403, {
          error: 'Request denied by policy',
          request_id,
          violations: policy.violations,
          links: { self: `/v1/requests/${request_id}` }
        });
      }

      await store.create({
        request_id,
        envelope: body,
        plan: handleResult.plan,
        results:
          body.operation === 'apply'
            ? (handleResult.plan?.tasks ?? []).map(t => ({
                task_id: t.id,
                backend: t.backend,
                status: 'queued'
              }))
            : handleResult.results,
        status: handleResult.status,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      if (body.operation === 'apply') {
        await runner.enqueue(request_id);
        void runner.tick?.();
      }

      return sendJson(res, 202, {
        request_id,
        status: handleResult.status,
        links: { self: `/v1/requests/${request_id}` }
      });
    }

    if (req.method === 'POST' && url.pathname.startsWith('/v1/callbacks/')) {
      const backend = url.pathname.split('/').pop();
      const body = await readBody(req);
      const external_id = body?.external_id;
      if (typeof external_id !== 'string' || !external_id) {
        return sendJson(res, 400, { error: 'external_id is required' });
      }

      const ref = await store.findTaskByExternalId(backend, external_id);
      if (!ref) {
        return sendJson(res, 404, { error: 'Unknown external_id' });
      }

      const record = await store.get(ref.request_id);
      if (!record) {
        return sendJson(res, 404, { error: 'Request not found' });
      }

      const status = isTaskStatus(body.status) ? body.status : 'running';

      const now = new Date().toISOString();
      const results = [...(record.results ?? [])];
      const idx = results.findIndex(r => r.task_id === ref.task_id);
      if (idx >= 0) {
        results[idx] = {
          ...results[idx],
          status,
          output: body.output ?? results[idx].output,
          error: body.error ?? results[idx].error,
          finished_at:
            status === 'succeeded' || status === 'failed'
              ? now
              : results[idx].finished_at
        };
      } else {
        results.push({
          task_id: ref.task_id,
          backend,
          status,
          external_id,
          output: body.output,
          error: body.error,
          started_at: now,
          finished_at:
            status === 'succeeded' || status === 'failed' ? now : undefined
        });
      }

      let requestStatus = record.status;
      if (record.plan) {
        requestStatus = engine.rollupStatus(record.plan, results);
      }

      await store.update(ref.request_id, {
        results,
        status: requestStatus
      });

      await auditSink.write({
        request_id: ref.request_id,
        timestamp: now,
        level: 'info',
        stage: 'callback',
        message: `Callback received from ${backend}`,
        data: { external_id, status }
      });
      void runner.tick?.();

      return sendJson(res, 202, {
        request_id: ref.request_id,
        task_id: ref.task_id,
        status
      });
    }

    if (
      req.method === 'GET' &&
      url.pathname.startsWith('/v1/requests/') &&
      url.pathname.endsWith('/audit')
    ) {
      const parts = url.pathname.split('/').filter(Boolean);
      const request_id = parts[2];
      if (!request_id) return sendJson(res, 404, { error: 'Not found' });
      const record = await store.get(request_id);
      if (!record) return sendJson(res, 404, { error: 'Not found' });

      if (typeof auditSink?.listByRequestId !== 'function') {
        return sendJson(res, 501, {
          error: 'Audit sink is not queryable in this mode'
        });
      }

      const limitParam = url.searchParams.get('limit');
      const limit = limitParam ? Number(limitParam) : 1000;
      const events = await auditSink.listByRequestId(request_id, limit);
      return sendJson(res, 200, { request_id, events });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/v1/requests/')) {
      const request_id = url.pathname.split('/').pop();
      const record = await store.get(request_id);
      if (!record) return sendJson(res, 404, { error: 'Not found' });
      return sendJson(res, 200, record);
    }

    return sendJson(res, 404, { error: 'Route not found' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return sendJson(res, 500, { error: message });
  }
});

export function start(port = 8080) {
  runner.start();
  server.listen(port, () => {
    console.log(`xcfg server listening on :${port}`);
  });
}

function isMainModule() {
  try {
    if (!process.argv[1]) return false;
    return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

const shouldStart =
  isMainModule() ||
  process.env.XCFG_AUTOSTART === '1';

if (shouldStart) {
  start(Number(process.env.PORT) || 8080);
}
