'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useTrackAnalytics } from '@/analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '@/analytics/events.js';
import { auiButtonClass } from '@/atoms/lib/buttonClasses.js';
import { cn } from '@/atoms/lib/cn.js';
import { auiSelectTriggerClass } from '@/atoms/lib/selectClasses.js';
import { themePortalRoot } from '@/atoms/lib/themePortalRoot.js';
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

const MENU_GAP_PX = 4;
const MENU_MAX_HEIGHT_CLASS = 'max-h-80';

export default function AppearanceSettings() {
  const { preset, typefaceId, setTypeface, resetTypeface } = useTheme();
  const track = useTrackAnalytics();
  // Unset preference keeps the preset face; trueforge’s brand default is Geist.
  const selectedId = typefaceId ?? (preset === 'trueforge' ? DEFAULT_TYPEFACE_ID : null);
  const selectedOption = selectedId != null ? getTypefaceOption(selectedId) : null;
  const isCustomized = selectedId != null && selectedId !== DEFAULT_TYPEFACE_ID;

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  useEffect(() => {
    ensureAllTypefaceStylesheets(TYPEFACE_OPTIONS);
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const update = () => {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setPos({
        top: rect.bottom + MENU_GAP_PX,
        left: rect.left,
        width: Math.max(rect.width, 16 * 16),
      });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return;
      if (rootRef.current?.contains(event.target)) return;
      if (menuRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

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
      setOpen(false);
      triggerRef.current?.focus();
    },
    [resetTypeface, setTypeface, track, typefaceId],
  );

  const handleReset = useCallback(() => {
    if (!isCustomized) return;
    resetTypeface();
    track(AnalyticsEvents.Settings.TYPEFACE_RESET);
    setOpen(false);
  }, [isCustomized, resetTypeface, track]);

  const menu =
    open && pos != null
      ? createPortal(
          <div
            ref={menuRef}
            className={cn(
              'aui-popup-enter fixed z-[200] overflow-hidden rounded-[0.25rem] border border-border bg-card-bg shadow-md',
              MENU_MAX_HEIGHT_CLASS,
              'overflow-y-auto',
            )}
            style={{ top: pos.top, left: pos.left, width: pos.width }}
            onMouseDown={event => event.stopPropagation()}
          >
            <div id={listboxId} role="listbox" aria-label="Typeface">
              {TYPEFACE_OPTIONS.map(option => {
                const selected = option.id === selectedId;
                const label = typefaceMenuLabel(option);
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    aria-label={label}
                    className={cn(
                      'flex w-full items-center gap-3 border-b border-border px-3 py-3 text-left transition-colors last:border-b-0',
                      'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus-ring focus-visible:ring-inset',
                      selected
                        ? 'bg-primary-button-bg/10 text-text-primary'
                        : 'text-text-primary hover:bg-ghost-button-hover/60',
                    )}
                    onClick={() => selectTypeface(option.id)}
                  >
                    <span
                      className={cn(
                        'flex size-5 shrink-0 items-center justify-center rounded-full border',
                        selected
                          ? 'border-primary-button-bg bg-primary-button-bg text-primary-button-text'
                          : 'border-border',
                      )}
                      aria-hidden
                    >
                      {selected ? <Icon name="check" className="size-3" /> : null}
                    </span>
                    <span
                      className="min-w-0 flex-1 truncate text-base font-medium"
                      style={{ fontFamily: option.fontFamily }}
                    >
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>,
          themePortalRoot(rootRef.current),
        )
      : null;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      <h3 className="text-xl font-semibold tracking-tight text-text-primary">Appearance</h3>
      <p className="mt-1 text-sm text-text-secondary">Choose the colors and fonts you see in the app</p>

      <section className="mt-8" aria-labelledby="appearance-visual-style-heading">
        <h4 id="appearance-visual-style-heading" className="text-base font-semibold text-text-primary">
          Visual style
        </h4>

        <div className="mt-3 divide-y divide-border border-y border-border">
          <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-text-primary">Typeface</p>
              <p className="mt-0.5 text-sm text-text-secondary">
                Change the font used throughout the application.
              </p>
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

              <div ref={rootRef} className="relative min-w-48">
                <button
                  ref={triggerRef}
                  type="button"
                  aria-label="Typeface"
                  aria-haspopup="listbox"
                  aria-expanded={open}
                  aria-controls={open ? listboxId : undefined}
                  className={auiSelectTriggerClass('h-9 rounded-[0.25rem] px-3')}
                  style={selectedOption != null ? { fontFamily: selectedOption.fontFamily } : undefined}
                  onClick={() => setOpen(next => !next)}
                  onKeyDown={event => {
                    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setOpen(true);
                    }
                  }}
                >
                  <span className="truncate font-medium">
                    {selectedOption != null ? typefaceMenuLabel(selectedOption) : 'Select typeface'}
                  </span>
                  <Icon name="chevron-down" className="size-4 shrink-0 text-text-secondary" />
                </button>
                {menu}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
