import type {
  ThreadListEmptyStateProps,
  ThreadListNewButtonProps,
  ThreadListRowProps,
  ThreadListShellProps,
  WelcomeScreenProps,
} from '@truefoundry/agent-ui-sdk';
import { PencilSquareIcon } from './icons';

export function AppWelcomeScreen({ heading = 'How can I help you today?', className }: WelcomeScreenProps) {
  return (
    <div className={['welcome-screen', className].filter(Boolean).join(' ')}>
      <h1>{heading}</h1>
    </div>
  );
}

export function AppThreadListShell({ header, children, className }: ThreadListShellProps) {
  return (
    <div className={['sidebar-shell', className].filter(Boolean).join(' ')}>
      <div className="sidebar-nav">{header}</div>
      <div className="sidebar-history-label">
        <span>Chat History</span>
      </div>
      <div className="sidebar-history-list">{children}</div>
    </div>
  );
}

export function AppThreadListNewButton({ className, onClick, disabled }: ThreadListNewButtonProps) {
  return (
    <button
      type="button"
      className={['sidebar-new-chat', className].filter(Boolean).join(' ')}
      onClick={onClick}
      disabled={disabled}
    >
      <PencilSquareIcon />
      New Chat
    </button>
  );
}

export function AppThreadListEmptyState({ message = 'No chats yet.', className }: ThreadListEmptyStateProps) {
  return <div className={['sidebar-empty', className].filter(Boolean).join(' ')}>{message}</div>;
}

export function AppThreadListRow({ title, active, onSelect, className }: ThreadListRowProps) {
  return (
    <button
      type="button"
      className={['sidebar-row', className].filter(Boolean).join(' ')}
      data-active={active || undefined}
      onClick={onSelect}
    >
      <span>{title}</span>
    </button>
  );
}
