import type { TreeNode } from "./model";

export interface TreeRow {
  node: TreeNode;
  depth: number;
}

export interface SearchResult {
  node: TreeNode;
  // Labels of the ancestors, root first.
  path: string[];
}

export function visibleRows(roots: TreeNode[], expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const visit = (nodes: TreeNode[], depth: number) => {
    for (const node of nodes) {
      rows.push({ node, depth });
      if (node.children.length && expanded.has(node.id)) visit(node.children, depth + 1);
    }
  };
  visit(roots, 0);
  return rows;
}

// Drops entity nodes that fail `keep` and every folder left empty. Counts are
// recomputed so folders show what the filter left.
export function filterTree(roots: TreeNode[], keep: (entityId: string) => boolean): TreeNode[] {
  const prune = (nodes: TreeNode[]): TreeNode[] => {
    const out: TreeNode[] = [];
    for (const node of nodes) {
      if (node.entityId) {
        if (keep(node.entityId)) out.push(node);
        continue;
      }
      const children = prune(node.children);
      if (children.length) {
        out.push({
          ...node,
          children,
          entityCount: children.reduce((sum, c) => sum + c.entityCount, 0),
        });
      }
    }
    return out;
  };
  return prune(roots);
}

export function searchTree(roots: TreeNode[], query: string): SearchResult[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const results: SearchResult[] = [];
  const visit = (nodes: TreeNode[], path: string[]) => {
    for (const node of nodes) {
      if (node.entityId) {
        const haystack = `${node.label} ${node.entityId}`.toLowerCase();
        if (haystack.includes(needle)) results.push({ node, path });
        continue;
      }
      visit(node.children, [...path, node.label]);
    }
  };
  visit(roots, []);
  return results;
}

// Returns the first node for the entity and its ancestors, root first.
export function findEntity(
  roots: TreeNode[],
  entityId: string,
): { node: TreeNode; ancestors: TreeNode[] } | undefined {
  const visit = (
    nodes: TreeNode[],
    ancestors: TreeNode[],
  ): { node: TreeNode; ancestors: TreeNode[] } | undefined => {
    for (const node of nodes) {
      if (node.entityId === entityId) return { node, ancestors };
      if (node.children.length) {
        const hit = visit(node.children, [...ancestors, node]);
        if (hit) return hit;
      }
    }
    return undefined;
  };
  return visit(roots, []);
}

export function findNode(
  roots: TreeNode[],
  id: string,
): { node: TreeNode; ancestors: TreeNode[] } | undefined {
  const visit = (
    nodes: TreeNode[],
    ancestors: TreeNode[],
  ): { node: TreeNode; ancestors: TreeNode[] } | undefined => {
    for (const node of nodes) {
      if (node.id === id) return { node, ancestors };
      // Ids are paths, so only the matching branch can hold the node.
      if (node.children.length && id.startsWith(`${node.id}/`)) {
        return visit(node.children, [...ancestors, node]);
      }
    }
    return undefined;
  };
  return visit(roots, []);
}

export function distinctEntityCount(roots: TreeNode[]): number {
  const seen = new Set<string>();
  const visit = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (node.entityId) seen.add(node.entityId);
      else visit(node.children);
    }
  };
  visit(roots);
  return seen.size;
}
