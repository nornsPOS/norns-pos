import { describe, expect, it } from 'vitest';

describe('probe', () => {
  it('kann die Flaeche laden', async () => {
    const mod = await import('./GeraeteManager.js');
    expect(typeof mod.GeraeteManager).toBe('function');
  });
});
