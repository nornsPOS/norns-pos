# Amtliches Prüfstück — DSFinV-K 2.4

Diese zwei Dateien stammen **unverändert** aus dem amtlichen Paket der
Finanzverwaltung. Sie werden hier NICHT gepflegt und NICHT angepasst. Wer sie
ändert, zerstört ihren einzigen Zweck.

## Warum sie unter `src/` liegen und nicht unter `tests/`

Aus ZWEI Gründen, und der zweite ist der wichtigere:

1. Der Wächter liest aus ihnen die Erwartung (siehe unten).
2. **Sie gehören in das ausgelieferte Paket.** Ein DSFinV-K-Datenträger
   besteht nicht nur aus den CSV-Dateien: `index.xml` beschreibt sie für das
   Prüfwerkzeug, und die DTD beschreibt die `index.xml`. Ohne beide kann ein
   Prüfer den Datenträger nicht einlesen.

Sie sind also Betriebsmittel, nicht Prüfmittel — und liegen deshalb dort, wo
der Erzeuger sie erreicht.

## Warum sie überhaupt hier liegen

`apps/api-cloud/tests/unit/dsfinvk-export.test.ts` schrieb die erwarteten
Dateinamen als Zeichenketten in den Test selbst (`'bon_kopf.csv'`,
`'bon_pos_preise.csv'` …) und verglich die Kopfzeilen mit `toContain` gegen
dieselben Bezeichner, die der Erzeuger schreibt.

**Links und rechts stand dasselbe Wort, und beide stammten aus derselben
Feder.** 392 Zeilen Test, und keine einzige fragte eine FREMDE Stelle, ob es
`bon_kopf.csv` überhaupt gibt. Genau deshalb liefen neun frei erfundene
Dateinamen jahrelang grün durch.

Ein Wächter, dessen Erwartung vom Erzeuger stammt, kann bei genau diesem Fehler
nie rot werden. Deshalb kommt die Erwartung ab jetzt von hier: **die amtliche
`index.xml` beschreibt alle 20 Tabellen mit 219 Spalten maschinenlesbar.** Der
Wächter parst sie und nennt keinen einzigen Namen selbst.

## Herkunft, nachprüfbar

- **Quelle:** BZSt, „Digitale Schnittstelle der Finanzverwaltung für
  Kassensysteme (DSFinV-K)", Paket `dsfinv_k_v_2_4.zip`
- **Bekanntgabe:** BMF-Schreiben vom 12.01.2024,
  Aktenzeichen IV D 2 – S 0316-a/19/10007:004
- **Rechtsgrundlage:** § 146a AO in Verbindung mit der KassenSichV,
  AEAO zu § 146a, Stand 01.01.2024
- **Version:** 2.4, Dokumentstand 15.12.2023

## Prüfsummen (SHA-256)

    index.xml   d0b1fed31a50dc6370d7a54528034a1e0ac2f982f82e3c0a9250a15c64c85160
    gdpdu.dtd   af3d4c5a19e991f2d8c53995bc708680bbd7ff9326fde539c55b7e2c63f848a2

Die PDF der Norm selbst liegt nicht im Repo (995 kB, für den Wächter nicht
nötig). Ihre Prüfsumme zur Vollständigkeit:

    20231215_DSFinV_K_2_4.pdf
                01c8fa646fa92e70be62511a196177487323c3514640043ef8a5dfdfb97bbecb

Die Provenienz wurde geprüft: dieselbe PDF aus dem BZSt-Paket und eine frei
verlinkte Kopie sind bytegleich. Die Feldangaben stammen also aus dem
amtlichen Dokument, nicht von einer Herstellerseite.

⚠️ Ein Wächter prüft diese Prüfsummen bei jedem Lauf. Wird eine Datei
angefasst, wird er rot — und das ist richtig so: ein „angepasstes" Prüfstück
misst nichts mehr.
