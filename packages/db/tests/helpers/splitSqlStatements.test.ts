import { describe, expect, it } from 'vitest';

import { splitSqlStatements } from './testDb.js';

describe('splitSqlStatements (psql -f fidelity)', () => {
  it('splits simple statements on the semicolon', () => {
    expect(splitSqlStatements('SELECT 1; SELECT 2;')).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('drops trailing whitespace/empty fragments', () => {
    expect(splitSqlStatements('SELECT 1;\n\n')).toEqual(['SELECT 1']);
    expect(splitSqlStatements('SELECT 1')).toEqual(['SELECT 1']); // no trailing ;
  });

  it('does NOT split on a semicolon inside a single-quoted string', () => {
    expect(splitSqlStatements("INSERT INTO t VALUES ('a;b'); SELECT 1;")).toEqual([
      "INSERT INTO t VALUES ('a;b')",
      'SELECT 1',
    ]);
  });

  it('handles doubled-quote escapes inside a string', () => {
    expect(splitSqlStatements("SELECT 'it''s; fine'; SELECT 2;")).toEqual([
      "SELECT 'it''s; fine'",
      'SELECT 2',
    ]);
  });

  it('does NOT split inside a line comment', () => {
    expect(splitSqlStatements('SELECT 1; -- a; b; c\nSELECT 2;')).toEqual([
      'SELECT 1',
      '-- a; b; c\nSELECT 2',
    ]);
  });

  it('does NOT split inside a block comment (nested)', () => {
    expect(splitSqlStatements('SELECT 1 /* a; /* nested; */ b; */; SELECT 2;')).toEqual([
      'SELECT 1 /* a; /* nested; */ b; */',
      'SELECT 2',
    ]);
  });

  it('keeps a dollar-quoted function body (with its own ; and BEGIN/END) as ONE statement', () => {
    const fn =
      'CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $$ BEGIN; x := 1; RETURN x; END; $$';
    expect(splitSqlStatements(`${fn}; SELECT 2;`)).toEqual([fn, 'SELECT 2']);
  });

  it('handles a tagged dollar quote $body$ … $body$', () => {
    const fn = 'CREATE FUNCTION g() RETURNS int LANGUAGE sql AS $body$ SELECT 1; $body$';
    expect(splitSqlStatements(`${fn};`)).toEqual([fn]);
  });

  it('treats a $1 placeholder as a normal char, not a dollar quote', () => {
    expect(splitSqlStatements('SELECT $1 WHERE a = $2; SELECT 3;')).toEqual([
      'SELECT $1 WHERE a = $2',
      'SELECT 3',
    ]);
  });

  it('isolates ALTER TYPE … ADD VALUE from a following BEGIN block (the 0039 case)', () => {
    // The whole point: ADD VALUE must be its OWN statement so it autocommits
    // before the BEGIN block uses the new value.
    const sql = `
      ALTER TYPE belegtext_kind ADD VALUE IF NOT EXISTS 'REVERSE_CHARGE_13B';
      BEGIN;
      INSERT INTO t (k) VALUES ('REVERSE_CHARGE_13B');
      COMMIT;
    `;
    expect(splitSqlStatements(sql)).toEqual([
      "ALTER TYPE belegtext_kind ADD VALUE IF NOT EXISTS 'REVERSE_CHARGE_13B'",
      'BEGIN',
      "INSERT INTO t (k) VALUES ('REVERSE_CHARGE_13B')",
      'COMMIT',
    ]);
  });
});
