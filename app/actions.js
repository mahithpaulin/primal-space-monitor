'use server';

import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { issueTask, cancelTask, issueJob, cancelJob } from '../lib/actions.js';
import { ADMIN_COOKIE, adminKey, safeEqual } from '../lib/admin.js';

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

export async function enqueueBenchmarkAction({ deviceId = null, iterations = 200000, chunks = 8 }) {
  try {
    const task = await issueTask({
      deviceId: deviceId || null,
      workload: 'hash_sum_v1',
      params: {
        seed: crypto.randomBytes(8).toString('hex'),
        iterations: Number(iterations),
        chunks: Number(chunks),
      },
      limits: { max_cpu_pct: 20, max_memory_mb: 128, deadline_seconds: 120 },
      createdBy: 'dashboard',
    });
    revalidatePath('/');
    return {
      ok: true,
      taskId: task.id,
      message: `Benchmark ${task.id.slice(0, 8)} queued for ${task.device_name || 'device'}.`,
    };
  } catch (error) {
    return { ok: false, error: error.message || 'Could not queue task.' };
  }
}

export async function enqueuePythonAction({ deviceId = null, code = '', args = null, maxSeconds = 10 }) {
  try {
    const task = await issueTask({
      deviceId: deviceId || null,
      workload: 'python_func',
      params: { code, args },
      limits: { max_cpu_pct: 20, max_memory_mb: 128, deadline_seconds: 60, max_seconds: Number(maxSeconds) },
      createdBy: 'dashboard',
    });
    revalidatePath('/');
    return {
      ok: true,
      taskId: task.id,
      message: `Python task ${task.id.slice(0, 8)} queued for ${task.device_name || 'device'}.`,
    };
  } catch (error) {
    return { ok: false, error: error.message || 'Could not queue Python task.' };
  }
}

export async function enqueueJobAction({ workload = 'hash_sum_v1', params = {}, shards = 12 }) {
  try {
    const job = await issueJob({
      workload,
      params,
      shards: Number(shards),
      limits: { max_cpu_pct: 20, max_memory_mb: 128, deadline_seconds: 300 },
      createdBy: 'dashboard',
    });
    revalidatePath('/');
    return {
      ok: true,
      jobId: job.id,
      message: `Job ${job.id.slice(0, 8)} split into ${job.shard_count} shards.`,
    };
  } catch (error) {
    return { ok: false, error: error.message || 'Could not create job.' };
  }
}

export async function cancelJobAction({ jobId }) {
  try {
    const job = await cancelJob(jobId);
    revalidatePath('/');
    return { ok: true, message: `Job ${job.id.slice(0, 8)} cancelled.` };
  } catch (error) {
    return { ok: false, error: error.message || 'Could not cancel job.' };
  }
}

export async function cancelTaskAction({ taskId }) {
  try {
    const task = await cancelTask(taskId);
    revalidatePath('/');
    return { ok: true, message: `Cancel requested for ${task.id.slice(0, 8)}.` };
  } catch (error) {
    return { ok: false, error: error.message || 'Could not cancel task.' };
  }
}
