import { readState } from '../../../../../lib/store.js';
import { deviceView } from '../../../../../lib/status.js';
import { taskView } from '../../../../../lib/tasks.js';
import { json, fail } from '../../../../../lib/http.js';

export const dynamic = 'force-dynamic';

export async function GET(_request, context) {
  const { id } = await context.params;
  const state = await readState();
  const device = state.devices[id];
  if (!device) return fail('device_not_found', 404);

  const tasks = Object.values(state.tasks)
    .filter((task) => task.device_id === id)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, 10)
    .map((task) => taskView(task, state.devices));

  return json({ device: deviceView(device), tasks });
}
