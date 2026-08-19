-- 0106 — Eine Kundensitzung kann widerrufen werden.
--
-- Das Audit vom 24.07.2026 fand die Lücke: Personal-Sitzungen tragen seit 0089
-- ein `revoked_at` (ein Stempel tötet die Sitzung beim nächsten Request), aber
-- Kundensitzungen konnten NUR durch Löschen der Zeile beendet werden. Eine
-- frühere Wanderung versuchte sogar `UPDATE ... SET revoked_at` und warf für
-- jeden Aufruf, weil die Spalte fehlte (0095). Damit fehlte der Kundschaft der
-- weiche Ausschalter: „dieses eine Gerät abmelden" ohne die ganze Zeile zu
-- verlieren, und der prüfbare Widerruf (die Zeile bleibt mit Zeitstempel stehen).
--
-- Diese Wanderung schliesst die Lücke spiegelbildlich zu 0089. Kein neuer GRANT
-- nötig: auf shopper_sessions liegt bereits ein TABELLENWEITES UPDATE-Recht
-- (0018), das kommende Spalten mitträgt — anders als ein spaltenweiser GRANT.

ALTER TABLE shopper_sessions
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

-- Der Resolver liest die Sitzung über den Token; ein Teilindex hält die lebenden
-- (nicht widerrufenen) Zeilen schlank.
CREATE INDEX IF NOT EXISTS shopper_sessions_live_idx
  ON shopper_sessions (token)
  WHERE revoked_at IS NULL;
