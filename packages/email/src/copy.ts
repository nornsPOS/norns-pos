/**
 * email-copy — every transactional email, in the customer's own language.
 *
 * THE GAP THIS CLOSES: a shopper could read the whole app in Turkish, reserve
 * a piece, and then receive a GERMAN email carrying the one thing they must
 * act on, the pickup number. The app spoke thirteen languages; the letters it
 * sent spoke one.
 *
 * Why a static table and not the translation cache: the set of emails is
 * FIXED and known at build time, exactly like the metal and Erhaltung facets.
 * Product text goes through the model because the owner writes it at runtime;
 * a welcome letter does not. Static copy is also the only responsible choice
 * here, since an email must never wait on a model call inside a checkout
 * transaction, and a transactional letter may not be paraphrased on the fly.
 *
 * Discipline:
 *   • The interface is exhaustive, so tsc refuses a locale that is missing a
 *     phrase. That is the parity gate, enforced by the compiler.
 *   • Each language keeps the POLITENESS REGISTER the app already uses (formal
 *     Sie in German, vous in French, siz in Turkish, informal du in Danish and
 *     Swedish, je in Dutch), and the app's own words for a piece and for
 *     reserving. The letter must sound like the same shop as the screen.
 *   • Plural rules are real, not naive: Arabic has a dual, Polish and
 *     Ukrainian have a few-versus-many form, Turkish and Swedish take no
 *     plural after a numeral.
 *   • Numbers, the reservation reference and the amount are never translated.
 *   • Anything not translated falls back to German rather than to a blank.
 */

/** The thirteen languages the storefront ships. German is the source. */
export const EMAIL_LOCALES = [
  'de', 'en', 'ar', 'tr', 'fr', 'es', 'it', 'nl', 'pl', 'pt', 'da', 'sv', 'uk',
] as const;

export type EmailLocale = (typeof EMAIL_LOCALES)[number];

/**
 * The languages LETTERS are written in — ALL THIRTEEN the storefront ships.
 *
 * BASELS ENTSCHEIDUNG, 24.07.2026
 * „اي عمليه تصير بلغة عربية يوصل ايميل للزبون بلغته العربيه وهاكذا على جميع
 * الغات بشكل تلقائي بدون تدخل" — wer den Laden auf Arabisch benutzt, soll
 * seinen Brief auf Arabisch bekommen, und so für jede Sprache.
 *
 * Bis heute waren die Briefe auf Deutsch und Englisch beschränkt, obwohl die
 * vollständigen Tabellen für alle dreizehn Sprachen längst unten stehen. Die
 * Beschränkung war eine einzige Engstelle, kein Übersetzungsmangel. Sie ist
 * jetzt aufgehoben: der Brief folgt der GESPEICHERTEN Wahl des Menschen.
 *
 * Deutsch bleibt die Vertragssprache, und jeder nicht-deutsche Brief sagt das
 * mit einer Zeile (`courtesyNote`). Ein Geschäftsbrief, der laut am Tresen
 * vorgelesen oder dem Steuerberater weitergereicht wird, trägt also weiter die
 * verbindliche deutsche Grundlage in sich — nur eben in der Sprache, die der
 * Empfänger versteht.
 */
export const MAIL_LOCALES = EMAIL_LOCALES;
export type MailLocale = EmailLocale;

/**
 * Best language guess from the browser or app's Accept Language header. Used
 * ONLY for readers who have not stored a preference, above all guests, who
 * reserve without ever creating an account. A stored preference is a choice
 * and always outranks this.
 *
 * Trifft eine Sprache, die der Laden führt, wird sie GENOMMEN — nicht mehr auf
 * Englisch zusammengefaltet. Nur Unbekanntes fällt auf Deutsch zurück.
 */
export function localeFromAcceptLanguage(header: string | string[] | undefined): EmailLocale {
  const raw = Array.isArray(header) ? header[0] : header;
  // Absent tells us nothing, so it reads as the shop's own language rather
  // than as "foreign".
  if (!raw) return 'de';
  // "tr-TR,tr;q=0.9,en;q=0.8" — take tags in order, first one we ship wins.
  for (const part of raw.split(',')) {
    const tag = part.split(';')[0]?.trim() ?? '';
    const code = tag.slice(0, 2).toLowerCase();
    if ((EMAIL_LOCALES as readonly string[]).includes(code)) return code as EmailLocale;
  }
  return 'de';
}

/**
 * Die gespeicherte Sprachwahl eines Menschen auf eine Briefsprache abbilden.
 * Führt der Laden die Sprache, wird sie genommen; alles Unbekannte, Fehlende
 * oder Verstümmelte liest sich als Deutsch, die Haussprache.
 *
 * Frühere Fassung faltete `ar`/`tr`/… auf Englisch — genau das war der Bug,
 * den Basel gemeldet hat. Jetzt bleibt `ar` `ar`.
 */
export function normalizeEmailLocale(raw: string | null | undefined): EmailLocale {
  const code = (raw ?? '').trim().slice(0, 2).toLowerCase();
  if (!code) return 'de';
  return (EMAIL_LOCALES as readonly string[]).includes(code) ? (code as EmailLocale) : 'de';
}

export interface EmailCopy {
  /** Text direction of the HTML body. Only Arabic reads right to left. */
  dir: 'ltr' | 'rtl';
  /** Line under the wordmark. */
  tagline: string;
  /** Who operates the shop, for the footer of a business letter. */
  operatorLine: string;
  /** Non German letters say plainly that German governs the contract. */
  courtesyNote: string | null;
  /**
   * When the shop is actually open. This is not decoration: the reservation
   * letter says we hold the piece for three days, and three days that fall
   * across a weekend are worthless if the reader does not know the shop is
   * shut. Telling someone to collect without telling them when they can is
   * how a held piece quietly becomes a lapsed one.
   */
  openingHoursLabel: string;
  openingHours: string;

  greetNamed: (name: string) => string;
  greetPlain: string;

  welcomeSubject: string;
  welcomeLead: string;
  welcomeBody: string;
  welcomeClose: string;

  reservationSubject: (ref: string) => string;
  /** "one piece" / "3 pieces", in the language's real plural rule. */
  pieces: (n: number) => string;
  reservationLead: (pieces: string) => string;
  /**
   * Ueberschrift ueber der Liste der zurueckgelegten Stuecke.
   *
   * Bis zum 25.07.2026 nannte die Bestaetigung nur eine ANZAHL („2 Stuecke").
   * In einem Haus, das Einzelstuecke verkauft, ist das die duennste
   * moegliche Auskunft: der Mensch weiss nicht, ob die Muenze oder die
   * Marke gehalten wird, und kann einen Fehler nicht erkennen.
   */
  /**
   * „Grund" — die Ueberschrift ueber der Begruendung einer Absage.
   *
   * Bis zum 25.07.2026 nannte der Absagebrief KEINEN Grund, obwohl das
   * Personal beim Ablehnen einen eintippt, er in der Datenbank steht und
   * die App ihn anzeigt. Der Mensch im Postfach erfuhr also nur, dass
   * abgesagt wurde, und musste raten. Wer absagt, schuldet eine
   * Begruendung.
   */
  cancelReasonLabel: string;
  reservedItemsLabel: string;
  /** „Abholen bis" — die Frist gehoert auf den Abschnitt, nicht in den Fliesstext. */
  pickupByLabel: string;
  refLabel: string;
  totalLabel: string;
  euro: string;
  reservationClose: string;

  /**
   * Die Nummer gehört IN die Betreffzeile. Ohne sie las sich die Absage als
   * „Reservierung storniert" ohne jeden Anhalt: wer zwei Reservierungen
   * hatte, konnte im Postfach nicht sehen, welche gemeint war, und musste
   * den Brief öffnen, um eine Frage zu beantworten, die die Betreffzeile
   * hätte beantworten können.
   */
  cancelledSubject: (ref: string) => string;
  cancelledLead: (ref: string) => string;
  cancelledClose: string;

  /**
   * „Ihr Stück liegt bereit." Der wichtigste Brief des Abholmodells: er ist das
   * Einzige, das der Kundschaft sagt, dass sie kommen kann. Ohne ihn wartet ein
   * Mensch zu Hause auf ein Zeichen, das nie kommt, während sein Stück am Tresen
   * liegt.
   */
  readySubject: (ref: string) => string;
  readyLead: string;
  readyClose: string;

  /**
   * Die Erinnerung vor Fristablauf. Ohne sie verfällt eine Reservierung
   * stillschweigend: der Mensch denkt, er habe noch Zeit, und findet sein
   * Stück beim nächsten Besuch im Regal eines anderen. Ein Brief, drei Zeilen,
   * und die Frist steht als Datum darin, nicht als „bald".
   */
  expiryReminderSubject: (ref: string) => string;
  expiryReminderLead: (deadline: string) => string;
  expiryReminderClose: string;
  /**
   * Die Frist ist verstrichen. Bis heute erfuhr der Mensch das NIE: die Stücke
   * gingen zurück in den Verkauf, die Vertrauensleiter zählte ein Nichterscheinen
   * gegen ihn, und er plante womöglich noch, am Samstag zu kommen. Der Ton ist
   * bewusst nicht strafend, und der Schluss nennt den WEG: erneut reservieren,
   * oder schreiben, denn das Haus kann eine Frist verlängern.
   */
  expiredSubject: (ref: string) => string;
  expiredLead: string;
  expiredClose: string;

