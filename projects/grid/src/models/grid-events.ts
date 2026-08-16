/** Emitted once the grid has completed its initial render. */
export interface GridReadyEvent {
  rowCount: number;
  columnCount: number;
}

/** Emitted after an inline edit is committed (Enter or blur) on an editable cell. */
export interface CellValueChangedEvent<TData = unknown> {
  row: TData;
  field?: string;
  oldValue: unknown;
  newValue: unknown;
}
