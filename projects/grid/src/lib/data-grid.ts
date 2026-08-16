import { ChangeDetectionStrategy, Component, OnInit, computed, input, output, signal } from '@angular/core';
import { NgClass } from '@angular/common';
import { ScrollingModule } from '@angular/cdk/scrolling';
import type { ColDef } from '../models/col-def';
import type { GridReadyEvent } from '../models/grid-events';

/** A column def merged with `defaultColDef` and its resolved flex-box sizing. */
interface ResolvedColumn<TData> {
  def: ColDef<TData>;
  key: string;
  style: Record<string, string>;
}

interface SortEntry {
  key: string;
  direction: 'asc' | 'desc';
}

@Component({
  selector: 'gd-data-grid',
  imports: [NgClass, ScrollingModule],
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

  readonly gridReady = output<GridReadyEvent>();
  /** Fires with the full list of currently-selected row objects whenever selection changes. */
  readonly selectionChanged = output<TData[]>();

  private readonly sortState = signal<SortEntry[]>([]);
  private readonly columnFilters = signal<Record<string, string>>({});
  private readonly currentPage = signal(0);
  private readonly selection = signal<ReadonlyMap<string | number, TData>>(new Map());

  protected readonly columns = computed<ResolvedColumn<TData>[]>(() => {
    const fallback = this.defaultColDef();
    return this.columnDefs()
      .filter((col) => !col.hide)
      .map((col, index) => {
        const merged: ColDef<TData> = { ...fallback, ...col };
        return {
          def: merged,
          key: merged.field ?? merged.headerName ?? String(index),
          style: columnStyle(merged),
        };
      });
  });

  protected readonly hasColumnFilters = computed(() => this.columns().some((col) => !!col.def.filter));

  /** Minimum total width of all columns - lets the grid provide its own horizontal scrollbar
   * (via CSS `min-width` + `.gd-root { overflow-x: auto }`) instead of columns being silently
   * clipped/pushed off-screen when the container is narrower than the content. */
  protected readonly contentMinWidth = computed<string>(() => {
    const total = this.columns().reduce((sum, col) => sum + (col.def.width ?? col.def.minWidth ?? 120), 0);
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

  protected readonly pageCount = computed(() =>
    this.pagination() ? Math.max(1, Math.ceil(this.sortedRows().length / this.pageSize())) : 1,
  );

  /** Clamped so filtering/sorting/pageSize changes never leave the page pointing past the end. */
  protected readonly safeCurrentPage = computed(() => Math.min(this.currentPage(), this.pageCount() - 1));

  protected readonly pagedRows = computed<readonly TData[]>(() => {
    if (!this.pagination()) return this.sortedRows();
    const start = this.safeCurrentPage() * this.pageSize();
    return this.sortedRows().slice(start, start + this.pageSize());
  });

  /** The currently rendered rows (post filter/sort/page) - what select-all should act on. */
  private readonly visibleRows = computed<readonly TData[]>(() =>
    this.pagination() ? this.pagedRows() : this.sortedRows(),
  );

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
    if ((event.target as HTMLElement).closest('input[type="checkbox"]')) return;
    this.toggleRowSelection(row, index);
  }

  protected onRowKeydown(row: TData, index: number, event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if ((event.target as HTMLElement).closest('input[type="checkbox"]')) return;
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

  protected goToPage(page: number): void {
    this.currentPage.set(Math.min(Math.max(page, 0), this.pageCount() - 1));
  }

  /** e.g. "1-50 of 320" for the pager footer; "0 of 0" when there are no rows. */
  protected pageRangeText(): string {
    const total = this.sortedRows().length;
    if (total === 0) return '0 of 0';
    const start = this.safeCurrentPage() * this.pageSize() + 1;
    const end = Math.min(start + this.pageSize() - 1, total);
    return `${start}-${end} of ${total}`;
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

function columnStyle<TData>(col: ColDef<TData>): Record<string, string> {
  const style: Record<string, string> = {
    flex: col.width != null ? `0 0 ${col.width}px` : `${col.flex ?? 1} 1 0`,
  };
  if (col.minWidth != null) style['min-width'] = `${col.minWidth}px`;
  if (col.maxWidth != null) style['max-width'] = `${col.maxWidth}px`;
  return style;
}
