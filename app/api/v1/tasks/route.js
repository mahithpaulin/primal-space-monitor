import { readState } from '../../../../lib/store.js';
import { taskView, WORKLOADS } from '../../../../lib/tasks.js';
import { createTask } from '../../../../lib/tasks.js';
import { withState, pruneTasks } from '../../../../lib/store.js';
import { cleanString, json, fail, readJson } from '../../../../lib/http.js';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const state = await readState();
  const url = new URL(request.url);
  const deviceId = url.searchParams.get('device_id');
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
  const tasks = Object.values(state.tasks)
    .filter((task) => !deviceId || task.device_id === deviceId)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, limit)
    .map((task) => taskView(task, state.devices));
  return json({ tasks });
}

export async function POST(request) {
  const body = await readJson(request);
  if (!body) return fail('invalid_json', 400);

  const deviceId = body.device_id ? cleanString(body.device_id, 64) : null;
  const workload = cleanString(body.workload, 32) || 'hash_sum_v1';
  if (!WORKLOADS.includes(workload)) return fail('unsupported_workload', 400);

  const result = await withState((state) => {
    if (deviceId && !state.devices[deviceId]) return { error: 'device_not_found', status: 404 };
    const task = createTask({
      deviceId,
      workload,
      params: body.params,
      resourceLimits: body.resource_limits,
      createdBy: 'public_api',
    });
    state.tasks[task.id] = task;
    pruneTasks(state);
    return { task: taskView(task, state.devices) };
  });

  if (result.error) return fail(result.error, result.status);
  return json(result, 201);
}
