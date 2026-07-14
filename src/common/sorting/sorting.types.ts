export type SortDirection = 'asc' | 'desc';

export interface SortParam<TField extends string = string> {
  field: TField;
  direction: SortDirection;
}
