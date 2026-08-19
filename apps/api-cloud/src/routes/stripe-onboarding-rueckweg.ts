/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DER RÜCKWEG AUS DER STRIPE-EINRICHTUNG
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Ein Einrichtungslink von Stripe lebt zwei Stunden und wird beim BENUTZEN
 * verbraucht (am 26.07.2026 nachgemessen: der angefangene Link antwortete
 * danach mit 404, ein bloss geöffneter blieb bei 200). Läuft er ab oder bricht
 * die Sitzung, schickt Stripe den Händler an `refresh_url`.
 *
 * ⚠️ Genau dafür ist diese Adresse da: **sie soll einen NEUEN Link erzeugen und
 * sofort dorthin weiterleiten.** Beim ersten Versuch stand dort eine erfundene
 * Adresse, die es gar nicht gab (404), beim zweiten die Ladenseite. Beide Male
 * war der Händler an einer Sackgasse — und musste sich bei uns melden, damit
 * jemand von Hand einen Link erzeugt.
 *
 * ── Warum die Kontokennung NICHT einfach in der Adresse stehen darf ──────
 *
 * Der naheliegende Weg wäre `?account=acct_…`. Das wäre eine offene Tür: wer
 * die Kennung kennt, erzeugt sich selbst einen Einrichtungslink und trägt
 * **sein eigenes Bankkonto** ein. Die Auszahlungen des Händlers gingen dann an
 * ihn. Die Kennung ist kein Geheimnis — sie steht in unserem Register, in
 * Protokollen und in jeder Antwort der Statusroute.
 *
 * Deshalb trägt die Adresse ein SIGNIERTES, kurzlebiges Zeichen. Es ist an
 * genau eine Kennung gebunden, hält 14 Tage (so lange darf eine Einrichtung
 * dauern) und lässt sich ohne `AUTH_SECRET` nicht herstellen.
 *
 * Dieselbe Bauart wie die SSE-Eintrittskarte, aus demselben Grund: was in einer
 * Adresszeile steht, steht am Ende in einem Protokoll.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

import type { Env } from '../config/env.js';

/**
 * Vierzehn Tage.
 *
 * Kürzer wäre die Falle, die diese Datei behebt: ein Händler, der die
 * Einrichtung am Freitag beginnt und am Montag fortsetzt, stünde sonst wieder
 * vor einer toten Adresse. Länger wäre unnötig — wer nach zwei Wochen nicht
 * fertig ist, soll sich melden.
 */
export const RUECKWEG_TTL_MS = 14 * 24 * 3600 * 1000;

/** `acct_…` + Ablauf, signiert mit dem Betriebsgeheimnis. */
export function zeichneRueckweg(accountId: string, secret: string, jetzt = Date.now()): string {
  const nutzlast = `${accountId}.${jetzt + RUECKWEG_TTL_MS}`;
  const sig = createHmac('sha256', secret).update(nutzlast).digest('base64url');
  return `${Buffer.from(nutzlast).toString('base64url')}.${sig}`;
}

