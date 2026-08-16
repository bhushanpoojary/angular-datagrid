/** Column definition for the data grid. Extended feature-by-feature through later phases. */
export interface ColDef<TData = unknown, TValue = unknown> {
  field?: keyof TData & string;
  headerName?: string;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  flex?: number;
  sortable?: boolean;
  /** Declarative initial sort direction, applied on first render. */
  sort?: 'asc' | 'desc';
  /** When multiple columns declare `sort`, the lowest `sortIndex` is applied first. */
  sortIndex?: number;
  /** Custom comparator; defaults to a numeric/date/locale-aware comparison of resolved values. */
  comparator?: (valueA: TValue, valueB: TValue, rowA: TData, rowB: TData) => number;
  /** Enables a per-column filter row input. `true` behaves like `'text'` (case-insensitive substring). */
  filter?: boolean | 'text' | 'number' | 'date';
  hide?: boolean;
  pinned?: 'left' | 'right' | null;
  cellClass?: string | string[];
  valueGetter?: (data: TData) => TValue;
  valueFormatter?: (value: TValue) => string;
}
