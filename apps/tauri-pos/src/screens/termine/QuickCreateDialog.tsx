/**
 * QuickCreateDialog — fast booking from an empty calendar slot. The clicked
 * slot pre-fills the start; the current operator is the default staff. A 409
 * (slot taken / outside working hours) surfaces as a German hint.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { productsApi } from '@norns/api-client';

import { ApiError, type AppointmentType } from '@norns/api-client';
import { APPOINTMENT_TYPE_LABELS } from '@norns/api-client';
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  Field,
  Input,
  Select,
  Textarea,
} from '@norns/ui-kit';

import { useBookAppointment } from '../../hooks/useAppointments.js';
import { useApiClient } from '../../lib/api-context.js';
import { useSessionStore } from '../../state/session-store.js';
import { useToastStore } from '../../state/toast-store.js';
import { describeError } from '@norns/i18n-de';

const APPOINTMENT_TYPES: AppointmentType[] = ['VIEWING', 'BUYBACK_EVAL', 'CONSULTATION', 'PICKUP'];

/** Mirror of packages/appointments DEFAULT_DURATION_MINUTES (kept in sync by review). */
const DEFAULT_DURATION: Record<AppointmentType, number> = {
  VIEWING: 30,
  BUYBACK_EVAL: 45,
  CONSULTATION: 30,
  PICKUP: 15,
};

const DURATION_CHOICES = [15, 30, 45, 60, 90, 120] as const;

/** ISO instant → value for `<input type="datetime-local">` (local wall clock). */
export function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

interface QuickCreateDialogProps {
  /** The clicked empty slot (local Date) — null closes the dialog. */
  slotStart: Date | null;
  onClose: () => void;
}

export function QuickCreateDialog({
  slotStart,
  onClose,
}: QuickCreateDialogProps): JSX.Element | null {
  if (!slotStart) return null;
  return (
    <Dialog open onClose={onClose} title="Neuer Termin" size="sm">
      <CreateForm key={slotStart.toISOString()} slotStart={slotStart} onClose={onClose} />
    </Dialog>
  );
}

interface PersonKurz {
  userId: string;
  name: string;
  fenster: { wochentag: number }[];
}

