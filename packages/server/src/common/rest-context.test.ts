import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { McpAuth } from '../modules/auth/api-key.guard';
import { assertDefaultRestConfig, createRestStorage, resolveRestIdentity } from './rest-context';

function auth(tenantId: string, userKey: string): McpAuth {
  return { keyId: `${tenantId}-${userKey}`, tenantId, userKey, record: {} as McpAuth['record'] };
}

describe('normal REST tenant scope', () => {
  let root: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'noppt-rest-scope-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(root);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    rmSync(root, { recursive: true, force: true });
  });

  it('uses authenticated tenant/user identity and ignores MCP header concepts', () => {
    expect(resolveRestIdentity(auth('tenant-a', 'alice'))).toEqual({
      tenantId: 'tenant-a',
      userKey: 'alice',
    });
    const storage = createRestStorage(auth('tenant-a', 'alice'));
    expect(storage.getScope()).toEqual(['tenants', 'tenant-a', 'users', 'alice']);
    expect(storage.getPublicBase()).toBe('/data/tenants/tenant-a/users/alice/workspace');
  });

  it('keeps same presentation identifiers isolated across tenant and user scopes', async () => {
    const tenantA = createRestStorage(auth('tenant-a', 'alice'));
    const tenantB = createRestStorage(auth('tenant-b', 'alice'));
    const userB = createRestStorage(auth('tenant-a', 'bob'));
    const fileName = 'presentation.json';
    tenantA.ensurePresentationDir('same-id');
    await tenantA.writeJsonFile(join(tenantA.getPresentationDir('same-id'), fileName), {
      id: 'same-id',
      owner: 'tenant-a/alice',
    });

    expect(
      tenantB.readJsonFile(join(tenantB.getPresentationDir('same-id'), fileName), null),
    ).toBeNull();
    expect(
      userB.readJsonFile(join(userB.getPresentationDir('same-id'), fileName), null),
    ).toBeNull();
    expect(existsSync(tenantA.getPresentationDir('same-id'))).toBe(true);
  });

  it('allows global config only for the default owner', () => {
    expect(() => assertDefaultRestConfig(auth('default', 'default'))).not.toThrow();
    expect(() => assertDefaultRestConfig(auth('tenant-a', 'alice'))).toThrow(
      'Global configuration is restricted to the default owner',
    );
  });

  it('rejects malformed stored identities before creating directories', () => {
    expect(() => resolveRestIdentity(auth('../tenant', 'alice'))).toThrow();
    expect(() => resolveRestIdentity(auth('tenant-a', 'alice/bob'))).toThrow();
  });
});
