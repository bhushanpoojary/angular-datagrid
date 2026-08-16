import { ChangeDetectionStrategy, Component, OnInit, computed, input, output } from '@angular/core';
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
  /** Stable row identity for virtual-scroll trackBy; defaults to positional index. */
  readonly getRowId = input<(row: TData, index: number) => string | number>((_row, index) => index);

  readonly gridReady = output<GridReadyEvent>();

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

  ngOnInit(): void {
    this.gridReady.emit({ rowCount: this.rowData().length, columnCount: this.columns().length });
  }

  protected trackRow = (index: number, row: TData): string | number => this.getRowId()(row, index);

  protected cellValue(row: TData, col: ColDef<TData>): unknown {
    if (col.valueGetter) return col.valueGetter(row);
    return col.field ? row[col.field] : undefined;
  }

  protected cellDisplay(row: TData, col: ColDef<TData>): string {
    const value = this.cellValue(row, col);
    if (col.valueFormatter) return col.valueFormatter(value);
    return value == null ? '' : String(value);
  }
}

function columnStyle<TData>(col: ColDef<TData>): Record<string, string> {
  const style: Record<string, string> = {
    flex: col.width != null ? `0 0 ${col.width}px` : `${col.flex ?? 1} 1 0`,
  };
  if (col.minWidth != null) style['min-width'] = `${col.minWidth}px`;
  if (col.maxWidth != null) style['max-width'] = `${col.maxWidth}px`;
  return style;
}
