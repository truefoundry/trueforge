import { useOptionalShellMode, WelcomeScreen, type WelcomeScreenProps } from '@truefoundry/trueforge-ui';

/**
 * WelcomeScreen override: New Agent empty state gets a polka-dot canvas
 * (see `.new-agent-welcome` + viewport `:has()` rule in `index.css`).
 * Named chats and plain New Chat keep the default welcome.
 */
export function NewAgentWelcomeScreen(props: WelcomeScreenProps) {
  const shell = useOptionalShellMode();
  const isNewAgent =
    shell?.mode.status === 'active' &&
    shell.mode.isMutable &&
    shell.mode.isCreateAgent &&
    !(shell.mode.agentName != null && shell.mode.agentName.length > 0);

  const className = [isNewAgent ? 'new-agent-welcome' : undefined, props.className].filter(Boolean).join(' ');

  return <WelcomeScreen {...props} {...(className ? { className } : {})} />;
}
