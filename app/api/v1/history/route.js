import { withStateRead } from '../../../../lib/store.js';
import { authenticateDevice } from '../../../../lib/auth.js';
import { taskView } from '../../../../lib/tasks.js';
import { jobProgress, jobStatus } from '../../../../lib/jobs.js';
import { cleanString, json, fail } from '../../../../lib/http.js';
import { sweepStore } from '../../../../lib/scheduler.js';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const url = new URL(request.url);
  const deviceId = cleanString(url.searchParams.get('device_id'), 64);
  if (!deviceId) return fail('device_id_required', 400);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));

  await sweepStore();
  const result = await withStateRead((state) => {
    const auth = authenticateDevice(state, request, deviceId);
    if (auth.error) return auth;

    const deviceTasks = Object.values(state.tasks)
      .filter((task) => task.claimed_by === deviceId)
      .sort((a, b) => {
        const completed = Date.parse(b.completed_at || b.created_at) - Date.parse(a.completed_at || a.created_at);
        return completed || b.id.localeCompare(a.id);
      });
    const visibleTasks = deviceTasks.slice(0, limit);
    const jobIds = new Set(deviceTasks.map((task) => task.job_id).filter(Boolean));
    const jobs = Object.values(state.jobs || {})
      .filter((job) => jobIds.has(job.id))
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .slice(0, limit)
      .map((job) => {
        const shards = (job.task_ids || [])
          .map((id) => state.tasks[id])
          .filter((task) => task && task.claimed_by === deviceId)
          .map((task) => ({
            id: task.id,
            index: task.shard_index ?? 0,
            status: task.status,
            value: task.result_value ?? null,
            verified: task.verified ?? null,
            error: task.error ?? null,
            attempts: task.attempts ?? 0,
            duration_ms: task.duration_ms ?? null,
            completed_at: task.completed_at ?? null,
          }));
        return {
          id: job.id,
          workload: job.workload,
          status: jobStatus(job, state.tasks),
          shard_count: job.shard_count,
          item_count: job.item_count ?? null,
          reduce: job.reduce || 'concat',
          progress: jobProgress(job, state.tasks),
          created_at: job.created_at,
          deadline_at: job.deadline_at,
          completed_at: job.completed_at ?? null,
          cancelled_at: job.cancelled_at ?? null,
          shards,
        };
      });

    const summary = {
      tasks: deviceTasks.length,
      completed: deviceTasks.filter((task) => task.status === 'completed').length,
      failed: deviceTasks.filter((task) => ['failed', 'cancelled'].includes(task.status)).length,
      active: deviceTasks.filter((task) => ['pending', 'claimed', 'executing'].includes(task.status)).length,
      jobs: jobIds.size,
    };

    return {
      scope: 'device',
      device_id: deviceId,
      summary,
      tasks: visibleTasks.map((task) => taskView(task, state.devices)),
      jobs,
    };
  });

  if (result.error) return fail(result.error, result.status);
  return json(result);
}
