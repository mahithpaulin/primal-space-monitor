import { readState, withState } from '../../../../../lib/store.js';
import { authenticateDevice } from '../../../../../lib/auth.js';
import { deviceView } from '../../../../../lib/status.js';
import { taskView } from '../../../../../lib/tasks.js';
import { adminGateResponse, isAdminRequest } from '../../../../../lib/admin.js';
import { json, fail } from '../../../../../lib/http.js';

export const dynamic = 'force-dynamic';

export async function GET(request, context) {
  const { id } = await context.params;
  const state = await readState();
  const device = state.devices[id];
  if (!device) return fail('device_not_found', 404);
  if (!isAdminRequest(request)) {
    const auth = authenticateDevice(state, request, id);
    if (auth.error) return fail(auth.error, auth.status);
  }

  const tasks = Object.values(state.tasks)
    .filter((task) => task.device_id === id)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, 10)
    .map((task) => taskView(task, state.devices));

  return json({ device: deviceView(device), tasks });
}

export async function DELETE(request, context) {
  if (!isAdminRequest(request)) {
    const gate = adminGateResponse();
    return fail(gate.error, gate.status);
  }
  const { id } = await context.params;
  const result = await withState((state) => {
    if (!state.devices[id]) return { error: 'device_not_found', status: 404 };
    delete state.devices[id];
    for (const [taskId, task] of Object.entries(state.tasks)) {
      if (task.device_id === id && ['pending', 'claimed', 'executing'].includes(task.status)) {
        state.tasks[taskId] = {
          ...task,
          status: 'cancelled',
          error: 'device_removed',
          completed_at: new Date().toISOString(),
        };
      }
    }
    return { ok: true, device_id: id };
  });
  if (result.error) return fail(result.error, result.status);
  return json(result);
}
