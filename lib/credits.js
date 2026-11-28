import crypto from 'node:crypto';
import { createMessage } from './messages.js';

export const MAX_TRANSFER = 100000;
export const MAX_EVENTS = 500;

export function createTransfer({ from, to, amount, note = '', fromName = '', toName = '' }) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) throw new Error('transfer_amount_invalid');
  if (value > MAX_TRANSFER) throw new Error('transfer_amount_too_large');
  if (!to) throw new Error('transfer_target_required');
  if (from === to) throw new Error('transfer_target_is_sender');
  return {
    id: crypto.randomUUID(),
    from,
    to,
    from_name: fromName || '',
    to_name: toName || '',
    amount: Math.round(value * 1000) / 1000,
    note: typeof note === 'string' ? note.slice(0, 200) : '',
    created_at: new Date().toISOString(),
    status: 'settled',
  };
}

export function transferView(transfer) {
  return {
    id: transfer.id,
    from: transfer.from,
    to: transfer.to,
    from_name: transfer.from_name || '',
    to_name: transfer.to_name || '',
    amount: transfer.amount,
    note: transfer.note || '',
    created_at: transfer.created_at,
    status: transfer.status || 'settled',
  };
}

/**
 * Settle a transfer between two devices. The ledger is mirrored on the server and
 * delivered to both devices as credit messages so their own wallets stay in sync.
 */
export function settleTransfer(state, { from, to, amount, note = '' }) {
  const source = state.devices[from];
  const target = state.devices[to];
  if (!source) throw new Error('device_not_found');
  if (!target) throw new Error('device_not_found');
  const sourceBalance = Number(source.credits?.balance ?? source.wallet?.balance ?? 0);
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) throw new Error('transfer_amount_invalid');
  if (sourceBalance < value) throw new Error('insufficient_balance');

  const transfer = createTransfer({
    from,
    to,
    amount: value,
    note,
    fromName: source.name,
    toName: target.name,
  });

  const sourceWallet = {
    ...(source.credits || {}),
    balance: Math.round((sourceBalance - value) * 1000) / 1000,
    spent_total: Math.round((Number(source.credits?.spent_total || 0) + value) * 1000) / 1000,
  };
  source.credits = sourceWallet;

  const targetWallet = {
    ...(target.credits || {}),
    balance: Math.round((Number(target.credits?.balance || 0) + value) * 1000) / 1000,
  };
  target.credits = targetWallet;

  state.credit_events = state.credit_events || {};
  state.credit_events[transfer.id] = transfer;

  const creditMessage = createMessage({
    from: 'operator',
    to,
    topic: 'credit',
    body: `+${transfer.amount} CU received from ${source.name}${note ? ` · ${note}` : ''}`,
  });
  creditMessage.credit = { kind: 'incoming', amount: transfer.amount, from, from_name: source.name, transfer_id: transfer.id };
  state.messages[creditMessage.id] = creditMessage;

  const debitMessage = createMessage({
    from: 'operator',
    to: from,
    topic: 'credit',
    body: `-${transfer.amount} CU sent to ${target.name}${note ? ` · ${note}` : ''}`,
  });
  debitMessage.credit = { kind: 'outgoing', amount: transfer.amount, to, to_name: target.name, transfer_id: transfer.id };
  state.messages[debitMessage.id] = debitMessage;

  return transfer;
}

