-- ═════════════════════════════════════════════════════════════════════════
-- 0122 — Der Dankestext trug ein wörtliches Backslash-n
-- ═════════════════════════════════════════════════════════════════════════
--
-- GEFUNDEN 26.07.2026, beim lebenden Durchlauf vor der OTA-Freigabe:
-- auf JEDEM Bon stand mitten im Dankestext wörtlich »\n«.
--
-- URSACHE: Wanderung 0024 säte die Belegtexte mit '...Einkauf!\nFür...' —
-- in einer GEWÖHNLICHEN SQL-Zeichenkette. Bei standard_conforming_strings
-- (der Vorgabe seit PostgreSQL 9.1) ist '\n' KEIN Zeilenumbruch, sondern
-- die zwei Zeichen Backslash und n. Ein Umbruch braucht E'\n'.
--
-- Und NICHTS auf dem Weg deutet die Folge nachträglich: der Klient zerlegt
-- den Text an ECHTEN Umbrüchen (useReceiptFooter.ts, split auf U+000A),
-- der Byte-Erzeuger (thermal.rs) druckt, was er bekommt, die Vorschauen
-- ebenso. Bewiesen mit od -c am erzeugten Strom.
--
-- DIE BEHEBUNG: die zwei Zeichen werden zum echten Umbruch. Idempotent —
-- nach dem ersten Lauf findet strpos nichts mehr. Künftige Mandanten
-- laufen 0024 und unmittelbar danach diese Wanderung, kommen also sauber
-- zur Welt. 0024 selbst bleibt unangetastet: eine bereits angewandte
-- Wanderung wird in diesem Haus nicht umgeschrieben (das Hauptbuch der
-- Wanderungen ist unser eigenes, von Hand veränderte Läufe verschwinden
-- daraus — siehe die Lehre vom 24.07.).
--
-- Bewusst ALLE Zeilen von belegtext_templates, nicht nur die zwei
-- gesäten: hat ein Inhaber den Fehler inzwischen von Hand in einen
-- eigenen Text kopiert, wird auch der geheilt.

UPDATE belegtext_templates
   SET body_text = replace(body_text, '\n', E'\n')
 WHERE strpos(body_text, '\n') > 0;
