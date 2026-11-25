import crypto from 'node:crypto';

import { cleanString } from './http.js';

export const MAX_GROUP_MEMBERS = 32;
export const GROUP_PREFIX = 'group:';

export function isGroupTarget(target) {
  return typeof target === 'string' && target.startsWith(GROUP_PREFIX);
}

export function groupIdFromTarget(target) {
  return isGroupTarget(target) ? target.slice(GROUP_PREFIX.length) : null;
}

export function createGroup({ name, members = [], owner = null, topic = 'chat' }) {
  const unique = [];
  for (const member of Array.isArray(members) ? members : []) {
    const id = cleanString(member, 64);
    if (id && !unique.includes(id)) unique.push(id);
  }
  if (owner && !unique.includes(owner)) unique.unshift(owner);
  if (unique.length === 0) throw new Error('group_members_required');
  if (unique.length > MAX_GROUP_MEMBERS) throw new Error('too_many_group_members');
  return {
    id: crypto.randomUUID(),
    name: cleanString(name, 64) || 'Group chat',
    topic: cleanString(topic, 64) || 'chat',
    members: unique,
    owner: owner || unique[0],
    created_at: new Date().toISOString(),
  };
}

export function findGroup(state, groupId) {
  if (!groupId) return null;
  return (state.groups || {})[groupId] || null;
}

export function groupView(state, group) {
  const members = (group.members || []).map((id) => {
    const device = (state.devices || {})[id];
    return {
      id,
      name: device?.profile?.name || device?.name || id.slice(0, 8),
      online: device?.status === 'online',
      agent: device?.agent?.enabled === true ? device.agent.name || null : null,
    };
  });
  return {
    id: group.id,
    name: group.name,
    topic: group.topic,
    owner: group.owner,
    members,
    member_ids: group.members || [],
    created_at: group.created_at,
  };
}

export function listGroupsForDevice(state, deviceId) {
  return Object.values(state.groups || {})
    .filter((group) => (group.members || []).includes(deviceId))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .map((group) => groupView(state, group));
}

export function groupRecipients(group, senderId) {
  return (group?.members || []).filter((id) => id !== senderId);
}
