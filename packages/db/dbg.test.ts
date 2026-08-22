import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const MIGRATIONS = new URL('../../packages/db/migrations/', import.meta.url);
describe('dbg', () => {
  it('zeigt', () => {
    const sql = readdirSync(MIGRATIONS).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort()
      .map((f) => readFileSync(new URL(f, MIGRATIONS), 'utf8').replace(/--[^\n]*/g, '')).join('\n');
    const marker = /CREATE OR REPLACE FUNCTION[^;]*?erase_customer/gi;
    let last = -1;
    for (const m of sql.matchAll(marker)) last = m.index ?? last;
    const rest = sql.slice(last);
    const end = rest.indexOf('$function$;');
    const body = end === -1 ? rest : rest.slice(0, end);
    console.log('LEN', body.length, 'HAS', /UPDATE\s+transactions/i.test(body));
    expect(1).toBe(1);
  });
});
