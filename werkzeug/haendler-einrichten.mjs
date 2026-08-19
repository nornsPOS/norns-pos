#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  EINEN HÄNDLER EINRICHTEN — die ganze Kette in einem Lauf
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Basels Ziel: „der Kunde steckt an und verkauft sofort." Damit das geht,
 * muss VOR der Auslieferung alles stehen, was die Kasse braucht. Genau das
 * tut dieses Werkzeug, und zwar in einem Lauf statt in sieben Handgriffen
 * durch zwei verschiedene Weboberflächen.
 *
 * ── DIE KETTE ────────────────────────────────────────────────────────────
 *
 *   1. Anmelden an der VERWALTUNG (dashboard.fiskaly.com) mit dem
 *      Schlüssel der Mutterorganisation.
 *   2. Für den Händler einen eigenen API-Schlüssel anlegen.
 *      ⚠️ Das Geheimnis kommt GENAU EINMAL zurück.
 *   3. Mit DIESEM Schlüssel an der SIGNIER-Schnittstelle anmelden
 *      (kassensichv.fiskaly.com). Nur so gehört die Sicherungseinrichtung
 *      wirklich dem Händler und nicht der Mutter.
 *   4. Sicherungseinrichtung anlegen.
 *      ⚠️ Der Verwalterschlüssel kommt GENAU EINMAL zurück.
 *   5. Sie in Betrieb nehmen (INITIALIZED).
 *   6. Die Kasse als Klienten registrieren.
 *   7. Die vier Werte ausgeben, die in die Kasse gehören.
 *
 * ── ⚠️ DIE REGEL, DIE ALLES TRÄGT ────────────────────────────────────────
 *
 * ZWEI Geheimnisse dieser Kette kommen nur EIN EINZIGES MAL zurück: das
 * API-Geheimnis des Händlers und der Verwalterschlüssel der
 * Sicherungseinrichtung. Wer sie in dieser Sekunde nicht wegschreibt, hat
 * sie für immer verloren — und mit dem Verwalterschlüssel die Hoheit über
 * eine Einrichtung, die zehn Jahre halten soll.
 *
 * Deshalb schreibt dieses Werkzeug JEDE Antwort SOFORT und VOR dem nächsten
 * Schritt in eine Datei mit Rechten 0600. Erst danach macht es weiter.
 *
 * ── ⚠️ NUR ERPROBUNG ─────────────────────────────────────────────────────
 *
 * Gegen die amtliche Umgebung ist dieses Werkzeug GESPERRT. Eine echte
 * Sicherungseinrichtung ist ein Rechtsinstrument auf den Namen eines
 * Steuerpflichtigen; sie wird mit offenen Augen von Hand angelegt, nicht
 * von einem Skript.
 *
 * ── AUFRUF ───────────────────────────────────────────────────────────────
 *
 *   node werkzeug/haendler-einrichten.mjs <organisations-id> [kassenname]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = join(HIER, '..');
const TRESOR = join(WURZEL, 'fiskaly-geheimnisse');

const VERWALTUNG = 'https://dashboard.fiskaly.com/api/v0';
const SIGNIEREN = 'https://kassensichv-middleware.fiskaly.com/api/v2';

const organisation = process.argv[2];
const kassenname = process.argv[3] ?? 'kasse-1';

if (!organisation) {
  console.log('Aufruf: node werkzeug/haendler-einrichten.mjs <organisations-id> [kassenname]');
  console.log('');
  console.log('Die Organisations-Kennung zeigt `node werkzeug/fiskaly-sonde.mjs`.');
  process.exit(2);
}

