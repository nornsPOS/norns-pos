/**
 * Die Vorgangs-Uhr: der Vorgang beginnt beim ERSTEN Stueck (DSFinV-K
 * Anhang I S. 113, § 146a AO „zeitgerecht"), nicht beim Bezahlen.
 * Begruendung und Befund in vorgangs-uhr.ts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const finishMock = vi.fn();
const startMock = vi.fn();

vi.mock('./hardware-client.js', () => ({
  tseClient: {
    finish: (...a: unknown[]) => finishMock(...a),
    start: (...a: unknown[]) => startMock(...a),
  },
  isRunningInTauri: () => true,
}));

import {
  offenerVorgang,
  vorgangBeginnen,
  vorgangUebernehmen,
  vorgangVerwerfen,
  vorgangsUhrZuruecksetzen,
} from './vorgangs-uhr.js';

const KONFIG = { apiBaseUrl: 'https://kassensichv-middleware.fiskaly.com/api/v2', tssId: 't', clientId: 'c' } as never;

beforeEach(() => {
  vorgangsUhrZuruecksetzen();
  finishMock.mockReset();
  startMock.mockReset();
});

describe('vorgangBeginnen', () => {
  it('haelt den Zeitpunkt auch fest, wenn die TSE NICHT antwortet', async () => {
    // Der Vorgangsbeginn ist eine Tatsache der Kasse, kein Geschenk des
    // Signaturdienstes. TSE aus → intention null, Zeit trotzdem da.
    startMock.mockRejectedValue(new Error('TSE aus'));
    const v = await vorgangBeginnen(KONFIG);
    expect(v.begonnenAm).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(v.intention).toBeNull();
  });

  it('oeffnet die TSE-Transaktion beim ersten Stueck', async () => {
    startMock.mockResolvedValue({ intentionId: 'i1', fiskalyTransactionId: 'f1' });
    const v = await vorgangBeginnen(KONFIG);
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(v.intention).not.toBeNull();
  });

  it('ist idempotent — das zweite Stueck beginnt keinen zweiten Vorgang', async () => {
    startMock.mockResolvedValue({ intentionId: 'i1', fiskalyTransactionId: 'f1' });
    const a = await vorgangBeginnen(KONFIG);
    const b = await vorgangBeginnen(KONFIG);
    expect(b.intentionId).toBe(a.intentionId);
    expect(startMock).toHaveBeenCalledTimes(1);
  });
});

describe('vorgangUebernehmen', () => {
  it('gibt den offenen Vorgang heraus und leert die Uhr', async () => {
    startMock.mockResolvedValue({ intentionId: 'i1', fiskalyTransactionId: 'f1' });
    const offen = await vorgangBeginnen(KONFIG);
    const uebernommen = vorgangUebernehmen();
    expect(uebernommen?.intentionId).toBe(offen.intentionId);
    expect(offenerVorgang()).toBeNull();
    // Und ein FINISH hat hier NICHT stattgefunden — das macht der Bezahlweg.
    expect(finishMock).not.toHaveBeenCalled();
  });
});

describe('vorgangVerwerfen', () => {
  it('schliesst den verworfenen Korb als AVBelegabbruch (ABORT, Betrag 0)', async () => {
    // DER Kern des Befunds H1: ein gefuellter und verworfener Korb beruehrte
    // die TSE nie — genau das Unterdrueckungsfenster, das sie schliessen soll.
    startMock.mockResolvedValue({ intentionId: 'i1', fiskalyTransactionId: 'f1' });
    finishMock.mockResolvedValue({});
    await vorgangBeginnen(KONFIG);
    await vorgangVerwerfen(KONFIG);
    expect(finishMock).toHaveBeenCalledTimes(1);
    const params = finishMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(params.receiptType).toBe('ABORT');
    expect(params.amountCents).toBe(0);
    expect(offenerVorgang()).toBeNull();
  });

  it('bleibt still, wenn nichts offen ist oder das Oeffnen scheiterte', async () => {
    await vorgangVerwerfen(KONFIG); // nichts offen
    startMock.mockRejectedValue(new Error('aus'));
    await vorgangBeginnen(KONFIG);
    await vorgangVerwerfen(KONFIG); // offen, aber ohne intention
    expect(finishMock).not.toHaveBeenCalled();
  });

  it('ein FINISH-Fehler bremst den naechsten Kunden nicht', async () => {
    startMock.mockResolvedValue({ intentionId: 'i1', fiskalyTransactionId: 'f1' });
    finishMock.mockRejectedValue(new Error('Netz weg'));
    await vorgangBeginnen(KONFIG);
    await expect(vorgangVerwerfen(KONFIG)).resolves.toBeUndefined();
  });
});
