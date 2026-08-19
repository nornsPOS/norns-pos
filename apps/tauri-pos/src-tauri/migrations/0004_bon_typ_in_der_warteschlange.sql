-- ════════════════════════════════════════════════════════════════════════
--  0004 — Die Warteschlange merkt sich den BON_TYP
-- ════════════════════════════════════════════════════════════════════════
--
--  ── DER BEFUND VOM 08.08.2026 ───────────────────────────────────────────
--
--  Die dauerhafte TSE-Warteschlange hält alles, was ein Beleg zum Nachsignieren
--  braucht: Betrag, Zahlart, Steueraufteilung. Sie hielt NICHT, ob der Beleg
--  ein Verkauf oder ein Storno ist.
--
--  Bis heute fiel das nicht auf, weil der Rumpf ohnehin das falsche Vokabular
--  sprach und deshalb NIE signiert wurde. Jetzt, wo er signiert, würde ein
--  nachgereichter Storno als gewöhnlicher Beleg signiert — mit einem BON_TYP,
--  den er nicht hat, und die Signatur wäre eine falsche Aussage.
--
--  ── DIE ENTSCHEIDUNG, DIE DIESE WANDERUNG TRÄGT ────────────────────────
--
--  Bestehende Zeilen bekommen 'RECEIPT'.
--
--  Das ist keine Bequemlichkeit, sondern die einzige Zeile, die stimmt: es gibt
--  auf keiner Kasse eine bestehende Zeile, die einen Storno trägt. Der
--  Storno-Weg hat bis heute `amountCents: 0` gesendet, und die Attrappe wies
--  jeden Betrag 0 ab, bevor er in die Warteschlange kam. Wer eine alte Zeile
--  findet, hat also einen Verkauf vor sich.

ALTER TABLE tse_signature_queue
  ADD COLUMN receipt_type TEXT NOT NULL DEFAULT 'RECEIPT';
