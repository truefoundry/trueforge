'use client';

import { useCallback, useEffect } from 'react';

import { useTrackAnalytics } from '@/analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '@/analytics/events.js';
import { auiButtonClass } from '@/atoms/lib/buttonClasses.js';
import { auiSelectTriggerClass } from '@/atoms/lib/selectClasses.js';
import { DropdownMenu, DropdownMenuItem } from '@/atoms/primitives/DropdownMenu.js';
import { Icon } from '@/icons/Icon.js';
import { ensureAllTypefaceStylesheets } from '@/theme/ensureTypeface.js';
import { useTheme } from '@/theme/ThemeProvider.js';
import {
  DEFAULT_TYPEFACE_ID,
  TYPEFACE_OPTIONS,
  getTypefaceOption,
  typefaceMenuLabel,
  type TypefaceId,
} from '@/theme/typefaces.js';

export default function AppearanceSettings() {
  const { typefaceId, setTypeface, resetTypeface } = useTheme();
  const track = useTrackAnalytics();
  // Unset preference keeps IBM Plex Sans (brand default) on every preset.
  const selectedId = typefaceId ?? DEFAULT_TYPEFACE_ID;
  const selectedOption = getTypefaceOption(selectedId);
  const isCustomized = selectedId !== DEFAULT_TYPEFACE_ID;

  useEffect(() => {
    ensureAllTypefaceStylesheets(TYPEFACE_OPTIONS);
  }, []);

  const selectTypeface = useCallback(
    (id: TypefaceId) => {
      if (id === DEFAULT_TYPEFACE_ID) {
        if (typefaceId != null) {
          resetTypeface();
          track(AnalyticsEvents.Settings.TYPEFACE_RESET);
        }
      } else if (id !== typefaceId) {
        setTypeface(id);
        track(AnalyticsEvents.Settings.TYPEFACE_CHANGED, { typeface: id });
      }
    },
    [resetTypeface, setTypeface, track, typefaceId],
  );

  const handleReset = useCallback(() => {
    if (!isCustomized) return;
    resetTypeface();
    track(AnalyticsEvents.Settings.TYPEFACE_RESET);
  }, [isCustomized, resetTypeface, track]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      <h3 className="text-xl font-semibold tracking-tight text-text-primary">Appearance</h3>
      <p className="mt-1 text-sm text-text-secondary">Choose the font you see in the app</p>

      <section className="mt-8" aria-labelledby="appearance-visual-style-heading">
        <h4 id="appearance-visual-style-heading" className="text-base font-semibold text-text-primary">
          Visual style
        </h4>

        <div className="mt-3 divide-y divide-border border-y border-border">
          <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-text-primary">Typeface</p>
              <p className="mt-0.5 text-sm text-text-secondary">Change the font used throughout the application.</p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {isCustomized ? (
                <button
                  type="button"
                  aria-label="Reset typeface to default"
                  title="Reset to default"
                  className={auiButtonClass({
                    variant: 'ghost',
                    size: 'icon',
                    className: 'size-8 text-text-secondary hover:text-text-primary',
                  })}
                  onClick={handleReset}
                >
                  <Icon name="rotate-right" className="size-4" />
                </button>
              ) : null}

              <DropdownMenu
                align="start"
                lockScroll
                className="max-h-64 min-w-48 overflow-y-auto"
                trigger={
                  <button
                    type="button"
                    aria-label="Typeface"
                    className={auiSelectTriggerClass('w-48')}
                    style={{ fontFamily: selectedOption.fontFamily }}
                  >
                    <span className="truncate">{typefaceMenuLabel(selectedOption)}</span>
                    <Icon name="chevron-down" className="size-4 shrink-0 text-text-secondary" />
                  </button>
                }
              >
                {TYPEFACE_OPTIONS.map(option => {
                  const selected = option.id === selectedId;
                  const label = typefaceMenuLabel(option);
                  return (
                    <DropdownMenuItem
                      key={option.id}
                      aria-label={label}
                      aria-selected={selected}
                      className="justify-between gap-2 text-left"
                      onClick={() => selectTypeface(option.id)}
                    >
                      <span className="min-w-0 truncate" style={{ fontFamily: option.fontFamily }}>
                        {label}
                      </span>
                      {selected ? <Icon name="check" className="size-3.5 shrink-0" /> : null}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenu>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
