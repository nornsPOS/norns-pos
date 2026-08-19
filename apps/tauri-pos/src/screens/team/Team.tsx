/**
 * Team & Rollen — staff administration (Track A3). The Owner adds a staff member
 * (their Google e-mail then unlocks the app), sets the role, and can deactivate
 * one. Reads `/api/admin/staff`; create + deactivate are Owner + PIN step-up
 * server-side (the global step-up modal opens + replays transparently).
 *
 * Ported into tauri-pos as a pure ADDITION; uses the app's global toast store
 * and step-up cancel helper. `Dot` stands in for the control-desktop StatusDot.
 */

import { type CSSProperties, useState } from 'react';

import { useQuery } from '@tanstack/react-query';

import { ApiError } from '@norns/api-client';
import { InfoPunkt, Button, Zwischentitel, ParchmentCard, ZustandFehler } from '@norns/ui-kit';
import { describeError } from '@norns/i18n-de';

import { useApiClient } from '../../lib/api-context.js';
import { isStepUpCancelled } from '../../state/step-up-store.js';
import { useToastStore } from '../../state/toast-store.js';

type StaffRole = 'ADMIN' | 'CASHIER' | 'READONLY';

interface StaffRow {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
  isOwner: boolean;
  createdAt: string;
}
interface ListResponse {
  items: StaffRow[];
}

const ROLE_DE: Record<StaffRole, string> = {
  ADMIN: 'Administrator',
  CASHIER: 'Kasse',
  READONLY: 'Nur Lesen',
};

function Dot({ tone, size = 9 }: { tone: 'ok' | 'info'; size?: number }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: tone === 'ok' ? 'var(--w14-verdigris)' : 'var(--w14-ink-faded)',
        display: 'inline-block',
        flexShrink: 0,
      }}
    />
  );
}

const captionStyle: CSSProperties = {
  margin: 0,
  color: 'var(--w14-ink-faded)',
  fontSize: 'var(--w14-schrift-text)',
  lineHeight: 1.5,
};
const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: 'var(--w14-abstand-8) var(--w14-abstand-12)',
  fontSize: 'var(--w14-schrift-zeile)',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--w14-ink-faded)',
  borderBottom: '1px solid var(--w14-ink-faded)',
  whiteSpace: 'nowrap',
};
const tdStyle: CSSProperties = {
  padding: 'var(--w14-abstand-10) var(--w14-abstand-12)',
  borderBottom: '1px solid var(--w14-parchment-3)',
  verticalAlign: 'middle',
};
const inputStyle: CSSProperties = {
  padding: 'var(--w14-abstand-8) var(--w14-abstand-10)',
  border: '1px solid var(--w14-ink-faded)',
  borderRadius: 'var(--w14-radius-button)',
  background: 'var(--w14-parchment)',
  color: 'var(--w14-ink)',
  fontFamily: 'var(--w14-font-display)',
  fontSize: 'var(--w14-schrift-betont)',
};

