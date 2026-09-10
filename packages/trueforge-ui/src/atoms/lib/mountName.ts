export function mountName(mount: object): string | null {
  return 'name' in mount && typeof mount.name === 'string' ? mount.name : null;
}
