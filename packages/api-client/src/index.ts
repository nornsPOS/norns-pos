/**
 * @norns/api-client
 *
 * Typed HTTP wrapper around the frozen Warehouse14 API surface.
 *
 * Design rules (memory.md #74):
 *   • One file per route domain (auth, products, customers, transactions,
 *     appraisals, photos, ebay, dashboard, …) — no monolithic god-client.
 *   • Methods are thin: `await client.products.list({ status: 'AVAILABLE' })`.
 *   • Request/response shapes are imported directly from the backend's
 *     TypeBox schemas where they exist, hand-mirrored where they don't.
 *   • Network errors surface as `ApiError` with the same `code` enum the
 *     backend emits (`STEP_UP_REQUIRED`, `DEVICE_NOT_AUTHORIZED`, etc.).
 *   • Auth: session cookie passed by the browser automatically; Tauri sets
 *     the cookie via `credentials: 'include'`.
 *
 * V1 ships the lowest-level primitives (`request()`, `ApiError`, `ApiClient`
 * constructor). Per-domain method clusters land alongside their corresponding
 * screens — adding a method is a 4-line PR.
 */

export * from './client.js';
export { devicesApi, type PushApp, type PushPlatform } from './domains/devices.js';
export * from './errors.js';
export * from './types.js';
export * from './validation.js';

// ───────────────────────────────────────────────────────────────────────
// Middleware engine + cross-cutting concerns (ADR-0042 / ADR-0043 / ADR-0044)
// ───────────────────────────────────────────────────────────────────────
export {
  compose,
  type Middleware,
  type Next,
  type MiddlewareRequest,
  type MiddlewareResponse,
  type RequestMeta,
  type HttpMethod,
} from './middleware.js';
export { TimeoutError } from './internal/abort.js';
export {
  AuthFlowCoordinator,
  type AuthFlowOptions,
} from './internal/auth-flow.js';
export {
  telemetryMiddleware,
  type TelemetrySink,
  type TelemetryOptions,
  type TelemetryStartEvent,
  type TelemetrySuccessEvent,
  type TelemetryErrorEvent,
} from './middleware/telemetry.js';
export {
  inflightDedupMiddleware,
  type DedupOptions,
} from './middleware/dedup.js';
export {
  circuitBreakerMiddleware,
  type CircuitOptions,
} from './middleware/circuit.js';
export {
  retryMiddleware,
  type RetryOptions,
} from './middleware/retry.js';
export {
  stepUpMiddleware,
  type StepUpDependencies,
  type StepUpReason,
  type StepUpToken,
} from './middleware/step-up.js';
export {
  FISCAL_PATH_PREFIXES,
  isGobdRelevantPath,
  offlineQueueMiddleware,
  type OfflineQueueDependencies,
  type OutboxRecord,
  type OutboxStatus,
  type OutboxStore,
} from './middleware/offline-queue.js';
export {
  drainOutbox,
  type ReplayDependencies,
  type ReplayOutcome,
} from './middleware/offline-replay.js';
export { uuidv7 } from './internal/uuidv7.js';

