/**
 * Closing + DSFinV-K state-machine enums.
 *
 * Created in migration 0011_closing.sql.
 */

import { pgEnum } from 'drizzle-orm/pg-core';

export const closingState = pgEnum('closing_state', ['COUNTING', 'FINALIZED']);

export const dsfinvkExportState = pgEnum('dsfinvk_export_state', [
  'GENERATING',
  'GENERATED',
  'DELIVERED_TO_STEUERBERATER',
  'FAILED',
]);
