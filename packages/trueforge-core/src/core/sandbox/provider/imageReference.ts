const IMAGE_BUILD_NAME_PREFIX = 'trueforge-build-';

/** Deterministic build name per image tag or digest so every server replica converges on one build. */
export function deriveSandboxImageBuildName(image: string): string {
  const lastSegment = image.slice(image.lastIndexOf('/') + 1);
  const colon = lastSegment.lastIndexOf(':');
  if (colon === -1) {
    throw new Error(`Sandbox image reference has no tag/digest: ${image}`);
  }
  return `${IMAGE_BUILD_NAME_PREFIX}${lastSegment.slice(colon + 1)}`;
}
