import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  Directive,
  ElementRef,
  OnInit,
  TemplateRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { NgClass, NgTemplateOutlet } from '@angular/common';
import { ScrollingModule } from '@angular/cdk/scrolling';
import type { ColDef } from '../models/col-def';
import type { CellValueChangedEvent, GridReadyEvent } from '../models/grid-events';

/** Focuses its host element once inserted - used for the inline cell editor instead of the
 * disallowed `autofocus` HTML attribute (flagged by @angular-eslint/template/no-autofocus). */
@Directive({ selector: '[gdAutoFocus]' })
class AutoFocusDirective implements AfterViewInit {
  private readonly host = inject(ElementRef<HTMLElement>);

  ngAfterViewInit(): void {
    queueMicrotask(() => this.host.nativeElement.focus());
  }
}

/** A column def merged with `defaultColDef` and its resolved flex-box sizing. */
interface ResolvedColumn<TData> {
  def: ColDef<TData>;
  key: string;
  width: number;
  pinned: 'left' | 'right' | null;
  style: Record<string, string>;
}

interface SortEntry {
  key: string;
  direction: 'asc' | 'desc';
}

interface GroupRow {
  key: string;
  level: number;
  field: string;
  value: unknown;
  count: number;
  aggregates: Record<string, unknown>;
}

type DisplayItem<TData> = { kind: 'group'; group: GroupRow } | { kind: 'row'; row: TData; rowIndex: number };

