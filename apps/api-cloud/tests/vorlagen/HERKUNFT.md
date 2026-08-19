# Woher diese zwei Dateien stammen

Beide sind **unverändert** von DATEV, heruntergeladen am 26.07.2026 aus dem
öffentlichen Entwicklerportal. Sie liegen hier, damit der Wächter in
`tests/unit/datev-format.test.ts` unsere erzeugte Datei gegen die echte
Vorlage halten kann, statt gegen eine Beschreibung davon.

| Datei | Quelle |
|---|---|
| `EXTF_Buchungsstapel_DATEV_Muster.csv` | `Musterdaten_DATEV_Format_0_7f9322b9cc.zip` unter `https://developer.datev.de/assets/` |
| `Format_Buchungsstapel_DATEV.xml` | `Datev_Format_Pruefprogramm_2_2_3_0_76439824cb.zip`, Datei vom 21.10.2025 |

Sie werden NICHT bearbeitet. Ändert DATEV das Format, werden sie neu geholt
und `datev-spalten.generiert.ts` neu erzeugt.
