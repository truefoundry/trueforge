/** Read an own key. `object` has no index signature. */
export function ownProperty(value: object, key: string): unknown {
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (entryKey === key) {
      return entryValue;
    }
  }
  return undefined;
}
