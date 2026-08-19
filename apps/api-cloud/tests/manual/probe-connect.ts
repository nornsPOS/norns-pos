/**
 * Fährt UNSEREN Connect-Anschluss gegen das echte Stripe im Testmodus.
 * Kein Cent echtes Geld: der Schlüssel der CLI ist ein Testschlüssel.
 */
import { readFileSync } from 'node:fs';
import {
  assertReadyToCharge, computeApplicationFeeCents, createOnboardingLink,
  createStandardAccount, directChargeFields, retrieveAccount,
  type StripeConnectConfig,
} from '../../src/lib/stripe-connect.js';

const toml = readFileSync(`${process.env.HOME}/.config/stripe/config.toml`, 'utf8');
const key = /test_mode_api_key\s*=\s*['"]([^'"]+)['"]/.exec(toml)?.[1] ?? '';
if (!key.startsWith('rk_test') && !key.startsWith('sk_test')) {
  console.error('KEIN Testschlüssel gefunden. Abbruch, damit nichts Echtes passiert.');
  process.exit(1);
}
const cfg: StripeConnectConfig = { secretKey: key, apiVersion: '2024-12-18.acacia', defaultFeeBps: 100 };

const ok = (s: string) => console.log('  ✓ ' + s);
const no = (s: string) => console.log('  ✗ ' + s);

