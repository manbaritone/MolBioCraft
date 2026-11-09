// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React from 'react';

interface ErrorBoundaryProps {
  /** Short name of the region, shown in the fallback ("Alignment studio"). */
  label: string;
  /** Changing this value clears the error (e.g. switching document or view). */
  resetKey?: string;
  /**
   * The boundary wraps the whole workbench: when it trips, the in-memory
   * session is already gone, so the fallback must not claim documents are safe.
   */
  root?: boolean;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Contains render-time exceptions (including traps from the Rust/WASM engine)
 * to one region. Without a boundary React unmounts the whole tree: the window
 * goes blank, unsaved in-memory work is lost and native-menu / quit listeners
 * disappear with it.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error(`[MolBioCraft] ${this.props.label} crashed`, error, info.componentStack);
  }

  componentDidUpdate(prev: ErrorBoundaryProps): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="info-callout mbc-error-boundary" role="alert">
        <strong>{this.props.label} hit an unexpected error and was stopped.</strong>
        <p style={{ margin: '6px 0' }}>
          {this.props.root
            ? 'The workbench must restart and unsaved changes in this window were lost. Your last autosave, if any, is offered for recovery when the workbench restarts.'
            : 'Your documents are unaffected. Change the input, switch view, or try again.'}
        </p>
        <code style={{ display: 'block', whiteSpace: 'pre-wrap', fontSize: 11, opacity: 0.8 }}>
          {error.message}
        </code>
        <button
          type="button"
          className="btn-secondary-sm"
          style={{ marginTop: 8 }}
          onClick={() => (this.props.root ? window.location.reload() : this.setState({ error: null }))}
        >
          {this.props.root ? 'Restart workbench' : 'Try again'}
        </button>
      </div>
    );
  }
}
