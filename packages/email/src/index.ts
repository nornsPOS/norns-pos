/**
 * Die Briefe des Hauses, an einer Stelle.
 *
 * Bis zum 23.07.2026 lagen Wortlaut und Gestalt in api-cloud, der Versender
 * im worker, und der worker konnte api-cloud nicht einbinden. Deshalb blieb
 * die Erinnerung vor Fristablauf ungebaut: sie gehört in den worker, der
 * Brief aber lag in api-cloud. Der einzige ehrliche Ausweg ohne Doppelpflege
 * ist dieses gemeinsame Paket. Beide Seiten verfassen jetzt denselben Brief.
 */
export * from './copy.js';
export * from './outbox.js';
export * from './push-copy.js';
