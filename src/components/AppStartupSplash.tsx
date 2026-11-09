// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React, { useEffect, useState } from 'react';
import { discoverRustRestApiEndpoint } from '../lib/tauriIpc';

export interface AppStartupSplashProps {
  /** Current application version displayed in the bottom-right corner */
  version?: string;
  /** Optional deterministic progress override (0–100) for controlled rendering / tests */
  initialProgress?: number;
  /** Optional callback fired once startup loading reaches 100% and fade-out completes */
  onComplete: () => void;
  /** Optional native desktop window drag handler so the splash screen remains draggable */
  onWindowChromeMouseDown?: (e: React.MouseEvent<HTMLElement>) => void;
}

/** Splash artwork, served from `public/splash/` so the static boot splash in index.html shares it. */
const SPLASH_PHOENIX_SRC = '/splash/phoenix-details.webp';
const SPLASH_HELIX_SRC = '/splash/dna-helix-protein-horizontal.svg';

const STARTUP_STAGES: ReadonlyArray<{ progress: number; label: string }> = [
  {
    progress: 18,
    label: 'Initializing molecular biology workspace…',
  },
  {
    progress: 52,
    label: 'Loading restriction enzymes, codon tables & vector catalog…',
  },
  {
    progress: 84,
    label: 'Connecting sequence alignment & bio-compute engine…',
  },
  {
    progress: 100,
    label: 'Ready',
  },
];

/**
 * Startup loading splash shown when opening MolBioCraft: a blue gradient card with the
 * yellow MolBioCraft Workbench wordmark, a DNA/protein helix ribbon, the application
 * summary and CC BY-NC 4.0 license line on the left, the phoenix artwork on the right,
 * and a semantic `<progress>` bar along the bottom edge.
 */
export const AppStartupSplash: React.FC<AppStartupSplashProps> = ({
  version = '1.0.0',
  initialProgress = STARTUP_STAGES[0].progress,
  onComplete,
  onWindowChromeMouseDown,
}) => {
  const [progress, setProgress] = useState<number>(initialProgress);
  const [stageLabel, setStageLabel] = useState<string>(STARTUP_STAGES[0].label);
  const [fadingOut, setFadingOut] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let cancelled = false;
    const prefersReducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const stepScale = prefersReducedMotion ? 0.55 : 1;

    const timers: number[] = [];
    const schedule = (delayMs: number, fn: () => void) => {
      const id = window.setTimeout(() => {
        if (!cancelled) fn();
      }, Math.round(delayMs * stepScale));
      timers.push(id);
    };

    // Kick off real background backend & font readiness checks bounded cleanly
    const backendReady = Promise.race([
      discoverRustRestApiEndpoint().catch(() => null),
      new Promise<null>((resolve) => {
        schedule(650, () => resolve(null));
      }),
    ]);

    const fontsReady =
      typeof document !== 'undefined' && document.fonts?.ready
        ? Promise.race([
          document.fonts.ready.catch(() => undefined),
          new Promise<undefined>((resolve) => {
            schedule(650, () => resolve(undefined));
          }),
        ])
        : Promise.resolve(undefined);

    schedule(260, () => {
      setProgress(STARTUP_STAGES[1].progress);
      setStageLabel(STARTUP_STAGES[1].label);
    });

    schedule(580, () => {
      setProgress(STARTUP_STAGES[2].progress);
      setStageLabel(STARTUP_STAGES[2].label);
    });

    void Promise.all([backendReady, fontsReady]).then(() => {
      if (cancelled) return;
      schedule(960, () => {
        setProgress(STARTUP_STAGES[3].progress);
        setStageLabel(STARTUP_STAGES[3].label);
      });
      schedule(1220, () => {
        setFadingOut(true);
      });
      schedule(1440, () => {
        onComplete();
      });
    });

    return () => {
      cancelled = true;
      for (const id of timers) {
        window.clearTimeout(id);
      }
    };
  }, [onComplete]);

  return (
    <div
      className={`mbc-startup-splash-overlay ${fadingOut ? 'is-fading-out' : ''}`}
      onMouseDown={onWindowChromeMouseDown}
      data-tauri-drag-region
    >
      <section
        className="mbc-startup-splash-card"
        aria-label="Loading MolBioCraft Workbench"
        data-tauri-drag-region
      >
        {/* Phoenix rising from a DNA double helix: the release artwork on the right half */}
        <img
          className="mbc-splash-phoenix"
          src={SPLASH_PHOENIX_SRC}
          width={880}
          height={880}
          alt=""
          aria-hidden="true"
          draggable={false}
          decoding="async"
        />

        <div className="mbc-splash-foreground">
          <div className="mbc-splash-copy">
            {/* Wordmark */}
            <div className="mbc-splash-wordmark-group">
              <div className="mbc-splash-title mbc-logo-wordmark">MolBioCraft</div>
              <div className="mbc-splash-subtitle mbc-logo-wordmark">Workbench</div>
            </div>

            {/* DNA double helix flowing into a protein alpha-helix, bleeding off the left edge */}
            <img
              className="mbc-splash-helix-ribbon"
              src={SPLASH_HELIX_SRC}
              width={1840}
              height={345}
              alt=""
              aria-hidden="true"
              draggable={false}
            />

            {/* Application & License Details */}
            <div className="mbc-splash-details-block">
              <p className="mbc-splash-summary-primary">
                Molecular &amp; Evolutionary Biology
                <br />
                Workbench
              </p>
              <p className="mbc-splash-license-title">
                CC BY-NC 4.0 (SPDX: CC-BY-NC-4.0)
                <br />
                Open-Source Research Workbench
              </p>
            </div>
          </div>

          {/* Bottom Loading Stage & Version Row */}
          <div className="mbc-splash-meta-row">
            <div
              id="mbc-splash-status-label"
              className="mbc-splash-status-text"
              role="status"
              aria-live="polite"
            >
              {stageLabel}
            </div>
            <div className="mbc-splash-version">Version {version}</div>
          </div>

          {/* Bottom Horizontal Progress Bar (<progress> per modern-web-guidance `progress`) */}
          <progress
            className="mbc-splash-progress"
            max={100}
            value={progress}
            aria-labelledby="mbc-splash-status-label"
          />
        </div>
      </section>
    </div>
  );
};
