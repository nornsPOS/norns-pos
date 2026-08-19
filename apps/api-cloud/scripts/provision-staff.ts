/**
 * provision-staff.ts — the admin-mediated way to create or update a staff
 * member and (optionally) the single Owner.
 *
 * This is the ONLY supported path to write `users.role` / `users.is_owner`.
 * The runtime app role is DELIBERATELY forbidden to touch those columns
 * (migrations 0004 §9 + 0014) so that a compromised API can never mint or
 * elevate a staff account. Provisioning therefore runs OUT OF BAND, with a
 * privileged connection (the `warehouse14_migrator` role or the postgres
 * superuser), exactly like a migration.
 *
 * USAGE (privileged URL required):
 *   PROVISION_DATABASE_URL=postgres://…migrator… \
 *     pnpm --filter @norns/api-cloud exec tsx scripts/provision-staff.ts \
 *       --email admin@warehouse14.de --name "Basel" --owner --clear-pin
 *
 * FLAGS
 *   --email <addr>     required. The verified Google email that will sign in.
 *   --name <str>       display name (default: the email local-part).
 *   --role <r>         ADMIN | CASHIER | READONLY (default ADMIN).
 *   --owner            set is_owner = TRUE (forces role ADMIN).
 *   --transfer-owner   if a DIFFERENT user is currently Owner, demote them to
 *                      ADMIN first. Ownership never moves silently — you ask.
 *   --clear-pin        null the POS PIN so a legacy PIN can no longer log in.
 *                      Use when migrating a PIN account to Google-only.
 *   --dry-run          print the intended change, write nothing.
 *
 * Idempotent: safe to re-run. Upserts by email. Refuses a second Owner unless
 * --transfer-owner is given. The privileged URL is read from PROVISION_DATABASE_URL,
 * else MIGRATOR_DATABASE_URL, else SUPERUSER_DATABASE_URL.
 */

import process from 'node:process';
import postgres from 'postgres';

type Role = 'ADMIN' | 'CASHIER' | 'READONLY';
const ROLES: readonly Role[] = ['ADMIN', 'CASHIER', 'READONLY'];

interface Args {
  email: string;
  name: string | null;
  role: Role;
  owner: boolean;
  transferOwner: boolean;
  clearPin: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? (argv[i + 1] ?? null) : null;
  };
  const has = (flag: string): boolean => argv.includes(flag);

  const email = (get('--email') ?? '').trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error('--email <addr> is required and must be a valid address');
  }
  const owner = has('--owner');
  const roleRaw = (get('--role') ?? (owner ? 'ADMIN' : 'ADMIN')).toUpperCase();
  if (!ROLES.includes(roleRaw as Role)) {
    throw new Error(`--role must be one of ${ROLES.join(' | ')}`);
  }
  const role: Role = owner ? 'ADMIN' : (roleRaw as Role); // Owner implies ADMIN.
  return {
    email,
    name: get('--name'),
    role,
    owner,
    transferOwner: has('--transfer-owner'),
    clearPin: has('--clear-pin'),
    dryRun: has('--dry-run'),
  };
}

function privilegedUrl(): string {
  const url =
    process.env.PROVISION_DATABASE_URL ??
    process.env.MIGRATOR_DATABASE_URL ??
    process.env.SUPERUSER_DATABASE_URL ??
    '';
  if (!url) {
    throw new Error(
      'No privileged DB URL. Set PROVISION_DATABASE_URL (or MIGRATOR_DATABASE_URL / ' +
        'SUPERUSER_DATABASE_URL) to a connection that may write users.role/is_owner.',
    );
  }
  return url;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const name = args.name ?? (args.email.split('@')[0] ?? args.email);
  const sql = postgres(privilegedUrl(), { max: 1, prepare: false, onnotice: () => {} });

  try {
    await sql.begin(async (tx) => {
      const existing = await tx<
        { id: string; role: Role; is_owner: boolean; has_pin: boolean }[]
      >`
        SELECT id, role, is_owner, (pos_pin_hash IS NOT NULL) AS has_pin
          FROM users
         WHERE email = ${args.email} AND soft_deleted_at IS NULL
         LIMIT 1`;

      // Ownership transfer guard — never silent.
      if (args.owner) {
        const current = await tx<{ id: string; email: string }[]>`
          SELECT id, email FROM users
           WHERE is_owner = TRUE AND soft_deleted_at IS NULL
           LIMIT 1`;
        const held = current[0];
        if (held && held.email.toLowerCase() !== args.email) {
          if (!args.transferOwner) {
            throw new Error(
              `Owner is already "${held.email}". Pass --transfer-owner to demote them ` +
                `to ADMIN and make "${args.email}" the Owner.`,
            );
          }
          console.log(`  ↪ transferring ownership away from ${held.email} (kept as ADMIN)`);
          if (!args.dryRun) {
            await tx`UPDATE users SET is_owner = FALSE, updated_at = now() WHERE id = ${held.id}`;
          }
        }
      }

      const pinClear = args.clearPin
        ? tx`, pos_pin_hash = NULL, pos_pin_set_at = NULL, pos_pin_failed_attempts = 0, pos_pin_locked_until = NULL`
        : tx``;

      if (existing[0]) {
        const row = existing[0];
        console.log(
          `  updating ${args.email}: role ${row.role}->${args.role}, ` +
            `owner ${row.is_owner}->${args.owner ? true : row.is_owner}` +
            (args.clearPin && row.has_pin ? ', clearing POS PIN' : ''),
        );
        if (!args.dryRun) {
          await tx`
            UPDATE users
               SET role = ${args.role}::user_role,
                   is_owner = ${args.owner ? true : row.is_owner},
                   name = ${name},
                   email_verified = TRUE,
                   updated_at = now()
                   ${pinClear}
             WHERE id = ${row.id}`;
        }
      } else {
        console.log(
          `  creating ${args.email}: role ${args.role}, owner ${args.owner} (no PIN — Google-only)`,
        );
        if (!args.dryRun) {
          await tx`
            INSERT INTO users (email, email_verified, name, role, is_owner)
            VALUES (${args.email}, TRUE, ${name}, ${args.role}::user_role, ${args.owner})`;
        }
      }

      if (args.dryRun) throw new DryRunAbort();
    });
    console.log('✅ done');
  } catch (err) {
    if (err instanceof DryRunAbort) {
      console.log('— dry run: rolled back, nothing written —');
    } else {
      console.error('✗ provisioning failed:', err instanceof Error ? err.message : err);
      process.exitCode = 1;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Sentinel to roll back the transaction on --dry-run. */
class DryRunAbort extends Error {}

void main();