@Component({
  selector: 'gd-data-grid',
  imports: [NgClass, NgTemplateOutlet, ScrollingModule, AutoFocusDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './data-grid.html',
  styleUrl: './data-grid.css',
})
export class DataGrid<TData = unknown> implements OnInit {
  readonly rowData = input<readonly TData[]>([]);
  readonly columnDefs = input<readonly ColDef<TData>[]>([]);
  readonly defaultColDef = input<ColDef<TData> | undefined>(undefined);
  /** Row height in px - the body is row-virtualized (CDK fixed-size viewport), so every row must be the same height. */
  readonly rowHeight = input<number>(36);
  /** CSS height of the scrollable body viewport, e.g. '480px' or '60vh'. */
  readonly height = input<string>('480px');
  /** Stable row identity for virtual-scroll trackBy AND row selection; defaults to positional
   * index - supply a real id-based function (e.g. `(row) => row.id`) for selection to survive
   * sorting/filtering correctly. */
  readonly getRowId = input<(row: TData, index: number) => string | number>((_row, index) => index);
  /** Global search text matched against every visible column's displayed value. */
  readonly quickFilterText = input<string>('');
  /** Enables client-side pagination; when true, the virtualized viewport is replaced with a pager. */
  readonly pagination = input<boolean>(false);
  /** Rows per page when `pagination` is enabled. */
  readonly pageSize = input<number>(50);
  /** Row selection mode; `'none'` disables selection entirely (default). */
  readonly rowSelection = input<'none' | 'single' | 'multiple'>('none');
  /** Starts inline editing on a single click instead of the default double-click. */
  readonly singleClickEdit = input<boolean>(false);
  /** Conditionally-applied row classes; each function receives the row object. */
  readonly rowClassRules = input<Record<string, (row: TData) => boolean> | undefined>(undefined);
  /** Built-in visual theme; sets CSS custom properties for colors. `'light'` (default) uses the
   * grid's own hardcoded fallback colors, so it never needs its own overrides. */
  readonly theme = input<'light' | 'dark' | 'high-contrast'>('light');
  /** Controls cell padding (and thus visual row compactness) via CSS custom properties. */
  readonly density = input<'compact' | 'normal' | 'comfortable'>('normal');
  /** Shows a loading overlay over the body while data is being fetched/refreshed. */
  readonly loading = input<boolean>(false);
  /** Custom "no rows" overlay content; defaults to a plain "No rows to display" message. */
  readonly noRowsTemplate = input<TemplateRef<void> | undefined>(undefined);
  /** Per-row height override; falls back to `rowHeight()` when omitted. Only honored in
   * non-virtualized (paginated) mode - the virtual-scroll viewport requires a single fixed
   * `itemSize` for its fixed-size strategy, so virtualized rows always use `rowHeight()`. */
  readonly getRowHeight = input<((row: TData, index: number) => number) | undefined>(undefined);

  readonly gridReady = output<GridReadyEvent>();
  /** Fires with the full list of currently-selected row objects whenever selection changes. */
  readonly selectionChanged = output<TData[]>();
  /** Fires after an inline edit is committed (Enter or blur). */
  readonly cellValueChanged = output<CellValueChangedEvent<TData>>();

  private readonly sortState = signal<SortEntry[]>([]);
  private readonly columnFilters = signal<Record<string, string>>({});
  private readonly currentPage = signal(0);
  private readonly selection = signal<ReadonlyMap<string | number, TData>>(new Map());
  private readonly editingCell = signal<{ rowKey: string | number; colKey: string } | null>(null);
  /** Roving-tabindex active cell for keyboard navigation (arrows/Home/End/PageUp/PageDown) -
   * exactly one cell is in the Tab order at a time (besides always-tabbable editable cells). */
  private readonly activeCell = signal<{ rowIndex: number; colIndex: number }>({ rowIndex: 0, colIndex: 0 });
  /** Row-group keys the user has collapsed; a key not in this set is expanded (default expanded). */
  private readonly collapsedGroups = signal<ReadonlySet<string>>(new Set());
  /** User-dragged column order, as a list of column keys; `null` uses `columnDefs`' natural order. */
  private readonly columnOrder = signal<string[] | null>(null);
  /** User-dragged column widths (px), keyed by column key; overrides `col.width` when present. */
  private readonly columnWidthOverrides = signal<Record<string, number>>({});

  protected readonly columns = computed<ResolvedColumn<TData>[]>(() => {
    const fallback = this.defaultColDef();
    const overrides = this.columnWidthOverrides();
    const merged = this.columnDefs()
      .filter((col) => !col.hide)
      .map((col, index) => {
        const def: ColDef<TData> = { ...fallback, ...col };
        const key = def.field ?? def.headerName ?? String(index);
        return { def, key, width: overrides[key] ?? def.width };
      });

    const ordered = applyColumnOrder(merged, this.columnOrder());
    const grouped = groupByPinned(ordered);

    let leftOffset = 0;
    let rightOffset = grouped
      .filter((entry) => entry.def.pinned === 'right')
      .reduce((sum, entry) => sum + resolvedColumnWidth(entry.def, entry.width), 0);

    return grouped.map((entry): ResolvedColumn<TData> => {
      const width = resolvedColumnWidth(entry.def, entry.width);
      const style = columnStyle(entry.def, entry.width);
      if (entry.def.pinned === 'left') {
        style['position'] = 'sticky';
        style['left'] = `${leftOffset}px`;
        style['z-index'] = '1';
        leftOffset += width;
      } else if (entry.def.pinned === 'right') {
        rightOffset -= width;
        style['position'] = 'sticky';
        style['right'] = `${rightOffset}px`;
        style['z-index'] = '1';
      }
      return { def: entry.def, key: entry.key, width, pinned: entry.def.pinned ?? null, style };
    });
  });

  protected readonly hasColumnFilters = computed(() => this.columns().some((col) => !!col.def.filter));

  /** Minimum total width of all columns - lets the grid provide its own horizontal scrollbar
   * (via CSS `min-width` + `.gd-root { overflow-x: auto }`) instead of columns being silently
   * clipped/pushed off-screen when the container is narrower than the content. */
  protected readonly contentMinWidth = computed<string>(() => {
    const total = this.columns().reduce((sum, col) => sum + col.width, 0);
    return `${total}px`;
  });

  protected readonly filteredRows = computed<readonly TData[]>(() => {
    const cols = this.columns();
    const filters = this.columnFilters();
    const quick = this.quickFilterText().trim().toLowerCase();
    const activeColumnFilters = cols.filter((col) => (filters[col.key] ?? '').trim().length > 0);
    if (activeColumnFilters.length === 0 && !quick) return this.rowData();

    return this.rowData().filter((row) => {
      for (const col of activeColumnFilters) {
        const filterText = filters[col.key].trim();
        const type = col.def.filter === 'number' || col.def.filter === 'date' ? col.def.filter : 'text';
        if (!matchesColumnFilter(this.cellValue(row, col.def), filterText, type)) return false;
      }
      if (quick && !cols.some((col) => this.cellDisplay(row, col.def).toLowerCase().includes(quick))) {
        return false;
      }
      return true;
    });
  });

  protected readonly sortedRows = computed<readonly TData[]>(() => {
    const sorts = this.sortState();
    const rows = this.filteredRows();
    if (sorts.length === 0) return rows;

    const columnsByKey = new Map(this.columns().map((col) => [col.key, col.def]));
    return [...rows].sort((rowA, rowB) => {
      for (const sort of sorts) {
        const col = columnsByKey.get(sort.key);
        if (!col) continue;
        const valueA = this.cellValue(rowA, col);
        const valueB = this.cellValue(rowB, col);
        const cmp = col.comparator ? col.comparator(valueA, valueB, rowA, rowB) : defaultCompare(valueA, valueB);
        if (cmp !== 0) return sort.direction === 'desc' ? -cmp : cmp;
      }
      return 0;
    });
  });

  protected readonly pageCount = computed(() => {
    if (!this.pagination()) return 1;
    return Math.max(1, Math.ceil(this.displayRows().length / this.pageSize()));
  });

  /** Clamped so filtering/sorting/pageSize changes never leave the page pointing past the end. */
  protected readonly safeCurrentPage = computed(() => Math.min(this.currentPage(), this.pageCount() - 1));

  protected readonly pagedRows = computed<readonly TData[]>(() => {
    if (!this.pagination()) return this.sortedRows();
    const start = this.safeCurrentPage() * this.pageSize();
    return this.sortedRows().slice(start, start + this.pageSize());
  });

  /** Columns marked `rowGroup: true`, ordered by `rowGroupIndex` (outermost group first). */
  protected readonly groupColumns = computed(() =>
    this.columns()
      .filter((col) => col.def.rowGroup)
      .sort((colA, colB) => (colA.def.rowGroupIndex ?? 0) - (colB.def.rowGroupIndex ?? 0)),
  );

  protected readonly hasRowGrouping = computed(() => this.groupColumns().length > 0);

  protected readonly aggregateColumns = computed(() => this.columns().filter((col) => !!col.def.aggFunc));

  /** Flattened render list: every row when there's no grouping (1:1 with `sortedRows()`), or a
   * mix of group-header rows and leaf rows when one or more columns declare `rowGroup: true`.
   * Groups are a stable partition of `sortedRows()` (grouping happens AFTER sort), so sorting
   * still determines order both across and within groups. Collapsed groups (see
   * `collapsedGroups`) omit their descendants from the result entirely. */
  protected readonly displayRows = computed<DisplayItem<TData>[]>(() => {
    const rows = this.sortedRows();
    const groupCols = this.groupColumns();
    if (groupCols.length === 0) {
      return rows.map((row, rowIndex): DisplayItem<TData> => ({ kind: 'row', row, rowIndex }));
    }

    // Preserves the same row identity (index into `sortedRows()`) used everywhere else (getRowId,
    // selection, editing) even though grouping reorders rows into their group's bucket.
    const originalIndex = new Map<TData, number>(rows.map((row, index) => [row, index]));
    const aggCols = this.aggregateColumns();
    const collapsed = this.collapsedGroups();
    const result: DisplayItem<TData>[] = [];

    const buildLevel = (data: readonly TData[], levelIndex: number, parentKey: string): void => {
      if (levelIndex >= groupCols.length) {
        for (const row of data) result.push({ kind: 'row', row, rowIndex: originalIndex.get(row)! });
        return;
      }
      const col = groupCols[levelIndex];
      const buckets = new Map<string, TData[]>();
      for (const row of data) {
        const bucketKey = String(this.cellValue(row, col.def));
        const bucket = buckets.get(bucketKey);
        if (bucket) bucket.push(row);
        else buckets.set(bucketKey, [row]);
      }
      for (const [bucketKey, bucketRows] of buckets) {
        const key = `${parentKey}/${col.key}=${bucketKey}`;
        const aggregates: Record<string, unknown> = {};
        for (const aggCol of aggCols) aggregates[aggCol.key] = this.computeAggregate(bucketRows, aggCol);
        result.push({
          kind: 'group',
          group: {
            key,
            level: levelIndex,
            field: col.key,
            value: this.cellValue(bucketRows[0], col.def),
            count: bucketRows.length,
            aggregates,
          },
        });
        if (!collapsed.has(key)) buildLevel(bucketRows, levelIndex + 1, key);
      }
    };
    buildLevel(rows, 0, '');
    return result;
  });

  /** `displayRows()`, paginated when `[pagination]` is enabled - used for the non-virtualized
   * body, which handles both plain pagination and row grouping (grouping always uses this path;
   * see the template for why it can't use the CDK virtual-scroll viewport). */
  protected readonly pagedDisplayItems = computed<DisplayItem<TData>[]>(() => {
    const items = this.displayRows();
    if (!this.pagination()) return items;
    const start = this.safeCurrentPage() * this.pageSize();
    return items.slice(start, start + this.pageSize());
  });

  /** The currently rendered rows (post filter/sort/page/group) - what select-all should act on.
   * Group header rows are never selectable, so only `kind: 'row'` items are included. */
  private readonly visibleRows = computed<readonly TData[]>(() => {
    if (this.hasRowGrouping()) {
      const items = this.pagination() ? this.pagedDisplayItems() : this.displayRows();
      return items.filter(isRowItem).map((item) => item.row);
    }
    return this.pagination() ? this.pagedRows() : this.sortedRows();
  });

  protected readonly allVisibleSelected = computed(() => {
    const rows = this.visibleRows();
    if (rows.length === 0) return false;
    const selected = this.selection();
    return rows.every((row, index) => selected.has(this.rowId(row, index)));
  });

  ngOnInit(): void {
    const initialSort = this.columns()
      .filter((col) => col.def.sort)
      .sort((a, b) => (a.def.sortIndex ?? 0) - (b.def.sortIndex ?? 0))
      .map((col): SortEntry => ({ key: col.key, direction: col.def.sort! }));
    this.sortState.set(initialSort);

    this.gridReady.emit({ rowCount: this.rowData().length, columnCount: this.columns().length });
  }

  // ---------------------------------------------------------------------------------------
  // Imperative Grid API - obtain via `@ViewChild(DataGrid) grid!: DataGrid<TData>` and call
  // these directly (Angular convention: the component instance itself IS the API surface,
  // rather than a separate injectable service).
  // ---------------------------------------------------------------------------------------

  /** Selects every currently-displayed (filtered/sorted/paged) row. No-op when `rowSelection`
   * is `'none'`. Emits `(selectionChanged)`. */
  selectAll(): void {
    if (this.rowSelection() === 'none') return;
    const next = new Map<string | number, TData>();
    this.visibleRows().forEach((row, index) => next.set(this.rowId(row, index), row));
    this.selection.set(next);
    this.selectionChanged.emit([...next.values()]);
  }

  /** Clears the current selection. Emits `(selectionChanged)` with an empty array. */
  deselectAll(): void {
    this.selection.set(new Map());
    this.selectionChanged.emit([]);
  }

  /** Returns the currently-selected row objects, in selection order. */
  getSelectedRows(): TData[] {
    return [...this.selection().values()];
  }

  /** Total row count after filtering/sorting (before pagination slices it into pages). */
  getDisplayedRowCount(): number {
    return this.sortedRows().length;
  }

  /** Clears any user drag-resized column widths and drag-reordered column order, reverting to
   * the widths/order declared in `columnDefs`. */
  resetColumnState(): void {
    this.columnWidthOverrides.set({});
    this.columnOrder.set(null);
  }

  /** Exports the currently filtered/sorted rows (all of them, ignoring pagination) as a CSV file
   * download, using each column's `headerName`/`field` and formatted display value. */
  exportDataAsCsv(fileName = 'export.csv'): void {
    const cols = this.columns().filter((col) => !col.def.checkboxSelection);
    const header = cols.map((col) => csvEscape(col.def.headerName ?? col.def.field ?? col.key));
    const rows = this.sortedRows().map((row) => cols.map((col) => csvEscape(this.cellDisplay(row, col.def))));
    const csv = [header, ...rows].map((line) => line.join(',')).join('\r\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  protected trackRow = (index: number, row: TData): string | number => this.getRowId()(row, index);

  private rowId(row: TData, index: number): string | number {
    return this.getRowId()(row, index);
  }

  protected isSelected(row: TData, index: number): boolean {
    return this.selection().has(this.rowId(row, index));
  }

  protected toggleRowSelection(row: TData, index: number): void {
    const mode = this.rowSelection();
    if (mode === 'none') return;
    const id = this.rowId(row, index);

    this.selection.update((current) => {
      if (mode === 'single') {
        return current.has(id) && current.size === 1 ? new Map() : new Map([[id, row]]);
      }
      const next = new Map(current);
      if (next.has(id)) next.delete(id);
      else next.set(id, row);
      return next;
    });
    this.selectionChanged.emit([...this.selection().values()]);
  }

  protected onRowClick(row: TData, index: number, event: MouseEvent): void {
    // The checkbox's own (change) handler already toggles selection - avoid double-toggling.
    // Editable cells handle their own click/dblclick to start editing instead of selecting.
    const target = event.target as HTMLElement;
    if (target.closest('input[type="checkbox"]') || target.closest('.gd-cell--editable')) return;
    this.toggleRowSelection(row, index);
  }

  protected onRowKeydown(row: TData, index: number, event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target as HTMLElement;
    if (target.closest('input[type="checkbox"]') || target.closest('.gd-cell--editable')) return;
    event.preventDefault();
    this.toggleRowSelection(row, index);
  }

  protected toggleSelectAll(): void {
    if (this.rowSelection() !== 'multiple') return;
    const rows = this.visibleRows();
    const selectAll = !this.allVisibleSelected();

    this.selection.update((current) => {
      const next = new Map(current);
      rows.forEach((row, index) => {
        const id = this.rowId(row, index);
        if (selectAll) next.set(id, row);
        else next.delete(id);
      });
      return next;
    });
    this.selectionChanged.emit([...this.selection().values()]);
  }

  protected isEditable(col: ResolvedColumn<TData>, row: TData): boolean {
    const editable = col.def.editable;
    return typeof editable === 'function' ? editable(row) : !!editable;
  }

  protected isEditing(row: TData, index: number, col: ResolvedColumn<TData>): boolean {
    const cell = this.editingCell();
    return !!cell && cell.rowKey === this.rowId(row, index) && cell.colKey === col.key;
  }

  protected editorInitialValue(row: TData, col: ResolvedColumn<TData>): string {
    const value = this.cellValue(row, col.def);
    if (col.def.cellEditor === 'date') return value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? '');
    return value == null ? '' : String(value);
  }

  protected editorInitialChecked(row: TData, col: ResolvedColumn<TData>): boolean {
    return !!this.cellValue(row, col.def);
  }

  protected editorOptionSelected(row: TData, col: ResolvedColumn<TData>, optionValue: unknown): boolean {
    return this.editorInitialValue(row, col) === String(optionValue);
  }

  protected onCellClick(row: TData, index: number, col: ResolvedColumn<TData>, event: MouseEvent): void {
    if (!this.isEditable(col, row) || !this.singleClickEdit()) return;
    event.stopPropagation();
    this.startEdit(row, index, col);
  }

  protected onCellDblClick(row: TData, index: number, col: ResolvedColumn<TData>, event: MouseEvent): void {
    if (!this.isEditable(col, row)) return;
    event.stopPropagation();
    this.startEdit(row, index, col);
  }

  protected onCellKeydown(row: TData, index: number, col: ResolvedColumn<TData>, event: KeyboardEvent): void {
    if (this.isEditing(row, index, col)) return;
    if (this.isEditable(col, row) && (event.key === 'Enter' || event.key === 'F2')) {
      event.preventDefault();
      event.stopPropagation();
      this.startEdit(row, index, col);
      return;
    }
    this.navigateFromCell(event);
  }

  /** Marks a cell as the roving-tabindex active cell whenever it receives DOM focus (via mouse
   * click, Tab, or a programmatic `.focus()` from `navigateFromCell`). */
  protected onCellFocus(rowIndex: number, colIndex: number): void {
    this.activeCell.set({ rowIndex, colIndex });
  }

  protected isActiveCell(rowIndex: number, colIndex: number): boolean {
    const active = this.activeCell();
    return active.rowIndex === rowIndex && active.colIndex === colIndex;
  }

  /** Arrow/Home/End/PageUp/PageDown navigation between gridcells, via plain DOM sibling
   * traversal from the currently-focused cell (robust against CDK virtual-scroll DOM node
   * recycling, since it always reads the live DOM rather than trusting stale row indices). */
  private navigateFromCell(event: KeyboardEvent): void {
    const cell = event.currentTarget as HTMLElement;
    const rowEl = cell.parentElement;
    if (!rowEl) return;

    let target: Element | null | undefined;
    switch (event.key) {
      case 'ArrowRight':
        target = cell.nextElementSibling;
        break;
      case 'ArrowLeft':
        target = cell.previousElementSibling;
        break;
      case 'Home':
        target = rowEl.firstElementChild;
        break;
      case 'End':
        target = rowEl.lastElementChild;
        break;
      case 'ArrowDown':
        target = cellAtRowOffset(cell, rowEl, 1);
        break;
      case 'ArrowUp':
        target = cellAtRowOffset(cell, rowEl, -1);
        break;
      case 'PageDown':
        target = cellAtRowOffset(cell, rowEl, 10);
        break;
      case 'PageUp':
        target = cellAtRowOffset(cell, rowEl, -10);
        break;
      default:
        return;
    }
    if (!(target instanceof HTMLElement)) return;
    event.preventDefault();
    target.focus();
  }

  private startEdit(row: TData, index: number, col: ResolvedColumn<TData>): void {
    this.editingCell.set({ rowKey: this.rowId(row, index), colKey: col.key });
  }

  protected cancelEdit(): void {
    this.editingCell.set(null);
  }

  protected onEditorKeydown(row: TData, col: ResolvedColumn<TData>, event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      // Stop the bubbled keydown from also reaching the cell's own Enter/F2-to-start-editing
      // handler, which would otherwise see editing just turned off and reopen it immediately.
      event.stopPropagation();
      this.commitEditFromTarget(row, col, event.target);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.cancelEdit();
    }
  }

  protected onEditorBlur(row: TData, col: ResolvedColumn<TData>, event: Event): void {
    this.commitEditFromTarget(row, col, event.target);
  }

  private commitEditFromTarget(row: TData, col: ResolvedColumn<TData>, target: EventTarget | null): void {
    // Guards against a second blur firing after Enter/Escape already closed the editor.
    if (!this.editingCell()) return;
    if (target instanceof HTMLInputElement && target.type === 'checkbox') {
      this.commitEdit(row, col, target.checked);
    } else if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) {
      this.commitEdit(row, col, target.value);
    }
  }

  private commitEdit(row: TData, col: ResolvedColumn<TData>, raw: string | boolean): void {
    const field = col.def.field;
    const oldValue = this.cellValue(row, col.def);
    const newValue = coerceEditedValue(raw, col.def.cellEditor, col.def.cellEditorParams?.options);

    if (col.def.valueSetter) col.def.valueSetter(row, newValue);
    else if (field) (row as Record<string, unknown>)[field] = newValue;

    this.editingCell.set(null);
    this.cellValueChanged.emit({ row, field, oldValue, newValue });
  }

  protected goToPage(page: number): void {
    this.currentPage.set(Math.min(Math.max(page, 0), this.pageCount() - 1));
  }

  /** e.g. "1-50 of 320" for the pager footer; "0 of 0" when there are no rows. */
  protected pageRangeText(): string {
    const total = this.displayRows().length;
    if (total === 0) return '0 of 0';
    const start = this.safeCurrentPage() * this.pageSize() + 1;
    const end = Math.min(start + this.pageSize() - 1, total);
    return `${start}-${end} of ${total}`;
  }

  protected isGroupCollapsed(key: string): boolean {
    return this.collapsedGroups().has(key);
  }

  protected toggleGroup(key: string): void {
    this.collapsedGroups.update((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** Stable `@for` track key for a display item - a group's own key, or the leaf row's identity. */
  protected itemTrackKey(item: DisplayItem<TData>): string | number {
    return item.kind === 'group' ? item.group.key : this.rowId(item.row, item.rowIndex);
  }

  /** Formats an aggregate value for display; numbers are rounded to 2 decimal places (`avg`
   * commonly produces long decimals; `sum`/`min`/`max`/`count` are already whole for most data). */
  protected formatAggregateValue(value: unknown): string {
    if (typeof value !== 'number') return String(value ?? '');
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }

  private computeAggregate(rows: readonly TData[], col: ResolvedColumn<TData>): unknown {
    const fn = col.def.aggFunc;
    if (!fn) return undefined;
    if (fn === 'count') return rows.length;

    const nums = rows.map((row) => Number(this.cellValue(row, col.def))).filter((num) => !Number.isNaN(num));
    if (nums.length === 0) return fn === 'sum' ? 0 : undefined;
    switch (fn) {
      case 'sum':
        return nums.reduce((sum, num) => sum + num, 0);
      case 'avg':
        return nums.reduce((sum, num) => sum + num, 0) / nums.length;
      case 'min':
        return Math.min(...nums);
      case 'max':
        return Math.max(...nums);
      default:
        return undefined;
    }
  }

  protected cellValue(row: TData, col: ColDef<TData>): unknown {
    if (col.valueGetter) return col.valueGetter(row);
    return col.field ? row[col.field] : undefined;
  }

  protected cellDisplay(row: TData, col: ColDef<TData>): string {
    const value = this.cellValue(row, col);
    if (col.valueFormatter) return col.valueFormatter(value);
    return value == null ? '' : String(value);
  }

  /** Merges a column's static `cellClass` with any `cellClassRules` that evaluate truthy for this row. */
  /** Merges a column's static `cellClass` with any `cellClassRules` that evaluate truthy for this row. */
  protected cellClasses(col: ResolvedColumn<TData>, row: TData): string[] {
    const classes: string[] = ([] as string[]).concat(col.def.cellClass ?? []);
    const rules = col.def.cellClassRules;
    if (!rules) return classes;
    const value = this.cellValue(row, col.def);
    for (const [className, predicate] of Object.entries(rules)) {
      if (predicate({ value, data: row })) classes.push(className);
    }
    return classes;
  }

  /** Native `title` attribute text for a cell's tooltip, or `null` when `tooltip` isn't set. */
  protected cellTooltip(col: ResolvedColumn<TData>, row: TData): string | null {
    const tooltip = col.def.tooltip;
    if (!tooltip) return null;
    return typeof tooltip === 'function' ? tooltip(row) : this.cellDisplay(row, col.def);
  }

  /** Evaluates `rowClassRules` (if provided) for a row, returning the matching class names. */
  protected rowClasses(row: TData): string[] {
    const rules = this.rowClassRules();
    if (!rules) return [];
    return Object.entries(rules)
      .filter(([, predicate]) => predicate(row))
      .map(([className]) => className);
  }

  /** Row height for paginated (non-virtualized) rows - honors `getRowHeight()` when provided. */
  protected resolvedRowHeight(row: TData, index: number): number {
    return this.getRowHeight()?.(row, index) ?? this.rowHeight();
  }

  protected columnFilterValue(col: ResolvedColumn<TData>): string {
    return this.columnFilters()[col.key] ?? '';
  }

  protected filterPlaceholder(col: ResolvedColumn<TData>): string {
    switch (col.def.filter) {
      case 'number':
        return 'e.g. >10';
      case 'date':
        return 'YYYY-MM-DD';
      default:
        return 'Filter…';
    }
  }

  protected onColumnFilterInput(col: ResolvedColumn<TData>, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.columnFilters.update((current) => ({ ...current, [col.key]: value }));
  }

  protected onHeaderClick(col: ResolvedColumn<TData>, event: MouseEvent): void {
    this.toggleSort(col, event.shiftKey);
  }

  protected onHeaderKeydown(col: ResolvedColumn<TData>, event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.toggleSort(col, event.shiftKey);
  }

  private toggleSort(col: ResolvedColumn<TData>, multi: boolean): void {
    if (!col.def.sortable) return;
    this.sortState.update((current) => nextSortState(current, col.key, multi));
  }

  /** Sort direction + 1-based order (only shown once >1 column is sorted) for a header's aria/indicator. */
  protected sortInfo(col: ResolvedColumn<TData>): { direction?: 'asc' | 'desc'; order?: number } {
    const sorts = this.sortState();
    const index = sorts.findIndex((sort) => sort.key === col.key);
    if (index === -1) return {};
    return { direction: sorts[index].direction, order: sorts.length > 1 ? index + 1 : undefined };
  }

  protected isResizable(col: ResolvedColumn<TData>): boolean {
    return col.def.resizable !== false;
  }

  /** Drag-resizes a column from its header's right-edge handle; listens on `document` so the
   * drag continues even if the pointer leaves the handle/header cell. */
  protected onResizeStart(col: ResolvedColumn<TData>, event: MouseEvent): void {
    if (!this.isResizable(col)) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = this.columnWidthOverrides()[col.key] ?? col.width;

    const onMove = (moveEvent: MouseEvent): void => {
      const next = Math.max(30, startWidth + (moveEvent.clientX - startX));
      this.columnWidthOverrides.update((current) => ({ ...current, [col.key]: next }));
    };
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  /** Column reorder via native HTML5 drag-and-drop on the header cell (excludes the resize handle). */
  protected onHeaderDragStart(col: ResolvedColumn<TData>, event: DragEvent): void {
    event.dataTransfer?.setData('text/plain', col.key);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  protected onHeaderDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  protected onHeaderDrop(targetCol: ResolvedColumn<TData>, event: DragEvent): void {
    event.preventDefault();
    const sourceKey = event.dataTransfer?.getData('text/plain');
    if (!sourceKey || sourceKey === targetCol.key) return;

    const keys = this.columns().map((col) => col.key);
    const from = keys.indexOf(sourceKey);
    const to = keys.indexOf(targetCol.key);
    if (from === -1 || to === -1) return;

    const next = [...keys];
    next.splice(from, 1);
    next.splice(to, 0, sourceKey);
    this.columnOrder.set(next);
  }
}

/** Walks `Math.abs(deltaRows)` rows up/down from `cell`'s row, returning the cell at the same
 * column position in the target row (or the furthest reachable row if fewer rows remain). */
/** Type guard narrowing a `DisplayItem` to its leaf-row variant (used to filter out group headers). */
function isRowItem<TData>(item: DisplayItem<TData>): item is { kind: 'row'; row: TData; rowIndex: number } {
  return item.kind === 'row';
}

function cellAtRowOffset(cell: Element, rowEl: Element, deltaRows: number): Element | null {
  const cellIndex = Array.from(rowEl.children).indexOf(cell);
  const direction = deltaRows > 0 ? 1 : -1;
  let currentRow: Element | null = rowEl;
  let result: Element | null = null;
  for (let i = 0; i < Math.abs(deltaRows); i++) {
    const nextRow: Element | null = direction > 0 ? currentRow.nextElementSibling : currentRow.previousElementSibling;
    if (!nextRow) break;
    currentRow = nextRow;
    result = currentRow.children[cellIndex] ?? null;
  }
  return result;
}

/** Wraps a CSV field in quotes (doubling any embedded quotes) whenever it contains a comma,
 * quote, or newline - otherwise returns it unmodified. */
function csvEscape(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function nextSortState(current: SortEntry[], key: string, multi: boolean): SortEntry[] {
  const existing = current.find((entry) => entry.key === key);
  const next = nextDirection(existing?.direction);

  if (!multi) {
    return next ? [{ key, direction: next }] : [];
  }
  const withoutKey = current.filter((entry) => entry.key !== key);
  return next ? [...withoutKey, { key, direction: next }] : withoutKey;
}

function nextDirection(current: 'asc' | 'desc' | undefined): 'asc' | 'desc' | undefined {
  if (current === undefined) return 'asc';
  return current === 'asc' ? 'desc' : undefined;
}

function defaultCompare(valueA: unknown, valueB: unknown): number {
  if (valueA == null && valueB == null) return 0;
  if (valueA == null) return -1;
  if (valueB == null) return 1;
  if (typeof valueA === 'number' && typeof valueB === 'number') return valueA - valueB;
  if (valueA instanceof Date && valueB instanceof Date) return valueA.getTime() - valueB.getTime();
  return String(valueA).localeCompare(String(valueB));
}

const NUMBER_FILTER_PATTERN = /^(>=|<=|>|<|=)?\s*(-?\d+(?:\.\d+)?)$/;

function matchesColumnFilter(value: unknown, filterText: string, type: 'text' | 'number' | 'date'): boolean {
  if (type === 'number') {
    const match = NUMBER_FILTER_PATTERN.exec(filterText);
    if (!match) return String(value ?? '').toLowerCase().includes(filterText.toLowerCase());

    const [, operator = '=', numberText] = match;
    const target = Number(numberText);
    const actual = typeof value === 'number' ? value : Number(value);
    if (Number.isNaN(actual)) return false;

    switch (operator) {
      case '>':
        return actual > target;
      case '>=':
        return actual >= target;
      case '<':
        return actual < target;
      case '<=':
        return actual <= target;
      default:
        return actual === target;
    }
  }

  if (type === 'date') {
    const actual = value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? '');
    return actual.startsWith(filterText.trim());
  }

  return String(value ?? '')
    .toLowerCase()
    .includes(filterText.toLowerCase());
}

function coerceEditedValue(
  raw: string | boolean,
  editorType: 'text' | 'number' | 'select' | 'date' | 'checkbox' | undefined,
  options: { label: string; value: unknown }[] | undefined,
): unknown {
  if (editorType === 'checkbox') return !!raw;
  if (editorType === 'number') return raw === '' ? null : Number(raw);
  if (editorType === 'select' && options) {
    const match = options.find((option) => String(option.value) === String(raw));
    return match ? match.value : raw;
  }
  return raw;
}

function columnStyle<TData>(col: ColDef<TData>, widthOverride?: number): Record<string, string> {
  const width = widthOverride ?? col.width;
  const style: Record<string, string> = {
    flex: width != null ? `0 0 ${width}px` : `${col.flex ?? 1} 1 0`,
  };
  if (col.minWidth != null) style['min-width'] = `${col.minWidth}px`;
  if (col.maxWidth != null) style['max-width'] = `${col.maxWidth}px`;
  return style;
}

interface MergedColumn<TData> {
  def: ColDef<TData>;
  key: string;
  width?: number;
}

/** Reorders `columns` to match a stored key order (from drag-reordering); any column not present
 * in `order` (e.g. newly added to `columnDefs`) keeps its natural relative position at the end. */
function applyColumnOrder<TData>(columns: MergedColumn<TData>[], order: string[] | null): MergedColumn<TData>[] {
  if (!order) return columns;
  const byKey = new Map(columns.map((col) => [col.key, col]));
  const ordered = order.map((key) => byKey.get(key)).filter((col): col is MergedColumn<TData> => !!col);
  const orderedKeys = new Set(ordered.map((col) => col.key));
  const remaining = columns.filter((col) => !orderedKeys.has(col.key));
  return [...ordered, ...remaining];
}

/** Clusters pinned-left columns first, then unpinned, then pinned-right - preserving each group's
 * relative order (Array#filter is a stable partition). */
function groupByPinned<TData>(columns: MergedColumn<TData>[]): MergedColumn<TData>[] {
  const left = columns.filter((col) => col.def.pinned === 'left');
  const right = columns.filter((col) => col.def.pinned === 'right');
  const middle = columns.filter((col) => col.def.pinned !== 'left' && col.def.pinned !== 'right');
  return [...left, ...middle, ...right];
}

function resolvedColumnWidth<TData>(col: ColDef<TData>, widthOverride?: number): number {
  return widthOverride ?? col.width ?? col.minWidth ?? 120;
}
