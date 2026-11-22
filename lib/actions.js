import crypto from 'node:crypto';
import { withState, pruneTasks, pruneJobs } from './store.js';
import { createTask, taskView } from './tasks.js';
import { finalizeJob, jobDeadlineSeconds, jobView, planJob } from './jobs.js';

function assertCapability(device, workload) {
  const capabilities = Array.isArray(device?.workloads) ? device.workloads : [];
  if (capabilities.length && !capabilities.includes(workload)) {
    throw new Error(`unsupported_workload: ${device.name || 'device'} runs ${capabilities.join(', ')}`);
  }
}

export async function issueTask({ deviceId, workload = 'hash_sum_v1', params, limits, createdBy = 'dashboard' }) {
  return withState((state) => {
    const device = deviceId ? state.devices[deviceId] : null;
    if (deviceId && !device) throw new Error('device_not_found');
    if (device) assertCapability(device, workload);
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

export async function issueJob({ workload = 'hash_sum_v1', params = {}, shards = 8, limits = {}, createdBy = 'dashboard' }) {
  return withState((state) => {
    const plan = planJob({ workload, params, shards });
    const deadlineSeconds = jobDeadlineSeconds(plan.shard_count);
    const now = Date.now();
    const job = {
      id: crypto.randomUUID(),
      workload,
      shard_count: plan.shard_count,
      total_iterations: plan.total_iterations ?? null,
      created_by: createdBy,
      created_at: new Date(now).toISOString(),
      deadline_at: new Date(now + deadlineSeconds * 1000).toISOString(),
      status: 'pending',
      task_ids: [],
      aggregate: null,
      completed_at: null,
      cancelled_at: null,
    };
    for (const shard of plan.shards) {
      const task = createTask({
        deviceId: null,
        workload,
        params: shard.params,
        resourceLimits: { ...limits, deadline_seconds: deadlineSeconds },
        createdBy,
        jobId: job.id,
        shardIndex: shard.index,
      });
      task.deadline_at = job.deadline_at;
      state.tasks[task.id] = task;
      job.task_ids.push(task.id);
    }
    state.jobs[job.id] = job;
    finalizeJob(job, state.tasks, now);
    pruneTasks(state);
    pruneJobs(state);
    return jobView(job, state.tasks, state.devices);
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
    if (task.job_id && state.jobs[task.job_id]) {
      finalizeJob(state.jobs[task.job_id], state.tasks);
    }
    return taskView(task, state.devices);
  });
}

export async function cancelJob(jobId) {
  return withState((state) => {
    const job = state.jobs[jobId];
    if (!job) throw new Error('job_not_found');
    const now = new Date().toISOString();
    job.cancelled_at = job.cancelled_at || now;
    for (const id of job.task_ids) {
      const task = state.tasks[id];
      if (!task) continue;
      if (task.status === 'pending') {
        task.status = 'cancelled';
        task.error = 'cancelled_by_operator';
        task.completed_at = now;
      } else if (['claimed', 'executing'].includes(task.status)) {
        task.cancel_requested = true;
      }
    }
    finalizeJob(job, state.tasks);
    return jobView(job, state.tasks, state.devices);
  });
}
