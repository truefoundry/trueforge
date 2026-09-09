import { Icon } from '../../icons/Icon.js';
import { cn } from '../lib/cn.js';
import { Button } from '../primitives/Button.js';

export type McpServer = {
  id: string;
  name: string;
};

export type McpAuthPromptProps = {
  servers: McpServer[];
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
      className={cn('aui-mcp-auth-prompt mt-2 overflow-hidden rounded-lg border border-border', className)}
      data-testid={dataTestPrefix ? `${dataTestPrefix}-mcp-auth-card` : undefined}
    >
      <div className="border-b border-primary-button-bg/30 bg-primary-button-bg/10 px-4 py-2">
        <div className="font-sans text-sm font-medium text-primary-button-bg">{title}</div>
      </div>
      <div className="flex flex-col gap-3 bg-primary-bg px-4 py-3">
        {servers.map(server => (
          <div key={server.id} className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-1.5 text-sm">
              <span className="shrink-0 font-medium text-text-secondary">MCP Server Name</span>
              <span className="shrink-0 text-xs font-semibold text-text-secondary">:</span>
              <span className="truncate font-sans font-medium text-text-primary">{server.name}</span>
            </div>
            <Button.Primary size="small" disabled={readOnly} onClick={() => onConnect(server.id)} className="shrink-0">
              Connect
              <Icon name="external-link" size="0.75em" className="ml-1" />
            </Button.Primary>
          </div>
        ))}
        {onContinue && (
          <div className="flex justify-end border-t border-border pt-2">
            <Button.Primary size="small" disabled={readOnly} onClick={onContinue}>
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
