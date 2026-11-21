import { readState } from '../../../../../lib/store.js';
import { withState } from '../../../../../lib/store.js';
import { taskView } from '../../../../../lib/tasks.js';
import { json, fail } from '../../../../../lib/http.js';

export const dynamic = 'force-dynamic';

export async function GET(_request, context) {
  const { id } = await context.params;
  const state = await readState();
  const task = state.tasks[id];
  if (!task) return fail('task_not_found', 404);
  return json({ task: taskView(task, state.devices) });
}

export async function POST(_request, context) {
  const { id } = await context.params;
  const result = await withState((state) => {
    const task = state.tasks[id];
    if (!task) return { error: 'task_not_found', status: 404 };
    if (['pending', 'claimed', 'executing'].includes(task.status)) {
      if (task.status === 'pending') {
        task.status = 'cancelled';
        task.completed_at = new Date().toISOString();
        task.error = 'cancelled_by_operator';
      } else {
        task.cancel_requested = true;
      }
    }
    return { ok: true, task: taskView(task, state.devices) };
  });
  if (result.error) return fail(result.error, result.status);
  return json(result);
}
