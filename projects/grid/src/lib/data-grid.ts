import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { ColDef } from '../models/col-def';
import type { GridReadyEvent } from '../models/grid-events';

@Component({
  selector: 'gd-data-grid',
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './data-grid.html',
  styleUrl: './data-grid.css',
})
export class DataGrid<TData = unknown> {
  readonly rowData = input<readonly TData[]>([]);
  readonly columnDefs = input<readonly ColDef<TData>[]>([]);
  readonly defaultColDef = input<ColDef<TData> | undefined>(undefined);

  readonly gridReady = output<GridReadyEvent>();
}
