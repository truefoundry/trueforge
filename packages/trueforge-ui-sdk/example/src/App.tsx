import { TrueforgeUI } from '@truefoundry/trueforge-ui';

function MissingEnv({ missing }: { missing: string[] }) {
  return (
    <div className="missing-env">
      <h1>Missing environment variables</h1>
      <p>
        Copy <code>.env.example</code> to <code>.env</code> and set:
      </p>
      <ul>
        {missing.map(name => (
          <li key={name}>
            <code>{name}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function App() {
  const apiKey = import.meta.env.VITE_TFY_API_KEY?.trim() ?? '';
  const controlPlaneURL = import.meta.env.VITE_TFY_CONTROL_PLANE_URL?.trim() ?? '';
  const gatewayPlaneURL = import.meta.env.VITE_TFY_GATEWAY_URL?.trim() || undefined;

  const missing = [!apiKey && 'VITE_TFY_API_KEY', !controlPlaneURL && 'VITE_TFY_CONTROL_PLANE_URL'].filter(
    Boolean,
  ) as string[];

  if (missing.length > 0) {
    return <MissingEnv missing={missing} />;
  }

  return (
    <div className="flex h-dvh min-h-0 w-full flex-1 flex-col">
      <TrueforgeUI
        server={{
          type: 'truefoundry',
          apiKey,
          controlPlaneURL,
          ...(gatewayPlaneURL ? { gatewayPlaneURL } : {}),
        }}
        agentConfig={{ mode: 'AgentLibraryWithComposer' }}
        theme={{
          brand: {
            icon: {
              src: 'https://media.licdn.com/dms/image/v2/C560BAQGQ9Tfeof4MbA/company-logo_200_200/company-logo_200_200/0/1644494262340/truefoundry_logo?e=2147483647&v=beta&t=Xm6c1LGNbVPD2Ehtj21Z5OcuSCGLhYwlJ763oEYb92M',
              alt: 'TrueFoundry',
            },
            name: 'TFY',
          },
        }}
        layout="sidebar"
        className="h-full min-h-0"
      />
    </div>
  );
}
