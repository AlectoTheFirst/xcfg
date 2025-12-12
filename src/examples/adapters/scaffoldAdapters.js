function safeConfigSummary(config) {
  if (!config || typeof config !== 'object') return undefined;
  const out = {};
  if (typeof config.kind === 'string') out.kind = config.kind;
  if (typeof config.base_url === 'string') out.base_url = config.base_url;
  if (typeof config.domain === 'string') out.domain = config.domain;
  if (typeof config.tenant === 'string') out.tenant = config.tenant;
  if (typeof config.site === 'string') out.site = config.site;
  return Object.keys(out).length > 0 ? out : undefined;
}

function createScaffoldAdapter(name) {
  return {
    name,
    async execute(task, ctx) {
      const now = new Date().toISOString();
      return {
        task_id: task.id,
        backend: task.backend,
        status: 'succeeded',
        external_id: `stub-${name}-${task.id}`,
        output: {
          note: `${name} adapter is a scaffold`,
          action: task.action,
          config: safeConfigSummary(ctx?.config)
        },
        started_at: now,
        finished_at: now
      };
    }
  };
}

export const velocloudAdapter = createScaffoldAdapter('velocloud');
export const zscalerAdapter = createScaffoldAdapter('zscaler');
export const nautobotAdapter = createScaffoldAdapter('nautobot');
export const infrahubAdapter = createScaffoldAdapter('infrahub');

