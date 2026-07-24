import type { ComposerShellProps } from '@truefoundry/agent-ui-sdk';
import { useEffect, useId, useRef, useState } from 'react';
import { ComposerCatalogControls, type CatalogTab } from './ComposerCatalogControls';
import { ArrowUpIcon, PlusIcon, SquareIcon } from './icons';

/**
 * Dark product-style composer: + opens catalog panel, skills chip, model chip, purple send.
 */
export function AppComposerShell({
  value,
  placeholder,
  disabled,
  isRunning = false,
  attachments,
  onValueChange,
  onSubmit,
  onCancel,
  onAttach,
  className,
}: ComposerShellProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<CatalogTab>('connectors');
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const openPanel = (tab: CatalogTab) => {
    setPanelTab(tab);
    setPanelOpen(true);
  };

  useEffect(() => {
    if (!panelOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setPanelOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPanelOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [panelOpen]);

  return (
    <div
      ref={rootRef}
      data-slot="aui_composer-shell"
      className={['composer-shell', className].filter(Boolean).join(' ')}
    >
      {attachments}
      <textarea
        className="composer-input"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        rows={2}
        aria-label="Message input"
        onChange={event => {
          onValueChange(event.target.value);
        }}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            onSubmit();
          }
        }}
      />
      <div className="composer-toolbar">
        <div className="composer-toolbar-left">
          <button
            type="button"
            className="icon-btn"
            aria-label="Open connectors and skills"
            aria-expanded={panelOpen}
            aria-controls={panelId}
            disabled={disabled}
            data-open={panelOpen || undefined}
            onClick={() => {
              if (panelOpen && panelTab === 'connectors') {
                setPanelOpen(false);
              } else {
                openPanel('connectors');
              }
            }}
          >
            <PlusIcon />
          </button>

          <ComposerCatalogControls mode="sandbox" disabled={disabled || isRunning} />

          <ComposerCatalogControls
            mode="skills-chip"
            disabled={disabled || isRunning}
            onOpenPanel={tab => {
              openPanel(tab);
            }}
          />

          {panelOpen ? (
            <div id={panelId} className="popover" role="dialog" aria-label="Catalog">
              <ComposerCatalogControls
                key={panelTab}
                mode="panel"
                initialTab={panelTab}
                disabled={disabled}
                isRunning={isRunning}
                {...(onAttach ? { onAttach } : {})}
              />
            </div>
          ) : null}
        </div>

        <div className="composer-toolbar-right">
          <ComposerCatalogControls mode="model" disabled={disabled} isRunning={isRunning} />
          {isRunning ? (
            <button
              type="button"
              className="send-btn"
              aria-label="Stop generating"
              disabled={!onCancel}
              onClick={onCancel}
            >
              <SquareIcon />
            </button>
          ) : (
            <button
              type="button"
              className="send-btn"
              aria-label="Send message"
              disabled={disabled || value.trim().length === 0}
              onClick={onSubmit}
            >
              <ArrowUpIcon />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
