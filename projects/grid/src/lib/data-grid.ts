import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  Directive,
  ElementRef,
  OnInit,
  TemplateRef,
  computed,
  effect,
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

type DisplayItem<TData> =
  | { kind: 'group'; group: GroupRow }
  | { kind: 'row'; row: TData; rowIndex: number; level?: number }
  | { kind: 'detail'; row: TData; rowIndex: number };

interface ContextMenuAction {
  label: string;
  action: () => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuAction[];
}

/** A serializable snapshot of user-driven grid layout state, for persistence via `getGridState()`
 * / `applyGridState()`. */
export interface GridLayoutState {
  columnWidths: Record<string, number>;
  columnOrder: string[] | null;
  sort: SortEntry[];
  columnFilters: Record<string, string>;
  page: number;
}

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
  /** Enables hierarchical tree data: returns a row's children (or `undefined`/empty for a leaf).
   * `rowData` provides the top-level (root) rows. Expand/collapse state is tracked per-row via
   * `getRowId`. Mutually exclusive with row grouping (`ColDef.rowGroup`) in practice - if both are
   * configured, row grouping takes priority. Filtering/sorting apply only to the root rows in
   * `rowData`, not recursively to children - a documented v1 scope limitation. */
  readonly getChildRows = input<((row: TData) => readonly TData[] | undefined) | undefined>(undefined);
  /** Enables master/detail: rows get an expand toggle that reveals a full-width detail panel
   * rendered from this template, `<ng-template #tpl let-row let-data="data">...</ng-template>`.
   * Composes with row grouping/tree data (detail rows are injected after that structure is
   * resolved); not designed to combine with tree data's own first-cell toggle in the same grid. */
  readonly detailRowTemplate = input<TemplateRef<{ $implicit: TData; data: TData }> | undefined>(undefined);
  /** Pins a row to a fixed, always-visible section above (`'top'`) or below (`'bottom'`) the
   * scrollable body, outside the normal filter/sort/page pipeline entirely - return `null` (or
   * omit the input) for rows that should stay in the regular scrollable body. */
  readonly isRowPinned = input<((row: TData) => 'top' | 'bottom' | null) | undefined>(undefined);
  /** Enables drag-and-drop row reordering (native HTML5 drag-and-drop, via a drag handle in each
   * row's first cell). The grid does not reorder `rowData` itself (a one-way input) - handle
   * `(rowDragEnd)` and reorder your own array. Requires a real `getRowId` (not the default
   * positional index) to resolve rows correctly once sorting/filtering has reordered them. */
  readonly enableRowDrag = input<boolean>(false);
  /** Customizes the right-click context menu's items; defaults to Copy cell/Copy row/Export CSV
   * when omitted. Return an empty array to suppress the menu entirely for a given cell. */
  readonly contextMenuItems = input<
    ((params: { row: TData; col: ColDef<TData> | null }) => ContextMenuAction[]) | undefined
  >(undefined);
  /** Briefly highlights ("flashes") any cell whose displayed value changes between renders -
   * useful for live/streaming data (e.g. an RxJS interval pushing new `rowData` snapshots).
   * Requires a real `getRowId` (not the default positional index) so a row's identity survives
   * across updates; otherwise every cell would appear to "change" whenever rows reorder. */
  readonly enableChangeFlash = input<boolean>(false);
  /** How long (ms) a flashed cell stays highlighted before the class is removed. */
  readonly changeFlashDurationMs = input<number>(800);

  readonly gridReady = output<GridReadyEvent>();
  /** Fires with the full list of currently-selected row objects whenever selection changes. */
  readonly selectionChanged = output<TData[]>();
  /** Fires after an inline edit is committed (Enter or blur). */
  readonly cellValueChanged = output<CellValueChangedEvent<TData>>();
  /** Fires after a drag-and-drop row reorder; `fromIndex`/`toIndex` index into `rowData()`. The
   * grid does not reorder its own data - apply the change to your `rowData` array in response. */
  readonly rowDragEnd = output<{ row: TData; fromIndex: number; toIndex: number }>();

  private readonly sortState = signal<SortEntry[]>([]);
  private readonly columnFilters = signal<Record<string, string>>({});
  /** Selected values per `filter: 'set'` column key; no entry means "all values" (no restriction). */
  private readonly setFilters = signal<Record<string, ReadonlySet<string>>>({});
  /** Which column's set-filter facet panel is open, plus its fixed-position coordinates (derived
   * from the toggle button's bounding rect - see `toggleSetFilterPanel`) - `null` when closed.
   * Uses `position: fixed` rather than a `position: absolute` + `overflow: visible` override
   * because `.gd-cell` (and, via the CSS overflow-x/y interaction, `.gd-root` itself) clips
   * overflowing descendants; fixed positioning sidesteps that entirely, matching the same
   * pattern already used for the right-click context menu. */
  private readonly openSetFilterPanel = signal<{ colKey: string; x: number; y: number } | null>(null);
  private readonly currentPage = signal(0);
  private readonly selection = signal<ReadonlyMap<string | number, TData>>(new Map());
  private readonly editingCell = signal<{ rowKey: string | number; colKey: string } | null>(null);
  /** Roving-tabindex active cell for keyboard navigation (arrows/Home/End/PageUp/PageDown) -
   * exactly one cell is in the Tab order at a time (besides always-tabbable editable cells). */
  private readonly activeCell = signal<{ rowIndex: number; colIndex: number }>({ rowIndex: 0, colIndex: 0 });
  /** Row-group keys the user has collapsed; a key not in this set is expanded (default expanded). */
  private readonly collapsedGroups = signal<ReadonlySet<string>>(new Set());
  /** Row ids (via `getRowId`) with an expanded master/detail panel - default collapsed. */
  private readonly expandedDetailRows = signal<ReadonlySet<string | number>>(new Set());
  /** Open right-click context menu state (position + resolved items), or `null` when closed. */
  protected readonly contextMenuState = signal<ContextMenuState | null>(null);
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
    const setFilters = this.setFilters();
    const { fieldTokens, remainingText } = parseSearchTokens(this.quickFilterText(), cols);
    const quick = remainingText.trim().toLowerCase();
    const pin = this.isRowPinned();
    // Pinned rows are rendered in their own always-visible sections (see pinnedTopRows/
    // pinnedBottomRows) and never participate in the normal filter/sort/page/scroll pipeline.
    const candidateRows = pin ? this.rowData().filter((row) => !pin(row)) : this.rowData();
    const activeColumnFilters = cols.filter((col) => (filters[col.key] ?? '').trim().length > 0);
    const activeSetFilters = Object.entries(setFilters);
    if (
      activeColumnFilters.length === 0 &&
      activeSetFilters.length === 0 &&
      fieldTokens.length === 0 &&
      !quick
    ) {
      return candidateRows;
    }

    return candidateRows.filter((row) => {
      for (const col of activeColumnFilters) {
        const filterText = filters[col.key].trim();
        const type = col.def.filter === 'number' || col.def.filter === 'date' ? col.def.filter : 'text';
        if (!matchesColumnFilter(this.cellValue(row, col.def), filterText, type)) return false;
      }
      for (const [colKey, selected] of activeSetFilters) {
        const col = cols.find((c) => c.key === colKey);
        if (col && !selected.has(this.cellDisplay(row, col.def))) return false;
      }
      for (const { col, value } of fieldTokens) {
        if (!this.cellDisplay(row, col.def).toLowerCase().includes(value.toLowerCase())) return false;
      }
      if (quick && !cols.some((col) => this.cellDisplay(row, col.def).toLowerCase().includes(quick))) {
        return false;
      }
      return true;
    });
  });

  /** Distinct displayed values for a `filter: 'set'` column, with their count across ALL rows
   * (not scoped to other active filters - a deliberate simplification over a fully "faceted"
   * search where counts update live per other filters, to keep this feature reasonably scoped). */
  protected facetsFor(col: ResolvedColumn<TData>): { value: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const row of this.rowData()) {
      const display = this.cellDisplay(row, col.def);
      counts.set(display, (counts.get(display) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => a.value.localeCompare(b.value));
  }

  protected hasActiveSetFilter(col: ResolvedColumn<TData>): boolean {
    return !!this.setFilters()[col.key];
  }

  protected isFacetSelected(col: ResolvedColumn<TData>, value: string): boolean {
    const selected = this.setFilters()[col.key];
    return !selected || selected.has(value);
  }

  protected toggleFacetValue(col: ResolvedColumn<TData>, value: string): void {
    this.setFilters.update((current) => {
      const allValues = this.facetsFor(col).map((facet) => facet.value);
      const existing = current[col.key] ?? new Set(allValues);
      const next = new Set(existing);
      if (next.has(value)) next.delete(value);
      else next.add(value);

      const updated = { ...current };
      // Selecting every value again is equivalent to "no filter" - drop the entry so
      // hasActiveSetFilter()/the filter pipeline don't treat it as an active restriction.
      if (next.size === allValues.length) delete updated[col.key];
      else updated[col.key] = next;
      return updated;
    });
  }

  protected toggleSetFilterPanel(colKey: string, event: MouseEvent): void {
    this.openSetFilterPanel.update((current) => {
      if (current?.colKey === colKey) return null;
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      return { colKey, x: rect.left, y: rect.bottom };
    });
  }

  protected isSetFilterPanelOpen(colKey: string): boolean {
    return this.openSetFilterPanel()?.colKey === colKey;
  }

  protected setFilterPanelPosition(): { x: number; y: number } | null {
    const panel = this.openSetFilterPanel();
    return panel ? { x: panel.x, y: panel.y } : null;
  }

  protected closeSetFilterPanel(): void {
    this.openSetFilterPanel.set(null);
  }

  protected readonly pinnedTopRows = computed<readonly TData[]>(() => {
    const pin = this.isRowPinned();
    return pin ? this.rowData().filter((row) => pin(row) === 'top') : [];
  });

  protected readonly pinnedBottomRows = computed<readonly TData[]>(() => {
    const pin = this.isRowPinned();
    return pin ? this.rowData().filter((row) => pin(row) === 'bottom') : [];
  });

  protected readonly hasPinnedRows = computed(
    () => this.pinnedTopRows().length > 0 || this.pinnedBottomRows().length > 0,
  );

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

  protected readonly hasTreeData = computed(() => !!this.getChildRows());

  protected readonly hasDetailTemplate = computed(() => !!this.detailRowTemplate());

  /** Flattened render list: every row when there's no grouping/tree data (1:1 with
   * `sortedRows()`), a mix of group-header rows and leaf rows when one or more columns declare
   * `rowGroup: true`, or a hierarchical (indented) flattening of `sortedRows()` + their children
   * when `getChildRows` is provided. Groups are a stable partition of `sortedRows()` (grouping
   * happens AFTER sort), so sorting still determines order both across and within groups.
   * Collapsed groups/tree nodes (see `collapsedGroups`) omit their descendants entirely.
   * Detail rows (see `detailRowTemplate`) are injected as a final pass, after grouping/tree
   * structure is resolved, so master/detail composes with either of those. */
  protected readonly displayRows = computed<DisplayItem<TData>[]>(() => {
    const base = this.buildBaseDisplayRows();
    if (!this.hasDetailTemplate()) return base;

    const expanded = this.expandedDetailRows();
    const result: DisplayItem<TData>[] = [];
    for (const item of base) {
      result.push(item);
      if (item.kind === 'row' && expanded.has(this.rowId(item.row, item.rowIndex))) {
        result.push({ kind: 'detail', row: item.row, rowIndex: item.rowIndex });
      }
    }
    return result;
  });

  private buildBaseDisplayRows(): DisplayItem<TData>[] {
    const rows = this.sortedRows();
    const getChildren = this.getChildRows();
    if (getChildren) return this.buildTreeDisplayRows(rows, getChildren);

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
  }

  private buildTreeDisplayRows(
    rootRows: readonly TData[],
    getChildren: (row: TData) => readonly TData[] | undefined,
  ): DisplayItem<TData>[] {
    const collapsed = this.collapsedGroups();
    const result: DisplayItem<TData>[] = [];
    let rowIndex = 0;

    const walk = (nodes: readonly TData[], level: number): void => {
      for (const row of nodes) {
        const currentIndex = rowIndex++;
        result.push({ kind: 'row', row, rowIndex: currentIndex, level });
        const children = getChildren(row);
        if (children && children.length > 0 && !collapsed.has(String(this.rowId(row, currentIndex)))) {
          walk(children, level + 1);
        }
      }
    };
    walk(rootRows, 0);
    return result;
  }

  protected hasChildRows(row: TData): boolean {
    const children = this.getChildRows()?.(row);
    return !!children && children.length > 0;
  }

  protected isRowExpanded(row: TData, rowIndex: number): boolean {
    return !this.collapsedGroups().has(String(this.rowId(row, rowIndex)));
  }

  protected toggleRowExpanded(row: TData, rowIndex: number): void {
    this.toggleGroup(String(this.rowId(row, rowIndex)));
  }

  protected isDetailExpanded(row: TData, rowIndex: number): boolean {
    return this.expandedDetailRows().has(this.rowId(row, rowIndex));
  }

  protected toggleDetail(row: TData, rowIndex: number): void {
    const id = this.rowId(row, rowIndex);
    this.expandedDetailRows.update((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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

  /** Cell keys (`${rowId}:${colKey}`) currently mid-flash from a detected value change. */
  private readonly flashingCells = signal<ReadonlySet<string>>(new Set());
  /** Last-seen displayed value per cell key - a plain mutable map (not a signal) since it's only
   * ever read/written from inside the `enableChangeFlash` effect below, never from a template. */
  private readonly previousCellValues = new Map<string, string>();

  constructor() {
    effect(() => {
      if (!this.enableChangeFlash()) return;
      const rows = this.sortedRows();
      const cols = this.columns();
      const changedKeys: string[] = [];

      rows.forEach((row, index) => {
        const rid = this.rowId(row, index);
        for (const col of cols) {
          const key = `${rid}:${col.key}`;
          const value = this.cellDisplay(row, col.def);
          const previous = this.previousCellValues.get(key);
          if (previous !== undefined && previous !== value) changedKeys.push(key);
          this.previousCellValues.set(key, value);
        }
      });

      if (changedKeys.length === 0) return;
      this.flashingCells.update((current) => new Set([...current, ...changedKeys]));
      setTimeout(() => {
        this.flashingCells.update((current) => {
          const next = new Set(current);
          changedKeys.forEach((key) => next.delete(key));
          return next;
        });
      }, this.changeFlashDurationMs());
    });
  }

  protected isCellFlashing(col: ResolvedColumn<TData>, row: TData, rowIndex: number): boolean {
    return this.flashingCells().has(`${this.rowId(row, rowIndex)}:${col.key}`);
  }

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

  /** Snapshots the grid's user-driven layout state (column widths/order, sort, column filters,
   * current page) for persistence - serialize the result yourself (e.g. `JSON.stringify` to
   * `localStorage`); the grid stays storage-agnostic. */
  getGridState(): GridLayoutState {
    return {
      columnWidths: this.columnWidthOverrides(),
      columnOrder: this.columnOrder(),
      sort: this.sortState(),
      columnFilters: this.columnFilters(),
      page: this.currentPage(),
    };
  }

  /** Restores a snapshot from `getGridState()` (or a partial subset of it). */
  applyGridState(state: Partial<GridLayoutState>): void {
    if (state.columnWidths) this.columnWidthOverrides.set(state.columnWidths);
    if (state.columnOrder !== undefined) this.columnOrder.set(state.columnOrder);
    if (state.sort) this.sortState.set(state.sort);
    if (state.columnFilters) this.columnFilters.set(state.columnFilters);
    if (state.page !== undefined) this.currentPage.set(state.page);
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

  /** Opens the right-click context menu for a cell; uses `contextMenuItems()` when provided,
   * otherwise falls back to Copy cell / Copy row / Export CSV. */
  protected onCellContextMenu(row: TData, col: ResolvedColumn<TData>, event: MouseEvent): void {
    event.preventDefault();
    const customItems = this.contextMenuItems();
    const items = customItems ? customItems({ row, col: col.def }) : this.defaultContextMenuItems(row, col);
    if (items.length === 0) return;
    this.contextMenuState.set({ x: event.clientX, y: event.clientY, items });
  }

  private defaultContextMenuItems(row: TData, col: ResolvedColumn<TData>): ContextMenuAction[] {
    return [
      { label: 'Copy cell', action: () => this.copyToClipboard(this.cellDisplay(row, col.def)) },
      {
        label: 'Copy row',
        action: () => this.copyToClipboard(this.columns().map((c) => this.cellDisplay(row, c.def)).join('\t')),
      },
      { label: 'Export CSV', action: () => this.exportDataAsCsv() },
    ];
  }

  private copyToClipboard(text: string): void {
    navigator.clipboard?.writeText(text);
  }

  protected closeContextMenu(): void {
    this.contextMenuState.set(null);
  }

  protected runContextMenuAction(action: () => void): void {
    action();
    this.closeContextMenu();
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

  /** A pinned row's index within `rowData()` - used as its `rowId()` basis since pinned rows are
   * excluded from `sortedRows()` entirely (see `filteredRows`). */
  protected pinnedRowIndex(row: TData): number {
    return this.rowData().indexOf(row);
  }

  protected pinnedRowId(row: TData): string | number {
    return this.rowId(row, this.pinnedRowIndex(row));
  }

  protected onRowDragStart(row: TData, index: number, event: DragEvent): void {
    if (!this.enableRowDrag()) return;
    event.dataTransfer?.setData('text/plain', String(this.rowId(row, index)));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  protected onRowDragOver(event: DragEvent): void {
    if (this.enableRowDrag()) event.preventDefault();
  }

  /** Resolves both rows against `rowData()` by identity (id string / object reference) rather
   * than trusting the transient `sortedRows()`-relative index passed around during the drag, so
   * this stays correct regardless of active sorting/filtering. Requires a real `getRowId` (not
   * the default positional index) to work reliably once sorting/filtering reorders rows. */
  protected onRowDrop(targetRow: TData, event: DragEvent): void {
    if (!this.enableRowDrag()) return;
    event.preventDefault();
    const sourceId = event.dataTransfer?.getData('text/plain');
    if (!sourceId) return;

    const rows = this.rowData();
    const fromIndex = rows.findIndex((row, index) => String(this.rowId(row, index)) === sourceId);
    const toIndex = rows.indexOf(targetRow);
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;
    this.rowDragEnd.emit({ row: rows[fromIndex], fromIndex, toIndex });
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

  /** Stable `@for` track key for a display item - a group's own key, the leaf row's identity, or
   * (for a detail panel) that same identity with a distinguishing prefix. */
  protected itemTrackKey(item: DisplayItem<TData>): string | number {
    if (item.kind === 'group') return item.group.key;
    if (item.kind === 'detail') return `detail:${this.rowId(item.row, item.rowIndex)}`;
    return this.rowId(item.row, item.rowIndex);
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
function isRowItem<TData>(item: DisplayItem<TData>): item is Extract<DisplayItem<TData>, { kind: 'row' }> {
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

/** Splits `quickFilterText` into `field:value` tokens (matched against each column's `field`,
 * case-insensitively) and the remaining free text, which is treated as a single substring exactly
 * like the plain quick filter always has been - so text with no `field:value` tokens behaves
 * identically to before this feature existed. */
function parseSearchTokens<TData>(
  text: string,
  cols: readonly ResolvedColumn<TData>[],
): { fieldTokens: { col: ResolvedColumn<TData>; value: string }[]; remainingText: string } {
  const fieldTokens: { col: ResolvedColumn<TData>; value: string }[] = [];
  const remainingParts: string[] = [];

  for (const token of text.trim().split(/\s+/).filter(Boolean)) {
    const colonIndex = token.indexOf(':');
    if (colonIndex > 0) {
      const key = token.slice(0, colonIndex).toLowerCase();
      const value = token.slice(colonIndex + 1);
      const col = cols.find((candidate) => (candidate.def.field ?? '').toLowerCase() === key);
      if (col && value) {
        fieldTokens.push({ col, value });
        continue;
      }
    }
    remainingParts.push(token);
  }
  return { fieldTokens, remainingText: remainingParts.join(' ') };
}

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