async function main() {
  
  console.log('\n1. Standard-Konto anlegen (unser createStandardAccount)');
  const created = await createStandardAccount(cfg, {
    email: 'testhaendler@example.de', businessName: 'Testgoldhandel Schorndorf',
  });
  if (!created.ok) { no(`fehlgeschlagen: ${created.reason} ${created.detail}`); process.exit(1); }
  ok(`angelegt: ${created.value.stripeAccountId}`);
  ok(`Land ${created.value.country}, Währung ${created.value.defaultCurrency}`);
  console.log(`    charges_enabled=${created.value.chargesEnabled} details_submitted=${created.value.detailsSubmitted}`);
  
  console.log('\n2. Der Torwächter muss ein frisches Konto SPERREN');
  const gate = assertReadyToCharge(created.value);
  gate.ready ? no('FEHLER: frisches Konto wurde freigegeben!') : ok(`gesperrt, Begründung: "${gate.reason}"`);
  
  console.log('\n3. Onboarding-Link erzeugen (unser createOnboardingLink)');
  const link = await createOnboardingLink(cfg, {
    stripeAccountId: created.value.stripeAccountId,
    returnUrl: 'https://norns.de/stripe/fertig',
    refreshUrl: 'https://norns.de/stripe/neu',
  });
  if (!link.ok) { no(`fehlgeschlagen: ${link.reason} ${link.detail}`); }
  else {
    ok('Link erhalten von Stripe');
    console.log(`    ${link.value.url.slice(0, 78)}...`);
    const rest = link.value.expiresAt * 1000 - Date.now();
    ok(`läuft ab in ${Math.round(rest / 60000)} Minuten (darum niemals speichern)`);
  }
  
  console.log('\n4. Kontostand erneut abfragen (unser retrieveAccount)');
  const fresh = await retrieveAccount(cfg, created.value.stripeAccountId);
  fresh.ok ? ok(`gelesen, charges_enabled=${fresh.value.chargesEnabled}`) : no(String(fresh.detail));
  
  console.log('\n5. Unsinnige Kennung darf Stripe nie erreichen');
  const bad = await retrieveAccount(cfg, 'pi_3QabcDEF');
  (!bad.ok && bad.reason === 'INVALID_INPUT') ? ok('vorher abgefangen') : no('durchgelassen!');
  
  console.log('\n6. Direktbelastung: Kopfzeile und Gebühr');
  const d = directChargeFields({ stripeAccountId: created.value.stripeAccountId, amountCents: 120_000, feeBps: 100 });
  ok(`Kopfzeile Stripe-Account = ${d.header.stripeAccount}`);
  ok(`Gebühr = ${d.feeCents} Cent von 120000 (1,00 %)`);
  ok(`abgerundet: 999 Cent → ${computeApplicationFeeCents(999, 100)} Cent`);
  
  console.log('\n7. Zahlung auf einem NICHT freigeschalteten Konto muss Stripe ablehnen');
  const body = new URLSearchParams({ amount: '120000', currency: 'eur', 'payment_method_types[0]': 'card' });
  for (const [k2, v] of d.form) body.set(k2, v);
  const res = await fetch('https://api.stripe.com/v1/payment_intents', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`, 'Stripe-Version': cfg.apiVersion,
      'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Account': d.header.stripeAccount,
    },
    body: body.toString(),
  });
  const j: any = await res.json();
  if (res.ok) no(`FEHLER: Stripe hat eine Zahlung auf einem gesperrten Konto ERLAUBT (${j.id})`);
  else ok(`Stripe lehnt ab (${res.status}): ${String(j?.error?.message).slice(0, 110)}`);
  console.log('\n    → genau deshalb muss die Kasse readyToCharge VOR dem Kunden prüfen,');
  console.log('      nicht erst wenn Stripe vor seinen Augen nein sagt.\n');
  
  await schritt8(cfg, key, created.value.stripeAccountId);
}
main().catch((e) => { console.error(e); process.exit(1); });
/**
 * Schritt 8, ergänzt am 26.07.2026 mit Wanderung 0110.
 *
 * Die Kernbehauptung dieser Wanderung lautet: DERSELBE Händler kann im
 * Marktplatz eine andere Vermittlungsgebühr tragen als in seinem eigenen Shop.
 * Bis 0110 war das unmöglich, weil die Gebühr EIN Wert je Konto war.
 *
 * Die Einheitstests belegen die Rangfolge, aber nicht, dass Stripe die
 * unterschiedliche Gebühr auch wirklich bucht. Deshalb wird sie hier gegen die
 * echte Schnittstelle erzeugt und anschliessend ZURÜCKGELESEN. Genau diese
 * Sorte Messung hat die Abkündigung von Accounts v1 gefunden, die kein
 * Einheitstest sah.
 */
export async function schritt8(cfg: StripeConnectConfig, key: string, konto: string) {
  const { resolveCommission } = await import('../../src/lib/commission.js');

  // So, wie die Zeilen aus `payment_commission_rates` kämen.
  const zeilen = [
    { provider: 'STRIPE' as const, accountRef: konto, channel: 'WEB', feeBps: 100 },
    { provider: 'STRIPE' as const, accountRef: konto, channel: 'MARKETPLACE', feeBps: 500 },
    { provider: 'STRIPE' as const, accountRef: null, channel: null, feeBps: 250 },
  ];

  console.log('\n8. Gebuehr je KANAL, gegen das echte Stripe gemessen (0110)');

  for (const kanal of ['WEB', 'MARKETPLACE'] as const) {
    const g = resolveCommission(zeilen, {
      provider: 'STRIPE',
      accountRef: konto,
      channel: kanal,
      fallbackBps: 0,
    });
    const d = directChargeFields({ stripeAccountId: konto, amountCents: 120_000, feeBps: g.feeBps });

    const body = new URLSearchParams({
      amount: '120000',
      currency: 'eur',
      'payment_method_types[0]': 'card',
    });
    for (const [k, v] of d.form) body.set(k, v);

    const res = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Stripe-Version': cfg.apiVersion,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Stripe-Account': konto,
      },
      body: body.toString(),
    });
    const j = (await res.json()) as { id?: string; application_fee_amount?: number; error?: { message?: string } };

    if (!res.ok) {
      console.log(`  ✗ ${kanal}: Stripe lehnt ab: ${String(j?.error?.message).slice(0, 90)}`);
      continue;
    }
    // ZURUECKGELESEN, nicht geglaubt: was wir geschickt haben, ist nicht
    // dasselbe wie das, was Stripe gebucht hat.
    const gebucht = j.application_fee_amount;
    const erwartet = d.feeCents;
    const stimmt = gebucht === erwartet;
    console.log(
      `  ${stimmt ? '✓' : '✗'} ${kanal.padEnd(11)} aufgeloest ${String(g.feeBps).padStart(4)} bps (${g.source})` +
        ` → geschickt ${erwartet} Cent, Stripe bucht ${gebucht} Cent`,
    );
  }
  console.log('\n    → derselbe Haendler, dasselbe Konto, ZWEI verschiedene Gebuehren.');
  console.log('      Vor 0110 war das technisch unmoeglich.');
}
