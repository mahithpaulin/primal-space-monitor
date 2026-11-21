import { withState } from '../../../../../lib/store.js';
import { adminGateResponse, isAdminRequest } from '../../../../../lib/admin.js';
import { json, fail } from '../../../../../lib/http.js';

export const dynamic = 'force-dynamic';

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
