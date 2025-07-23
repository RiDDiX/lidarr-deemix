export function removeKeys(obj: any, keys: string[]): any {
  if (Array.isArray(obj)) {
    return obj.map((item) => removeKeys(item, keys));
  } else if (typeof obj === "object" && obj !== null) {
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([k]) => !keys.includes(k))
        .map(([k, v]) => [k, removeKeys(v, keys)])
    );
  }
  return obj;
}