  /**
   * „Wir haben Ihre Reservierung angenommen." Der Brief, den die Kundschaft
   * zwischen dem Reservieren und dem Bereitliegen als EINZIGEN bekommt: er
   * sagt, dass ein Mensch den Beleg gesehen und zugesagt hat. Der interne
   * Schritt „in Vorbereitung" bleibt still, denn für den Leser ändert er
   * nichts.
   */
  acceptedSubject: (ref: string) => string;
  acceptedLead: string;
  acceptedClose: string;

  /** Warum eine Bestellung abgelehnt wurde, wenn ein Grund genannt wurde. */
  declinedReasonLabel: string;

  /**
   * „Ein Stück ist aus Ihrer Reservierung herausgenommen worden."
   *
   * Muss geschrieben werden, sobald jemand eine Position entfernt: was die
   * Kundschaft abholt und was sie zahlt, ändert sich dadurch. Es stillschweigend
   * zu tun hiesse, sie am Tresen überraschen zu lassen.
   */
  itemRemovedSubject: (ref: string) => string;
  itemRemovedLead: (stueck: string) => string;
  itemRemovedRemaining: (anzahl: number) => string;
  itemRemovedClose: string;

  /**
   * „Ihre Abholfrist ist verlängert worden." Die gute Nachricht: wer anruft und
   * sagt, er kommt erst Samstag, bekommt schriftlich das neue Datum statt eines
   * Versprechens am Telefon, an das sich niemand erinnert.
   */
  deadlineExtendedSubject: (ref: string) => string;
  deadlineExtendedLead: (deadline: string) => string;
  deadlineExtendedClose: string;
}

const BRAND = 'Warehouse 14';
const ADDRESS = 'Rosenstraße 40, 73614 Schorndorf';
const OPERATOR = 'Briefmarken To-Go (stampscoins)';

/**
 * The signature, as DATA rather than as a sentence.
 *
 * Split into parts so the letter can make each one do its job on a phone: the
 * number dials, the address opens a map, the mailbox composes a reply. A
 * signature the reader has to copy by hand is a signature that gets a phone
 * call to the wrong shop.
 *
 * `email` MUST match the address the letter is sent from, or it invites a
 * reply to one place and signs off with another.
 */
export const SHOP = {
  brand: BRAND,
  operator: OPERATOR,
  street: 'Rosenstraße 40',
  city: '73614 Schorndorf',
  /** E.164 for the dial link; humans see the spaced form below. */
  phoneDial: '+4971819647511',
  phoneHuman: '+49 7181 9647511',
  email: 'bestellung@warehouse14.de',
  vatId: 'DE343451090',
  mapUrl: 'https://maps.google.com/?q=Rosenstra%C3%9Fe+40,+73614+Schorndorf',
} as const;

/**
 * Legacy single-line contact block. Still the plain-text signature, where
 * nothing is tappable and one honest line beats three.
 */
export const EMAIL_CONTACT_LINE =
  'Telefon +49 7181 9647511, bestellung@warehouse14.de, USt IdNr DE343451090';

