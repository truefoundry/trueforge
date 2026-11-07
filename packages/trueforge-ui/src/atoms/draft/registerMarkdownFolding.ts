import { computeMarkdownFoldingRanges } from './markdownFolding.js';

type FoldingModel = { getLineCount(): number; getLineContent(lineNumber: number): string };

type MonacoFoldingApi = {
  languages: {
    registerFoldingRangeProvider(
      language: string,
      provider: { provideFoldingRanges(model: FoldingModel): { start: number; end: number }[] },
    ): unknown;
  };
};

function hasFoldingApi(monaco: unknown): monaco is MonacoFoldingApi {
  if (typeof monaco !== 'object' || monaco === null || !('languages' in monaco)) return false;
  const { languages } = monaco;
  return (
    typeof languages === 'object' &&
    languages !== null &&
    'registerFoldingRangeProvider' in languages &&
    typeof languages.registerFoldingRangeProvider === 'function'
  );
}

let registered = false;

/** Monaco providers are global per language, so register once per page. */
export function registerMarkdownFolding(monaco: unknown): void {
  if (registered || !hasFoldingApi(monaco)) return;
  registered = true;
  monaco.languages.registerFoldingRangeProvider('markdown', {
    provideFoldingRanges(model) {
      const lines = Array.from({ length: model.getLineCount() }, (_, i) => model.getLineContent(i + 1));
      return computeMarkdownFoldingRanges(lines);
    },
  });
}
