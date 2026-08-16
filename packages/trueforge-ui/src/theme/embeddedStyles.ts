/**
 * Build-time placeholder. The tsup `embed-css` plugin replaces this module with
 * the contents of `dist/styles.css` so `ensureStyles` can inject without a host
 * CSS import. Source/tests see an empty string until CSS has been built.
 */
export const EMBEDDED_STYLES = '';
