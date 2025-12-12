import http from 'http';
import { randomUUID } from 'crypto';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { createDefaultEngine } from './index.js';
import { InMemoryRequestStore } from './core/requestStore.js';
import { SQLiteRequestStore } from './core/sqliteRequestStore.js';
import { InProcessRunner } from './core/runner.js';
import type { XCFGEnvelope } from './core/envelope.js';
import { ConsoleTelemetry } from './core/telemetry.js';
import type { TaskResult, TaskStatus } from './core/plan.js';

const telemetry = new ConsoleTelemetry();
const engine = createDefaultEngine({ telemetry });
const store =
  process.env.XCFG_STORE === 'memory'
    ? new InMemoryRequestStore()
    : new SQLiteRequestStore(process.env.XCFG_DB_PATH ?? 'data/xcfg.db');
const runner = new InProcessRunner(engine, store);
runner.start();

const requiredApiKey = process.env.XCFG_API_KEY;

function isAuthorized(req: http.IncomingMessage): boolean {
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

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload)
  });
  res.end(payload);
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON body');
  }
}

function isEnvelope(body: any): body is XCFGEnvelope {
  return (
    body &&
    body.api_version === '1' &&
    typeof body.type === 'string' &&
    typeof body.type_version === 'string' &&
    typeof body.operation === 'string' &&
    typeof body.idempotency_key === 'string' &&
    'payload' in body
  );
}

function isTaskStatus(value: any): value is TaskStatus {
  return (
    value === 'queued' ||
    value === 'running' ||
    value === 'succeeded' ||
    value === 'failed' ||
    value === 'canceled'
  );
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

    if (req.method === 'POST' && url.pathname === '/v1/requests') {
      const body = await readBody(req);
      if (!isEnvelope(body)) {
        return sendJson(res, 400, {
          error: 'Invalid envelope',
          hint: 'Check api_version/type/type_version/operation/idempotency_key/payload'
        });
      }

      const existing = await store.findByIdempotencyKey(
        body.idempotency_key
      );
      if (existing) {
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

      await store.create({
        request_id,
        envelope: body,
        plan: handleResult.plan,
        results: handleResult.results,
        status: handleResult.status,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      if (body.operation === 'apply') {
        await runner.enqueue(request_id);
      }

      return sendJson(res, 202, {
        request_id,
        status: handleResult.status,
        links: { self: `/v1/requests/${request_id}` }
      });
    }

    if (req.method === 'POST' && url.pathname.startsWith('/v1/callbacks/')) {
      const backend = url.pathname.split('/').pop()!;
      const body = (await readBody(req)) as any;
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

      const status: TaskStatus = isTaskStatus(body.status)
        ? body.status
        : 'running';

      const now = new Date().toISOString();
      const results: TaskResult[] = [...(record.results ?? [])];
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
      const planTasks = record.plan?.tasks ?? [];
      if (results.some(r => r.status === 'failed')) {
        requestStatus = 'failed';
      } else if (
        planTasks.length > 0 &&
        planTasks.every(t =>
          results.find(r => r.task_id === t.id)?.status === 'succeeded'
        )
      ) {
        requestStatus = 'executed';
      }

      await store.update(ref.request_id, {
        results,
        status: requestStatus
      });

      return sendJson(res, 202, {
        request_id: ref.request_id,
        task_id: ref.task_id,
        status
      });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/v1/requests/')) {
      const request_id = url.pathname.split('/').pop()!;
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
  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`xcfg server listening on :${port}`);
  });
}

function isMainModule(): boolean {
  try {
    if (!process.argv[1]) return false;
    return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

const shouldStart =
  isMainModule() ||
  process.env.XCFG_AUTOSTART === '1' ||
  process.env.UCE_AUTOSTART === '1';

if (shouldStart) {
  start(Number(process.env.PORT) || 8080);
}
