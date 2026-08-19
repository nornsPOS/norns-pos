#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DIE FISKALY-SONDE — misst, was das Konto WIRKLICH kann
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Basel fragt: „wie geht die Sache", damit er mit fiskaly reden und einen
 * Vertrag zeichnen kann. Diese Sonde beantwortet das mit Messungen statt mit
 * Vermutungen: sie meldet sich an, liest den Bestand und sagt in deutschen
 * Sätzen, was steht und was fehlt.
 *
 * ── ⚠️ ZWEI STUFEN, UND DIE ZWEITE IST EINE EINBAHNSTRASSE ────────────────
 *
 *   LESEN      Anmelden, Sicherungseinrichtungen auflisten, ihren Zustand
 *              lesen. Aendert NICHTS. Beliebig oft wiederholbar.
 *
 *   ANLEGEN    Legt eine Sicherungseinrichtung an. ⚠️ Der Verwalterschluessel
 *              (`admin_puk`) kommt bei der Anlage GENAU EINMAL zurueck. Wer
 *              ihn in dieser Sekunde nicht wegschreibt, verliert die
 *              Verwaltungshoheit ueber diese Einrichtung fuer immer.
 *              Deshalb laeuft diese Stufe NUR mit `--anlegen` und schreibt
 *              den Schluessel sofort in eine Datei, BEVOR sie irgendetwas
 *              anderes tut.
 *
 * ── DIE UMGEBUNG ─────────────────────────────────────────────────────────
 *
 * Vorgabe ist die ERPROBUNG. Wer die amtliche Umgebung will, muss sie
 * ausdruecklich nennen. Eine Sonde, die versehentlich eine echte
 * Sicherungseinrichtung anlegt, waere ein teurer Scherz: sie ist ein
 * Rechtsinstrument auf den Namen eines echten Steuerpflichtigen.
 *
 * ── AUFRUF ───────────────────────────────────────────────────────────────
 *
 *   node werkzeug/fiskaly-sonde.mjs                 # nur lesen, Erprobung
 *   node werkzeug/fiskaly-sonde.mjs --anlegen       # legt eine TSS an
 *   node werkzeug/fiskaly-sonde.mjs --amtlich       # gegen die echte Umgebung
 *
 * Die Zugangsdaten kommen aus `.env` im Wurzelverzeichnis (git-ignoriert):
 *   FISKALY_API_KEY="..."
 *   FISKALY_API_SECRET="..."
 *
 * ⚠️ Diese Sonde druckt NIE einen Schluessel oder ein Geheimnis. Sie zeigt
 * nur Laengen und die letzten vier Zeichen, damit man Tippfehler findet,
 * ohne das Geheimnis in ein Protokoll zu schreiben.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = join(HIER, '..');

const ERPROBUNG = 'https://kassensichv-middleware.fiskaly.com/api/v2';
const AMTLICH = 'https://kassensichv.fiskaly.com/api/v2';

/**
 * ⚠️ ZWEI GETRENNTE SCHNITTSTELLEN, und das ist der Punkt, den Basel am
 * 13.08.2026 richtig gesehen hat.
 *
 *   VERWALTUNG   dashboard.fiskaly.com/api/v0
 *                Organisationen, API-Schlüssel, Nutzer, Rechnungsanschriften.
 *                HIER entsteht die „Einheit" für jeden neuen Händler.
 *
 *   SIGNIEREN    kassensichv.fiskaly.com/api/v2
 *                Sicherungseinrichtungen und Signaturen. Der fiskalische Weg.
 *
 * Das Händlermodell heisst dort MANAGED_ORGANIZATION: eine Organisation, die
 * von einer anderen VERWALTET wird. Norns ist die verwaltende, jeder Händler
 * bekommt eine eigene verwaltete darunter, mit eigenem MANAGED_API_KEY und
 * eigener Sicherungseinrichtung. `billing_options.bill_to_organization` lässt
 * die Rechnung beim Verwalter landen — genau das Modell eines Kassenherstellers.
 */
const VERWALTUNG = 'https://dashboard.fiskaly.com/api/v0';

