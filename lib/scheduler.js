import { finalizeJob } from './jobs.js';
import { withState, withStateRead } from './store.js';

const MAX_ATTEMPTS = 3;
const MIN_LEASE_MS = 60000;

export function sweepState(state, now = Date.now()) {
  let dirty = false;
  if (!state.jobs || typeof state.jobs !== 'object') {
    state.jobs = {};
    dirty = true;
  }

  for (const task of Object.values(state.tasks)) {
    if (task.status === 'pending' && Date.parse(task.deadline_at) < now) {
      task.status = 'failed';
      task.error = 'deadline_exceeded';
      task.completed_at = new Date(now).toISOString();
      dirty = true;
      continue;
    }
    if (task.status === 'claimed' || task.status === 'executing') {
      if (Date.parse(task.deadline_at) < now) {
        task.status = 'failed';
        task.error = 'deadline_exceeded';
        task.completed_at = new Date(now).toISOString();
        dirty = true;
        continue;
      }
      const maxSeconds = Number(task.resource_limits?.max_seconds) || 10;
      const leaseMs = Math.max(MIN_LEASE_MS, maxSeconds * 3000 + 30000);
      const claimedAt = Date.parse(task.claimed_at || task.created_at);
      if (!Number.isFinite(claimedAt) || now - claimedAt <= leaseMs) continue;
      const attempts = (task.attempts ?? 0) + 1;
      task.attempts = attempts;
      if (attempts >= MAX_ATTEMPTS) {
        task.status = 'failed';
        task.error = 'lease_expired';
        task.completed_at = new Date(now).toISOString();
      } else {
        task.status = 'pending';
        task.claimed_at = null;
        task.claimed_by = null;
        task.device_id = task.target_device_id || null;
        task.preferred_device_id = null;
        task.assigned_at = null;
      }
      dirty = true;
    }
  }

  for (const job of Object.values(state.jobs)) {
    if (finalizeJob(job, state.tasks, now)) dirty = true;
  }
  return dirty;
}

export async function sweepStore() {
  const state = await withStateRead((current) => current);
  if (!sweepState(state)) return;
  await withState((current) => {
    sweepState(current);
    return null;
  });
}
