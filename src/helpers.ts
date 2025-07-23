import fetch, { RequestInit } from 'node-fetch'
import { URLSearchParams } from 'url'

/**
 * Wrapper um fetch mit AbortController.
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 5000
): Promise<Response> {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(id)
  }
}

/**
 * Baut eine query-string aus einem Objekt.
 */
export function buildQuery(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) qs.append(k, v)
  }
  return qs.toString()
}
