export function removeKeys(obj: any, keys: string[]): any {
  if (Array.isArray(obj)) {
    return obj.map(item => removeKeys(item, keys));
  } else if (typeof obj === "object" && obj !== null) {
    const newObj: any = {};
    Object.entries(obj).forEach(([key, value]) => {
      if (!keys.includes(key)) {
        newObj[key] = removeKeys(value, keys);
      }
    });
    return newObj;
  }
  return obj;
}

export function normalize(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/gi, "");
}
