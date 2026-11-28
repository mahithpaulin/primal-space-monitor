'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { issueTask, cancelTask, issueJob, cancelJob, sendOperatorMessage, requestLending, transferCredits } from '../lib/actions.js';
import { ADMIN_COOKIE, adminKey, safeEqual } from '../lib/admin.js';

async function adminSessionRequired() {
  const expected = adminKey();
  if (!expected) return null;
  const store = await cookies();
  const provided = store.get(ADMIN_COOKIE)?.value ?? null;
  if (provided && safeEqual(provided, expected)) return null;
  return { ok: false, error: 'admin_required' };
}

export async function adminLoginAction(key) {
  const expected = adminKey();
  if (!expected) return { ok: true };
  if (!key || !safeEqual(String(key), expected)) {
    return { ok: false, error: 'Invalid operator key.' };
  }
  const store = await cookies();
  store.set(ADMIN_COOKIE, expected, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: 60 * 60 * 12,
  });
  return { ok: true };
}

export async function adminLogoutAction() {
  const store = await cookies();
  store.delete(ADMIN_COOKIE);
  return { ok: true };
}

export async function enqueueTaskAction({ workload = 'python', params = {}, deviceId = null }) {
  const denied = await adminSessionRequired();
  if (denied) return denied;
  try {
    const task = await issueTask({
      deviceId: deviceId || null,
      workload,
      params,
      limits: { max_cpu_pct: 20, max_memory_mb: 128, deadline_seconds: 120 },
      createdBy: 'dashboard',
    });
    revalidatePath('/');
    return {
      ok: true,
      taskId: task.id,
      message: `${workload} task ${task.id.slice(0, 8)} queued for ${task.device_name || 'any compatible device'}.`,
    };
  } catch (error) {
    return { ok: false, error: error.message || 'Could not queue task.' };
  }
}

export async function enqueueJobAction({ workload = 'python', params = {}, shards = 4, reduce = 'concat' }) {
  const denied = await adminSessionRequired();
  if (denied) return denied;
  try {
    const job = await issueJob({
      workload,
      params,
      shards: Number(shards),
      reduce,
      limits: { max_cpu_pct: 20, max_memory_mb: 128, deadline_seconds: 300 },
      createdBy: 'dashboard',
    });
    revalidatePath('/');
    return {
      ok: true,
      jobId: job.id,
      message: `Job ${job.id.slice(0, 8)} split into ${job.shard_count} shards (${job.reduce}).`,
    };
  } catch (error) {
    return { ok: false, error: error.message || 'Could not create job.' };
  }
}

export async function cancelJobAction({ jobId }) {
  const denied = await adminSessionRequired();
  if (denied) return denied;
  try {
    const job = await cancelJob(jobId);
    revalidatePath('/');
    return { ok: true, message: `Job ${job.id.slice(0, 8)} cancelled.` };
  } catch (error) {
    return { ok: false, error: error.message || 'Could not cancel job.' };
  }
}

export async function cancelTaskAction({ taskId }) {
  const denied = await adminSessionRequired();
  if (denied) return denied;
  try {
    const task = await cancelTask(taskId);
    revalidatePath('/');
    return { ok: true, message: `Cancel requested for ${task.id.slice(0, 8)}.` };
  } catch (error) {
    return { ok: false, error: error.message || 'Could not cancel task.' };
  }
}

export async function sendMessageAction({ to = null, body = '', topic = 'chat' }) {
  const denied = await adminSessionRequired();
  if (denied) return denied;
  try {
    const message = await sendOperatorMessage({ to: to || null, body, topic });
    revalidatePath('/');
    return { ok: true, message: `Message sent to ${message.to ? 'device' : 'all devices'}.` };
  } catch (error) {
    return { ok: false, error: error.message || 'Could not send message.' };
  }
}

export async function setLendingAction({ deviceId, enabled, cpuPct = null, minutesPerHour = null, unitsPerHour = null }) {
  const denied = await adminSessionRequired();
  if (denied) return denied;
  try {
    const request = await requestLending({ deviceId, enabled, cpuPct, minutesPerHour, unitsPerHour });
    revalidatePath('/');
    return {
      ok: true,
      message: enabled
        ? `Active compute requested (${request.cpu_pct}% CPU, ${request.minutes_per_hour} min/hour).`
        : 'Active compute disabled on next heartbeat.',
    };
  } catch (error) {
    return { ok: false, error: error.message || 'Could not update lending.' };
  }
}

export async function transferCreditsAction({ from, to, amount, note = '' }) {
  const denied = await adminSessionRequired();
  if (denied) return denied;
  try {
    const transfer = await transferCredits({ from, to, amount, note });
    revalidatePath('/');
    return { ok: true, message: `Sent ${transfer.amount} CU to ${transfer.to_name || to}.` };
  } catch (error) {
    return { ok: false, error: error.message || 'Could not send credits.' };
  }
}
