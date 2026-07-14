import { SortDirection, SortParam } from './sorting.types';

interface ParseSortParamOptions<TField extends string> {
  value: string | undefined;
  allowedFields: readonly TField[];
  defaultField: TField;
  defaultDirection?: SortDirection;
}

function isAllowedField<TField extends string>(
  field: string,
  allowedFields: readonly TField[],
): field is TField {
  return (allowedFields as readonly string[]).includes(field);
}

/**
 * Parses a `sort=field` / `sort=-field` query param into a field + direction
 * pair, restricted to a caller-supplied allowlist. Never touches raw input
 * beyond exact string matching against that allowlist, so it can't be used
 * to smuggle SQL or reach an unlisted column.
 */
export function parseSortParam<TField extends string>({
  value,
  allowedFields,
  defaultField,
  defaultDirection = 'asc',
}: ParseSortParamOptions<TField>): SortParam<TField> {
  if (!(allowedFields as readonly string[]).includes(defaultField)) {
    throw new Error(
      `parseSortParam: defaultField "${defaultField}" is not in allowedFields`,
    );
  }

  if (!value) {
    return { field: defaultField, direction: defaultDirection };
  }

  const direction: SortDirection = value.startsWith('-') ? 'desc' : 'asc';
  const field = value.startsWith('-') ? value.slice(1) : value;

  if (!isAllowedField(field, allowedFields)) {
    throw new Error(`parseSortParam: "${field}" is not an allowed sort field`);
  }

  return { field, direction };
}
