import sandboxImage from './sandboxImage.json' with { type: 'json' };

/** Release-owned sandbox image URI; CI rewrites `sandboxImage.json`. */
export const SANDBOX_IMAGE_URI = sandboxImage.uri;
