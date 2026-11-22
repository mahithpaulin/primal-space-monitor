import { readState } from '../../../../lib/store.js';
import { taskView, WORKLOADS } from '../../../../lib/tasks.js';
import { issueTask } from '../../../../lib/actions.js';
import { sweepStore } from '../../../../lib/scheduler.js';
import { adminGateResponse, isAdminRequest } from '../../../../lib/admin.js';
import { cleanString, json, fail, readJson } from '../../../../lib/http.js';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (!isAdminRequest(request)) {
    const gate = adminGateResponse();
    return fail(gate.error, gate.status);
  }
  await sweepStore();
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

  try {
    const task = await issueTask({
      deviceId,
      workload,
      params: body.params,
      limits: body.resource_limits,
      createdBy: 'public_api',
    });
    return json({ task }, 201);
  } catch (error) {
    const message = error.message || 'task_create_failed';
    const status = message.startsWith('unsupported_workload') ? 409 : message === 'device_not_found' ? 404 : 400;
    return fail(message, status);
  }
}
