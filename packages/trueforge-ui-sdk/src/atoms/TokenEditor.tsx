'use client';

import { useEffect, useState } from 'react';

import { Icon } from '../icons/Icon.js';
import { useOptionalDevTokens, useThemeTokens } from '../theme/ThemeProvider.js';
import {
  EDITABLE_TOKEN_GROUPS,
  EDITABLE_TOKEN_KEYS,
  TOKEN_CSS_VARS,
  TOKEN_DESCRIPTIONS,
  type SemanticTokens,
  type TokenOverrides,
} from '../theme/types.js';
import { auiButtonClass } from './lib/buttonClasses.js';
import { cn } from './lib/cn.js';
import { auiInputClass } from './lib/inputClasses.js';
import { Button } from './primitives/Button.js';
import { CenteredModal } from './primitives/CenteredModal.js';

type EditableTokens = Partial<SemanticTokens>;
type DraftTokens = { light: EditableTokens; dark: EditableTokens };

function pickEditable(tokens: SemanticTokens): EditableTokens {
  const out: EditableTokens = {};
  for (const key of EDITABLE_TOKEN_KEYS) {
    const value = tokens[key];
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

const HEX6 = /^#[0-9a-fA-F]{6}$/;
const HEX8 = /^#[0-9a-fA-F]{8}$/;

/** Best-effort mapping to the native color input's required `#rrggbb`. */
function toColorInputValue(value: string): string {
  if (HEX6.test(value)) return value;
  if (HEX8.test(value)) return value.slice(0, 7);
  return '#000000';
}

function TokenRow({
  tokenKey,
  value,
  onChange,
}: {
  tokenKey: (typeof EDITABLE_TOKEN_KEYS)[number];
  value: string;
  onChange: (next: string) => void;
}) {
  const cssVar = TOKEN_CSS_VARS[tokenKey];
  const description = TOKEN_DESCRIPTIONS[tokenKey];
  return (
    <div className="flex items-start gap-2 border-b border-border/50 py-2.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="font-mono text-xs text-foreground">{cssVar}</div>
        <p className="mt-0.5 text-[0.6875rem] leading-snug text-muted-foreground">{description}</p>
      </div>
      <span
        aria-hidden
        className="mt-0.5 size-6 shrink-0 rounded border border-border"
        style={{ backgroundColor: value }}
      />
      <input
        type="color"
        aria-label={`${cssVar} color picker`}
        value={toColorInputValue(value)}
        onChange={event => onChange(event.target.value)}
        className="mt-0.5 size-8 shrink-0 cursor-pointer rounded border border-input bg-background p-0.5"
      />
      <input
        type="text"
        aria-label={cssVar}
        value={value}
        onChange={event => onChange(event.target.value)}
        className={auiInputClass('mt-0.5 h-8 w-28 font-mono text-xs')}
      />
    </div>
  );
}

export function TokenEditorModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { setTokenOverrides, resetTokenOverrides, resolveTokens } = useThemeTokens();
  const [activeMode, setActiveMode] = useState<'light' | 'dark'>('light');
  const [draft, setDraft] = useState<DraftTokens>(() => ({
    light: pickEditable(resolveTokens('light')),
    dark: pickEditable(resolveTokens('dark')),
  }));

  // Re-seed on open, and after a reset (which changes `resolveTokens`), so the
  // editor always reflects the tokens currently applied to the app.
  useEffect(() => {
    if (!open) return;
    setDraft({ light: pickEditable(resolveTokens('light')), dark: pickEditable(resolveTokens('dark')) });
  }, [open, resolveTokens]);

  const updateToken = (key: keyof SemanticTokens, next: string) => {
    setDraft(prev => ({ ...prev, [activeMode]: { ...prev[activeMode], [key]: next } }));
  };

  const handleSave = () => {
    const overrides: TokenOverrides = { light: draft.light, dark: draft.dark };
    setTokenOverrides(overrides);
    onOpenChange(false);
  };

  const handleCopy = () => {
    void navigator.clipboard?.writeText(JSON.stringify(draft, null, 2));
  };

  const activeTokens = draft[activeMode];

  return (
    <CenteredModal
      open={open}
      onOpenChange={onOpenChange}
      title="Tokens (For Dev)"
      description="Edit semantic colors and apply them live. Each swatch notes which UI to check. Persists in this browser only."
      headerIcon={<Icon name="palette" className="text-muted-foreground" />}
      contentSized
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-1 border-b border-border px-5 py-3">
          {(['light', 'dark'] as const).map(modeOption => (
            <button
              key={modeOption}
              type="button"
              onClick={() => setActiveMode(modeOption)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors',
                activeMode === modeOption
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              )}
            >
              {modeOption}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {EDITABLE_TOKEN_GROUPS.map(group => (
            <section key={group.label} className="mb-4 last:mb-0">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
              </h3>
              {group.keys.map(key => (
                <TokenRow
                  key={key}
                  tokenKey={key}
                  value={activeTokens[key] ?? ''}
                  onChange={next => updateToken(key, next)}
                />
              ))}
            </section>
          ))}
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" size="sm" onClick={resetTokenOverrides}>
            Reset to defaults
          </Button>
          <span className="min-w-0 flex-1" />
          <Button variant="outline" size="sm" onClick={handleCopy}>
            <Icon name="copy" />
            Copy JSON
          </Button>
          <Button variant="default" size="sm" onClick={handleSave}>
            Save
          </Button>
        </footer>
      </div>
    </CenteredModal>
  );
}

export function TokenEditorButton() {
  const devTokensEnabled = useOptionalDevTokens();
  const [open, setOpen] = useState(false);

  if (!devTokensEnabled) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Tokens (For Dev)"
        title="Tokens (For Dev)"
        aria-expanded={open}
        className={auiButtonClass({ variant: 'ghost', size: 'icon' })}
        onClick={() => setOpen(true)}
      >
        <Icon name="palette" />
      </button>
      <TokenEditorModal open={open} onOpenChange={setOpen} />
    </>
  );
}
