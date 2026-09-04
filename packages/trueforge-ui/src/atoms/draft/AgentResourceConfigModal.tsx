'use client';

import type { AgentSkill, AgentSpec, ConnectorState, McpToolSelection } from '../../server/types.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import { auiButtonClass } from '../lib/buttonClasses.js';
import { CenteredModal } from '../primitives/CenteredModal.js';

export type AgentResourceConfigModalProps = {
  editor: 'mcp' | 'skills' | null;
  spec: AgentSpec;
  connectors: ConnectorState[];
  skills: AgentSkill[];
  skillsDisabled: boolean;
  query: string;
  activeConnectorId: string | null;
  tools: McpToolSelection[];
  toolsLoading: boolean;
  toolsError: string | null;
  onQueryChange: (query: string) => void;
  onSelectConnector: (connectorId: string) => void;
  onRetryTools: () => void;
  onRefreshConnectors?: () => Promise<void>;
  onChange: (spec: AgentSpec) => void;
  onClose: () => void;
};

export function AgentResourceConfigModal({ editor, onClose, ...contentProps }: AgentResourceConfigModalProps) {
  const AgentResourceEditorContent = useSlot('AgentResourceEditorContent');
  const selectingMcp = editor === 'mcp';

  return (
    <CenteredModal
      open={editor !== null}
      onOpenChange={open => !open && onClose()}
      title={selectingMcp ? 'Select MCP Tools' : 'Skills'}
      className={
        selectingMcp
          ? 'md:w-[min(64rem,calc(100%-3rem))] md:max-w-5xl'
          : 'md:w-[min(40rem,calc(100%-3rem))] md:max-w-2xl'
      }
      contentSized
      aria-label={selectingMcp ? 'Select MCP Tools' : 'Edit skills'}
      footer={
        selectingMcp ? (
          <div className="flex justify-end">
            <button type="button" className={auiButtonClass()} onClick={onClose}>
              Save
            </button>
          </div>
        ) : undefined
      }
    >
      {editor ? <AgentResourceEditorContent editor={editor} {...contentProps} /> : null}
    </CenteredModal>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentResourceConfigModal: typeof AgentResourceConfigModal;
  }
}
