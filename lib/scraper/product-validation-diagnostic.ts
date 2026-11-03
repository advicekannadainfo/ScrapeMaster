import type { ZodError } from 'zod';
/** Only caller-allowlisted paths and fixed Zod codes/types; never issue messages/values. */
export function productValidationDiagnostic(error: ZodError, fields: readonly string[]) {
  const allowed = new Set(fields);
  return error.issues
    .slice(0, 8)
    .map((issue) => {
      const path = issue.path
        .map((part) =>
          typeof part === 'number' ? '[]' : allowed.has(part) ? part : '[field]',
        )
        .join('.');
      return `${path}:${issue.code}${issue.code === 'invalid_type' ? `:observed=${issue.received}` : ''}`;
    })
    .join('; ');
}
