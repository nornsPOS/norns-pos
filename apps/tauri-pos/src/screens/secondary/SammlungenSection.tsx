/**
 * SammlungenSection — die Storefront-Taxonomie verwalten (Anlegen, Umbenennen,
 * Löschen). Bisher konnte die Kasse Kategorien nur lesen und Produkten zuweisen
 * (`categoriesApi.tree`/`setForProduct`); die Governance der Sammlungen fehlte
 * ganz, obwohl die Wrapper (`create`/`update`/`remove`) längst existierten.
 *
 * Die Hierarchie ist bewusst zweistufig (der Server-Trigger lehnt Enkel ab), das
 * spiegelt die UI: eine Wurzel-Sammlung und ihre Unter-Sammlungen. Alle
 * Mutationen verlangen ADMIN plus Step-up, das der api-client-Interceptor
 * abfängt. Das Löschen kann der Server ablehnen (Kinder oder zugeordnete
 * Produkte); wir zeigen dessen deutschen Grund, statt ein Löschen zu
 * versprechen, das nicht gilt.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { ApiError, type CategoryNode, categoriesApi } from '@norns/api-client';
import { describeError } from '@norns/i18n-de';
import { Button } from '@norns/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { useToastStore } from '../../state/toast-store.js';
import { eingereihtHinweis, istSicherEingereiht, ohneApiFehlerSatz } from '../../lib/eingereiht.js';

/** Name → server-taugliches Slug (^[a-z0-9]+(-[a-z0-9]+)*$). */
function toSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function SammlungenSection(): JSX.Element {
  const api = useApiClient();

  const treeQ = useQuery({
    queryKey: ['categories', 'tree'],
    queryFn: () => categoriesApi.tree(api),
    staleTime: 30_000,
  });

  const [newRoot, setNewRoot] = useState<string>('');
  const createRoot = useCategoryMutation('root');

  const roots = treeQ.data?.roots ?? [];

  return (
    <div style={{ padding: 'var(--w14-abstand-24)', display: 'grid', gap: 'var(--w14-abstand-16)', maxWidth: 760 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 'var(--w14-schrift-titel)', fontWeight: 600, color: 'var(--w14-ink)' }}>
          Sammlungen
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: 'var(--w14-schrift-text)', color: 'var(--w14-ink-faded)' }}>
          Die Kategorien des Web-Shops. Zwei Ebenen: eine Sammlung und ihre Unter-Sammlungen.
        </p>
      </div>

      {/* Neue Wurzel-Sammlung */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--w14-abstand-8)',
          alignItems: 'center',
          padding: 'var(--w14-abstand-14)',
          background: 'var(--w14-parchment-2)',
          border: '1px solid var(--w14-rule)',
          borderRadius: 'var(--w14-radius-card)',
        }}
      >
        <input
          value={newRoot}
          onChange={(e) => setNewRoot(e.target.value)}
          placeholder="Neue Sammlung, z. B. Münzen"
          maxLength={80}
          style={sammlungInput}
        />
        <Button
          variant="primary"
          disabled={newRoot.trim().length < 2 || createRoot.isPending}
          onClick={() =>
            createRoot.mutate(
              { nameDe: newRoot.trim(), slug: toSlug(newRoot), parentId: null },
              { onSuccess: () => setNewRoot('') },
            )
          }
        >
          {createRoot.isPending ? 'Legt an…' : 'Anlegen'}
        </Button>
      </div>

      {treeQ.isLoading ? (
        <p style={{ color: 'var(--w14-ink-faded)', fontStyle: 'italic' }}>Lädt Sammlungen…</p>
      ) : treeQ.isError ? (
        <p role="alert" style={{ color: 'var(--w14-wax-red)' }}>
          Sammlungen konnten nicht geladen werden.
        </p>
      ) : roots.length === 0 ? (
        <p style={{ color: 'var(--w14-ink-faded)', fontStyle: 'italic' }}>
          Noch keine Sammlung angelegt.
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--w14-abstand-12)' }}>
          {roots.map((root) => (
            <RootRow key={root.id} root={root} />
          ))}
        </div>
      )}
    </div>
  );
}

