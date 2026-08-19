import type {
  TelemetryErrorEvent,
  TelemetrySink,
  TelemetryStartEvent,
  TelemetrySuccessEvent,
} from '@norns/api-client';

export const telemetrySink: TelemetrySink = {
  onStart(evt: TelemetryStartEvent) {
    console.debug(
      `[API] START: ${evt.method} ${evt.path} (attempt: ${evt.attempt}, traceId: ${evt.traceId})`,
    );
  },
  onSuccess(evt: TelemetrySuccessEvent) {
    console.debug(
      `[API] SUCCESS: ${evt.method} ${evt.path} (status: ${evt.status}, duration: ${evt.durationMs.toFixed(1)}ms)`,
    );
  },
  onError(evt: TelemetryErrorEvent) {
    console.error(
      `[API] ERROR: ${evt.method} ${evt.path} (kind: ${evt.kind}, code: ${evt.code}, msg: ${evt.errorMessage}, duration: ${evt.durationMs.toFixed(1)}ms)`,
    );
  },
};
