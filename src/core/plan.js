export const TASK_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'canceled'
];

const taskStatusSet = new Set(TASK_STATUSES);

/**
 * @param {any} value
 * @returns {value is string}
 */
export function isTaskStatus(value) {
  return typeof value === 'string' && taskStatusSet.has(value);
}

