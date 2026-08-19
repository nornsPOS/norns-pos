/**
 * Kurztexte für Benachrichtigungen an die KUNDSCHAFT, in allen dreizehn
 * Sprachen des Shops.
 *
 * WARUM HIER UND NICHT IM SERVER
 * Dieselbe Sprachwahl wie beim Brief soll auch für die Benachrichtigung gelten:
 * wer den Laden auf Arabisch benutzt, bekommt seinen Ton auf Arabisch. Die
 * Briefe liegen schon hier (copy.ts), also gehört die kurze Schwester daneben,
 * damit es EINE Quelle für kundenzugewandten Text gibt und keine zweite, die
 * still auseinanderdriftet.
 *
 * Eine Benachrichtigung ist ein Anstoß, kein Dokument: kurz, ein Titel und ein
 * Satz. Der ausführliche Inhalt reist im Brief. Deshalb nur die Anlässe, die
 * den Menschen WIRKLICH erreichen müssen, weil sie eine Handlung oder eine
 * Frist tragen: angenommen, abholbereit, abgesagt — und die Frist selbst.
 *
 * WARUM DIE FRIST DAZUKAM (25.07.2026)
 * Eine Web-Reservierung hält die Ware drei Tage, danach gibt der Kehrer sie
 * frei. Gewarnt wurde bis dahin NUR per Brief, und wer als Gast keine E-Mail
 * hinterlassen hat, bekam gar nichts. Genau diesen Menschen zählt die
 * Vertrauensleiter danach als Nichtabholer und kann ihn sperren. Wer nie
 * gewarnt wurde, hat nichts versäumt; ihn dafür zu bestrafen ist der Fehler.
 * Hat er die App, erreicht ihn jetzt die Meldung, auch ohne E-Mail.
 *
 * Der Text sagt „in Kürze", nicht „morgen": der Job erinnert innerhalb der
 * letzten VIERUNDZWANZIG Stunden, also kann die Frist auch in zwei Stunden
 * enden. „Morgen" wäre dann schlicht gelogen.
 *
 * Deutsch ist die Rückfallsprache. Eine unbekannte Sprache liest sich als
 * Deutsch, nie als Leere.
 */
import { normalizeEmailLocale, type EmailLocale } from './copy.js';

/** Die Anlässe, die den Kunden von sich aus erreichen. */
export type CustomerPushKind =
  | 'order_accepted'
  | 'order_ready'
  | 'order_cancelled'
  | 'reservation_expiring';

export interface PushCopy {
  title: string;
  /** `ref` ist die Bestellnummer (BST-…). Sie steht IM Text, damit die
   *  Benachrichtigung auch ohne Öffnen der App etwas sagt. */
  body: (ref: string) => string;
}

type PushTable = Record<CustomerPushKind, PushCopy>;

/**
 * Die Tabellen. Bewusst knapp und in der Aussage identisch über alle Sprachen:
 * „angenommen / bereit zur Abholung / leider abgesagt" plus die Nummer.
 */
