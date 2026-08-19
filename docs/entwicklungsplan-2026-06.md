# Warehouse14 — Umfassender Entwicklungsplan (Stand: 2026-06-10)

Der eine Plan, der alles ordnet: was JETZT gebaut wird, was als Nächstes kommt,
und welche Gates vor dem echten Go-Live stehen. Jede Phase ist so geschnitten,
dass sie für sich allein Wert liefert und in großen Batches (Agent-Schwarm)
umsetzbar ist — keine Mikro-Schritte.

---

## Phase 0 — LIVE heute (bereits geschafft)

| Baustein | Status |
|---|---|
| POS v0.4.12 (Kasse, Ankauf, Lager, Bewertung, Werkstatt, Kurse) | ✅ auf Basels Mac |
| Backend komplett auf dem Oracle-Server (api + worker + postgres + redis, Migration 0061) | ✅ live |
| Online-Shop am Server, direkt erreichbar: **http://79.76.116.239/** (nginx :80 → Container) | ✅ live |
| Kassierer → Veröffentlichen → Produkt + Foto erscheint im Shop (`is_published_to_web + AVAILABLE`) | ✅ verifiziert |
| Companion-Hub (Telefon via QR): Lager-Rolle, Zweitkasse, Kundenanzeige | ✅ v0.4.12 |
| Fiskal-Exporte jederzeit: DATEV (SKR03 je Steuerart), DSFinV-K, Kassenbericht, TSE-Archiv | ✅ (Testmodus-TSE) |

## Phase 1 — IN ARBEIT (diese Welle): Telefon-Anbindung + Termine

**Ziel:** Das Telefon wird ein vollwertiges Arbeitsgerät, und Termine laufen
zentral durchs System — vom Kunden bis in Basels iPhone-Kalender.

1. **Reibungslose Telefon-Kopplung**
   - Hub startet AUTOMATISCH mit dem POS (kein manuelles "Geräte koppeln" mehr).
   - Pairing bleibt 30 Tage gültig (persistiert, idle-basiert) — QR nur einmal scannen.
   - Lager am Telefon: Inventar, Scan per Kamera, Produkt anlegen/bearbeiten,
     Fotos aufnehmen + Hauptbild, Etikett drucken. (v0.4.12, wird verfeinert)
2. **Termine überall**
   - POS: Kalender-Cockpit (Tag/Woche/Monat, Farben je Typ, Drag-Reschedule,
     Schnell-Anlage, Heute-Leiste mit 1-Tap Check-in).
   - Telefon: Termine-Tab (Heute/Woche, Status-Flow Bestätigen → Check-in →
     Abgeschlossen, Neuer Termin mit Kundensuche).
   - **iPhone-Kalender nativ:** ICS-Abo-Feed (Token-URL) — alle Laden-Termine
     erscheinen automatisch in Apple/Google Kalender.
3. **Buchung von außen**
   - Öffentliche Buchungsseite **/termin** im Online-Shop (Slots aus
     Öffnungszeiten, Kollisionsprüfung, Quelle WEB) → Termin steht sofort im POS.
   - WhatsApp-Glue fertig verdrahtet, aber TOKEN-GATED: sobald die Meta-Keys in
     `.env` stehen, antwortet der Bot auf Termin-Anfragen mit dem Buchungslink
     und versendet Bestätigung + Erinnerungen (24h/2h) per WhatsApp.

**Deploy dieser Welle:** POS v0.4.13 (Mac-Install), api+migrate Image (0062),
Storefront-Image — alles vom Orchestrator nach grünen Gates.

## Phase 2 — Hardware-Tag Schorndorf (Basel vor Ort)

- ZVT-Kartenterminal scharf schalten (C3) + Fehler-UX nach Autorisierung.
- Bon-/Etikettendrucker + Scanner real verbinden (Auto-Connect ist gebaut).
- Kundendisplay am Tablet aufstellen (Rolle existiert).
- Checkliste: `docs/go-live-hardware-checklist.md`.

## Phase 3 — Kommunikation scharf schalten

- **WhatsApp Business (Meta) Keys** in Server-`.env` → Termin-Bot + Erinnerungen
  + Ankauf-Intake-Bot werden aktiv (alles schon verdrahtet).
- Chatwoot self-host deployen (`infrastructure/docker/chatwoot/`) + DNS
  `chat.warehouse14.de` + Widget-Token in Einstellungen → Kundenservice-Kanal.
- Social-Webhooks (Instagram/Facebook) auf denselben Reply-Router.

## Phase 4 — Online-Shop öffentlich

- Domain **www.warehouse14.de** auf den Shop (heute: private IP) + HTTPS.
- Rechtstexte mit ECHTEN Daten (Impressum/AGB/Datenschutz/Widerruf — heute
  Platzhalter "Musterstraße"), echtes Gründungsjahr, Wordmark-Vereinheitlichung.
- Checkout-Strecke live testen (Warenkorb → Kasse → Zahlung) + Bestell-E-Mails.
- SEO-Grundlagen (Sitemap, strukturierte Daten sind angelegt).

## Phase 5 — Go-Live-Gates (Pflicht vor echtem Betrieb)

| Gate | Warum |
|---|---|
| Produktive Fiskaly-TSE-Keys (raus aus Testmodus) | KassenSichV |
| DSFinV-K-Bundle gegen offizielles Prüftool validieren | Betriebsprüfung/Kassen-Nachschau |
| DATEV-Konten je Steuerart mit Steuerberater abstimmen | Fiskale Korrektheit |
| Cloudflare mTLS aktiv + `TEST_DEVICE_FINGERPRINT` entfernen | Gerätebindung |
| ALLE Secrets rotieren (PAT, R2, goldapi, CF-Token, mTLS-Dev-Key) | Hygiene nach Entwicklung |
| Session-Token → OS-Keychain | Hardening |

## Phase 6 — Vertiefung (nach Go-Live)

- eBay-Sync komplett (Listing-Push ist live; Inbound-Sync + Bestandsabgleich).
- Server-Vertiefung: Off-site-Backups (R2), Monitoring/Alerts, Log-Rotation,
  Restore-Probe.
- Auswertungen: Tages-/Monatsberichte, Margen je Kategorie, Ankauf-Analytik.
- Mehr Telefon-Rollen (Inventur-Modus, Foto-Studio-Modus).

---

### Arbeitsweise (Standing Order von Basel)
Große, abgeschlossene Batches mit Agent-Schwärmen; Recherche zuerst; mobile-first
(95 % Telefon); Deutsch in der UI; verifizieren vor "fertig"; Deploy auf den
eigenen Server; private Links bis zum offiziellen Launch.