// Per-domain method clusters + their request/response types
export {
  authPin,
  type ActorRole,
  type AnmeldbarePerson,
  type AuthProfile,
  type AuthSessionResponse,
  type PinLoginRequest,
  type PinLoginResponse,
  type PinStepUpRequest,
  type PinStepUpResponse,
  type SessionActor,
  type SignOutResponse,
} from './domains/auth-pin.js';
export {
  bridgeApi,
  type BridgeSummary,
} from './domains/bridge.js';
export {
  dashboard,
  type DashboardSummary,
} from './domains/dashboard.js';
export {
  closingsApi,
  DATEV_KONTENRAHMEN,
  type DatevKontenrahmen,
  type ClosingListItem,
  type ClosingListResponse,
} from './domains/closings.js';
export {
  settingsDatevApi,
  type DatevHerkunft,
  type DatevKontoZeile,
  type DatevMandantFeld,
  type DatevRahmenOption,
  type DatevSettings,
  type DatevSettingUpdateResult,
} from './domains/settings-datev.js';
export { registersApi, type AnVerkaufsbuchCsvQuery } from './domains/registers.js';
export {
  appointments,
  type AppointmentType,
  type AppointmentStatus,
  APPOINTMENT_TYPE_LABELS,
  APPOINTMENT_STATUS_LABELS,
  type AvailableSlot,
  type AvailableSlotsQuery,
  type AppointmentListItem,
  type AppointmentListQuery,
  type BookAppointmentRequest,
  type AppointmentPatchStatus,
  type RescheduleRequest,
} from './domains/appointments.js';
export {
  isAlertEvent,
  parseLedgerEvent,
  shouldInvalidateDashboard,
  type LedgerEvent,
  type LedgerEventType,
} from './domains/ledger.js';
export {
  appraisalsApi,
  type AppraisalCompleteBody,
  type AppraisalItemBody,
  type AppraisalItemView,
  type AppraisalOpenBody,
  type AppraisalRejectBody,
  type AppraisalStatus,
  type AppraisalView,
} from './domains/appraisals.js';
export {
  shifts,
  type CashMovementDirection,
  type CashMovementRequest,
  type CashMovementResponse,
  type CloseShiftRequest,
  type OpenShiftRequest,
  type ShiftStatus,
  type ShiftView,
} from './domains/shifts.js';
export {
  productsApi,
  type CreateProductBody,
  type CreateProductResponse,
  type ProductConditionCode,
  type ProductItemType,
  type StampErhaltung,
  type InventoryAdjustmentBody,
  type InventoryAdjustmentReason,
  type InventoryAdjustmentResponse,
  type Metal,
  // ─── Day-13 extensions ──────────────────────────────────────────────
  type PrimaryCategoryRef,
  type ProductCategoryAssignment,
  type ProductDeleteResponse,
  type ProductDetail,
  type ProductListQuery,
  type ProductListResponse,
  type ProductListRow,
  type ProductStatus,
  type ProductUpdateBody,
  type ProductUpdateResponse,
  // ────────────────────────────────────────────────────────────────────
  type ReleaseBatchBody,
  type ReleaseBatchItem,
  type ReleaseBatchResponse,
  type ReleaseBody,
  type ReleaseReason,
  type ReleaseResponse,
  type ReservationChannel,
  type ReserveBody,
  type ReserveResponse,
  type TaxTreatmentCode,
} from './domains/products.js';
// ── Day 13 / Phase 2.B kick-off — commerce taxonomy ──────────────────
export {
  categoriesApi,
  type CategoryNode,
  type CategoryTreeResponse,
  type CreateCategoryBody,
  type CreateCategoryResponse,
  type DeleteCategoryResponse,
  type SetProductCategoriesBody,
  type SetProductCategoriesResponse,
  type UpdateCategoryBody,
  type UpdateCategoryResponse,
} from './domains/categories.js';
export {
  transactionsApi,
  type AnkaufBody,
  type AnkaufCondition,
  type AnkaufItemType,
  type AnkaufLineItem,
  type AnkaufMetal,
  type AnkaufPayoutMethod,
  type AnkaufResponse,
  type AnkaufResponseProduct,
  type FinalizeBody,
  type FinalizeLineItem,
  type FinalizePayment,
  type FinalizeResponse,
  type PaymentMethod,
  type RecentTransactionItem,
  type RecentTransactionsResponse,
  type TransactionDirection,
  type TseSignatureBody,
  type TseSignatureResponse,
} from './domains/transactions.js';
export {
  customersApi,
  type CustomerCreateBody,
  type CustomerCreateResponse,
  type CustomerDetail,
  type CustomerKycDocumentBody,
  type CustomerKycDocumentResponse,
  type CustomerKycStampBody,
  type CustomerKycStampDocumentType,
  type CustomerKycStampResponse,
  type CustomerKycStatus,
  type CustomerLanguage,
  type CustomerListQuery,
  type CustomerListResponse,
  type CustomerListRow,
  CUSTOMER_KYC_STATUS_LABELS,
  CUSTOMER_TRUST_LEVEL_LABELS,
  type CustomerTrustChangeBody,
  type CustomerTrustChangeResponse,
  type CustomerTrustLevel,
  type CustomerUpdateBody,
  type CustomerUpdateResponse,
  type KycDocumentType,
} from './domains/customers.js';
export {
  photosApi,
  type PhotoDirectUploadBody,
  type PhotoDirectUploadResponse,
  type PhotoRegisterBody,
  type PhotoRow,
  type PhotoSetPrimaryResponse,
  type PhotoSource,
  type PhotoUploadIntent,
  type PhotoUploadUrlBody,
  type PhotoUploadUrlResponse,
  type PhotoWorkflowState,
} from './domains/photos.js';


// 19.08.2026: hier stand der Werkzeug-Klient des Sprachassistenten
// (/api/mcp). Kein Bildschirm rief ihn; ausgezogen mit dem Assistenten.

