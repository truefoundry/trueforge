/** Shared dynamic import so shell preload and editors race the same promise. */
let monacoImportPromise: Promise<typeof import('monaco-editor')> | undefined;

/** Start loading Monaco without mounting an editor. Safe to call repeatedly. */
export function preloadMonaco(): Promise<typeof import('monaco-editor')> {
  monacoImportPromise ??= import('monaco-editor');
  return monacoImportPromise;
}

/** Test-only: clear the cached import so preload can be re-exercised. */
export function resetMonacoPreloadForTests(): void {
  monacoImportPromise = undefined;
}
