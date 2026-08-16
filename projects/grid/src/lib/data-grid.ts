import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  Directive,
  ElementRef,
  OnInit,
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
  style: Record<string, string>;
}

interface SortEntry {
  key: string;
  direction: 'asc' | 'desc';
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
    if (!this.isEditable(col, row) || this.isEditing(row, index, col)) return;
    if (event.key !== 'Enter' && event.key !== 'F2') return;
    event.preventDefault();
    event.stopPropagation();
    this.startEdit(row, index, col);
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

function columnStyle<TData>(col: ColDef<TData>): Record<string, string> {
  const style: Record<string, string> = {
    flex: col.width != null ? `0 0 ${col.width}px` : `${col.flex ?? 1} 1 0`,
  };
  if (col.minWidth != null) style['min-width'] = `${col.minWidth}px`;
  if (col.maxWidth != null) style['max-width'] = `${col.maxWidth}px`;
  return style;
}
