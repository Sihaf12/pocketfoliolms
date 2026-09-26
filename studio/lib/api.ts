/**
 * Calls to the API, from the browser, through this origin's /api. Every
 * error arrives in the API's one shape; its message is already written
 * for a person, so it is shown as it is.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Messages about particular fields, by their dotted path in the request body. */
  get fields(): Map<string, string> {
    const raw = this.details.fields;
    const out = new Map<string, string>();
    if (Array.isArray(raw)) {
      for (const f of raw) {
        if (f && typeof f.field === 'string' && typeof f.message === 'string' && !out.has(f.field)) out.set(f.field, f.message);
      }
    }
    return out;
  }

  /** The list of things to fix, when the API sent one. */
  get problems(): string[] {
    const p = this.details.problems;
    return Array.isArray(p) ? p.filter((x): x is string => typeof x === 'string') : [];
  }
}

export async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      headers: init.body === undefined ? {} : { 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'offline', 'The studio could not reach the server. Check your connection and try again.', {});
  }
  if (res.status === 204 || res.status === 202) return undefined as T;
  const json: unknown = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
  if (!res.ok) {
    const error = (json as { error?: Record<string, unknown> } | null)?.error ?? {};
    const { code, message, ...details } = error;
    throw new ApiError(
      res.status,
      typeof code === 'string' ? code : 'error',
      typeof message === 'string' ? message : 'That did not work. Try again in a moment.',
      details,
    );
  }
  return json as T;
}