export function accrueDeviceCompute(
  device,
  { durationMs = 0, cpuPct = null, childCpuPct = null, earn = true, at = new Date() } = {},
) {
  if (!device) return { earned: 0, minutes: 0 };
  const lending = device.lending || {};
  if (!lending.enabled) return { earned: 0, minutes: 0 };

  const duration = Math.max(0, Number(durationMs) || 0);
  const now = at instanceof Date ? at : new Date(at);
  const windowStart = new Date(Math.floor(now.getTime() / 3600000) * 3600000).toISOString();
  const credits = device.credits || {};
  const wallet = device.wallet || {};
  const previousMinutes = credits.window_start === windowStart ? Number(credits.minutes_used || 0) : 0;
  const allowance = Math.max(0, Number(lending.minutes_per_hour) || 0);
  const creditedMinutes = Math.min(duration / 60000, Math.max(0, allowance - previousMinutes));
  const creditedDuration = creditedMinutes * 60000;
  const rate = Math.max(0, Number(lending.units_per_hour) || 0);
  const promisedCpu = Math.max(0.01, (Number(lending.cpu_pct) || 20) / 100);
  const workerCpu = cpuPct === null || cpuPct === undefined ? null : Number(cpuPct);
  const childCpu = childCpuPct === null || childCpuPct === undefined ? null : Number(childCpuPct);
  const measuredCpu = Math.max(
    Number.isFinite(workerCpu) ? workerCpu : 0,
    Number.isFinite(childCpu) ? childCpu : 0,
  );
  const cpuFactor =
    workerCpu === null && childCpu === null
      ? 0
      : Math.min(1, measuredCpu / 100 / promisedCpu);
  const earned = earn ? Math.max(0, (creditedDuration / 3600000) * rate * cpuFactor) : 0;
  const balance = Number(credits.balance ?? wallet.balance ?? 0) + earned;
  const earnedTotal = Number(credits.earned_total ?? wallet.earned_total ?? 0) + earned;
  const spentTotal = Number(credits.spent_total ?? wallet.spent_total ?? 0);
  const units = Number(credits.units ?? 0) + earned;
  const totalUnits = Number(credits.total_units ?? 0) + earned;
  const minutesUsed = Math.min(allowance, previousMinutes + creditedMinutes);
  const updatedAt = now.toISOString();

  device.credits = {
    ...credits,
    units: Math.round(units * 1000) / 1000,
    total_units: Math.round(totalUnits * 1000) / 1000,
    minutes_used: Math.round(minutesUsed * 100) / 100,
    window_start: windowStart,
    updated_at: updatedAt,
    balance: Math.round(balance * 1000) / 1000,
    earned_total: Math.round(earnedTotal * 1000) / 1000,
    spent_total: Math.round(spentTotal * 1000) / 1000,
  };
  device.wallet = {
    ...wallet,
    balance: device.credits.balance,
    earned_total: device.credits.earned_total,
    spent_total: device.credits.spent_total,
    units: device.credits.units,
    total_units: device.credits.total_units,
    updated_at: updatedAt,
  };
  device.wallet_history = Array.isArray(device.wallet_history) ? device.wallet_history.slice(-240) : [];
  device.wallet_history.push({
    at: updatedAt,
    balance: device.credits.balance,
    earned: device.credits.earned_total,
  });

  return {
    earned: Math.round(earned * 1000) / 1000,
    minutes: Math.round(creditedMinutes * 100) / 100,
  };
}

export function listTransfers(state, limit = 50) {
  return Object.values(state.credit_events || {})
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, Math.min(MAX_EVENTS, Math.max(1, limit)))
    .map(transferView);
}

export function currencySummary(state, devices) {
  const views = Object.values(devices || state.devices || {});
  let balance = 0;
  let earned = 0;
  let spent = 0;
  for (const device of views) {
    balance += Number(device.credits?.balance ?? device.wallet?.balance ?? 0);
    earned += Number(device.credits?.earned_total ?? device.wallet?.earned_total ?? 0);
    spent += Number(device.credits?.spent_total ?? device.wallet?.spent_total ?? 0);
  }
  const transfers = listTransfers(state, MAX_EVENTS);
  const transferred = transfers.reduce((total, transfer) => total + Number(transfer.amount || 0), 0);
  return {
    total_balance: Math.round(balance * 1000) / 1000,
    total_earned: Math.round(earned * 1000) / 1000,
    total_spent: Math.round(spent * 1000) / 1000,
    total_transferred: Math.round(transferred * 1000) / 1000,
    transfer_count: transfers.length,
    wallets: views.map((device) => ({
      id: device.id,
      name: device.name,
      balance: Math.round(Number(device.credits?.balance ?? device.wallet?.balance ?? 0) * 1000) / 1000,
      earned_total: Math.round(Number(device.credits?.earned_total ?? device.wallet?.earned_total ?? 0) * 1000) / 1000,
      spent_total: Math.round(Number(device.credits?.spent_total ?? device.wallet?.spent_total ?? 0) * 1000) / 1000,
    })),
  };
}
