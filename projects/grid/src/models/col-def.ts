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
  /** Renders a selection checkbox in this column's cells, and a select-all checkbox in its header
   * when `rowSelection` is `'multiple'`. Typically set on the first column. */
  checkboxSelection?: boolean;
  /** Enables inline editing for this column (double-click, or single-click via `singleClickEdit`). */
  editable?: boolean | ((row: TData) => boolean);
  /** Editor widget shown while editing; defaults to `'text'`. */
  cellEditor?: 'text' | 'number' | 'select' | 'date' | 'checkbox';
  cellEditorParams?: { options?: { label: string; value: TValue }[] };
  /** Applies a committed edit; defaults to `row[field] = value`. Use for computed/nested fields. */
  valueSetter?: (row: TData, value: TValue) => void;
  hide?: boolean;
  pinned?: 'left' | 'right' | null;
  cellClass?: string | string[];
  valueGetter?: (data: TData) => TValue;
  valueFormatter?: (value: TValue) => string;
}
