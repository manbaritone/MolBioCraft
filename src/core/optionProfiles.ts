// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Per-operation option memory and named option profiles.
 *
 * Every operation dialog remembers the options it was last run with and can save,
 * load, rename, delete, export and import named profiles. A profile belongs to one
 * operation (an alignment profile never loads into the tree builder). Values are
 * merged over the operation's defaults on load, so profiles saved by an older build
 * keep working when options are added.
 */

export type OptionValues = Record<string, string | number | boolean>;

export interface OptionProfile {
  name: string;
  operation: string;
  values: OptionValues;
  savedAt: string;
}

interface Store {
  lastUsed: Record<string, OptionValues>;
  profiles: OptionProfile[];
}

const STORAGE_KEY = 'molbiocraft.optionProfiles.v1';
const FILE_FORMAT = 'molbiocraft-option-profiles';

function read(): Store {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Store>;
      return {
        lastUsed: parsed.lastUsed && typeof parsed.lastUsed === 'object' ? parsed.lastUsed : {},
        profiles: Array.isArray(parsed.profiles) ? parsed.profiles.filter(isProfile) : [],
      };
    }
  } catch {
    // Storage blocked or corrupt: start empty.
  }
  return { lastUsed: {}, profiles: [] };
}

function write(store: Store): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Storage unavailable (private mode): options still work for this session.
  }
}

function isProfile(p: unknown): p is OptionProfile {
  const o = p as OptionProfile;
  return !!o && typeof o.name === 'string' && typeof o.operation === 'string' &&
    !!o.values && typeof o.values === 'object';
}

/** Keeps only keys the operation defines, with the same primitive type as the default. */
export function sanitizeValues(defaults: OptionValues, values: Partial<OptionValues> | undefined): OptionValues {
  const out: OptionValues = { ...defaults };
  if (!values) return out;
  for (const [k, def] of Object.entries(defaults)) {
    const v = values[k];
    if (v !== undefined && typeof v === typeof def) out[k] = v;
  }
  return out;
}

export function loadLastUsed(operation: string, defaults: OptionValues): OptionValues {
  return sanitizeValues(defaults, read().lastUsed[operation]);
}

export function saveLastUsed(operation: string, values: OptionValues): void {
  const store = read();
  store.lastUsed[operation] = values;
  write(store);
}

export function listProfiles(operation: string): OptionProfile[] {
  return read().profiles
    .filter((p) => p.operation === operation)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Saves (or overwrites a same-named) profile for `operation`. */
export function saveProfile(operation: string, name: string, values: OptionValues): OptionProfile {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('A profile needs a name.');
  const store = read();
  const profile: OptionProfile = { name: trimmed, operation, values, savedAt: new Date().toISOString() };
  store.profiles = [...store.profiles.filter((p) => !(p.operation === operation && p.name === trimmed)), profile];
  write(store);
  return profile;
}

export function deleteProfile(operation: string, name: string): void {
  const store = read();
  store.profiles = store.profiles.filter((p) => !(p.operation === operation && p.name === name));
  write(store);
}

export function renameProfile(operation: string, from: string, to: string): void {
  const target = to.trim();
  if (!target) throw new Error('A profile needs a name.');
  const store = read();
  if (store.profiles.some((p) => p.operation === operation && p.name === target && target !== from)) {
    throw new Error(`A profile called "${target}" already exists.`);
  }
  store.profiles = store.profiles.map((p) =>
    p.operation === operation && p.name === from ? { ...p, name: target } : p);
  write(store);
}

export function exportProfilesFile(profiles: OptionProfile[]): string {
  return JSON.stringify({ format: FILE_FORMAT, version: 1, profiles }, null, 2);
}

/**
 * Imports profiles from an exported file. Profiles for other operations are kept too
 * (they appear when that dialog is opened). Returns how many were imported.
 */
export function importProfilesFile(text: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('This is not a MolBioCraft option-profile file (invalid JSON).');
  }
  const file = parsed as { format?: string; profiles?: unknown[] };
  if (file?.format !== FILE_FORMAT || !Array.isArray(file.profiles)) {
    throw new Error('This is not a MolBioCraft option-profile file.');
  }
  const incoming = file.profiles.filter(isProfile);
  const store = read();
  for (const p of incoming) {
    store.profiles = [...store.profiles.filter((q) => !(q.operation === p.operation && q.name === p.name)), {
      name: p.name.trim() || 'Imported profile',
      operation: p.operation,
      values: p.values,
      savedAt: typeof p.savedAt === 'string' ? p.savedAt : new Date().toISOString(),
    }];
  }
  write(store);
  return incoming.length;
}
