import type { SequenceDocument } from '../types/bio';

export interface ExplorerFolder {
  id: string;
  label: string;
  parent: string;
  matchFolders: string[];
}

export interface ProjectExplorerState {
  customFolders: string[];
  folderColors: Record<string, string>;
  folderNames: Record<string, string>;
  folderParents: Record<string, string>;
  hiddenFolders: string[];
  favoriteFolders: string[];
  favoriteDocIds: string[];
  deletedDocIds: string[];
  readDocIds: string[];
}

export const PROJECT_ROOT = 'All Project Files';

/** UI state is optional in older sessions and must not trust imported JSON types. */
export function normalizeProjectExplorer(value: unknown): ProjectExplorerState {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const strings = (key: string): string[] => Array.isArray(data[key])
    ? [...new Set((data[key] as unknown[]).filter((item): item is string => typeof item === 'string'))] : [];
  const record = (key: string): Record<string, string> => {
    const item = data[key];
    return item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).filter(([key, value]) => key !== '__proto__' && typeof value === 'string')) : {};
  };
  return {
    customFolders: strings('customFolders'), folderColors: record('folderColors'),
    folderNames: record('folderNames'), folderParents: record('folderParents'),
    hiddenFolders: strings('hiddenFolders'), favoriteFolders: strings('favoriteFolders'),
    favoriteDocIds: strings('favoriteDocIds'), deletedDocIds: strings('deletedDocIds'),
    readDocIds: strings('readDocIds'),
  };
}

export function folderDescendants(id: string, folders: ExplorerFolder[]): Set<string> {
  const result = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (result.has(folder.parent) && !result.has(folder.id)) {
        result.add(folder.id);
        changed = true;
      }
    }
  }
  return result;
}

export function documentsInFolder(
  id: string, folders: ExplorerFolder[], documents: SequenceDocument[]
): SequenceDocument[] {
  const descendants = folderDescendants(id, folders);
  const aliases = new Set(folders.filter((f) => descendants.has(f.id)).flatMap((f) => f.matchFolders));
  return documents.filter((doc) => descendants.has(doc.folder) || aliases.has(doc.folder));
}

/** Select All is scoped to the visible rows in the current folder, never selecting across other folders. */
export function toggleVisibleSelection(selected: string[], visible: string[]): string[] {
  if (visible.length === 0) return [];
  const visibleSet = new Set(visible);
  const inFolderSelected = selected.filter((id) => visibleSet.has(id));
  const selectedSet = new Set(inFolderSelected);
  return visible.every((id) => selectedSet.has(id))
    ? []
    : [...visible];
}

/**
 * The Project Explorer labels from the root to the folder `folder` names (US-01M7DVS2): the folder
 * whose id it is, or else the one that gathers it (`matchFolders`), then each parent up to the root.
 * A folder the explorer does not list is named as it is, under the root; a parent loop stops at the
 * first folder seen twice.
 */
export function folderPathLabels(folder: string, folders: ExplorerFolder[]): string[] {
  if (!folder || folder === PROJECT_ROOT) return [PROJECT_ROOT];
  const byId = new Map(folders.map((f) => [f.id, f]));
  const own = byId.get(folder) ?? folders.find((f) => f.matchFolders.includes(folder));
  if (!own) return [PROJECT_ROOT, folder];
  const labels: string[] = [];
  const seen = new Set<string>();
  for (let f: ExplorerFolder | undefined = own; f && !seen.has(f.id); f = byId.get(f.parent)) {
    seen.add(f.id);
    labels.unshift(f.label);
  }
  return [PROJECT_ROOT, ...labels];
}