const PUSH: Record<EmailLocale, PushTable> = {
  de: {
    order_accepted: { title: 'Bestellung angenommen', body: (r) => `Wir bereiten Ihre Bestellung ${r} vor.` },
    order_ready: { title: 'Zur Abholung bereit', body: (r) => `Ihre Bestellung ${r} liegt im Geschäft für Sie bereit.` },
    order_cancelled: { title: 'Bestellung abgesagt', body: (r) => `Ihre Bestellung ${r} wurde storniert.` },
    reservation_expiring: { title: 'Reservierung läuft bald ab', body: (r) => `Ihre Reservierung ${r} läuft in Kürze ab. Bitte holen Sie sie im Geschäft ab.` },
  },
  en: {
    order_accepted: { title: 'Order accepted', body: (r) => `We are preparing your order ${r}.` },
    order_ready: { title: 'Ready for collection', body: (r) => `Your order ${r} is waiting for you in the shop.` },
    order_cancelled: { title: 'Order cancelled', body: (r) => `Your order ${r} has been cancelled.` },
    reservation_expiring: { title: 'Reservation expiring soon', body: (r) => `Your reservation ${r} expires shortly. Please collect it in the shop.` },
  },
  ar: {
    order_accepted: { title: 'تم قبول الطلب', body: (r) => `نُجهّز طلبك ${r}.` },
    order_ready: { title: 'جاهز للاستلام', body: (r) => `طلبك ${r} بانتظارك في المتجر.` },
    order_cancelled: { title: 'أُلغي الطلب', body: (r) => `تم إلغاء طلبك ${r}.` },
    reservation_expiring: { title: 'الحجز على وشك الانتهاء', body: (r) => `حجزك ${r} سينتهي قريباً. الرجاء استلامه من المتجر.` },
  },
  tr: {
    order_accepted: { title: 'Sipariş kabul edildi', body: (r) => `${r} numaralı siparişinizi hazırlıyoruz.` },
    order_ready: { title: 'Teslim almaya hazır', body: (r) => `${r} numaralı siparişiniz mağazada sizi bekliyor.` },
    order_cancelled: { title: 'Sipariş iptal edildi', body: (r) => `${r} numaralı siparişiniz iptal edildi.` },
    reservation_expiring: { title: 'Rezervasyon yakında sona eriyor', body: (r) => `${r} numaralı rezervasyonunuz yakında sona eriyor. Lütfen mağazadan teslim alın.` },
  },
  fr: {
    order_accepted: { title: 'Commande acceptée', body: (r) => `Nous préparons votre commande ${r}.` },
    order_ready: { title: 'Prête à être retirée', body: (r) => `Votre commande ${r} vous attend en boutique.` },
    order_cancelled: { title: 'Commande annulée', body: (r) => `Votre commande ${r} a été annulée.` },
    reservation_expiring: { title: 'Réservation bientôt expirée', body: (r) => `Votre réservation ${r} expire bientôt. Merci de la retirer en boutique.` },
  },
  es: {
    order_accepted: { title: 'Pedido aceptado', body: (r) => `Estamos preparando su pedido ${r}.` },
    order_ready: { title: 'Listo para recoger', body: (r) => `Su pedido ${r} le espera en la tienda.` },
    order_cancelled: { title: 'Pedido cancelado', body: (r) => `Su pedido ${r} ha sido cancelado.` },
    reservation_expiring: { title: 'La reserva caduca pronto', body: (r) => `Su reserva ${r} caduca en breve. Por favor, recójala en la tienda.` },
  },
  it: {
    order_accepted: { title: 'Ordine accettato', body: (r) => `Stiamo preparando il suo ordine ${r}.` },
    order_ready: { title: 'Pronto per il ritiro', body: (r) => `Il suo ordine ${r} la attende in negozio.` },
    order_cancelled: { title: 'Ordine annullato', body: (r) => `Il suo ordine ${r} è stato annullato.` },
    reservation_expiring: { title: 'La prenotazione sta per scadere', body: (r) => `La sua prenotazione ${r} scade a breve. La ritiri in negozio, per favore.` },
  },
  nl: {
    order_accepted: { title: 'Bestelling geaccepteerd', body: (r) => `We bereiden uw bestelling ${r} voor.` },
    order_ready: { title: 'Klaar om af te halen', body: (r) => `Uw bestelling ${r} ligt voor u klaar in de winkel.` },
    order_cancelled: { title: 'Bestelling geannuleerd', body: (r) => `Uw bestelling ${r} is geannuleerd.` },
    reservation_expiring: { title: 'Reservering verloopt binnenkort', body: (r) => `Uw reservering ${r} verloopt binnenkort. Haal deze op in de winkel.` },
  },
  pl: {
    order_accepted: { title: 'Zamówienie przyjęte', body: (r) => `Przygotowujemy Twoje zamówienie ${r}.` },
    order_ready: { title: 'Gotowe do odbioru', body: (r) => `Twoje zamówienie ${r} czeka na Ciebie w sklepie.` },
    order_cancelled: { title: 'Zamówienie anulowane', body: (r) => `Twoje zamówienie ${r} zostało anulowane.` },
    reservation_expiring: { title: 'Rezerwacja wkrótce wygaśnie', body: (r) => `Twoja rezerwacja ${r} wkrótce wygaśnie. Prosimy o odbiór w sklepie.` },
  },
  pt: {
    order_accepted: { title: 'Encomenda aceite', body: (r) => `Estamos a preparar a sua encomenda ${r}.` },
    order_ready: { title: 'Pronta para levantamento', body: (r) => `A sua encomenda ${r} aguarda por si na loja.` },
    order_cancelled: { title: 'Encomenda cancelada', body: (r) => `A sua encomenda ${r} foi cancelada.` },
    reservation_expiring: { title: 'A reserva expira em breve', body: (r) => `A sua reserva ${r} expira em breve. Levante-a na loja, por favor.` },
  },
  da: {
    order_accepted: { title: 'Ordre accepteret', body: (r) => `Vi forbereder din ordre ${r}.` },
    order_ready: { title: 'Klar til afhentning', body: (r) => `Din ordre ${r} venter på dig i butikken.` },
    order_cancelled: { title: 'Ordre annulleret', body: (r) => `Din ordre ${r} er blevet annulleret.` },
    reservation_expiring: { title: 'Reservationen udløber snart', body: (r) => `Din reservation ${r} udløber snart. Hent den venligst i butikken.` },
  },
  sv: {
    order_accepted: { title: 'Beställning accepterad', body: (r) => `Vi förbereder din beställning ${r}.` },
    order_ready: { title: 'Klar för upphämtning', body: (r) => `Din beställning ${r} väntar på dig i butiken.` },
    order_cancelled: { title: 'Beställning avbruten', body: (r) => `Din beställning ${r} har avbrutits.` },
    reservation_expiring: { title: 'Reservationen går snart ut', body: (r) => `Din reservation ${r} går snart ut. Hämta den gärna i butiken.` },
  },
  uk: {
    order_accepted: { title: 'Замовлення прийнято', body: (r) => `Ми готуємо ваше замовлення ${r}.` },
    order_ready: { title: 'Готове до отримання', body: (r) => `Ваше замовлення ${r} чекає на вас у магазині.` },
    order_cancelled: { title: 'Замовлення скасовано', body: (r) => `Ваше замовлення ${r} було скасовано.` },
    reservation_expiring: { title: 'Бронювання скоро спливе', body: (r) => `Ваше бронювання ${r} скоро спливе. Будь ласка, заберіть його в магазині.` },
  },
};

/**
 * Den Kurztext für einen Anlass in der Sprache des Menschen holen. Unbekanntes
 * fällt auf Deutsch — nie auf Leere.
 */
export function customerPushCopy(kind: CustomerPushKind, locale: string | null | undefined): {
  title: string;
  body: string;
  ref: (orderNumber: string) => { title: string; body: string };
} {
  const table = PUSH[normalizeEmailLocale(locale)];
  const c = table[kind];
  return {
    title: c.title,
    body: c.body(''),
    ref: (orderNumber: string) => ({ title: c.title, body: c.body(orderNumber) }),
  };
}
