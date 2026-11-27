const PROVIDER_KEY_URLS = new Map<string, string>([
  ['openai', 'https://platform.openai.com/api-keys'],
  ['anthropic', 'https://console.anthropic.com/settings/keys'],
  ['google-gemini', 'https://aistudio.google.com/app/apikey'],
  ['fireworks', 'https://fireworks.ai/account/api-keys'],
  ['zai', 'https://z.ai/manage-apikey/apikey-list'],
  ['moonshot', 'https://platform.moonshot.ai/console/api-keys'],
  ['alibaba', 'https://bailian.console.alibabacloud.com/?apiKey=1'],
  ['together', 'https://api.together.ai/settings/api-keys'],
]);

/** Page where a user creates an API key for a well-known provider; undefined for others. */
export function providerKeyUrl(providerType: string): string | undefined {
  return PROVIDER_KEY_URLS.get(providerType);
}

/** Catalog names are lowercase ids (`google-gemini`); onboarding shows them capitalized. */
export function formatProviderName(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}