function RootRow({ root }: { root: CategoryNode }): JSX.Element {
  const [addChild, setAddChild] = useState<string>('');
  const createChild = useCategoryMutation('child');

  return (
    <div
      style={{
        border: '1px solid var(--w14-rule)',
        borderRadius: 'var(--w14-radius-card)',
        background: 'var(--w14-parchment-1)',
        padding: 'var(--w14-abstand-14)',
        display: 'grid',
        gap: 'var(--w14-abstand-10)',
      }}
    >
      <NodeRow node={root} isRoot />

      {root.children.length > 0 && (
        <div style={{ display: 'grid', gap: 'var(--w14-abstand-6)', paddingLeft: 'var(--w14-abstand-16)' }}>
          {root.children.map((child) => (
            <NodeRow key={child.id} node={child} isRoot={false} />
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 'var(--w14-abstand-8)', alignItems: 'center', paddingLeft: 'var(--w14-abstand-16)' }}>
        <input
          value={addChild}
          onChange={(e) => setAddChild(e.target.value)}
          placeholder="Unter-Sammlung hinzufügen…"
          maxLength={80}
          style={{ ...sammlungInput, fontSize: 'var(--w14-schrift-feld)' }}
        />
        <Button
          variant="ghost"
          size="sm"
          disabled={addChild.trim().length < 2 || createChild.isPending}
          onClick={() =>
            createChild.mutate(
              { nameDe: addChild.trim(), slug: toSlug(addChild), parentId: root.id },
              { onSuccess: () => setAddChild('') },
            )
          }
        >
          Hinzufügen
        </Button>
      </div>
    </div>
  );
}

function NodeRow({ node, isRoot }: { node: CategoryNode; isRoot: boolean }): JSX.Element {
  const [editing, setEditing] = useState<boolean>(false);
  const [name, setName] = useState<string>(node.nameDe);
  const rename = useCategoryUpdate(node.id);
  const remove = useCategoryRemove(node.id);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-8)' }}>
      {editing ? (
        <>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            style={{ ...sammlungInput, fontSize: isRoot ? 'var(--w14-schrift-betont)' : 'var(--w14-schrift-feld)' }}
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={name.trim().length < 2 || name.trim() === node.nameDe || rename.isPending}
            onClick={() =>
              rename.mutate({ nameDe: name.trim() }, { onSuccess: () => setEditing(false) })
            }
          >
            {rename.isPending ? 'Speichert…' : 'Speichern'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
            Abbrechen
          </Button>
        </>
      ) : (
        <>
          <span
            style={{
              flex: 1,
              fontFamily: 'var(--w14-font-display)',
              fontWeight: isRoot ? 600 : 500,
              fontSize: isRoot ? 'var(--w14-schrift-grund)' : 'var(--w14-schrift-text)',
              color: 'var(--w14-ink)',
            }}
          >
            {node.nameDe}
            <span
              className="w14-tabular"
              style={{
                marginLeft: 8,
                fontFamily: 'var(--w14-font-mono)',
                fontSize: 'var(--w14-schrift-kuerzel)',
                color: 'var(--w14-ink-faded)',
              }}
            >
              {node.productCount} {node.productCount === 1 ? 'Artikel' : 'Artikel'}
            </span>
          </span>
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Umbenennen
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm(`Sammlung „${node.nameDe}" löschen?`)) remove.mutate();
            }}
            style={{ color: 'var(--w14-wax-red)' }}
          >
            {remove.isPending ? 'Löscht…' : 'Löschen'}
          </Button>
        </>
      )}
    </div>
  );
}

// ── Mutations (jeweils mit Toast + Baum-Invalidierung) ────────────────────────

function useCategoryMutation(kind: 'root' | 'child') {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  return useMutation({
    mutationFn: (body: { nameDe: string; slug: string; parentId: string | null }) =>
      categoriesApi.create(api, body),
    onSuccess: async () => {
      addToast({
        tone: 'success',
        title: kind === 'root' ? 'Sammlung angelegt' : 'Unter-Sammlung angelegt',
      });
      await qc.invalidateQueries({ queryKey: ['categories'] });
    },
    onError: (err: unknown) => {
      // Eingereiht ist ein ERFOLG. „Bitte erneut versuchen." war hier die
      // Einladung, dieselbe Sammlung ein zweites Mal anzulegen — und zwei
      // gleichnamige Sammlungen im Baum sind hinterher Handarbeit.
      if (istSicherEingereiht(err)) {
        addToast(eingereihtHinweis(kind === 'root' ? 'Sammlung' : 'Unter-Sammlung'));
        return;
      }
      addToast({
        tone: 'alert',
        title: 'Anlegen fehlgeschlagen',
        body: err instanceof ApiError ? describeError(err) : ohneApiFehlerSatz(err),
      });
    },
  });
}

function useCategoryUpdate(id: string) {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  return useMutation({
    mutationFn: (body: { nameDe: string }) => categoriesApi.update(api, id, body),
    onSuccess: async () => {
      addToast({ tone: 'success', title: 'Sammlung umbenannt' });
      await qc.invalidateQueries({ queryKey: ['categories'] });
    },
    onError: (err: unknown) => {
      addToast({
        tone: 'alert',
        title: 'Umbenennen fehlgeschlagen',
        body: err instanceof ApiError ? describeError(err) : 'Bitte erneut versuchen.',
      });
    },
  });
}

function useCategoryRemove(id: string) {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  return useMutation({
    mutationFn: () => categoriesApi.remove(api, id),
    onSuccess: async () => {
      addToast({ tone: 'success', title: 'Sammlung gelöscht' });
      await qc.invalidateQueries({ queryKey: ['categories'] });
    },
    onError: (err: unknown) => {
      // Der Server lehnt das Löschen ab, wenn noch Kinder oder Produkte hängen.
      // Sein deutscher Grund ist ehrlicher als ein pauschales „fehlgeschlagen".
      addToast({
        tone: 'alert',
        title: 'Löschen nicht möglich',
        body: err instanceof ApiError ? describeError(err) : 'Bitte erneut versuchen.',
      });
    },
  });
}

const sammlungInput: React.CSSProperties = {
  flex: 1,
  padding: 'var(--w14-abstand-8) var(--w14-abstand-10)',
  border: '1px solid var(--w14-feldlinie)',
  borderRadius: 'var(--w14-radius-button)',
  backgroundColor: 'var(--w14-parchment)',
  fontFamily: 'var(--w14-font-body)',
  fontSize: 'var(--w14-schrift-text)',
  color: 'var(--w14-ink)',
  outline: 'none',
};
