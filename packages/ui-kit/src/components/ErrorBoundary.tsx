/**
 * ErrorBoundary — brand-themed React error boundary.
 *
 * Wraps a sub-tree so a thrown render error renders a calm parchment
 * fallback instead of a white screen. The fallback quotes the broadside
 * motto and offers a display-face "Erneut versuchen" reset button that
 * remounts the children (cleared error).
 *
 * Use at two depths (memory.md #76):
 *   • around each route element so one surface can crash without taking
 *     down the AppShell + Karteikasten
 *   • around the AppShell itself as a last-resort fallback
 *
 * Errors are also logged via the optional `onError` callback so the
 * consumer can pipe them to telemetry.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

import { Button } from './Button.js';
import { Zwischentitel } from './Zwischentitel.js';
import { ParchmentCard } from './ParchmentCard.js';
import { Seal } from './Seal.js';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional override; defaults to "Etwas ist ins Stocken geraten." */
  title?: string;
  /** Optional telemetry hook — fired once per caught error. */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public override state: ErrorBoundaryState = { error: null };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    if (this.props.onError) {
      try {
        this.props.onError(error, info);
      } catch {
        /* swallow */
      }
    }
    // Always log so the developer console shows the trace.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info);
  }

  private handleReset = (): void => {
    this.setState({ error: null });
  };

  public override render(): ReactNode {
    if (this.state.error) {
      return (
        <Fallback
          title={this.props.title ?? 'Etwas ist ins Stocken geraten.'}
          error={this.state.error}
          onReset={this.handleReset}
        />
      );
    }
    return this.props.children;
  }
}

function Fallback({
  title,
  error,
  onReset,
}: {
  title: string;
  error: Error;
  onReset: () => void;
}): JSX.Element {
  return (
    <div
      style={{
        minHeight: '60vh',
        display: 'grid',
        placeItems: 'center',
        padding: 32,
      }}
    >
      <ParchmentCard padding="lg" style={{ width: 'min(560px, 100%)', textAlign: 'center' }}>
        <Seal size="md" tone="wax-red" label="!" />
        <h2
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '1.4rem',
            margin: '16px 0 4px',
          }}
        >
          {title}
        </h2>
        <p
          style={{
            margin: 0,
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: '1rem',
          }}
        >
          Was lange ruht, spricht leise.
        </p>
        <Zwischentitel />
        <p
          style={{
            margin: '0 0 16px',
            fontFamily: 'var(--w14-font-mono)',
            fontSize: '0.8rem',
            color: 'var(--w14-ink-faded)',
            wordBreak: 'break-word',
            whiteSpace: 'pre-wrap',
            textAlign: 'left',
            background: 'var(--w14-parchment-3)',
            padding: '8px 10px',
            borderRadius: 4,
          }}
        >
          {error.name}: {error.message}
        </p>
        <Button onClick={onReset}>Erneut versuchen</Button>
      </ParchmentCard>
    </div>
  );
}