/** `null`, wenn das Zeichen gefälscht, verstümmelt oder abgelaufen ist. */
export function pruefeRueckweg(zeichen: string, secret: string, jetzt = Date.now()): string | null {
  const teile = zeichen.split('.');
  if (teile.length !== 2) return null;

  let nutzlast: string;
  try {
    nutzlast = Buffer.from(teile[0]!, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  const erwartet = createHmac('sha256', secret).update(nutzlast).digest('base64url');
  const a = Buffer.from(erwartet, 'utf8');
  const b = Buffer.from(teile[1]!, 'utf8');
  // Zeitkonstant, und die Längenprüfung VORHER — `timingSafeEqual` wirft bei
  // ungleicher Länge, und ein geworfener Fehler wäre hier ein 500 statt einer
  // sauberen Ablehnung.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const trenner = nutzlast.lastIndexOf('.');
  if (trenner < 0) return null;
  const accountId = nutzlast.slice(0, trenner);
  const gueltigBis = Number(nutzlast.slice(trenner + 1));

  if (!Number.isFinite(gueltigBis) || gueltigBis <= jetzt) return null;
  if (!/^acct_[A-Za-z0-9]+$/.test(accountId)) return null;

  return accountId;
}

/** Eine ruhige Seite statt einer nackten Weiterleitung. */
function fertigSeite(): string {
  return (
    '<!doctype html><html lang="de"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Einrichtung abgeschlossen</title><style>' +
    ':root{color-scheme:light dark}' +
    'body{margin:0;min-height:100vh;display:grid;place-items:center;' +
    'font-family:system-ui,-apple-system,sans-serif;background:#faf8f3;color:#1c1813}' +
    '@media(prefers-color-scheme:dark){body{background:#151310;color:#f2ede3}}' +
    '.k{max-width:30rem;text-align:center;padding:2rem;line-height:1.6}' +
    'h1{font-size:1.4rem;margin:0 0 1rem}p{margin:.6rem 0}' +
    '.l{color:#8a8579;font-size:.9rem;margin-top:1.5rem}' +
    '</style></head><body><div class="k">' +
    '<h1>Danke, Ihre Angaben sind bei Stripe angekommen.</h1>' +
    '<p>Stripe prüft sie jetzt. Das dauert meist wenige Minuten, bei einer ' +
    'Nachfrage auch ein bis zwei Werktage.</p>' +
    '<p>Sobald die Prüfung durch ist, können Sie in Ihrem Laden Karten annehmen, ' +
    'Sie müssen dafür nichts weiter tun.</p>' +
    '<p class="l">Fehlt noch etwas, meldet sich Stripe per E-Mail. ' +
    'Sie können sich jederzeit unter dashboard.stripe.com anmelden und ' +
    'in Ruhe weitermachen.</p>' +
    '</div></body></html>'
  );
}

function sackgasse(grund: string): string {
  return (
    '<!doctype html><html lang="de"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Link nicht mehr gültig</title><style>' +
    ':root{color-scheme:light dark}' +
    'body{margin:0;min-height:100vh;display:grid;place-items:center;' +
    'font-family:system-ui,-apple-system,sans-serif;background:#faf8f3;color:#1c1813}' +
    '@media(prefers-color-scheme:dark){body{background:#151310;color:#f2ede3}}' +
    '.k{max-width:30rem;text-align:center;padding:2rem;line-height:1.6}' +
    '</style></head><body><div class="k">' +
    '<h1>Dieser Link ist nicht mehr gültig.</h1>' +
    `<p>${grund}</p>` +
    '<p>Bitte melden Sie sich kurz bei uns, wir schicken Ihnen in einer ' +
    'Minute einen neuen.</p>' +
    '<p>Ihre bereits gemachten Angaben sind <strong>nicht</strong> verloren.</p>' +
    '</div></body></html>'
  );
}

interface Opts {
  env: Env;
}

export const stripeOnboardingRueckweg: FastifyPluginAsync<Opts> = async (app, opts) => {
  const secret = opts.env.AUTH_SECRET;

  // ══════════════════════════════════════════════════════════════════════
  // GET /api/stripe/connect/refresh?t=<zeichen>
  // ══════════════════════════════════════════════════════════════════════
  //
  // Stripe ruft das auf, wenn der Einrichtungslink abgelaufen oder verbraucht
  // ist. Wir erzeugen einen frischen und leiten sofort weiter — der Händler
  // merkt nur, dass es weitergeht.
  app.get<{ Querystring: { t?: string } }>(
    '/api/stripe/connect/refresh',
    {
      schema: {
        tags: ['stripe'],
        summary: 'Erzeugt einen frischen Einrichtungslink und leitet dorthin weiter.',
        security: [],
        hide: true,
      },
    },
    async (req: FastifyRequest<{ Querystring: { t?: string } }>, reply: FastifyReply) => {
      reply.header('content-type', 'text/html; charset=utf-8');

      const accountId = pruefeRueckweg(String(req.query.t ?? ''), secret);
      if (!accountId) {
        req.log.warn({}, 'stripe.rueckweg: ungueltiges oder abgelaufenes Zeichen');
        return reply.status(400).send(sackgasse('Er war zu lange offen.'));
      }

      const rueck = zeichneRueckweg(accountId, secret);
      const basis = opts.env.ADMIN_PUBLIC_URL.replace(/\/+$/, '');

      const form = new URLSearchParams({
        account: accountId,
        type: 'account_onboarding',
        refresh_url: `${basis}/api/stripe/connect/refresh?t=${rueck}`,
        return_url: `${basis}/api/stripe/connect/fertig`,
      });

      const res = await fetch('https://api.stripe.com/v1/account_links', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${opts.env.STRIPE_SECRET_KEY}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: form,
      });
      const j = (await res.json()) as { url?: string; error?: { message?: string } };

      if (!res.ok || !j.url) {
        // ⚠️ Kein stiller Fehlschlag: der Händler steht sonst wieder vor einer
        // Sackgasse, und das ist genau der Zustand, den diese Datei behebt.
        req.log.error({ status: res.status, err: j.error?.message }, 'stripe.rueckweg fehlgeschlagen');
        return reply.status(502).send(sackgasse('Wir konnten gerade keinen neuen erzeugen.'));
      }

      req.log.info({ accountId }, 'stripe.rueckweg: frischer Einrichtungslink erzeugt');
      return reply.redirect(j.url, 302);
    },
  );

  // ══════════════════════════════════════════════════════════════════════
  // GET /api/stripe/connect/fertig
  // ══════════════════════════════════════════════════════════════════════
  //
  // ⚠️ Stripe ruft das auf, SOBALD der Händler den Ablauf verlässt — auch dann,
  // wenn noch etwas fehlt. Die Seite darf deshalb NICHT „alles erledigt" sagen;
  // das ist eine Behauptung, die wir hier gar nicht prüfen können. Der wahre
  // Stand steht in `GET /api/stripe/connect/status`.
  app.get(
    '/api/stripe/connect/fertig',
    {
      schema: {
        tags: ['stripe'],
        summary: 'Landeseite nach der Stripe-Einrichtung.',
        security: [],
        hide: true,
      },
    },
    async (_req, reply) => {
      reply.header('content-type', 'text/html; charset=utf-8');
      return reply.send(fertigSeite());
    },
  );
};

export default stripeOnboardingRueckweg;