const amtlich = process.argv.includes('--amtlich');
const anlegen = process.argv.includes('--anlegen');
const BASIS = amtlich ? AMTLICH : ERPROBUNG;

// ── Zugangsdaten lesen, ohne sie je zu zeigen ────────────────────────────

function envLesen() {
  const pfad = join(WURZEL, '.env');
  if (!existsSync(pfad)) return {};
  const werte = {};
  for (const zeile of readFileSync(pfad, 'utf8').split('\n')) {
    const t = zeile.trim();
    if (t === '' || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    werte[t.slice(0, i).trim()] = t
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  return werte;
}

/** Ein Geheimnis so zeigen, dass man Tippfehler sieht und nichts verrät. */
const andeuten = (s) => (s ? `${s.length} Zeichen, endet auf …${s.slice(-4)}` : 'FEHLT');

const env = { ...envLesen(), ...process.env };
const schluessel = env.FISKALY_API_KEY;
const geheimnis = env.FISKALY_API_SECRET;

console.log('═══ Fiskaly-Sonde ═══');
console.log(`Umgebung:   ${amtlich ? '⚠️  AMTLICH (echte Signaturen)' : 'Erprobung (Signaturen ohne Rechtswert)'}`);
console.log(`Adresse:    ${BASIS}`);
console.log(`Schlüssel:  ${andeuten(schluessel)}`);
console.log(`Geheimnis:  ${andeuten(geheimnis)}`);
console.log('');

if (!schluessel || !geheimnis) {
  console.log('⛔ Es fehlen Zugangsdaten.');
  console.log('');
  console.log('   Lege im Wurzelverzeichnis eine Datei `.env` an (sie ist');
  console.log('   git-ignoriert, Zeile 25 der .gitignore) mit diesen zwei Zeilen:');
  console.log('');
  console.log('     FISKALY_API_KEY="…"');
  console.log('     FISKALY_API_SECRET="…"');
  console.log('');
  console.log('   Die Werte stehen im fiskaly-Arbeitsbereich unter den');
  console.log('   API-Schlüsseln. Erprobung und amtlich haben GETRENNTE');
  console.log('   Schlüssel — nimm die der Erprobung.');
  process.exit(2);
}

// ── Der Weg ──────────────────────────────────────────────────────────────

async function ruf(pfad, { methode = 'GET', koerper, token, basis = BASIS } = {}) {
  const antwort = await fetch(`${basis}${pfad}`, {
    method: methode,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(koerper ? { body: JSON.stringify(koerper) } : {}),
  });
  const text = await antwort.text();
  let daten;
  try {
    daten = text ? JSON.parse(text) : null;
  } catch {
    daten = text;
  }
  return { status: antwort.status, ok: antwort.ok, daten };
}

function fehlerSatz(a) {
  const d = a.daten;
  const grund =
    (d && (d.message || d.error || d.title)) || (typeof d === 'string' ? d.slice(0, 200) : '');
  return `HTTP ${a.status}${grund ? ` — ${grund}` : ''}`;
}

async function main() {
  // ── 1. Anmelden ────────────────────────────────────────────────────────
  console.log('① Anmeldung …');
  const auth = await ruf('/auth', {
    methode: 'POST',
    koerper: { api_key: schluessel, api_secret: geheimnis },
  });

  if (!auth.ok) {
    console.log(`   ⛔ Die Anmeldung schlug fehl: ${fehlerSatz(auth)}`);
    console.log('');
    if (auth.status === 401) {
      console.log('   401 heisst fast immer: Schlüssel und Geheimnis gehören zu einer');
      console.log('   ANDEREN Umgebung. Erprobung und amtlich haben getrennte Schlüssel.');
      console.log(`   Diese Sonde lief gegen: ${amtlich ? 'amtlich' : 'Erprobung'}.`);
      console.log('   Probiere es ohne bzw. mit `--amtlich`.');
    }
    process.exit(1);
  }

  const token = auth.daten?.access_token;
  console.log('   ✓ angemeldet');
  const a = auth.daten?.access_token_claims ?? {};
  if (a.organization_id) console.log(`   Schlüssel gehört zu Organisation: ${a.organization_id}`);
  if (a.env) console.log(`   Umgebung laut Token: ${a.env}`);

  // ⚠️ Der Rumpf verlangt hart das Feld `access_token_expires_at`, waehrend
  // vier andere Stellen im Haus `access_token_expires_in` lesen. Welche der
  // beiden fiskaly WIRKLICH liefert, war aus dem Baum nicht messbar. Hier
  // ist die Antwort, endlich gemessen.
  const felder = Object.keys(auth.daten ?? {});
  console.log(`   Felder der Antwort: ${felder.join(', ')}`);
  const hatAt = felder.includes('access_token_expires_at');
  const hatIn = felder.includes('access_token_expires_in');
  console.log(
    `   ⚠️ Ablauffeld: expires_at ${hatAt ? 'JA' : 'nein'}, expires_in ${hatIn ? 'JA' : 'nein'}`,
  );
  if (!hatAt) {
    console.log('   ⚠️ Der Rumpf (commands/tse.rs) verlangt `access_token_expires_at` HART.');
    console.log('      Fehlt es, bricht die Anmeldung in der Kasse. Das gehört gehärtet.');
  }
  console.log('');

  // ── 1b. Die VERWALTUNG: wer bin ich, und was verwalte ich? ────────────
  //
  // Das beantwortet Basels eigentliche Frage: mit welchem Schluessel lassen
  // sich Einheiten fuer weitere Haendler anlegen, und was steht schon da.
  console.log('①b Verwaltung (Organisationen und Schlüssel) …');
  const vAuth = await ruf('/auth', {
    methode: 'POST',
    basis: VERWALTUNG,
    koerper: { api_key: schluessel, api_secret: geheimnis },
  });

  if (!vAuth.ok) {
    console.log(`   ⚠️ Kein Zugang zur Verwaltung: ${fehlerSatz(vAuth)}`);
    console.log('   Das ist NICHT unbedingt ein Fehler: ein Schlüssel, der nur');
    console.log('   signieren darf, kommt hier nicht hinein. Zum Anlegen neuer');
    console.log('   Händler-Einheiten braucht es einen Verwaltungsschlüssel.');
    console.log('');
  } else {
    const vToken = vAuth.daten?.access_token;
    const orgs = await ruf('/organizations?limit=100', { token: vToken, basis: VERWALTUNG });
    if (!orgs.ok) {
      console.log(`   ⚠️ ${fehlerSatz(orgs)}`);
    } else {
      const liste = orgs.daten?.data ?? orgs.daten?.results ?? [];
      console.log(`   ✓ ${liste.length} Organisation(en) erreichbar`);
      for (const o of liste) {
        const art = o.managed_by_organization_id ? 'verwaltet' : 'eigen';
        const umg = Array.isArray(o._envs) ? o._envs.join('+') : (o._envs ?? '?');
        console.log(`     • ${o.display_name || o.name}  [${art}]  Umgebungen: ${umg}`);
        console.log(`       ${o._id ?? o.id}`);
        if (o.managed_by_organization_id) {
          console.log(`       verwaltet von: ${o.managed_by_organization_id}`);
        }
      }
      const eigene = liste.filter((o) => !o.managed_by_organization_id);
      const verwaltet = liste.filter((o) => o.managed_by_organization_id);
      console.log('');
      console.log(`   Eigene Organisation(en): ${eigene.length}`);
      console.log(`   Verwaltete Händler:      ${verwaltet.length}`);
      if (verwaltet.length === 0 && eigene.length > 0) {
        console.log('   → Noch kein Händler als verwaltete Organisation angelegt.');
        console.log('     Das ist der Weg für „eine Einheit je Laden".');
      }
    }
    console.log('');
  }

  // ── 2. Bestand lesen ───────────────────────────────────────────────────
  console.log('② Sicherungseinrichtungen lesen …');
  const liste = await ruf('/tss', { token });
  if (!liste.ok) {
    console.log(`   ⛔ ${fehlerSatz(liste)}`);
    process.exit(1);
  }

  const tss = liste.daten?.data ?? liste.daten?.results ?? [];
  console.log(`   ✓ ${tss.length} Sicherungseinrichtung(en) im Konto`);
  for (const t of tss) {
    console.log(`     • ${t._id ?? t.id}`);
    console.log(`       Zustand: ${t.state ?? 'unbekannt'}`);
    if (t.description) console.log(`       Bezeichnung: ${t.description}`);
    if (t.certificate_expiration_date) {
      const d = new Date(t.certificate_expiration_date * 1000);
      console.log(`       Zertifikat läuft: ${d.toISOString().slice(0, 10)}`);
    }
  }
  console.log('');

  // ── 3. Was bedeutet das? ───────────────────────────────────────────────
  const betriebsbereit = tss.filter((t) => t.state === 'INITIALIZED');
  console.log('③ Urteil');
  if (tss.length === 0) {
    console.log('   Das Konto ist leer. Es gibt noch keine Sicherungseinrichtung.');
    console.log('   Zum Anlegen: dieselbe Sonde mit `--anlegen`.');
  } else if (betriebsbereit.length === 0) {
    console.log('   ⚠️ Es gibt Einrichtungen, aber KEINE ist im Zustand INITIALIZED.');
    console.log('   Eine Kasse kann damit nicht signieren. Der Zustand muss von');
    console.log('   CREATED über UNINITIALIZED nach INITIALIZED geführt werden.');
  } else {
    console.log(`   ✓ ${betriebsbereit.length} Einrichtung(en) betriebsbereit (INITIALIZED).`);
    console.log('   Für die Kasse werden gebraucht: die Kennung oben, eine');
    console.log('   registrierte Klientenkennung, sowie Schlüssel und Geheimnis.');
  }
  console.log('');

  if (!anlegen) {
    console.log('Nur gelesen, nichts verändert. Für die Anlage: `--anlegen`.');
    return;
  }

  // ── 4. Anlegen — die Einbahnstrasse ────────────────────────────────────
  if (amtlich) {
    console.log('⛔ Anlegen gegen die AMTLICHE Umgebung ist in dieser Sonde gesperrt.');
    console.log('   Eine echte Sicherungseinrichtung ist ein Rechtsinstrument auf den');
    console.log('   Namen eines Steuerpflichtigen. Sie gehört von Hand angelegt, mit');
    console.log('   offenen Augen, nicht von einem Werkzeug.');
    process.exit(3);
  }

  console.log('④ Sicherungseinrichtung anlegen (Erprobung) …');
  const kennung = crypto.randomUUID();
  const angelegt = await ruf(`/tss/${kennung}`, {
    methode: 'PUT',
    token,
    koerper: { description: 'Norns POS Erprobung', state: 'UNINITIALIZED' },
  });

  if (!angelegt.ok) {
    console.log(`   ⛔ ${fehlerSatz(angelegt)}`);
    process.exit(1);
  }

  // ⚠️⚠️ SOFORT WEGSCHREIBEN, VOR ALLEM ANDEREN. Der Verwalterschlüssel
  // kommt genau einmal zurück.
  const ziel = join(WURZEL, `fiskaly-tss-${kennung}.geheim.json`);
  writeFileSync(ziel, JSON.stringify(angelegt.daten, null, 2), { mode: 0o600 });

  console.log(`   ✓ angelegt: ${kennung}`);
  console.log(`   ⚠️ Die vollständige Antwort — samt Verwalterschlüssel, der`);
  console.log(`      GENAU EINMAL kommt — liegt jetzt in:`);
  console.log(`      ${ziel}`);
  console.log('');
  console.log('   ⛔ Diese Datei gehört NICHT ins Lager. Lege sie in deinen');
  console.log('      Passwortspeicher und lösche sie danach von der Platte.');
}

main().catch((e) => {
  console.log('');
  console.log(`⛔ Unerwarteter Abbruch: ${e instanceof Error ? e.message : String(e)}`);
  console.log('   Kein Netz? Falsche Adresse? Die Sonde hat nichts verändert.');
  process.exit(1);
});
