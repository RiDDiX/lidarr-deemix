export function removeKeys(obj: any, keys: string[]): any {
  if (Array.isArray(obj)) {
    return obj.map((v) => removeKeys(v, keys));
  } else if (typeof obj === "object" && obj !== null) {
    return Object.keys(obj).reduce((acc, key) => {
      if (!keys.includes(key)) {
        acc[key] = removeKeys(obj[key], keys);
      }
      return acc;
    }, {} as any);
  }
  return obj;
}

export function normalize(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/gi, "");
}
