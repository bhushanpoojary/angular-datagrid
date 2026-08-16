/** Column definition for the data grid. Extended feature-by-feature through later phases. */
export interface ColDef<TData = unknown, TValue = unknown> {
  field?: keyof TData & string;
  headerName?: string;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  flex?: number;
  sortable?: boolean;
  hide?: boolean;
  pinned?: 'left' | 'right' | null;
  cellClass?: string | string[];
  valueGetter?: (data: TData) => TValue;
  valueFormatter?: (value: TValue) => string;
}
