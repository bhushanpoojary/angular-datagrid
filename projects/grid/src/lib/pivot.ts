import type { ColDef } from '../models/col-def';

export interface PivotOptions<TData> {
  /** Field whose distinct values become output rows. */
  rowField: keyof TData & string;
  /** Field whose distinct values become output columns. */
  columnField: keyof TData & string;
  /** Numeric field aggregated at each row/column intersection. */
  valueField: keyof TData & string;
  /** Defaults to `'sum'`. */
  aggFunc?: 'sum' | 'avg' | 'min' | 'max' | 'count';
  /** Header for the leading row-label column; defaults to `rowField`. */
  rowHeaderName?: string;
}

export interface PivotResult {
  rowData: Record<string, unknown>[];
  columnDefs: ColDef<Record<string, unknown>>[];
}

/** Transforms flat rows into a cross-tab: distinct `columnField` values become individual output
 * columns, distinct `rowField` values become output rows, and `valueField` is aggregated
 * (`aggFunc`, default `'sum'`) at each row/column intersection. Feed the result straight into
 * `<gd-data-grid [rowData]="result.rowData" [columnDefs]="result.columnDefs">` - the grid itself
 * has no pivot-specific code; this is a plain data-transformation utility that composes with
 * every other grid feature (sorting/filtering/grouping/etc. all just work on the pivoted output). */
export function pivotData<TData>(rows: readonly TData[], options: PivotOptions<TData>): PivotResult {
  const { rowField, columnField, valueField, aggFunc = 'sum', rowHeaderName } = options;

  const rowValues: string[] = [];
  const columnValues: string[] = [];
  const buckets = new Map<string, Map<string, number[]>>();

  for (const row of rows) {
    const rowKey = String(row[rowField]);
    const colKey = String(row[columnField]);
    const value = Number(row[valueField]);

    if (!rowValues.includes(rowKey)) rowValues.push(rowKey);
    if (!columnValues.includes(colKey)) columnValues.push(colKey);

    let rowBucket = buckets.get(rowKey);
    if (!rowBucket) {
      rowBucket = new Map();
      buckets.set(rowKey, rowBucket);
    }
    const values = rowBucket.get(colKey);
    if (values) values.push(value);
    else rowBucket.set(colKey, [value]);
  }

  rowValues.sort();
  columnValues.sort();

  const rowData = rowValues.map((rowKey) => {
    const rowBucket = buckets.get(rowKey);
    const record: Record<string, unknown> = { [rowField]: rowKey };
    for (const colKey of columnValues) {
      const values = rowBucket?.get(colKey);
      record[colKey] = values ? aggregate(values, aggFunc) : null;
    }
    return record;
  });

  const columnDefs: ColDef<Record<string, unknown>>[] = [
    { field: rowField, headerName: rowHeaderName ?? rowField, pinned: 'left' },
    ...columnValues.map((colKey): ColDef<Record<string, unknown>> => ({ field: colKey, headerName: colKey, sortable: true })),
  ];

  return { rowData, columnDefs };
}

function aggregate(values: number[], fn: 'sum' | 'avg' | 'min' | 'max' | 'count'): number {
  if (fn === 'count') return values.length;
  const nums = values.filter((num) => !Number.isNaN(num));
  if (nums.length === 0) return 0;
  switch (fn) {
    case 'sum':
      return nums.reduce((sum, num) => sum + num, 0);
    case 'avg':
      return nums.reduce((sum, num) => sum + num, 0) / nums.length;
    case 'min':
      return Math.min(...nums);
    case 'max':
      return Math.max(...nums);
  }
}
