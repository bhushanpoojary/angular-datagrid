/** Column definition for the data grid. Extended feature-by-feature through later phases. */
import type { TemplateRef } from '@angular/core';

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
  /** Allows the user to drag-resize this column's width from its header. Defaults to `true`. */
  resizable?: boolean;
  cellClass?: string | string[];
  /** Conditionally-applied classes; each function receives the resolved cell value + full row. */
  cellClassRules?: Record<string, (params: { value: TValue; data: TData }) => boolean>;
  valueGetter?: (data: TData) => TValue;
  valueFormatter?: (value: TValue) => string;
  /** Custom cell content via template projection - the template's implicit context is the
   * resolved value, with `value`/`data` also available as named context variables:
   * `<ng-template #tpl let-value let-data="data">...</ng-template>`, then
   * `{ field: 'x', cellRenderer: tpl }` where `tpl` is a `@ViewChild('tpl') tpl!: TemplateRef<...>`. */
  cellRenderer?: TemplateRef<{ $implicit: TValue; value: TValue; data: TData }>;
  /** Shows a native browser tooltip (the `title` attribute) on hover; `true` uses the cell's
   * displayed value, or supply a function for custom tooltip text. */
  tooltip?: boolean | ((row: TData) => string);
  /** Groups rows by this column's value, rendering a collapsible group-header row per distinct
   * value instead of individual rows for it. When multiple columns declare `rowGroup: true`,
   * `rowGroupIndex` controls nesting order (lower = outer group); grouping happens after sorting. */
  rowGroup?: boolean;
  rowGroupIndex?: number;
  /** Shows an aggregated value (over the resolved cell value) in each group-header row for this
   * column. Requires at least one other column to declare `rowGroup: true`. */
  aggFunc?: 'sum' | 'avg' | 'min' | 'max' | 'count';
}
