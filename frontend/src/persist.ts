import type { ViewId } from "./tree/model";

// Per-browser conveniences. Storage can be blocked or cleared, so every read
// falls back and every write is best effort.

const TREE_WIDTH_KEY = "entity-explorer.tree-width";
const expandedKey = (view: ViewId) => `entity-explorer.expanded.${view}`;
// Keeps the stored list bounded when folders are opened and never closed.
const EXPANDED_LIMIT = 5000;

export function loadTreeWidth(): number | undefined {
  try {
    const value = Number(localStorage.getItem(TREE_WIDTH_KEY));
    return value > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

export function saveTreeWidth(width: number) {
  try {
    localStorage.setItem(TREE_WIDTH_KEY, String(width));
  } catch {
    // Ignored: the width then lasts until the page reloads.
  }
}

export function loadExpanded(view: ViewId): Set<string> | undefined {
  try {
    const raw = localStorage.getItem(expandedKey(view));
    const ids: unknown = raw ? JSON.parse(raw) : undefined;
    return Array.isArray(ids) ? new Set(ids.filter((id) => typeof id === "string")) : undefined;
  } catch {
    return undefined;
  }
}

export function saveExpanded(view: ViewId, ids: ReadonlySet<string>) {
  try {
    localStorage.setItem(expandedKey(view), JSON.stringify([...ids].slice(-EXPANDED_LIMIT)));
  } catch {
    // Ignored: the folders then reset on the next page load.
  }
}
