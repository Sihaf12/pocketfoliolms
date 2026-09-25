/**
 * Schemas shared by the paper-based routes. A paper question never
 * carries its correct key or rationales; the response schema would drop
 * them even if a query selected them.
 */
export const uuid = { type: 'string', format: 'uuid' } as const;

const option = {
  type: 'object',
  required: ['key', 'text'],
  properties: { key: { type: 'string' }, text: { type: 'string' } },
} as const;

export const paperQuestion = {
  type: 'object',
  required: ['id', 'prompt', 'options'],
  properties: {
    id: { type: 'string' },
    tier: { type: 'string' },
    prompt: { type: 'string' },
    options: { type: 'array', items: option },
  },
} as const;

export const paper = {
  type: 'object',
  required: ['attemptId', 'questions'],
  properties: { attemptId: { type: 'string' }, questions: { type: 'array', items: paperQuestion } },
} as const;

export const attemptParams = {
  type: 'object',
  additionalProperties: false,
  required: ['attemptId'],
  properties: { attemptId: uuid },
} as const;

/** { [questionId]: optionKey }. `nullable` allows an explicit skip. */
export function answersBody(nullable: boolean) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['answers'],
    properties: {
      answers: {
        type: 'object',
        maxProperties: 64,
        propertyNames: uuid,
        additionalProperties: nullable
          ? { type: ['string', 'null'], maxLength: 16 }
          : { type: 'string', maxLength: 16 },
      },
    },
  } as const;
}

export interface PaperQuestion {
  id: string;
  tier?: string;
  prompt: string;
  options: { key: string; text: string }[];
}

/** Rows fetched by id come back in any order; the paper's order is the attempt's. */
export function inPaperOrder<T extends { id: string }>(ids: readonly string[], rows: readonly T[]): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
}
