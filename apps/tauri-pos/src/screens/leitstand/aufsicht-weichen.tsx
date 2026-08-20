/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Die Weichen der alten Aufsichts-Adressen
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── WOZU (20.08.2026) ──────────────────────────────────────────────────────
 *
 * Seit die vier Aufsichtsflächen unter EINER Tür stehen (`Aufsicht.tsx`),
 * zeigen `/risiko`, `/tagebuch` und `/compliance-inbox` nicht mehr auf eine
 * eigene Fläche. Die Adressen verschwinden trotzdem NICHT:
 *
 *   • Cmd+K findet die Flächen weiter unter ihren gewohnten Namen — wer
 *     „Tagebuch" tippt, denkt nicht an „Aufsicht".
 *   • Die Startliste, der Leitstand selbst und die Meldungen verweisen
 *     darauf.
 *   • Und das Muskelgedächtnis eines Menschen, der die Kasse täglich
 *     bedient, ist ein Grund für sich.
 *
 * Jede alte Adresse führt deshalb weiter — nur eben in ihren Bereich.
 *
 * ⚠️ `replace`, nicht `push`: sonst stünde die Weiche in der Geschichte, und
 * der Weg zurück landete wieder auf ihr, die sofort erneut weiterleitet. Eine
 * Falle, aus der man nicht herauskommt.
 */

import { Navigate } from 'react-router-dom';

import { type AufsichtBereich, aufsichtsAdresse } from './Aufsicht.js';

function weiche(bereich: AufsichtBereich): () => JSX.Element {
  return function Weiche(): JSX.Element {
    return <Navigate to={aufsichtsAdresse(bereich)} replace />;
  };
}

export const RisikoWeiche = weiche('risiko');
export const TagebuchWeiche = weiche('tagebuch');
export const KonfliktpostfachWeiche = weiche('konflikte');
