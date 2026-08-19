/**
 * id-codec — Stripe-artige, undurchsichtige, präfigierte Kennungen über den
 * stabilen UUID-Primärschlüsseln (Audit 24.07.2026).
 *
 * WARUM
 * Alle Kern-Tabellen tragen `uuid gen_random_uuid()` — schon nicht erratbar.
 * Aber roh reisen sie über den Draht als bloße UUID, ohne zu sagen, WAS sie
 * kennzeichnen, und die menschlichen Nummern (CUST-2026-000034) sind fortlaufend
 * und verraten damit die Menge. Eine präfigierte Kennung wie `cus_9x8bV2…` ist
 * selbsterklärend, verrät keine Menge und ist eine reine FORMAT-Schicht: die
 * UUID bleibt der interne Schlüssel, unverändert.
 *
 * BEWUSST NUR AUF DEM SERVER
 * Der Server verschlüsselt beim AUSGANG und entschlüsselt beim EINGANG. Der
 * Client reicht die Zeichenkette nur unverändert zurück — er braucht KEINEN
 * Codec. Das macht die spätere Aktivierung zu einer Server-Sache ohne Flag-Day.
 *
 * NOCH NICHT VERDRAHTET (Basels „Infrastruktur bereit, auch bei Teilnutzung").
 * `toUuid()` akzeptiert ABSICHTLICH beide Formen — rohe UUID UND präfigiert —
 * damit der Eingang schon heute rückwärtskompatibel ist und der Ausgang später
 * ohne Bruch scharf geschaltet werden kann.
 *
 * Kodierung: die 16 Roh-Bytes der UUID in Crockford-Base32 (kleingeschrieben,
 * ohne Polster) = 26 Zeichen, URL-sicher, ohne verwechselbare Zeichen (i/l/o/u
 * fallen weg). Verlustfrei und umkehrbar.
 */

/** Die Präfixe je Entität. Kurz, sprechend, an Stripe angelehnt. */
export const ID_PREFIX = {
  customer: 'cus',
  shopper: 'shp',
  product: 'prod',
  order: 'ord', // carts in status RESERVED — die „Bestellung"
  cart: 'cart',
  transaction: 'tx',
  paymentIntent: 'pi',
  user: 'usr',
  device: 'dev',
  appraisal: 'apr',
  ticket: 'tic',
} as const;

export type EntityKind = keyof typeof ID_PREFIX;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Crockford-Base32-Alphabet (ohne i, l, o, u).
const B32 = '0123456789abcdefghjkmnpqrstvwxyz';
const B32_INDEX: Record<string, number> = {};
for (let i = 0; i < B32.length; i += 1) B32_INDEX[B32[i]!] = i;

/** Die 16 Roh-Bytes einer UUID. */
function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** 16 Bytes zurück in die kanonische UUID-Schreibweise. */
function bytesToUuid(bytes: Uint8Array): string {
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** 16 Bytes → 26 Base32-Zeichen (128 Bit / 5 = 25,6 → 26). */
function bytesToB32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** 26 Base32-Zeichen → 16 Bytes, oder null bei ungültigem Zeichen/Länge. */
function b32ToBytes(s: string): Uint8Array | null {
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of s) {
    const idx = B32_INDEX[ch];
    if (idx === undefined) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  if (out.length !== 16) return null;
  return Uint8Array.from(out);
}

/** Eine UUID in die präfigierte Form bringen: `cus_9x8bv2…`. */
export function encodeId(kind: EntityKind, uuid: string): string {
  if (!UUID_RE.test(uuid)) throw new Error(`id-codec: keine gültige UUID: ${uuid}`);
  return `${ID_PREFIX[kind]}_${bytesToB32(uuidToBytes(uuid))}`;
}

/**
 * Eine präfigierte Kennung zurück in die UUID — NUR wenn das Präfix zur
 * erwarteten Entität passt. Falsches Präfix (jemand schickt eine `cus_`, wo eine
 * `ord_` erwartet wird) → null, damit ein vertauschter Bezug nie durchrutscht.
 */
export function decodeId(kind: EntityKind, token: string): string | null {
  const prefix = `${ID_PREFIX[kind]}_`;
  if (!token.startsWith(prefix)) return null;
  const bytes = b32ToBytes(token.slice(prefix.length));
  return bytes ? bytesToUuid(bytes) : null;
}

/**
 * Der rückwärtskompatible EINGANG: akzeptiert BEIDE Formen. Ist der Wert schon
 * eine rohe UUID, wird sie durchgereicht (der heutige Draht); ist es die
 * präfigierte Form der erwarteten Entität, wird sie entschlüsselt. Sonst null.
 *
 * So kann der Ausgang später ohne Flag-Day scharf geschaltet werden: der
 * Eingang versteht ab sofort beides.
 */
export function toUuid(kind: EntityKind, value: string): string | null {
  if (UUID_RE.test(value)) return value.toLowerCase();
  return decodeId(kind, value);
}