function envLesen() {
  const pfad = join(WURZEL, '.env');
  if (!existsSync(pfad)) return {};
  const w = {};
  for (const z of readFileSync(pfad, 'utf8').split('\n')) {
    const t = z.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    w[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return w;
}

const env = { ...envLesen(), ...process.env };
const mutterSchluessel = env.FISKALY_API_KEY;
const mutterGeheimnis = env.FISKALY_API_SECRET;

if (!mutterSchluessel || !mutterGeheimnis) {
  console.log('⛔ In `.env` fehlen FISKALY_API_KEY und FISKALY_API_SECRET.');
  process.exit(2);
}

async function ruf(basis, pfad, { methode = 'GET', koerper, token } = {}) {
  const a = await fetch(`${basis}${pfad}`, {
    method: methode,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(koerper ? { body: JSON.stringify(koerper) } : {}),
  });
  const text = await a.text();
  let d;
  try {
    d = text ? JSON.parse(text) : null;
  } catch {
    d = text;
  }
  return { status: a.status, ok: a.ok, daten: d };
}

const fehlerSatz = (a) => {
  const d = a.daten;
  const g = (d && (d.message || d.error || d.title)) || (typeof d === 'string' ? d.slice(0, 200) : '');
  return `HTTP ${a.status}${g ? ` — ${g}` : ''}`;
};

/** ⚠️ SOFORT wegschreiben. Vor allem anderen. Rechte 0600. */
function wegschreiben(name, daten) {
  mkdirSync(TRESOR, { recursive: true, mode: 0o700 });
  const ziel = join(TRESOR, name);
  writeFileSync(ziel, JSON.stringify(daten, null, 2), { mode: 0o600 });
  return ziel;
}

const stempel = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

async function main() {
  console.log('═══ Händler einrichten (ERPROBUNG) ═══');
  console.log(`Organisation: ${organisation}`);
  console.log(`Kasse:        ${kassenname}`);
  console.log('');

  // ── 1. Verwaltung ──────────────────────────────────────────────────────
  console.log('① Anmeldung an der Verwaltung …');
  const vAuth = await ruf(VERWALTUNG, '/auth', {
    methode: 'POST',
    koerper: { api_key: mutterSchluessel, api_secret: mutterGeheimnis },
  });
  if (!vAuth.ok) {
    console.log(`   ⛔ ${fehlerSatz(vAuth)}`);
    process.exit(1);
  }
  const vToken = vAuth.daten.access_token;
  console.log('   ✓');

  const org = await ruf(VERWALTUNG, `/organizations/${organisation}`, { token: vToken });
  if (!org.ok) {
    console.log(`   ⛔ Organisation nicht erreichbar: ${fehlerSatz(org)}`);
    process.exit(1);
  }
  const umgebungen = Array.isArray(org.daten._envs) ? org.daten._envs : [];
  console.log(`   Organisation: ${org.daten.display_name || org.daten.name}`);
  console.log(`   Umgebungen:   ${umgebungen.join('+') || '?'}`);
  if (umgebungen.includes('LIVE') && !umgebungen.includes('TEST')) {
    console.log('   ⛔ Diese Organisation kennt nur LIVE. Dieses Werkzeug richtet');
    console.log('      ausschliesslich in der Erprobung ein. Abbruch.');
    process.exit(3);
  }
  console.log('');

  // ── 2. Schlüssel für den Händler ───────────────────────────────────────
  console.log('② API-Schlüssel für diesen Händler anlegen …');
  const schluesselName = `norns-${kassenname}-${stempel.slice(2, 16).replace(/-/g, '')}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 30);
  const neuerSchluessel = await ruf(VERWALTUNG, `/organizations/${organisation}/api-keys`, {
    methode: 'POST',
    token: vToken,
    koerper: { name: schluesselName, status: 'enabled' },
  });
  if (!neuerSchluessel.ok) {
    console.log(`   ⛔ ${fehlerSatz(neuerSchluessel)}`);
    process.exit(1);
  }
  // ⚠️⚠️ SOFORT. Das Geheimnis kommt nie wieder.
  const schluesselDatei = wegschreiben(`api-schluessel-${schluesselName}.json`, neuerSchluessel.daten);
  const hKey = neuerSchluessel.daten.key ?? neuerSchluessel.daten.api_key;
  const hSecret = neuerSchluessel.daten.secret ?? neuerSchluessel.daten.api_secret;
  console.log(`   ✓ ${schluesselName}`);
  console.log(`   ⚠️ Geheimnis weggeschrieben: ${schluesselDatei}`);
  if (!hSecret) {
    console.log('   ⛔ In der Antwort war KEIN Geheimnis. Ohne das geht es nicht weiter.');
    console.log(`      Felder: ${Object.keys(neuerSchluessel.daten ?? {}).join(', ')}`);
    process.exit(1);
  }
  console.log('');

  // ── 3. Signier-Schnittstelle mit dem HÄNDLER-Schlüssel ─────────────────
  console.log('③ Anmeldung an der Signier-Schnittstelle (mit dem Händlerschlüssel) …');
  const sAuth = await ruf(SIGNIEREN, '/auth', {
    methode: 'POST',
    koerper: { api_key: hKey, api_secret: hSecret },
  });
  if (!sAuth.ok) {
    console.log(`   ⛔ ${fehlerSatz(sAuth)}`);
    console.log('   Der Schlüssel ist angelegt und liegt in der Datei oben.');
    process.exit(1);
  }
  const sToken = sAuth.daten.access_token;
  console.log('   ✓');
  console.log('');

  // ── 4. Sicherungseinrichtung ───────────────────────────────────────────
  console.log('④ Sicherungseinrichtung anlegen …');
  const tssId = crypto.randomUUID();
  const tss = await ruf(SIGNIEREN, `/tss/${tssId}`, {
    methode: 'PUT',
    token: sToken,
    koerper: { description: `Norns POS — ${kassenname}` },
  });
  if (!tss.ok) {
    console.log(`   ⛔ ${fehlerSatz(tss)}`);
    process.exit(1);
  }
  // ⚠️⚠️ SOFORT. Der Verwalterschlüssel kommt nie wieder.
  const tssDatei = wegschreiben(`tss-${tssId}.json`, tss.daten);
  console.log(`   ✓ ${tssId}`);
  console.log(`   Zustand: ${tss.daten.state}`);
  console.log(`   ⚠️ Verwalterschlüssel weggeschrieben: ${tssDatei}`);
  const puk = tss.daten.admin_puk;
  console.log('');

  // ── 5. In Betrieb nehmen ───────────────────────────────────────────────
  //
  // ⚠️ GEMESSEN am 13.08.2026 gegen die echte Erprobungsumgebung: die
  // Sicherungseinrichtung entsteht in `CREATED`, NICHT in `UNINITIALIZED`.
  // Die Kette ist dreistufig, und wer die erste Stufe überspringt, bekommt
  // „TSS must be in state UNINITIALIZED for a state transition to
  // INITIALIZED" — mit einer Einrichtung, die angelegt, aber unbrauchbar ist.
  //
  //     CREATED → UNINITIALIZED → INITIALIZED
  //
  console.log('⑤ In Betrieb nehmen (CREATED → UNINITIALIZED → INITIALIZED) …');

  const stufe1 = await ruf(SIGNIEREN, `/tss/${tssId}`, {
    methode: 'PATCH',
    token: sToken,
    koerper: { state: 'UNINITIALIZED' },
  });
  console.log(`   CREATED → UNINITIALIZED: ${stufe1.ok ? '✓' : fehlerSatz(stufe1)}`);
  if (!stufe1.ok) {
    console.log('   ⛔ Ohne diese Stufe geht es nicht weiter.');
    process.exit(1);
  }

  if (!puk) {
    console.log('   ⛔ Kein Verwalterschlüssel in der Antwort. Abbruch.');
    process.exit(1);
  }
  // ⚠️ GEMESSEN am 13.08.2026: die Verwalter-PIN muss SECHS Zeichen haben.
  // Mit fuenf antwortet fiskaly `E_ADMIN_LOGIN_FAILED` und dem Satz
  // „ERROR_AUTHENTICATION_FAILED (UNBLOCK_RESULT_ERROR)" — also einer
  // Meldung ueber die ANMELDUNG, waehrend in Wahrheit die LAENGE falsch ist.
  // Wer das nicht misst, sucht den Fehler stundenlang beim Verwalterschluessel.
  //
  // ⚠️ Und NICHT mit Swissbit verwechseln: dort ist die PIN fuenfstellig und
  // die PUK sechsstellig. Hier ist die PIN sechsstellig und die PUK zehn.
  // Zwei Hersteller, zwei Laengen.
  const ADMIN_PIN = String(Math.floor(Math.random() * 900000) + 100000);
  const pinSetzen = await ruf(SIGNIEREN, `/tss/${tssId}/admin`, {
    methode: 'PATCH',
    token: sToken,
    koerper: { admin_puk: puk, new_admin_pin: ADMIN_PIN },
  });
  console.log(`   Verwalter-PIN setzen:    ${pinSetzen.ok ? '✓' : fehlerSatz(pinSetzen)}`);

  const anmelden = await ruf(SIGNIEREN, `/tss/${tssId}/admin/auth`, {
    methode: 'POST',
    token: sToken,
    koerper: { admin_pin: ADMIN_PIN },
  });
  console.log(`   Als Verwalter anmelden:  ${anmelden.ok ? '✓' : fehlerSatz(anmelden)}`);

  const stufe2 = await ruf(SIGNIEREN, `/tss/${tssId}`, {
    methode: 'PATCH',
    token: sToken,
    koerper: { state: 'INITIALIZED' },
  });
  console.log(`   UNINITIALIZED → INITIALIZED: ${stufe2.ok ? '✓' : fehlerSatz(stufe2)}`);
  if (stufe2.ok) {
    console.log(`   Zustand jetzt: ${stufe2.daten?.state}`);
  }
  console.log('');

  // ── 6. Die Kasse als Klienten ──────────────────────────────────────────
  console.log('⑥ Kasse als Klienten registrieren …');
  const clientId = crypto.randomUUID();
  const klient = await ruf(SIGNIEREN, `/tss/${tssId}/client/${clientId}`, {
    methode: 'PUT',
    token: sToken,
    koerper: { serial_number: kassenname },
  });
  console.log(`   ${klient.ok ? `✓ ${clientId}` : `⚠️ ${fehlerSatz(klient)}`}`);
  console.log('');

  // ── 7. Was in die Kasse gehört ─────────────────────────────────────────
  const uebergabe = {
    organisation,
    tssId,
    clientId,
    adminPin: ADMIN_PIN,
    apiKeyName: schluesselName,
    hinweis:
      'Schluessel und Geheimnis stehen in api-schluessel-*.json. Der Verwalter' +
      'schluessel der TSE steht in tss-*.json. Beide gehoeren in den Passwort' +
      'speicher und danach von der Platte geloescht.',
  };
  const uebergabeDatei = wegschreiben(`uebergabe-${kassenname}-${stempel}.json`, uebergabe);

  console.log('⑦ Für die Kasse gebraucht:');
  console.log(`   TSS-Kennung:      ${tssId}`);
  console.log(`   Klientenkennung:  ${clientId}`);
  console.log(`   Schlüsselname:    ${schluesselName}`);
  console.log(`   (Schlüssel und Geheimnis: ${schluesselDatei})`);
  console.log('');
  console.log(`   Übergabeblatt: ${uebergabeDatei}`);
  console.log('');
  console.log('⛔ Der Ordner `fiskaly-geheimnisse/` gehört NICHT ins Lager.');
  console.log('   Alles in den Passwortspeicher, dann den Ordner löschen.');
}

main().catch((e) => {
  console.log('');
  console.log(`⛔ Abbruch: ${e instanceof Error ? e.message : String(e)}`);
  console.log(`   Bereits angelegte Geheimnisse liegen in ${TRESOR}`);
  process.exit(1);
});