export function Team(): JSX.Element {
  const client = useApiClient();
  const addToast = useToastStore((s) => s.addToast);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<StaffRole>('CASHIER');
  const [busy, setBusy] = useState<string | null>(null);

  const query = useQuery<ListResponse>({
    queryKey: ['staff'],
    queryFn: () => client.request<ListResponse>('GET', '/api/admin/staff'),
    staleTime: 30_000,
  });

  function handleStepUp(err: unknown, failTitle: string): void {
    if (isStepUpCancelled(err) || (err instanceof ApiError && err.code === 'STEP_UP_REQUIRED')) {
      addToast({ tone: 'alert', title: 'Abgebrochen', body: 'Die PIN-Bestätigung wurde abgebrochen.' });
    } else {
      addToast({ tone: 'alert', title: failTitle, body: describeError(err) });
    }
  }

  async function addStaff(): Promise<void> {
    if (busy || email.trim().length === 0 || name.trim().length === 0) return;
    setBusy('create');
    try {
      await client.request('POST', '/api/admin/staff', {
        email: email.trim(),
        name: name.trim(),
        role,
      });
      setEmail('');
      setName('');
      addToast({
        tone: 'success',
        title: 'Mitarbeiter freigeschaltet',
        // ⚠️ 01.08.2026: hier stand „mit diesem Google-Konto". Auf dieser
        // Kasse ist die Anmeldung der Kassencode; die Mailanschrift dient der
        // Zuordnung, nicht dem Anmelden.
        body: 'Der Zugang ist eingetragen. Der Kassencode wird beim ersten Start gesetzt.',
      });
      await query.refetch();
    } catch (err) {
      handleStepUp(err, 'Freischaltung fehlgeschlagen');
    } finally {
      setBusy(null);
    }
  }

  async function deactivate(row: StaffRow): Promise<void> {
    setBusy(row.id);
    try {
      await client.request('POST', `/api/admin/staff/${encodeURIComponent(row.id)}/deactivate`, {});
      addToast({ tone: 'success', title: 'Zugang deaktiviert', body: `${row.name} kann sich nicht mehr anmelden.` });
      await query.refetch();
    } catch (err) {
      handleStepUp(err, 'Deaktivierung fehlgeschlagen');
    } finally {
      setBusy(null);
    }
  }

  /**
   * ── DER INHABER GIBT KEINEN CODE, ER NIMMT IHN WEG (02.08.2026) ────────
   *
   * Der nächstliegende Knopf wäre „Code setzen": der Inhaber tippt dem
   * Mitarbeiter einen ein. Dann KENNT er ihn — und die Bedienerzuordnung nach
   * § 146a AO wäre wertlos, denn jede Buchung dieses Mitarbeiters könnte
   * ebenso gut vom Inhaber stammen.
   *
   * Deshalb löscht er nur. Der Mitarbeiter wählt danach am Tresen seinen
   * Namen und setzt seinen EIGENEN ersten Code. Niemand kennt je den Code
   * eines anderen.
   *
   * Derselbe Knopf ist auch die Antwort auf „Code vergessen".
   */
  async function kassencodeLoeschen(row: StaffRow): Promise<void> {
    setBusy(row.id);
    try {
      await client.request(
        'POST',
        `/api/admin/staff/${encodeURIComponent(row.id)}/kassencode-loeschen`,
        {},
      );
      addToast({
        tone: 'success',
        title: 'Kassencode gelöscht',
        // Der Satz sagt, was JETZT zu tun ist. „Erfolgreich" allein liesse den
        // Inhaber im Glauben, er müsse dem Mitarbeiter noch etwas mitteilen.
        body: `${row.name} wählt beim nächsten Start am Tresen den eigenen Namen und setzt einen neuen Code.`,
      });
      await query.refetch();
    } catch (err) {
      handleStepUp(err, 'Löschen fehlgeschlagen');
    } finally {
      setBusy(null);
    }
  }

  const items = query.data?.items ?? [];

  return (
    <div style={{ padding: 'var(--w14-abstand-20)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-4)', marginBottom: 20 }}>
        <Zwischentitel tone="gold" label="Team & Rollen" style={{ flex: 1 }} />
        <InfoPunkt
          ariaLabel="Wie kommt jemand ins Team?"
          richtung="links"
          text="Wer sich anmelden darf und mit welcher Rolle. Ein neuer Mitarbeiter wird über seine Mailanschrift eingetragen und setzt beim ersten Start seinen eigenen Kassencode."
        />
      </div>

      {/* Breitbild (26.07.2026): Freischalt-Formular und Mitgliederliste
          standen einspaltig unter 760/920er-Deckeln neben viel Leere. Sie
          stehen jetzt nebeneinander, sobald zwei Spalten à 640 Punkte Platz
          haben (die Tabelle braucht innen mindestens 640) — flüssig über
          auto-fit, bei 1280 bleibt es die eine Spalte von heute. */}
      <div
        style={{
          display: 'grid',
          gap: 'var(--w14-abstand-16)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 640px), 1fr))',
          alignItems: 'start',
          maxWidth: 1500,
        }}
      >
      <ParchmentCard tone="parchment" padding="md">
        <div style={{ display: 'flex', gap: 'var(--w14-abstand-12)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-4)', flex: '1 1 220px' }}>
            <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-aged)' }}>Mailanschrift</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={200}
              placeholder="name@ihr-laden.de"
              style={inputStyle}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-4)', flex: '1 1 160px' }}>
            <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-aged)' }}>Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              placeholder="Vor- und Nachname"
              style={inputStyle}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-4)' }}>
            <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-aged)' }}>Rolle</span>
            <select value={role} onChange={(e) => setRole(e.target.value as StaffRole)} style={inputStyle}>
              <option value="READONLY">Nur Lesen</option>
              <option value="CASHIER">Kasse</option>
              <option value="ADMIN">Administrator</option>
            </select>
          </label>
          <Button
            variant="primary"
            size="md"
            disabled={busy === 'create' || email.trim().length === 0 || name.trim().length === 0}
            onClick={() => void addStaff()}
          >
            {busy === 'create' ? 'Wird freigeschaltet …' : 'Freischalten'}
          </Button>
        </div>
      </ParchmentCard>

      {query.isLoading ? (
        <ParchmentCard tone="parchment" padding="lg">
          <p style={captionStyle}>Lädt Team …</p>
        </ParchmentCard>
      ) : query.isError ? (
        // FUND: `items` ist `query.data?.items ?? []`. Fiel der Abruf aus, war
        // die Liste leer und die Fläche schrieb „Noch keine Mitarbeiter." — vor
        // dem Inhaber stand also die Behauptung, sein Team existiere nicht.
        // Schlimmer noch: das Formular darüber lud ihn ein, jemanden anzulegen,
        // der längst angelegt ist. Eine leere Liste ohne Antwort ist kein Leer.
        <ZustandFehler
          satz={describeError(query.error)}
          folge="Wer sich anmelden darf, lässt sich jetzt nicht sagen. Bitte niemanden erneut freischalten, bevor die Liste wieder steht."
          onErneut={() => void query.refetch()}
        />
      ) : items.length === 0 ? (
        <ParchmentCard tone="parchment" padding="lg">
          <p style={captionStyle}>Noch keine Mitarbeiter.</p>
        </ParchmentCard>
      ) : (
        <ParchmentCard tone="parchment" padding="md" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>E-Mail</th>
                <th style={thStyle}>Rolle</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Aktion</th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id}>
                  <td style={{ ...tdStyle, fontFamily: 'var(--w14-font-display)' }}>{s.name}</td>
                  <td style={{ ...tdStyle, wordBreak: 'break-all' }}>{s.email}</td>
                  <td style={tdStyle}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--w14-abstand-8)' }}>
                      <Dot tone={s.isOwner ? 'ok' : 'info'} size={9} />
                      {s.isOwner ? 'Inhaber' : ROLE_DE[s.role]}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    {s.isOwner ? (
                      <span style={captionStyle}>-</span>
                    ) : (
                      <span
                        style={{
                          display: 'inline-flex',
                          gap: 'var(--w14-abstand-8)',
                          justifyContent: 'flex-end',
                        }}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy === s.id}
                          title="Löscht den Code. Der Mitarbeiter setzt am Tresen selbst einen neuen; niemand sonst erfährt ihn."
                          onClick={() => void kassencodeLoeschen(s)}
                        >
                          {busy === s.id ? '…' : 'Kassencode löschen'}
                        </Button>
                        <Button variant="ghost" size="sm" disabled={busy === s.id} onClick={() => void deactivate(s)}>
                          {busy === s.id ? '…' : 'Deaktivieren'}
                        </Button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ParchmentCard>
      )}
      </div>
    </div>
  );
}
