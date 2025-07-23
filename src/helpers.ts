export function removeKeys(obj: any, keys: string[]): any {
  if (Array.isArray(obj)) {
    return obj.map((item) => removeKeys(item, keys));
  } else if (typeof obj === "object" && obj !== null) {
    const newObj: any = {};
    for (const key in obj) {
      if (!keys.includes(key)) {
        newObj[key] = removeKeys(obj[key], keys);
      }
    }
    return newObj;
  }
  return obj;
}

export function normalize(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/gi, "")
    .toLowerCase();
}