const COPY: Record<EmailLocale, EmailCopy> = {
  de: {
    dir: 'ltr',
    tagline: 'Edelmetalle und Sammlerstücke',
    operatorLine: `${BRAND}, ein Angebot von ${OPERATOR}, ${ADDRESS}`,
    courtesyNote: null,
    openingHoursLabel: 'Öffnungszeiten',
    openingHours: 'Mo bis Do 15:00 bis 18:30, Fr 15:00 bis 19:00',
    greetNamed: (n) => `Guten Tag ${n},`,
    greetPlain: 'Guten Tag,',
    welcomeSubject: `Willkommen bei ${BRAND}`,
    welcomeLead: `herzlich willkommen bei ${BRAND}. Ihr Konto ist eingerichtet.`,
    welcomeBody:
      'Sie können ab sofort unsere Stücke durchstöbern, Favoriten merken und Reservierungen ' +
      'zur Abholung im Geschäft aufgeben. Jedes Stück ist ein Einzelstück, geprüft und kuratiert.',
    welcomeClose: 'Wir freuen uns auf Ihren Besuch.',
    reservationSubject: (ref) => `Ihre Reservierung ${ref} bei ${BRAND}`,
    pieces: (n) => (n === 1 ? 'ein Stück' : `${n} Stücke`),
    reservationLead: (p) =>
      `Ihre Reservierung ist eingegangen. Wir legen ${p} drei Tage im Geschäft für Sie zurück.`,
    cancelReasonLabel: 'Grund',
    reservedItemsLabel: 'Zurückgelegt für Sie',
    pickupByLabel: 'Abholen bis',
    refLabel: 'Reservierungsnummer',
    totalLabel: 'Gesamtwert',
    euro: 'Euro',
    reservationClose:
      'Bitte nennen Sie die Reservierungsnummer bei der Abholung im Geschäft. ' +
      'Bezahlt wird bequem vor Ort.',
    cancelledSubject: (ref) => `Reservierung storniert, ${BRAND}, ${ref}`,
    cancelledLead: (ref) =>
      `Ihre Reservierung ${ref} wurde storniert. Die Stücke sind wieder frei verfügbar.`,
    cancelledClose: 'Sie können jederzeit erneut reservieren. Wir sind gern für Sie da.',
    readySubject: (ref) => `Ihre Bestellung ${ref} liegt zur Abholung bereit`,
    readyLead: 'Ihre Stücke sind vorbereitet und liegen jetzt im Geschäft für Sie bereit. Kommen Sie zu unseren Öffnungszeiten vorbei; bezahlt wird bequem vor Ort.',
    readyClose: 'Bitte nennen Sie die Reservierungsnummer bei der Abholung. Wir freuen uns auf Ihren Besuch.',
    expiryReminderSubject: (ref) => `Ihre Reservierung ${ref} läuft bald ab`,
    expiryReminderLead: (deadline) => `Ihre Reservierung wartet noch im Geschäft. Wir halten die Stücke bis ${deadline} für Sie zurück; danach gehen sie zurück in den Verkauf.`,
    expiryReminderClose: 'Wenn Sie es zeitlich nicht schaffen, schreiben Sie uns kurz. Wir finden eine Lösung.',
    expiredSubject: (ref) => `Ihre Reservierung ${ref} ist abgelaufen`,
    expiredLead: 'Die Frist ist verstrichen, und die Stücke sind zurück in den Verkauf gegangen. Wir haben sie so lange zurückgehalten, wie wir konnten.',
    expiredClose: 'Sind sie noch da, reservieren Sie gern erneut. Und wenn etwas dazwischengekommen ist: schreiben Sie uns einfach. Wir halten auch länger zurück, wenn wir davon wissen.',
    acceptedSubject: (ref) => `Ihre Reservierung ${ref} ist angenommen`,
    acceptedLead: 'Wir haben Ihre Reservierung geprüft und angenommen. Die Stücke sind für Sie zurückgelegt; wir bereiten sie vor und melden uns, sobald sie abholbereit sind.',
    acceptedClose: 'Sie müssen nichts weiter tun. Wir schreiben Ihnen wieder, wenn alles bereit liegt.',
    declinedReasonLabel: 'Grund',
    itemRemovedSubject: (ref) => `Ihre Reservierung ${ref} wurde geändert`,
    itemRemovedLead: (stueck) =>
      `wir mussten ein Stück aus Ihrer Reservierung nehmen: ${stueck}.`,
    itemRemovedRemaining: (anzahl) =>
      anzahl === 1
        ? 'Ein Stück bleibt für Sie reserviert.'
        : `${anzahl} Stücke bleiben für Sie reserviert.`,
    itemRemovedClose: 'Der Betrag beim Abholen ändert sich entsprechend.',
    deadlineExtendedSubject: (ref) => `Mehr Zeit für Ihre Reservierung ${ref}`,
    deadlineExtendedLead: (deadline) =>
      `wir haben Ihre Abholfrist verlängert. Neuer Termin: ${deadline}.`,
    deadlineExtendedClose: 'Ihre Stücke bleiben bis dahin für Sie zurückgelegt.',
  },

  en: {
    dir: 'ltr',
    tagline: 'Precious metals and collectibles',
    operatorLine: `${BRAND}, operated by ${OPERATOR}, ${ADDRESS}, Germany`,
    courtesyNote: 'This message is a courtesy translation. The contract language is German.',
    openingHoursLabel: 'Opening hours',
    openingHours: 'Mon to Thu 15:00 to 18:30, Fri 15:00 to 19:00',
    greetNamed: (n) => `Hello ${n},`,
    greetPlain: 'Hello,',
    welcomeSubject: `Welcome to ${BRAND}`,
    welcomeLead: `Welcome to ${BRAND}. Your account is ready.`,
    welcomeBody:
      'From now on you can browse our pieces, keep favourites and reserve them for pickup ' +
      'in the shop. Every piece is one of a kind, checked and curated.',
    welcomeClose: 'We look forward to your visit.',
    reservationSubject: (ref) => `Your reservation ${ref} at ${BRAND}`,
    pieces: (n) => (n === 1 ? 'one piece' : `${n} pieces`),
    reservationLead: (p) =>
      `We have your reservation. We hold ${p} in the shop for three days.`,
    cancelReasonLabel: 'Reason',
    reservedItemsLabel: 'Held for you',
    pickupByLabel: 'Collect by',
    refLabel: 'Reservation number',
    totalLabel: 'Total value',
    euro: 'Euro',
    reservationClose:
      'Please give the reservation number when you pick up in the shop. ' +
      'You simply pay on the spot.',
    cancelledSubject: (ref) => `Reservation cancelled, ${BRAND}, ${ref}`,
    cancelledLead: (ref) =>
      `Your reservation ${ref} has been cancelled. The pieces are available again.`,
    cancelledClose: 'You can reserve again at any time. We are glad to help.',
    readySubject: (ref) => `Your order ${ref} is ready for collection`,
    readyLead: 'Your pieces are prepared and now waiting for you in the shop. Come by during our opening hours; you pay comfortably on site.',
    readyClose: 'Please mention the reservation number when you collect. We look forward to your visit.',
    expiryReminderSubject: (ref) => `Your reservation ${ref} expires soon`,
    expiryReminderLead: (deadline) => `Your reservation is still waiting at the shop. We are holding the pieces for you until ${deadline}; after that they return to the shelf.`,
    expiryReminderClose: 'If you cannot make it in time, just write to us. We will find a way.',
    expiredSubject: (ref) => `Your reservation ${ref} has expired`,
    expiredLead: 'The deadline has passed and the pieces have gone back on sale. We held them as long as we could.',
    expiredClose: 'If they are still available, you are welcome to reserve again. And if something came up, just write to us: we will hold longer when we know about it.',
    acceptedSubject: (ref) => `Your reservation ${ref} is accepted`,
    acceptedLead: 'We have reviewed your reservation and accepted it. The pieces are set aside for you; we are preparing them and will write again as soon as they are ready for collection.',
    acceptedClose: 'There is nothing further for you to do. We will write again once everything is ready.',
    declinedReasonLabel: 'Reason',
    itemRemovedSubject: (ref) => `Your reservation ${ref} has changed`,
    itemRemovedLead: (stueck) =>
      `we had to take one piece out of your reservation: ${stueck}.`,
    itemRemovedRemaining: (anzahl) =>
      anzahl === 1
        ? 'One piece stays reserved for you.'
        : `${anzahl} pieces stay reserved for you.`,
    itemRemovedClose: 'The amount due at pickup changes accordingly.',
    deadlineExtendedSubject: (ref) => `More time for your reservation ${ref}`,
    deadlineExtendedLead: (deadline) =>
      `we have extended your pickup deadline. New date: ${deadline}.`,
    deadlineExtendedClose: 'Your pieces stay set aside for you until then.',
  },

  ar: {
    dir: 'rtl',
    tagline: 'معادن ثمينة وقطع للمقتنين',
    operatorLine: `${BRAND}، يديره ${OPERATOR}، ${ADDRESS}، ألمانيا`,
    courtesyNote: 'هذه الرسالة ترجمة للتيسير. لغة التعاقد هي الألمانية.',
    openingHoursLabel: 'ساعات العمل',
    openingHours: 'الاثنين إلى الخميس 15:00 حتى 18:30، الجمعة 15:00 حتى 19:00',
    greetNamed: (n) => `مرحباً ${n}،`,
    greetPlain: 'مرحباً،',
    welcomeSubject: `أهلاً بك في ${BRAND}`,
    welcomeLead: `أهلاً بك في ${BRAND}. حسابك جاهز.`,
    welcomeBody:
      'يمكنك من الآن تصفح قطعنا وحفظ ما يعجبك في المفضلة وحجز ما تريد لاستلامه من المتجر. ' +
      'كل قطعة فريدة، مفحوصة ومختارة بعناية.',
    welcomeClose: 'نتطلع إلى زيارتك.',
    reservationSubject: (ref) => `حجزك ${ref} لدى ${BRAND}`,
    pieces: (n) => {
      if (n === 1) return 'قطعة واحدة';
      if (n === 2) return 'قطعتين';
      if (n <= 10) return `${n} قطع`;
      return `${n} قطعة`;
    },
    reservationLead: (p) => `وصلنا حجزك. نحتفظ لك بـ ${p} في المتجر لمدة ثلاثة أيام.`,
    cancelReasonLabel: 'السبب',
    reservedItemsLabel: 'محجوز لك',
    pickupByLabel: 'الاستلام قبل',
    refLabel: 'رقم الحجز',
    totalLabel: 'القيمة الإجمالية',
    euro: 'يورو',
    reservationClose:
      'يرجى ذكر رقم الحجز عند الاستلام من المتجر. الدفع يتم بكل راحة عند الاستلام.',
    cancelledSubject: (ref) => `تم إلغاء الحجز، ${BRAND}, ${ref}`,
    cancelledLead: (ref) => `تم إلغاء حجزك ${ref}. القطع متاحة من جديد.`,
    cancelledClose: 'يمكنك الحجز مجدداً في أي وقت. نحن هنا من أجلك.',
    readySubject: (ref) => `طلبك ${ref} جاهز للاستلام`,
    readyLead: 'قطعك جاهزة وبانتظارك الآن في المحل. تفضل بالمرور خلال ساعات العمل، والدفع يتم بسهولة في المحل.',
    readyClose: 'يرجى ذكر رقم الحجز عند الاستلام. يسعدنا زيارتك.',
    expiryReminderSubject: (ref) => `حجزك ${ref} على وشك الانتهاء`,
    expiryReminderLead: (deadline) => `حجزك ما زال بانتظارك في المحل. نحتفظ بالقطع لك حتى ${deadline}، وبعدها تعود إلى العرض.`,
    expiryReminderClose: 'إن تعذّر عليك الحضور في الوقت المحدد، راسلنا وسنجد حلاً.',
    expiredSubject: (ref) => `انتهت مهلة حجزك ${ref}`,
    expiredLead: 'انقضت المهلة وعادت القطع إلى العرض. احتفظنا بها لك أطول ما استطعنا.',
    expiredClose: 'إن كانت ما زالت متوفرة، يسعدنا أن تحجزها من جديد. وإن طرأ ما منعك، راسلنا فحسب: نحتفظ بها مدة أطول متى عرفنا بذلك.',
    acceptedSubject: (ref) => `تم قبول حجزك ${ref}`,
    acceptedLead: 'راجعنا حجزك وقبلناه. القطع محجوزة لك، ونحن نُجهّزها وسنكتب إليك حالما تصبح جاهزة للاستلام.',
    acceptedClose: 'لا يلزمك فعل شيء الآن. سنكتب إليك مرة أخرى عندما يصبح كل شيء جاهزاً.',
    declinedReasonLabel: 'السبب',
    itemRemovedSubject: (ref) => `تغيّر حجزك ${ref}`,
    itemRemovedLead: (stueck) => `اضطررنا لإخراج قطعة من حجزك: ${stueck}.`,
    itemRemovedRemaining: (anzahl) =>
      anzahl === 1 ? 'تبقى لك قطعة واحدة محجوزة.' : `تبقى لك ${anzahl} قطع محجوزة.`,
    itemRemovedClose: 'يتغيّر المبلغ عند الاستلام تبعاً لذلك.',
    deadlineExtendedSubject: (ref) => `وقت إضافي لحجزك ${ref}`,
    deadlineExtendedLead: (deadline) => `مدّدنا مهلة الاستلام. الموعد الجديد: ${deadline}.`,
    deadlineExtendedClose: 'تبقى قطعك محفوظة لك حتى ذلك الحين.',
  },

  tr: {
    dir: 'ltr',
    tagline: 'Kıymetli madenler ve koleksiyon parçaları',
    operatorLine: `${BRAND}, ${OPERATOR} tarafından işletilmektedir, ${ADDRESS}, Almanya`,
    courtesyNote: 'Bu mesaj kolaylık olsun diye çevrilmiştir. Sözleşme dili Almancadır.',
    openingHoursLabel: 'Açılış saatleri',
    openingHours: 'Pzt ile Per 15:00 ile 18:30, Cum 15:00 ile 19:00',
    greetNamed: (n) => `Merhaba ${n},`,
    greetPlain: 'Merhaba,',
    welcomeSubject: `${BRAND} ailesine hoş geldiniz`,
    welcomeLead: `${BRAND} ailesine hoş geldiniz. Hesabınız hazır.`,
    welcomeBody:
      'Artık parçalarımıza göz atabilir, beğendiklerinizi kaydedebilir ve mağazadan teslim ' +
      'almak üzere rezerve edebilirsiniz. Her parça tektir, kontrol edilmiş ve özenle seçilmiştir.',
    welcomeClose: 'Ziyaretinizi dört gözle bekliyoruz.',
    reservationSubject: (ref) => `${BRAND} rezervasyonunuz ${ref}`,
    pieces: (n) => (n === 1 ? 'bir ürün' : `${n} ürün`),
    reservationLead: (p) =>
      `Rezervasyonunuz bize ulaştı. ${p} mağazada üç gün boyunca sizin için ayrılıyor.`,
    cancelReasonLabel: 'Gerekçe',
    reservedItemsLabel: 'Sizin için ayrıldı',
    pickupByLabel: 'Son teslim',
    refLabel: 'Rezervasyon numarası',
    totalLabel: 'Toplam değer',
    euro: 'euro',
    reservationClose:
      'Mağazadan teslim alırken rezervasyon numarasını söylemeniz yeterli. ' +
      'Ödemeyi orada rahatça yaparsınız.',
    cancelledSubject: (ref) => `Rezervasyon iptal edildi, ${BRAND}, ${ref}`,
    cancelledLead: (ref) =>
      `${ref} numaralı rezervasyonunuz iptal edildi. Parçalar yeniden satışa açık.`,
    cancelledClose: 'Dilediğiniz zaman yeniden rezerve edebilirsiniz. Her zaman buradayız.',
    readySubject: (ref) => `${ref} numaralı siparişiniz teslim almaya hazır`,
    readyLead: 'Parçalarınız hazırlandı ve şimdi mağazada sizi bekliyor. Çalışma saatlerimizde uğrayın; ödeme yerinde rahatça yapılır.',
    readyClose: 'Lütfen teslim alırken rezervasyon numarasını belirtin. Ziyaretinizi bekliyoruz.',
    expiryReminderSubject: (ref) => `${ref} numaralı rezervasyonunuzun süresi doluyor`,
    expiryReminderLead: (deadline) => `Rezervasyonunuz hâlâ dükkânda sizi bekliyor. Parçaları sizin için ${deadline} tarihine kadar ayırıyoruz; sonrasında yeniden satışa çıkıyorlar.`,
    expiryReminderClose: 'Zamanında gelemezseniz bize kısaca yazın. Bir çözüm buluruz.',
    expiredSubject: (ref) => `${ref} numaralı rezervasyonunuzun süresi doldu`,
    expiredLead: 'Süre doldu ve parçalar yeniden satışa çıktı. Onları elimizden geldiğince uzun süre sizin için ayırdık.',
    expiredClose: 'Hâlâ duruyorlarsa yeniden rezervasyon yapabilirsiniz. Bir aksilik çıktıysa bize yazmanız yeter: haberimiz olursa daha uzun süre ayırırız.',
    acceptedSubject: (ref) => `${ref} numaralı rezervasyonunuz kabul edildi`,
    acceptedLead: 'Rezervasyonunuzu inceledik ve kabul ettik. Parçalar sizin için ayrıldı; hazırlıyoruz ve teslim almaya hazır olur olmaz size tekrar yazacağız.',
    acceptedClose: 'Şimdilik yapmanız gereken bir şey yok. Her şey hazır olduğunda tekrar yazacağız.',
    declinedReasonLabel: 'Gerekçe',
    itemRemovedSubject: (ref) => `${ref} numaralı rezervasyonunuz değişti`,
    itemRemovedLead: (stueck) => `rezervasyonunuzdan bir parça çıkarmak zorunda kaldık: ${stueck}.`,
    itemRemovedRemaining: (anzahl) =>
      anzahl === 1 ? 'Bir parça sizin için ayrılmış kalıyor.' : `${anzahl} parça sizin için ayrılmış kalıyor.`,
    itemRemovedClose: 'Teslim alırken ödenecek tutar buna göre değişir.',
    deadlineExtendedSubject: (ref) => `${ref} rezervasyonunuz için ek süre`,
    deadlineExtendedLead: (deadline) => `teslim alma sürenizi uzattık. Yeni tarih: ${deadline}.`,
    deadlineExtendedClose: 'Parçalarınız o tarihe kadar sizin için ayrılmış kalır.',
  },

  fr: {
    dir: 'ltr',
    tagline: 'Métaux précieux et pièces de collection',
    operatorLine: `${BRAND}, exploité par ${OPERATOR}, ${ADDRESS}, Allemagne`,
    courtesyNote: "Ce message est une traduction de courtoisie. La langue du contrat est l'allemand.",
    openingHoursLabel: 'Horaires',
    openingHours: 'Lun à jeu 15:00 à 18:30, ven 15:00 à 19:00',
    greetNamed: (n) => `Bonjour ${n},`,
    greetPlain: 'Bonjour,',
    welcomeSubject: `Bienvenue chez ${BRAND}`,
    welcomeLead: `Bienvenue chez ${BRAND}. Votre compte est prêt.`,
    welcomeBody:
      'Vous pouvez dès maintenant parcourir nos pièces, garder vos favorites et les réserver ' +
      'pour un retrait en boutique. Chaque pièce est unique, vérifiée et choisie avec soin.',
    welcomeClose: 'Au plaisir de vous accueillir.',
    reservationSubject: (ref) => `Votre réservation ${ref} chez ${BRAND}`,
    pieces: (n) => (n === 1 ? 'une pièce' : `${n} pièces`),
    reservationLead: (p) =>
      `Nous avons bien reçu votre réservation. Nous gardons ${p} en boutique pendant trois jours.`,
    cancelReasonLabel: 'Motif',
    reservedItemsLabel: 'Mis de côté pour vous',
    pickupByLabel: 'À retirer avant le',
    refLabel: 'Numéro de réservation',
    totalLabel: 'Valeur totale',
    euro: 'euros',
    reservationClose:
      "Merci d'indiquer le numéro de réservation lors du retrait en boutique. " +
      'Le paiement se fait tranquillement sur place.',
    cancelledSubject: (ref) => `Réservation annulée, ${BRAND}, ${ref}`,
    cancelledLead: (ref) =>
      `Votre réservation ${ref} a été annulée. Les pièces sont de nouveau disponibles.`,
    cancelledClose:
      'Vous pouvez réserver à nouveau quand vous le souhaitez. Nous restons à votre disposition.',
    readySubject: (ref) => `Votre commande ${ref} est prête à être retirée`,
    readyLead: 'Vos pièces sont préparées et vous attendent désormais en boutique. Passez pendant nos horaires d’ouverture ; le paiement se fait sur place.',
    readyClose: 'Merci d’indiquer le numéro de réservation lors du retrait. Au plaisir de vous accueillir.',
    expiryReminderSubject: (ref) => `Votre réservation ${ref} expire bientôt`,
    expiryReminderLead: (deadline) => `Votre réservation vous attend toujours en boutique. Nous gardons les pièces pour vous jusqu'au ${deadline}; ensuite elles retournent à la vente.`,
    expiryReminderClose: 'Si vous ne pouvez pas venir à temps, écrivez-nous. Nous trouverons une solution.',
    expiredSubject: (ref) => `Votre réservation ${ref} a expiré`,
    expiredLead: 'Le délai est passé et les pièces sont retournées à la vente. Nous les avons gardées aussi longtemps que possible.',
    expiredClose: 'Si elles sont encore là, réservez à nouveau avec plaisir. Et si un imprévu est survenu, écrivez-nous simplement: nous gardons plus longtemps quand nous le savons.',
    acceptedSubject: (ref) => `Votre réservation ${ref} est acceptée`,
    acceptedLead: 'Nous avons examiné votre réservation et l’avons acceptée. Les pièces sont mises de côté pour vous; nous les préparons et vous écrirons dès qu’elles seront prêtes à être retirées.',
    acceptedClose: 'Vous n’avez rien d’autre à faire. Nous vous écrirons de nouveau lorsque tout sera prêt.',
    declinedReasonLabel: 'Motif',
    itemRemovedSubject: (ref) => `Votre réservation ${ref} a changé`,
    itemRemovedLead: (stueck) => `nous avons dû retirer une pièce de votre réservation : ${stueck}.`,
    itemRemovedRemaining: (anzahl) =>
      anzahl === 1 ? 'Une pièce reste réservée pour vous.' : `${anzahl} pièces restent réservées pour vous.`,
    itemRemovedClose: 'Le montant à régler au retrait change en conséquence.',
    deadlineExtendedSubject: (ref) => `Plus de temps pour votre réservation ${ref}`,
    deadlineExtendedLead: (deadline) => `nous avons prolongé votre délai de retrait. Nouvelle date : ${deadline}.`,
    deadlineExtendedClose: 'Vos pièces restent mises de côté pour vous jusque-là.',
  },

  es: {
    dir: 'ltr',
    tagline: 'Metales preciosos y piezas de colección',
    operatorLine: `${BRAND}, gestionado por ${OPERATOR}, ${ADDRESS}, Alemania`,
    courtesyNote:
      'Este mensaje es una traducción de cortesía. El idioma del contrato es el alemán.',
    openingHoursLabel: 'Horario',
    openingHours: 'Lun a jue 15:00 a 18:30, vie 15:00 a 19:00',
    greetNamed: (n) => `Hola ${n},`,
    greetPlain: 'Hola,',
    welcomeSubject: `Bienvenido a ${BRAND}`,
    welcomeLead: `Bienvenido a ${BRAND}. Tu cuenta ya está lista.`,
    welcomeBody:
      'Desde ahora puedes explorar nuestras piezas, guardar tus favoritas y reservarlas para ' +
      'recogerlas en la tienda. Cada pieza es única, revisada y elegida con cuidado.',
    welcomeClose: 'Te esperamos con mucho gusto.',
    reservationSubject: (ref) => `Tu reserva ${ref} en ${BRAND}`,
    pieces: (n) => (n === 1 ? 'una pieza' : `${n} piezas`),
    reservationLead: (p) =>
      `Hemos recibido tu reserva. Te guardamos ${p} en la tienda durante tres días.`,
    cancelReasonLabel: 'Motivo',
    reservedItemsLabel: 'Reservado para usted',
    pickupByLabel: 'Recoger antes del',
    refLabel: 'Número de reserva',
    totalLabel: 'Valor total',
    euro: 'euros',
    reservationClose:
      'Indica el número de reserva al recoger en la tienda. Pagas cómodamente allí mismo.',
    cancelledSubject: (ref) => `Reserva cancelada, ${BRAND}, ${ref}`,
    cancelledLead: (ref) =>
      `Tu reserva ${ref} ha sido cancelada. Las piezas vuelven a estar disponibles.`,
    cancelledClose: 'Puedes reservar de nuevo cuando quieras. Estamos a tu disposición.',
    readySubject: (ref) => `Su pedido ${ref} está listo para recoger`,
    readyLead: 'Sus piezas están preparadas y le esperan ahora en la tienda. Pásese durante nuestro horario; el pago se realiza cómodamente en el sitio.',
    readyClose: 'Indique el número de reserva al recoger. Esperamos su visita.',
    expiryReminderSubject: (ref) => `Su reserva ${ref} caduca pronto`,
    expiryReminderLead: (deadline) => `Su reserva sigue esperándole en la tienda. Guardamos las piezas para usted hasta el ${deadline}; después vuelven a la venta.`,
    expiryReminderClose: 'Si no puede venir a tiempo, escríbanos. Encontraremos una solución.',
    expiredSubject: (ref) => `Su reserva ${ref} ha caducado`,
    expiredLead: 'El plazo ha pasado y las piezas han vuelto a la venta. Las guardamos todo el tiempo que pudimos.',
    expiredClose: 'Si siguen disponibles, puede reservarlas de nuevo. Y si surgió algo, escríbanos sin más: guardamos más tiempo cuando lo sabemos.',
    acceptedSubject: (ref) => `Su reserva ${ref} está aceptada`,
    acceptedLead: 'Hemos revisado su reserva y la hemos aceptado. Las piezas están apartadas para usted; las estamos preparando y le escribiremos en cuanto estén listas para recoger.',
    acceptedClose: 'No tiene que hacer nada más. Le escribiremos de nuevo cuando todo esté listo.',
    declinedReasonLabel: 'Motivo',
    itemRemovedSubject: (ref) => `Su reserva ${ref} ha cambiado`,
    itemRemovedLead: (stueck) => `hemos tenido que retirar una pieza de su reserva: ${stueck}.`,
    itemRemovedRemaining: (anzahl) =>
      anzahl === 1 ? 'Una pieza sigue reservada para usted.' : `${anzahl} piezas siguen reservadas para usted.`,
    itemRemovedClose: 'El importe a pagar en la recogida cambia en consecuencia.',
    deadlineExtendedSubject: (ref) => `Más tiempo para su reserva ${ref}`,
    deadlineExtendedLead: (deadline) => `hemos ampliado su plazo de recogida. Nueva fecha: ${deadline}.`,
    deadlineExtendedClose: 'Sus piezas quedan apartadas para usted hasta entonces.',
  },

  it: {
    dir: 'ltr',
    tagline: 'Metalli preziosi e pezzi da collezione',
    operatorLine: `${BRAND}, gestito da ${OPERATOR}, ${ADDRESS}, Germania`,
    courtesyNote:
      'Questo messaggio è una traduzione di cortesia. La lingua del contratto è il tedesco.',
    openingHoursLabel: 'Orari di apertura',
    openingHours: 'Lun a gio 15:00 a 18:30, ven 15:00 a 19:00',
    greetNamed: (n) => `Buongiorno ${n},`,
    greetPlain: 'Buongiorno,',
    welcomeSubject: `Benvenuto da ${BRAND}`,
    welcomeLead: `Benvenuto da ${BRAND}. Il tuo account è pronto.`,
    welcomeBody:
      'Da ora puoi sfogliare i nostri pezzi, salvare i preferiti e prenotarli per il ritiro ' +
      'in negozio. Ogni pezzo è unico, verificato e scelto con cura.',
    welcomeClose: 'Ti aspettiamo volentieri.',
    reservationSubject: (ref) => `La tua prenotazione ${ref} da ${BRAND}`,
    pieces: (n) => (n === 1 ? 'un pezzo' : `${n} pezzi`),
    reservationLead: (p) =>
      `Abbiamo ricevuto la tua prenotazione. Teniamo ${p} in negozio per tre giorni.`,
    cancelReasonLabel: 'Motivo',
    reservedItemsLabel: 'Messo da parte per lei',
    pickupByLabel: 'Ritiro entro il',
    refLabel: 'Numero di prenotazione',
    totalLabel: 'Valore totale',
    euro: 'euro',
    reservationClose:
      'Basta indicare il numero di prenotazione al ritiro in negozio. Paghi con calma sul posto.',
    cancelledSubject: (ref) => `Prenotazione annullata, ${BRAND}, ${ref}`,
    cancelledLead: (ref) =>
      `La tua prenotazione ${ref} è stata annullata. I pezzi sono di nuovo disponibili.`,
    cancelledClose: 'Puoi prenotare di nuovo quando vuoi. Siamo sempre a disposizione.',
    readySubject: (ref) => `Il tuo ordine ${ref} è pronto per il ritiro`,
    readyLead: 'I tuoi pezzi sono pronti e ti aspettano ora in negozio. Passa durante i nostri orari; il pagamento avviene comodamente sul posto.',
    readyClose: 'Indica il numero di prenotazione al ritiro. Ti aspettiamo.',
    expiryReminderSubject: (ref) => `La tua prenotazione ${ref} sta per scadere`,
    expiryReminderLead: (deadline) => `La tua prenotazione ti aspetta ancora in negozio. Teniamo i pezzi da parte fino al ${deadline}; poi tornano in vendita.`,
    expiryReminderClose: 'Se non riesci ad arrivare in tempo, scrivici. Troveremo una soluzione.',
    expiredSubject: (ref) => `La sua prenotazione ${ref} è scaduta`,
    expiredLead: 'Il termine è trascorso e i pezzi sono tornati in vendita. Li abbiamo tenuti da parte il più a lungo possibile.',
    expiredClose: 'Se sono ancora disponibili, può prenotare di nuovo. E se è successo qualcosa, ci scriva pure: teniamo da parte più a lungo quando lo sappiamo.',
    acceptedSubject: (ref) => `La tua prenotazione ${ref} è accettata`,
    acceptedLead: 'Abbiamo esaminato la tua prenotazione e l’abbiamo accettata. I pezzi sono messi da parte per te; li stiamo preparando e ti scriveremo appena saranno pronti per il ritiro.',
    acceptedClose: 'Non devi fare altro. Ti scriveremo di nuovo quando tutto sarà pronto.',
    declinedReasonLabel: 'Motivo',
    itemRemovedSubject: (ref) => `La sua prenotazione ${ref} è cambiata`,
    itemRemovedLead: (stueck) => `abbiamo dovuto togliere un pezzo dalla sua prenotazione: ${stueck}.`,
    itemRemovedRemaining: (anzahl) =>
      anzahl === 1 ? 'Un pezzo resta prenotato per lei.' : `${anzahl} pezzi restano prenotati per lei.`,
    itemRemovedClose: 'L\'importo al ritiro cambia di conseguenza.',
    deadlineExtendedSubject: (ref) => `Più tempo per la sua prenotazione ${ref}`,
    deadlineExtendedLead: (deadline) => `abbiamo prolungato il termine di ritiro. Nuova data: ${deadline}.`,
    deadlineExtendedClose: 'I suoi pezzi restano da parte per lei fino ad allora.',
  },

  nl: {
    dir: 'ltr',
    tagline: 'Edelmetalen en verzamelstukken',
    operatorLine: `${BRAND}, geëxploiteerd door ${OPERATOR}, ${ADDRESS}, Duitsland`,
    courtesyNote: 'Dit bericht is een vertaling ter informatie. De contracttaal is Duits.',
    openingHoursLabel: 'Openingstijden',
    openingHours: 'Ma tot do 15:00 tot 18:30, vr 15:00 tot 19:00',
    greetNamed: (n) => `Hallo ${n},`,
    greetPlain: 'Hallo,',
    welcomeSubject: `Welkom bij ${BRAND}`,
    welcomeLead: `Welkom bij ${BRAND}. Je account staat klaar.`,
    welcomeBody:
      'Vanaf nu kun je onze stukken bekijken, favorieten bewaren en reserveren om af te halen ' +
      'in de winkel. Elk stuk is uniek, gecontroleerd en met zorg gekozen.',
    welcomeClose: 'We zien je graag in de winkel.',
    reservationSubject: (ref) => `Je reservering ${ref} bij ${BRAND}`,
    pieces: (n) => (n === 1 ? 'één stuk' : `${n} stuks`),
    reservationLead: (p) =>
      `We hebben je reservering ontvangen. We leggen ${p} drie dagen apart in de winkel.`,
    cancelReasonLabel: 'Reden',
    reservedItemsLabel: 'Voor u gereserveerd',
    pickupByLabel: 'Ophalen vóór',
    refLabel: 'Reserveringsnummer',
    totalLabel: 'Totale waarde',
    euro: 'euro',
    reservationClose:
      'Noem het reserveringsnummer bij het afhalen in de winkel. Je betaalt gewoon ter plekke.',
    cancelledSubject: (ref) => `Reservering geannuleerd, ${BRAND}, ${ref}`,
    cancelledLead: (ref) =>
      `Je reservering ${ref} is geannuleerd. De stukken zijn weer beschikbaar.`,
    cancelledClose: 'Je kunt altijd opnieuw reserveren. We staan voor je klaar.',
    readySubject: (ref) => `Je bestelling ${ref} ligt klaar om op te halen`,
    readyLead: 'Je stukken zijn voorbereid en liggen nu voor je klaar in de winkel. Kom langs tijdens onze openingstijden; betalen doe je gemakkelijk ter plaatse.',
    readyClose: 'Noem het reserveringsnummer bij het ophalen. We verheugen ons op je bezoek.',
    expiryReminderSubject: (ref) => `Je reservering ${ref} verloopt binnenkort`,
    expiryReminderLead: (deadline) => `Je reservering wacht nog in de winkel. We houden de stukken voor je vast tot ${deadline}; daarna gaan ze terug in de verkoop.`,
    expiryReminderClose: 'Lukt het niet op tijd, laat het ons even weten. We vinden een oplossing.',
    expiredSubject: (ref) => `Uw reservering ${ref} is verlopen`,
    expiredLead: 'De termijn is verstreken en de stukken zijn terug in de verkoop. We hebben ze zo lang mogelijk voor u bewaard.',
    expiredClose: 'Zijn ze er nog, reserveer dan gerust opnieuw. En als er iets tussenkwam: schrijf ons gewoon. We houden ze langer vast als we het weten.',
    acceptedSubject: (ref) => `Je reservering ${ref} is aangenomen`,
    acceptedLead: 'We hebben je reservering bekeken en aangenomen. De stukken liggen voor je apart; we maken ze klaar en schrijven je zodra ze opgehaald kunnen worden.',
    acceptedClose: 'Je hoeft verder niets te doen. We schrijven je weer als alles klaarligt.',
    declinedReasonLabel: 'Reden',
    itemRemovedSubject: (ref) => `Uw reservering ${ref} is gewijzigd`,
    itemRemovedLead: (stueck) => `we moesten een stuk uit uw reservering halen: ${stueck}.`,
    itemRemovedRemaining: (anzahl) =>
      anzahl === 1 ? 'Eén stuk blijft voor u gereserveerd.' : `${anzahl} stukken blijven voor u gereserveerd.`,
    itemRemovedClose: 'Het bedrag bij het ophalen verandert navenant.',
    deadlineExtendedSubject: (ref) => `Meer tijd voor uw reservering ${ref}`,
    deadlineExtendedLead: (deadline) => `we hebben uw ophaaltermijn verlengd. Nieuwe datum: ${deadline}.`,
    deadlineExtendedClose: 'Uw stukken blijven tot dan voor u apart liggen.',
  },

  pl: {
    dir: 'ltr',
    tagline: 'Metale szlachetne i przedmioty kolekcjonerskie',
    operatorLine: `${BRAND}, prowadzone przez ${OPERATOR}, ${ADDRESS}, Niemcy`,
    courtesyNote: 'Ta wiadomość jest tłumaczeniem informacyjnym. Językiem umowy jest niemiecki.',
    openingHoursLabel: 'Godziny otwarcia',
    openingHours: 'Pon do czw 15:00 do 18:30, pt 15:00 do 19:00',
    greetNamed: (n) => `Dzień dobry ${n},`,
    greetPlain: 'Dzień dobry,',
    welcomeSubject: `Witamy w ${BRAND}`,
    welcomeLead: `Witamy w ${BRAND}. Twoje konto jest gotowe.`,
    welcomeBody:
      'Od teraz możesz przeglądać nasze przedmioty, zapisywać ulubione i rezerwować je do ' +
      'odbioru w sklepie. Każdy przedmiot jest jedyny w swoim rodzaju, sprawdzony i starannie wybrany.',
    welcomeClose: 'Czekamy na Twoją wizytę.',
    reservationSubject: (ref) => `Twoja rezerwacja ${ref} w ${BRAND}`,
    pieces: (n) => {
      if (n === 1) return 'jeden przedmiot';
      const last = n % 10;
      const two = n % 100;
      if (last >= 2 && last <= 4 && !(two >= 12 && two <= 14)) return `${n} przedmioty`;
      return `${n} przedmiotów`;
    },
    reservationLead: (p) =>
      `Otrzymaliśmy Twoją rezerwację. Odkładamy ${p} w sklepie na trzy dni.`,
    cancelReasonLabel: 'Powód',
    reservedItemsLabel: 'Zarezerwowane dla Ciebie',
    pickupByLabel: 'Odbiór do',
    refLabel: 'Numer rezerwacji',
    totalLabel: 'Wartość łączna',
    euro: 'euro',
    reservationClose:
      'Prosimy podać numer rezerwacji przy odbiorze w sklepie. Zapłacisz wygodnie na miejscu.',
    cancelledSubject: (ref) => `Rezerwacja anulowana, ${BRAND}, ${ref}`,
    cancelledLead: (ref) =>
      `Twoja rezerwacja ${ref} została anulowana. Przedmioty są znowu dostępne.`,
    cancelledClose: 'Możesz zarezerwować ponownie w dowolnej chwili. Chętnie pomożemy.',
    readySubject: (ref) => `Twoje zamówienie ${ref} jest gotowe do odbioru`,
    readyLead: 'Twoje przedmioty są przygotowane i czekają teraz na Ciebie w sklepie. Wpadnij w godzinach otwarcia; płatność wygodnie na miejscu.',
    readyClose: 'Przy odbiorze podaj numer rezerwacji. Czekamy na Twoją wizytę.',
    expiryReminderSubject: (ref) => `Twoja rezerwacja ${ref} wkrótce wygasa`,
    expiryReminderLead: (deadline) => `Twoja rezerwacja wciąż czeka w sklepie. Trzymamy dla Ciebie przedmioty do ${deadline}; potem wracają do sprzedaży.`,
    expiryReminderClose: 'Jeśli nie zdążysz, napisz do nas. Znajdziemy rozwiązanie.',
    expiredSubject: (ref) => `Rezerwacja ${ref} wygasła`,
    expiredLead: 'Termin minął, a przedmioty wróciły do sprzedaży. Trzymaliśmy je tak długo, jak mogliśmy.',
    expiredClose: 'Jeśli nadal są dostępne, zapraszamy do ponownej rezerwacji. A jeśli coś wypadło, po prostu napisz do nas: gdy wiemy, trzymamy dłużej.',
    acceptedSubject: (ref) => `Twoja rezerwacja ${ref} została przyjęta`,
    acceptedLead: 'Sprawdziliśmy Twoją rezerwację i ją przyjęliśmy. Przedmioty są odłożone dla Ciebie; przygotowujemy je i napiszemy, gdy tylko będą gotowe do odbioru.',
    acceptedClose: 'Nie musisz nic więcej robić. Napiszemy ponownie, gdy wszystko będzie gotowe.',
    declinedReasonLabel: 'Powód',
    itemRemovedSubject: (ref) => `Twoja rezerwacja ${ref} została zmieniona`,
    itemRemovedLead: (stueck) => `musieliśmy usunąć jeden przedmiot z Twojej rezerwacji: ${stueck}.`,
    itemRemovedRemaining: (anzahl) =>
      anzahl === 1 ? 'Jeden przedmiot pozostaje dla Ciebie zarezerwowany.' : `${anzahl} przedmioty pozostają dla Ciebie zarezerwowane.`,
    itemRemovedClose: 'Kwota przy odbiorze zmienia się odpowiednio.',
    deadlineExtendedSubject: (ref) => `Więcej czasu na odbiór rezerwacji ${ref}`,
    deadlineExtendedLead: (deadline) => `przedłużyliśmy termin odbioru. Nowa data: ${deadline}.`,
    deadlineExtendedClose: 'Twoje przedmioty czekają na Ciebie do tego czasu.',
  },

  pt: {
    dir: 'ltr',
    tagline: 'Metais preciosos e peças de coleção',
    operatorLine: `${BRAND}, explorado por ${OPERATOR}, ${ADDRESS}, Alemanha`,
    courtesyNote:
      'Esta mensagem é uma tradução de cortesia. A língua do contrato é o alemão.',
    openingHoursLabel: 'Horário',
    openingHours: 'Seg a qui 15:00 a 18:30, sex 15:00 a 19:00',
    greetNamed: (n) => `Olá ${n},`,
    greetPlain: 'Olá,',
    welcomeSubject: `Bem vindo à ${BRAND}`,
    welcomeLead: `Bem vindo à ${BRAND}. A sua conta está pronta.`,
    welcomeBody:
      'A partir de agora pode explorar as nossas peças, guardar as favoritas e reservar o que ' +
      'quiser para levantamento na loja. Cada peça é única, verificada e escolhida com cuidado.',
    welcomeClose: 'Teremos muito gosto na sua visita.',
    reservationSubject: (ref) => `A sua reserva ${ref} na ${BRAND}`,
    pieces: (n) => (n === 1 ? 'uma peça' : `${n} peças`),
    reservationLead: (p) =>
      `Recebemos a sua reserva. Guardamos ${p} na loja durante três dias.`,
    cancelReasonLabel: 'Motivo',
    reservedItemsLabel: 'Reservado para si',
    pickupByLabel: 'Levantar até',
    refLabel: 'Número da reserva',
    totalLabel: 'Valor total',
    euro: 'euros',
    reservationClose:
      'Basta indicar o número da reserva no levantamento na loja. ' +
      'O pagamento é feito com toda a calma no local.',
    cancelledSubject: (ref) => `Reserva cancelada, ${BRAND}, ${ref}`,
    cancelledLead: (ref) =>
      `A sua reserva ${ref} foi cancelada. As peças estão novamente disponíveis.`,
    cancelledClose: 'Pode reservar de novo quando quiser. Estamos ao seu dispor.',
    readySubject: (ref) => `A sua encomenda ${ref} está pronta para levantamento`,
    readyLead: 'As suas peças estão preparadas e aguardam-no agora na loja. Passe durante o nosso horário; o pagamento é feito comodamente no local.',
    readyClose: 'Indique o número de reserva no levantamento. Esperamos a sua visita.',
    expiryReminderSubject: (ref) => `A sua reserva ${ref} expira em breve`,
    expiryReminderLead: (deadline) => `A sua reserva continua à sua espera na loja. Guardamos as peças para si até ${deadline}; depois voltam para venda.`,
    expiryReminderClose: 'Se não conseguir vir a tempo, escreva-nos. Encontramos uma solução.',
    expiredSubject: (ref) => `A sua reserva ${ref} expirou`,
    expiredLead: 'O prazo terminou e as peças voltaram para venda. Guardámo-las o máximo de tempo que conseguimos.',
    expiredClose: 'Se ainda estiverem disponíveis, reserve novamente com todo o gosto. E se surgiu algum imprevisto, escreva-nos: guardamos por mais tempo quando sabemos.',
    acceptedSubject: (ref) => `A sua reserva ${ref} foi aceite`,
    acceptedLead: 'Analisámos a sua reserva e aceitámo-la. As peças estão reservadas para si; estamos a prepará-las e escreveremos assim que estiverem prontas para levantamento.',
    acceptedClose: 'Não precisa de fazer mais nada. Escreveremos novamente quando estiver tudo pronto.',
    declinedReasonLabel: 'Motivo',
    itemRemovedSubject: (ref) => `A sua reserva ${ref} foi alterada`,
    itemRemovedLead: (stueck) => `tivemos de retirar uma peça da sua reserva: ${stueck}.`,
    itemRemovedRemaining: (anzahl) =>
      anzahl === 1 ? 'Uma peça continua reservada para si.' : `${anzahl} peças continuam reservadas para si.`,
    itemRemovedClose: 'O valor a pagar no levantamento muda em conformidade.',
    deadlineExtendedSubject: (ref) => `Mais tempo para a sua reserva ${ref}`,
    deadlineExtendedLead: (deadline) => `prolongámos o prazo de levantamento. Nova data: ${deadline}.`,
    deadlineExtendedClose: 'As suas peças ficam guardadas para si até lá.',
  },

  da: {
    dir: 'ltr',
    tagline: 'Ædelmetaller og samlerobjekter',
    operatorLine: `${BRAND}, drives af ${OPERATOR}, ${ADDRESS}, Tyskland`,
    courtesyNote: 'Denne besked er en oversættelse til orientering. Aftalesproget er tysk.',
    openingHoursLabel: 'Åbningstider',
    openingHours: 'Man til tor 15:00 til 18:30, fre 15:00 til 19:00',
    greetNamed: (n) => `Hej ${n},`,
    greetPlain: 'Hej,',
    welcomeSubject: `Velkommen til ${BRAND}`,
    welcomeLead: `Velkommen til ${BRAND}. Din konto er klar.`,
    welcomeBody:
      'Fra nu af kan du kigge på vores varer, gemme favoritter og reservere dem til afhentning ' +
      'i butikken. Hver vare er unik, gennemgået og udvalgt med omhu.',
    welcomeClose: 'Vi glæder os til dit besøg.',
    reservationSubject: (ref) => `Din reservation ${ref} hos ${BRAND}`,
    pieces: (n) => (n === 1 ? 'en vare' : `${n} varer`),
    reservationLead: (p) =>
      `Vi har modtaget din reservation. Vi lægger ${p} til side i butikken i tre dage.`,
    cancelReasonLabel: 'Årsag',
    reservedItemsLabel: 'Lagt til side til dig',
    pickupByLabel: 'Hentes inden',
    refLabel: 'Reservationsnummer',
    totalLabel: 'Samlet værdi',
    euro: 'euro',
    reservationClose:
      'Nævn blot reservationsnummeret ved afhentning i butikken. Du betaler nemt på stedet.',
    cancelledSubject: (ref) => `Reservation annulleret, ${BRAND}, ${ref}`,
    cancelledLead: (ref) => `Din reservation ${ref} er annulleret. Varerne er ledige igen.`,
    cancelledClose: 'Du kan reservere igen når som helst. Vi er her for dig.',
    readySubject: (ref) => `Din bestilling ${ref} er klar til afhentning`,
    readyLead: 'Dine stykker er forberedt og venter nu på dig i butikken. Kig forbi i vores åbningstid; betaling sker bekvemt på stedet.',
    readyClose: 'Nævn venligst reservationsnummeret ved afhentning. Vi ser frem til dit besøg.',
    expiryReminderSubject: (ref) => `Din reservation ${ref} udløber snart`,
    expiryReminderLead: (deadline) => `Din reservation venter stadig i butikken. Vi holder stykkerne til dig indtil ${deadline}; derefter går de tilbage i salg.`,
    expiryReminderClose: 'Kan du ikke nå det i tide, så skriv til os. Vi finder en løsning.',
    expiredSubject: (ref) => `Din reservation ${ref} er udløbet`,
    expiredLead: 'Fristen er udløbet, og stykkerne er tilbage i salg. Vi holdt dem så længe, vi kunne.',
    expiredClose: 'Er de der stadig, er du velkommen til at reservere igen. Og hvis noget kom i vejen, så skriv blot til os: vi holder længere, når vi ved det.',
    acceptedSubject: (ref) => `Din reservation ${ref} er accepteret`,
    acceptedLead: 'Vi har gennemgået din reservation og accepteret den. Stykkerne er lagt til side til dig; vi gør dem klar og skriver, så snart de kan afhentes.',
    acceptedClose: 'Du skal ikke gøre mere. Vi skriver igen, når alt er klar.',
    declinedReasonLabel: 'Årsag',
    itemRemovedSubject: (ref) => `Din reservation ${ref} er ændret`,
    itemRemovedLead: (stueck) => `vi måtte tage en genstand ud af din reservation: ${stueck}.`,
    itemRemovedRemaining: (anzahl) =>
      anzahl === 1 ? 'Én genstand er stadig reserveret til dig.' : `${anzahl} genstande er stadig reserveret til dig.`,
    itemRemovedClose: 'Beløbet ved afhentning ændrer sig tilsvarende.',
    deadlineExtendedSubject: (ref) => `Mere tid til din reservation ${ref}`,
    deadlineExtendedLead: (deadline) => `vi har forlænget din afhentningsfrist. Ny dato: ${deadline}.`,
    deadlineExtendedClose: 'Dine genstande er lagt til side til dig indtil da.',
  },

  sv: {
    dir: 'ltr',
    tagline: 'Ädelmetaller och samlarobjekt',
    operatorLine: `${BRAND}, drivs av ${OPERATOR}, ${ADDRESS}, Tyskland`,
    courtesyNote: 'Detta meddelande är en översättning för information. Avtalsspråket är tyska.',
    openingHoursLabel: 'Öppettider',
    openingHours: 'Mån till tors 15:00 till 18:30, fre 15:00 till 19:00',
    greetNamed: (n) => `Hej ${n},`,
    greetPlain: 'Hej,',
    welcomeSubject: `Välkommen till ${BRAND}`,
    welcomeLead: `Välkommen till ${BRAND}. Ditt konto är klart.`,
    welcomeBody:
      'Från och med nu kan du bläddra bland våra föremål, spara favoriter och reservera dem för ' +
      'upphämtning i butiken. Varje föremål är unikt, kontrollerat och utvalt med omsorg.',
    welcomeClose: 'Vi ser fram emot ditt besök.',
    reservationSubject: (ref) => `Din reservation ${ref} hos ${BRAND}`,
    pieces: (n) => (n === 1 ? 'ett föremål' : `${n} föremål`),
    reservationLead: (p) =>
      `Vi har fått din reservation. Vi lägger undan ${p} i butiken i tre dagar.`,
    cancelReasonLabel: 'Anledning',
    reservedItemsLabel: 'Undanlagt åt dig',
    pickupByLabel: 'Hämtas senast',
    refLabel: 'Reservationsnummer',
    totalLabel: 'Totalt värde',
    euro: 'euro',
    reservationClose:
      'Nämn reservationsnumret vid upphämtningen i butiken. Du betalar bekvämt på plats.',
    cancelledSubject: (ref) => `Reservation avbokad, ${BRAND}, ${ref}`,
    cancelledLead: (ref) => `Din reservation ${ref} är avbokad. Föremålen är tillgängliga igen.`,
    cancelledClose: 'Du kan reservera igen när du vill. Vi finns här för dig.',
    readySubject: (ref) => `Din beställning ${ref} är redo att hämtas`,
    readyLead: 'Dina stycken är förberedda och väntar nu på dig i butiken. Kom förbi under våra öppettider; betalning sker bekvämt på plats.',
    readyClose: 'Ange reservationsnumret vid hämtning. Vi ser fram emot ditt besök.',
    expiryReminderSubject: (ref) => `Din reservation ${ref} går snart ut`,
    expiryReminderLead: (deadline) => `Din reservation väntar fortfarande i butiken. Vi håller föremålen åt dig till ${deadline}; därefter går de tillbaka till försäljning.`,
    expiryReminderClose: 'Hinner du inte i tid, skriv till oss. Vi hittar en lösning.',
    expiredSubject: (ref) => `Din reservation ${ref} har gått ut`,
    expiredLead: 'Fristen har passerat och styckena har gått tillbaka till försäljning. Vi höll dem så länge vi kunde.',
    expiredClose: 'Finns de kvar är du varmt välkommen att reservera igen. Och om något kom emellan: skriv bara till oss, vi håller längre när vi vet om det.',
    acceptedSubject: (ref) => `Din reservation ${ref} är godkänd`,
    acceptedLead: 'Vi har gått igenom din reservation och godkänt den. Föremålen är undanlagda åt dig; vi gör i ordning dem och skriver så snart de kan hämtas.',
    acceptedClose: 'Du behöver inte göra något mer. Vi skriver igen när allt är klart.',
    declinedReasonLabel: 'Orsak',
    itemRemovedSubject: (ref) => `Din reservation ${ref} har ändrats`,
    itemRemovedLead: (stueck) => `vi behövde ta ut ett föremål ur din reservation: ${stueck}.`,
    itemRemovedRemaining: (anzahl) =>
      anzahl === 1 ? 'Ett föremål är fortfarande reserverat åt dig.' : `${anzahl} föremål är fortfarande reserverade åt dig.`,
    itemRemovedClose: 'Beloppet vid hämtning ändras i motsvarande grad.',
    deadlineExtendedSubject: (ref) => `Mer tid för din reservation ${ref}`,
    deadlineExtendedLead: (deadline) => `vi har förlängt din hämtningsfrist. Nytt datum: ${deadline}.`,
    deadlineExtendedClose: 'Dina föremål ligger kvar åt dig till dess.',
  },

  uk: {
    dir: 'ltr',
    tagline: 'Дорогоцінні метали та колекційні речі',
    operatorLine: `${BRAND}, керує ${OPERATOR}, ${ADDRESS}, Німеччина`,
    courtesyNote: 'Це повідомлення є перекладом для зручності. Мовою договору є німецька.',
    openingHoursLabel: 'Години роботи',
    openingHours: 'Пн до чт 15:00 до 18:30, пт 15:00 до 19:00',
    greetNamed: (n) => `Доброго дня, ${n},`,
    greetPlain: 'Доброго дня,',
    welcomeSubject: `Вітаємо у ${BRAND}`,
    welcomeLead: `Вітаємо у ${BRAND}. Ваш обліковий запис готовий.`,
    welcomeBody:
      'Відтепер ви можете переглядати наші речі, зберігати улюблені та бронювати їх для ' +
      'отримання в магазині. Кожна річ унікальна, перевірена та дібрана з увагою.',
    welcomeClose: 'Будемо раді вашому візиту.',
    reservationSubject: (ref) => `Ваше бронювання ${ref} у ${BRAND}`,
    pieces: (n) => {
      if (n === 1) return 'одну річ';
      const last = n % 10;
      const two = n % 100;
      if (last >= 2 && last <= 4 && !(two >= 12 && two <= 14)) return `${n} речі`;
      return `${n} речей`;
    },
    reservationLead: (p) =>
      `Ми отримали ваше бронювання. Ми відкладемо ${p} у магазині на три дні.`,
    cancelReasonLabel: 'Причина',
    reservedItemsLabel: 'Відкладено для вас',
    pickupByLabel: 'Забрати до',
    refLabel: 'Номер бронювання',
    totalLabel: 'Загальна вартість',
    euro: 'євро',
    reservationClose:
      'Будь ласка, назвіть номер бронювання під час отримання в магазині. Оплата зручно на місці.',
    cancelledSubject: (ref) => `Бронювання скасовано, ${BRAND}, ${ref}`,
    cancelledLead: (ref) => `Ваше бронювання ${ref} скасовано. Речі знову доступні.`,
    cancelledClose: 'Ви можете забронювати знову будь коли. Ми завжди раді допомогти.',
    readySubject: (ref) => `Ваше замовлення ${ref} готове до отримання`,
    readyLead: 'Ваші вироби підготовлені й тепер чекають на вас у магазині. Завітайте в години роботи; оплата зручно на місці.',
    readyClose: 'Будь ласка, назвіть номер бронювання при отриманні. Будемо раді вашому візиту.',
    expiryReminderSubject: (ref) => `Ваше бронювання ${ref} невдовзі спливає`,
    expiryReminderLead: (deadline) => `Ваше бронювання досі чекає в магазині. Ми тримаємо речі для вас до ${deadline}; після цього вони повертаються у продаж.`,
    expiryReminderClose: 'Якщо не встигаєте, просто напишіть нам. Ми знайдемо рішення.',
    expiredSubject: (ref) => `Термін вашого бронювання ${ref} минув`,
    expiredLead: 'Термін минув, і речі повернулися до продажу. Ми тримали їх для вас так довго, як могли.',
    expiredClose: 'Якщо вони ще є, будь ласка, забронюйте знову. А якщо щось завадило, просто напишіть нам: коли ми знаємо, тримаємо довше.',
    acceptedSubject: (ref) => `Ваше бронювання ${ref} прийнято`,
    acceptedLead: 'Ми переглянули ваше бронювання і прийняли його. Речі відкладені для вас; ми готуємо їх і напишемо, щойно вони будуть готові до отримання.',
    acceptedClose: 'Більше нічого робити не потрібно. Ми напишемо знову, коли все буде готове.',
    declinedReasonLabel: 'Причина',
    itemRemovedSubject: (ref) => `Ваше бронювання ${ref} змінено`,
    itemRemovedLead: (stueck) => `нам довелося вилучити один предмет із вашого бронювання: ${stueck}.`,
    itemRemovedRemaining: (anzahl) =>
      anzahl === 1 ? 'Один предмет залишається заброньованим для вас.' : `${anzahl} предмети залишаються заброньованими для вас.`,
    itemRemovedClose: 'Сума до сплати при отриманні змінюється відповідно.',
    deadlineExtendedSubject: (ref) => `Більше часу для бронювання ${ref}`,
    deadlineExtendedLead: (deadline) => `ми продовжили термін отримання. Нова дата: ${deadline}.`,
    deadlineExtendedClose: 'Ваші предмети чекають на вас до цього часу.',
  },
};

/** The letter's voice for one reader. Never null: German is the floor. */
export function emailCopy(locale: string | null | undefined): EmailCopy {
  return COPY[normalizeEmailLocale(locale)];
}
