import { Icon } from '../../icons/Icon.js';
import { cn } from '../lib/cn.js';
import { Button } from '../primitives/Button.js';

export type McpServer = {
  id: string;
  name: string;
};

export type McpAuthPromptProps = {
  servers: McpServer[];
  connectedServerIds?: ReadonlySet<string>;
  continueLoading?: boolean;
  onConnect: (serverId: string) => void;
  onContinue?: () => void;
  readOnly?: boolean;
  title?: string;
  dataTestPrefix?: string;
  className?: string;
};

const DEFAULT_TITLE = 'MCP Authentication Required';

export function McpAuthPrompt({
  servers,
  connectedServerIds,
  continueLoading = false,
  onConnect,
  onContinue,
  readOnly = false,
  title = DEFAULT_TITLE,
  dataTestPrefix,
  className,
}: McpAuthPromptProps) {
  if (servers.length === 0) return null;

  return (
    <div
      className={cn(
        // Inset vs composer so stacked pause chrome matches the design (~1rem each side).
        'aui-mcp-auth-prompt mx-auto w-[calc(100%-2rem)] min-w-0 overflow-hidden rounded-lg',
        className,
      )}
      data-testid={dataTestPrefix ? `${dataTestPrefix}-mcp-auth-card` : undefined}
    >
      <div className="border rounded-t-lg border-primary-button-bg/30 bg-primary-button-bg/10 px-4 py-2.5">
        <div className="font-sans text-sm font-medium text-primary-button-bg">{title}</div>
      </div>
      <div className="flex flex-col gap-3 bg-primary-bg px-4 py-3 border border-border border-t-0">
        {servers.map(server => (
          <div key={server.id} className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-1.5 text-sm">
              <Icon name="mcp-server" size="0.875rem" className="shrink-0 text-text-secondary" />
              <span className="shrink-0 font-medium text-text-secondary">MCP Server Name</span>
              <span className="shrink-0 text-xs font-semibold text-text-secondary">:</span>
              <span className="truncate font-sans font-medium text-text-primary">{server.name}</span>
            </div>
            {connectedServerIds?.has(server.id) ? (
              <span className="inline-flex shrink-0 items-center gap-1 text-xs text-success-bg">
                <Icon name="check" size="0.875rem" />
                Connected
              </span>
            ) : (
              <Button.Secondary
                size="small"
                disabled={readOnly}
                onClick={() => onConnect(server.id)}
                className="shrink-0"
              >
                Connect
                <Icon name="external-link" size="0.75em" className="ml-1" />
              </Button.Secondary>
            )}
          </div>
        ))}
        {onContinue && (
          <div className="flex justify-end pt-1">
            <Button.Primary
              size="small"
              disabled={readOnly || continueLoading}
              onClick={onContinue}
              className="bg-gray-850 text-white hover:bg-gray-850 dark:text-black"
            >
              {continueLoading ? <Icon name="loader" className="animate-spin" /> : null}
              Continue
            </Button.Primary>
          </div>
        )}
      </div>
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    McpAuthPrompt: typeof McpAuthPrompt;
  }
}
