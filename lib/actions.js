import crypto from 'node:crypto';
import { withState, pruneTasks, pruneJobs, pruneMessages } from './store.js';
import { createTask, normalizeWorkloadParams, taskView } from './tasks.js';
import { finalizeJob, jobDeadlineSeconds, jobView, normalizeReduce, planJob } from './jobs.js';
import { isWorkload } from './workloads.js';
import { createMessage, messageView } from './messages.js';
import { sanitizeLending } from './device.js';

function assertCapability(device, workload) {
  const capabilities = Array.isArray(device?.workloads) ? device.workloads : [];
  if (capabilities.length && !capabilities.includes(workload)) {
    throw new Error(`unsupported_workload: ${device.name || 'device'} runs ${capabilities.join(', ')}`);
  }
}

export async function issueTask({ deviceId, workload = 'python', params, limits, createdBy = 'dashboard' }) {
  if (!isWorkload(workload)) throw new Error('unsupported_workload');
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

export async function issueJob({
  workload = 'python',
  params = {},
  shards = 1,
  reduce = 'concat',
  limits = {},
  createdBy = 'dashboard',
}) {
  if (!isWorkload(workload)) throw new Error('unsupported_workload');
  return withState((state) => {
    const plan = planJob({ workload, params, shards, reduce });
    const baseParams = normalizeWorkloadParams(workload, params);
    const deadlineSeconds = jobDeadlineSeconds(plan.shard_count);
    const now = Date.now();
    const job = {
      id: crypto.randomUUID(),
      workload,
      reduce: normalizeReduce(reduce),
      shard_count: plan.shard_count,
      item_count: plan.item_count ?? null,
      params: baseParams,
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

export async function purgeWorkloads(workloads) {
  const wanted = new Set((Array.isArray(workloads) ? workloads : []).map(String));
  if (!wanted.size) throw new Error('workloads_required');
  return withState((state) => {
    let tasks = 0;
    let jobs = 0;
    const removedJobs = new Set();
    for (const [id, task] of Object.entries(state.tasks)) {
      if (!wanted.has(task.workload)) continue;
      if (task.job_id) removedJobs.add(task.job_id);
      delete state.tasks[id];
      tasks += 1;
    }
    for (const [id, job] of Object.entries(state.jobs || {})) {
      if (!wanted.has(job.workload) && !removedJobs.has(id)) continue;
      delete state.jobs[id];
      jobs += 1;
    }
    return { tasks, jobs };
  });
}

export async function sendOperatorMessage({ to = null, body, topic = 'chat' }) {
  return withState((state) => {
    if (to && !state.devices[to]) throw new Error('device_not_found');
    const message = createMessage({ from: 'operator', to: to || null, topic, body });
    state.messages[message.id] = message;
    pruneMessages(state);
    return messageView(message);
  });
}

export async function requestLending({ deviceId, enabled, cpuPct = null, minutesPerHour = null, unitsPerHour = null }) {
  return withState((state) => {
    const device = state.devices[deviceId];
    if (!device) throw new Error('device_not_found');
    const current = sanitizeLending(device.lending || {});
    const request = {
      enabled: enabled === true,
      cpu_pct: cpuPct === null ? current.cpu_pct : Math.round(Math.min(100, Math.max(1, Number(cpuPct) || current.cpu_pct))),
      minutes_per_hour:
        minutesPerHour === null
          ? current.minutes_per_hour
          : Math.round(Math.min(60, Math.max(1, Number(minutesPerHour) || current.minutes_per_hour))),
      units_per_hour:
        unitsPerHour === null
          ? current.units_per_hour
          : Math.round(Math.min(100, Math.max(0.01, Number(unitsPerHour) || current.units_per_hour)) * 1000) / 1000,
      requested_at: new Date().toISOString(),
    };
    device.lending_request = request;
    return request;
  });
}
