export function LoginPage() {
  const error = new URLSearchParams(window.location.search).get('error');
  const loginHref = '/api/v1/auth/login?return_to=%2F';

  let message: string | undefined;
  if (error) {
    message = 'Sign-in failed. Try again.';
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="flex w-full max-w-sm flex-col gap-6 text-center">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">TrueForge</h1>
          <p className="text-sm text-muted-foreground">Sign in to continue.</p>
        </div>
        {message ? (
          <p className="text-sm leading-6 text-destructive" role="alert">
            {message}
          </p>
        ) : null}
        <a
          href={loginHref}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Sign in
        </a>
      </div>
    </main>
  );
}
