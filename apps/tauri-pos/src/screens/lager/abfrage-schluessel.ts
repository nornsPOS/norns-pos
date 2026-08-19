/**
 * Die Abfrageschlüssel des Lagers, an einer Stelle.
 *
 * ⚠️ 01.08.2026: `productDetailQueryKey` wohnte bis heute in `WebSeoPanel.tsx`.
 * Diese Fläche schaltete ein Stück im Webshop frei und pflegte den Text für
 * Suchmaschinen dazu. Norns POS ist die Kasse am Tresen und hat keinen
 * Webshop, also ist sie raus — der Schlüssel wird aber an acht Stellen im
 * Produktblatt gebraucht und zieht hierher um.
 *
 * Ein Schlüssel gehört ohnehin nicht in eine Fläche: wer ihn braucht, müsste
 * sonst eine ganze Bildschirmfläche einziehen, um eine Zeichenkette zu
 * bekommen.
 */

/** Ein einzelnes Stück im Lager. Nach jedem Schreiben ungültig machen. */
export const productDetailQueryKey = (id: string): readonly unknown[] => ['products', 'detail', id];

/** Der Baum der Sammlungen. Eine Zwischenablage für die ganze Lagerfläche. */
export const categoriesTreeQueryKey: readonly unknown[] = ['categories', 'tree'];
