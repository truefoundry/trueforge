import type { WelcomeScreenProps } from '@truefoundry/agent-ui-sdk';

export function AppWelcomeScreen({ heading = 'How can I help you today?', className }: WelcomeScreenProps) {
  return (
    <div className={['welcome-screen', className].filter(Boolean).join(' ')}>
      <h1>{heading}</h1>
    </div>
  );
}
