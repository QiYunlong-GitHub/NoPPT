import { existsSync, lstatSync, realpathSync } from 'fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'path';

/**
 * Resolve user-controlled path segments below a trusted directory.
 * Segments are deliberately treated as names, not mini path expressions.
 */
export function resolveContainedPath(rootPath: string, ...segments: string[]): string {
  for (const segment of segments) {
    if (typeof segment !== 'string' || segment.includes('\0') || isAbsolute(segment)) {
      throw new Error('Invalid storage path');
    }
    if (segment.split(/[\\/]/).some((part) => part === '..')) {
      throw new Error('Invalid storage path');
    }
  }

  const candidate = resolve(rootPath, ...segments);
  assertContainedPath(rootPath, candidate);
  return candidate;
}

/**
 * Validate an already-built path. Absolute paths are accepted here because
 * existing StorageService callers pass absolute paths; containment still
 * rejects traversal and symlink escapes.
 */
export function assertContainedPath(rootPath: string, candidatePath: string): string {
  if (
    typeof rootPath !== 'string' ||
    typeof candidatePath !== 'string' ||
    rootPath.includes('\0') ||
    candidatePath.includes('\0')
  ) {
    throw new Error('Invalid storage path');
  }
  if (candidatePath.split(/[\\/]/).some((part) => part === '..')) {
    throw new Error('Invalid storage path');
  }

  const root = resolve(rootPath);
  const candidate = resolve(candidatePath);
  if (!isPathWithin(root, candidate)) {
    throw new Error('Invalid storage path');
  }

  const realRoot = realPathOrExistingAncestor(root);
  const realCandidate = realPathOrExistingAncestor(candidate);
  if (realRoot && realCandidate && !isPathWithin(realRoot, realCandidate)) {
    throw new Error('Invalid storage path');
  }

  return candidate;
}

/** Reject symlink entries when callers enumerate untrusted directory contents. */
export function isSafeRegularFile(filePath: string): boolean {
  try {
    return lstatSync(filePath).isFile() && !lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
}

function isPathWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function realPathOrExistingAncestor(path: string): string | null {
  let current = path;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  try {
    return realpathSync(current);
  } catch {
    return null;
  }
}