function CreateForm({ slotStart, onClose }: { slotStart: Date; onClose: () => void }): JSX.Element {
  const actor = useSessionStore((s) => s.actor);
  const api = useApiClient();

  // ⚠️ 02.08.2026: hier stand ein Feld „Mitarbeiter-ID", in das ein Mensch
  // eine 36-stellige Kennung abtippen sollte. Niemand tut das; man kopiert sie
  // aus einer anderen Fläche, oder man lässt sich selbst stehen und der Termin
  // gehört dem Falschen. Und ein Tippfehler ergab keine Fehlermeldung über die
  // PERSON, sondern „Zeitpunkt nicht mehr frei" — denn eine unbekannte Kennung
  // hat naturgemäss keine Arbeitszeiten.
  //
  // Die Liste kommt aus derselben Quelle, die auch die Kapazität speist. Damit
  // kann hier niemand erscheinen, dessen Termin der Server danach ablehnt.
  const { data: personen } = useQuery<{ personen: PersonKurz[] }>({
    queryKey: ['arbeitszeiten'],
    queryFn: () => api.request('GET', '/api/arbeitszeiten') as Promise<{ personen: PersonKurz[] }>,
    staleTime: 60_000,
  });
  const addToast = useToastStore((s) => s.addToast);
  const book = useBookAppointment();

  const [type, setType] = useState<AppointmentType>('VIEWING');
  const [startsAtLocal, setStartsAtLocal] = useState(toDatetimeLocal(slotStart));
  const [duration, setDuration] = useState<number>(DEFAULT_DURATION.VIEWING);
  const [staffUserId, setStaffUserId] = useState(actor?.id ?? '');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  // ⚠️ 02.08.2026: Die Verknüpfung von Stücken war im Motor VOLLSTÄNDIG fertig
  // — `linkedProductIds` wird entgegengenommen, in `appointment_linked_products`
  // geschrieben, und ein Auslöser der Datenbank macht daraus weiche Halte auf
  // dem Stück. Nur konnte es niemand benutzen: die Fläche bot es nicht an.
  //
  // Am Tresen hiess das: der Kunde kommt zur Besichtigung, das Stück ist in der
  // Zwischenzeit verkauft. Die Kasse hätte es halten können und wusste es
  // nicht.
  const [stuecke, setStuecke] = useState<string[]>([]);
  const istBesichtigung = type === 'VIEWING';
  const { data: verfuegbar } = useQuery({
    queryKey: ['produkte-verfuegbar-fuer-termin'],
    queryFn: () => productsApi.list(api, { status: 'AVAILABLE', limit: 200 }),
    // Nur laden, wenn es überhaupt gebraucht wird: die anderen drei Terminarten
    // haben kein Stück.
    enabled: istBesichtigung,
    staleTime: 30_000,
  });

  const changeType = (t: AppointmentType): void => {
    setType(t);
    setDuration(DEFAULT_DURATION[t]);
  };

  const canSubmit = startsAtLocal.length > 0 && staffUserId.trim().length > 0 && !book.isPending;

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    book.mutate(
      {
        type,
        ...(istBesichtigung && stuecke.length > 0 ? { linkedProductIds: stuecke } : {}),
        startsAt: new Date(startsAtLocal).toISOString(),
        staffUserId: staffUserId.trim(),
        bookedVia: 'pos',
        durationMinutes: duration,
        ...(note.trim() ? { customerNotes: note.trim() } : {}),
      },
      {
        onSuccess: () => {
          addToast({ tone: 'success', title: 'Termin gebucht' });
          onClose();
        },
        onError: (err: unknown) => {
          if (err instanceof ApiError && err.httpStatus === 409) {
            setError(
              'Dieser Slot ist nicht verfügbar. Belegt oder außerhalb der Arbeitszeiten. Bitte anderen Zeitpunkt wählen.',
            );
          } else if (err instanceof ApiError) {
            setError(describeError(err));
          } else {
            setError('Buchung fehlgeschlagen. Bitte erneut versuchen.');
          }
        },
      },
    );
  };

  return (
    <form onSubmit={submit}>
      <DialogBody>
        <div style={{ display: 'grid', gap: 'var(--w14-abstand-12)' }}>
          <Field label="Terminart" required>
            <Select value={type} onChange={(e) => changeType(e.target.value as AppointmentType)}>
              {APPOINTMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {APPOINTMENT_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Beginn" required>
            <Input
              type="datetime-local"
              value={startsAtLocal}
              onChange={(e) => setStartsAtLocal(e.target.value)}
            />
          </Field>

          <Field label="Dauer">
            <Select value={String(duration)} onChange={(e) => setDuration(Number(e.target.value))}>
              {DURATION_CHOICES.map((m) => (
                <option key={m} value={m}>
                  {m} Minuten
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Mitarbeiter"
            hint="Vorbelegt mit Ihnen. Nur wer Arbeitszeiten hinterlegt hat, kann Termine annehmen."
            required
          >
            <Select value={staffUserId} onChange={(e) => setStaffUserId(e.target.value)}>
              {/* Wer keine Zeiten hat, steht mit Hinweis da statt zu fehlen:
                  sonst suchte der Inhaber einen Menschen, den er sieht, und
                  fände ihn hier nicht — ohne zu erfahren warum. */}
              {(personen?.personen ?? []).map((p) => (
                <option key={p.userId} value={p.userId} disabled={p.fenster.length === 0}>
                  {p.name}
                  {p.fenster.length === 0 ? ' (keine Arbeitszeiten hinterlegt)' : ''}
                </option>
              ))}
            </Select>
          </Field>

          {/* Nur die Besichtigung kennt Stücke. Bei einer Beratung wäre das
              Feld eine Frage ohne Sinn. */}
          {istBesichtigung ? (
            <Field
              label="Stücke für diese Besichtigung"
              hint="Ausgewählte Stücke werden bis zum Termin weich gehalten und erscheinen im Lager als vorgemerkt."
            >
              <div style={{ display: 'grid', gap: 'var(--w14-abstand-4)', maxHeight: 200, overflowY: 'auto' }}>
                {/*
                  ⚠️ 13.08.2026 — DIESE LISTE HAT EINE OBERGRENZE, UND SIE MUSS
                  ES SAGEN.
                  Der Server gibt hoechstens 200 Zeilen (`product-list.ts`,
                  `maximum: 200`). Ein Juwelier mit mehr verfuegbaren Stuecken
                  bekam die restlichen NICHT — und weil die Liste das nicht
                  sagte, schloss der Bediener, das Stueck sei nicht verfuegbar.
                  Das ist die Hausklasse „Liste mit fester Obergrenze wird zur
                  unsichtbaren Wand": ohne Gesamtzahl kann eine Flaeche „steht
                  nicht auf dieser Seite" nicht von „gibt es nicht"
                  unterscheiden.
                */}
                {verfuegbar?.hasMore ? (
                  <span
                    style={{
                      fontSize: 'var(--w14-schrift-zeile)',
                      color: 'var(--w14-wax-red)',
                    }}
                  >
                    Diese Auswahl zeigt {verfuegbar.items.length} von{' '}
                    {verfuegbar.total} verfügbaren Stücken. Ein hier fehlendes
                    Stück ist NICHT verkauft, es steht nur nicht auf dieser
                    Seite. Es lässt sich nach dem Anlegen über das Lager
                    vormerken.
                  </span>
                ) : null}
                {(verfuegbar?.items ?? []).length === 0 ? (
                  <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}>
                    Zurzeit ist kein Stück verfügbar.
                  </span>
                ) : (
                  (verfuegbar?.items ?? []).map((prod) => (
                    <label
                      key={prod.id}
                      style={{ display: 'flex', gap: 'var(--w14-abstand-8)', alignItems: 'center' }}
                    >
                      <input
                        type="checkbox"
                        checked={stuecke.includes(prod.id)}
                        onChange={(ev) =>
                          setStuecke((alt) =>
                            ev.target.checked
                              ? [...alt, prod.id]
                              : alt.filter((x) => x !== prod.id),
                          )
                        }
                      />
                      <span style={{ fontSize: 'var(--w14-schrift-text)' }}>
                        {prod.name}
                        {prod.sku ? ` (${prod.sku})` : ''}
                      </span>
                    </label>
                  ))
                )}
              </div>
            </Field>
          ) : null}

          <Field label="Notiz">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Anlass, Kundenwunsch, Artikel …"
            />
          </Field>

          {error ? (
            <p role="alert" style={{ margin: 0, fontSize: 'var(--w14-schrift-feld)', color: 'var(--w14-wax-red)' }}>
              {error}
            </p>
          ) : null}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" type="button" onClick={onClose}>
          Abbrechen
        </Button>
        <Button variant="primary" type="submit" disabled={!canSubmit}>
          {book.isPending ? 'Bucht …' : 'Termin buchen'}
        </Button>
      </DialogFooter>
    </form>
  );
}
