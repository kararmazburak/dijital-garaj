// Oturum, yetkiler ve sözlük verileri.
import { api } from './api.js';

export const state = {
  me: null,
  perms: {},
  lookups: null,
};

export const bus = new EventTarget();
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));
export const on = (name, fn) => {
  bus.addEventListener(name, fn);
  return () => bus.removeEventListener(name, fn);
};

export function setSession({ user, perms }) {
  state.me = user;
  state.perms = perms || {};
}

export function can(mod, action) {
  if (!state.me) return false;
  if (state.me.role === 'admin') return true;
  const a = state.perms[mod] || [];
  return a.includes(action) || (action === 'read_own' && a.includes('read'));
}

/** 'all' | 'own' | false */
export function scope(mod) {
  if (can(mod, 'read')) return 'all';
  if (can(mod, 'read_own')) return 'own';
  return false;
}

export async function loadLookups() {
  const l = await api.get('/lookups');
  state.lookups = l;
  state.me = l.me;
  state.perms = l.perms;
  emit('lookups', l);
  return l;
}

export const L = () => state.lookups;
export const C = () => state.lookups?.constants || {};

export const vehicleLabel = (v) => (v ? `${v.plate}${v.brand || v.model ? ' — ' + [v.brand, v.model].filter(Boolean).join(' ') : ''}` : '—');
export const vehicleById = (id) => state.lookups?.vehicles.find((v) => v.id === Number(id));
export const driverById = (id) => state.lookups?.drivers.find((d) => d.id === Number(id));