// ───────────────────────────────────────────────────────────────────────
// Phase 2 Day 8 — Tier-2 screens domain clusters
// ───────────────────────────────────────────────────────────────────────
export {
  tasksApi,
  ALLOWED_TASK_TRANSITIONS,
  type CreateTaskBody,
  type ListTasksQuery,
  type ListTasksResponse,
  type TaskPriority,
  type TaskRelatedTable,
  type TaskRow,
  type TaskStatus,
  type TransitionTaskBody,
  type UpdateTaskBody,
} from './domains/tasks.js';
export {
  metalPricesApi,
  METAL_KIND_ORDER,
  type CurrentMetalPrice,
  type CurrentMetalPricesResponse,
  type ManualOverrideBody,
  type ManualOverrideResponse,
  type MetalKind,
  type MetalPriceHistoryQuery,
  type MetalPriceHistoryResponse,
  type MetalPriceHistoryRow,
  type MetalPriceSource,
  type MetalRate,
  type MetalRatesResponse,
  type UpdateMarginBody,
  type UpdateMarginResponse,
  type Verkaufsaufschlag,
  type VerkaufsaufschlagBody,
} from './domains/metal-prices.js';
export {
  stripeTerminalApi,
  type ErstattenResponse as TerminalErstattenResponse,
  type ErstattungsWeg as TerminalErstattungsWeg,
  type LeserRegistrierenBody,
  type TerminalFehlerbild,
  type TerminalLeser,
  type TerminalPosition,
  type TerminalZahlungStatus,
  type ZahlungStand as TerminalZahlungStand,
  type ZahlungStartenBody as TerminalZahlungStartenBody,
  type ZahlungView as TerminalZahlungView,
} from './domains/stripe-terminal.js';
export {
  belegLogoApi,
  type BelegLogo,
  type BelegLogoFormat,
  type BelegLogoHochladenBody,
  type BelegLogoHochladenResponse,
  type BelegLogoLoeschenResponse,
  type ShopIdentitaet,
} from './domains/beleg-logo.js';
export {
  belegtextApi,
  BELEGTEXT_KIND_LABELS,
  type BelegtextKind,
  type BelegtextRow,
  type CurrentBelegtextQuery,
  type CurrentBelegtextResponse,
  type ListBelegtextQuery,
  type ListBelegtextResponse,
  type PublishBelegtextBody,
  type PublishBelegtextResponse,
  type ResolveBelegtextQuery,
  type ResolveBelegtextResponse,
  // TaxTreatmentCode is re-exported from products.ts (existing surface).
} from './domains/belegtext.js';
export {
  documentsApi,
  DOCUMENT_CATEGORY_LABELS,
  type CreateDocumentBody,
  type DocumentCategory,
  type DocumentRow,
  type ListDocumentsQuery,
  type ListDocumentsResponse,
} from './domains/documents.js';
export {
  ledgerQueryApi,
  type LedgerListQuery,
  type LedgerListResponse,
  type LedgerListRow,
} from './domains/ledger-query.js';

// ───────────────────────────────────────────────────────────────────────
// Phase 2 Day 9 — WhatsApp Inbox surface
// ───────────────────────────────────────────────────────────────────────

// ───────────────────────────────────────────────────────────────────────
// Owner OS — finance backend (migration 0075): P&L + expenses + fixed costs
// ───────────────────────────────────────────────────────────────────────
export {
  financeApi,
  expensesApi,
  fixedCostsApi,
  EXPENSE_CATEGORIES,
  AUSGABE_ZAHLWEGE_WAEHLBAR,
  type FinancePeriod,
  type ExpenseCategory,
  type AusgabeZahlweg,
  type AusgabeZahlwegWaehlbar,
  type ProfitResponse,
  type MonthRevenueResponse,
  type InventoryValueResponse,
  type MetalWeightsResponse,
  type ExpenseRow,
  type ListExpensesQuery,
  type ListExpensesResponse,
  type CreateExpenseBody,
  type UpdateExpenseBody,
  type FixedCostRow,
  type ListFixedCostsQuery,
  type ListFixedCostsResponse,
  type CreateFixedCostBody,
  type UpdateFixedCostBody,
} from './domains/finance.js';


export {
  inventorySessionsApi,
  type InventorySessionStatus,
  type InventorySessionView,
  type InventoryProgress,
  type InventoryMatchStatus,
  type InventoryScanResult,
} from './domains/inventory-sessions.js';

