import { withState, pruneTasks } from './store.js';
import { createTask, taskView } from './tasks.js';

export async function issueTask({ deviceId, workload = 'hash_sum_v1', params, limits, createdBy = 'dashboard' }) {
  return withState((state) => {
    const device = state.devices[deviceId];
    if (!device) throw new Error('device_not_found');
    const task = createTask({
      deviceId,
      workload,
      params,
      resourceLimits: limits,
      createdBy,
    });
    state.tasks[task.id] = task;
    pruneTasks(state);
    return taskView(task, state.devices);
  });
}

export async function cancelTask(taskId) {
  return withState((state) => {
    const task = state.tasks[taskId];
    if (!task) throw new Error('task_not_found');
    if (['pending', 'claimed', 'executing'].includes(task.status)) {
      if (task.status === 'pending') {
        task.status = 'cancelled';
        task.completed_at = new Date().toISOString();
        task.error = 'cancelled_by_operator';
      } else {
        task.cancel_requested = true;
      }
    }
    return taskView(task, state.devices);
  });
}
