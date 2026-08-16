import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { CdkVirtualScrollViewport } from '@angular/cdk/scrolling';

import { DataGrid } from './data-grid';
import type { ColDef } from '../models/col-def';
import type { GridReadyEvent } from '../models/grid-events';

interface Row {
  id: number;
  name: string;
  score: number;
}

describe('DataGrid', () => {
  let fixture: ComponentFixture<DataGrid<Row>>;
  let component: DataGrid<Row>;

  const rowData: Row[] = [
    { id: 1, name: 'Ada', score: 91 },
    { id: 2, name: 'Grace', score: 88 },
  ];

  const columnDefs: ColDef<Row>[] = [
    { field: 'id', headerName: 'ID', width: 60 },
    { field: 'name', headerName: 'Name' },
    { field: 'score', headerName: 'Score', valueFormatter: (v) => `${v}%` },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [DataGrid] }).compileComponents();
    fixture = TestBed.createComponent(DataGrid<Row>);
    component = fixture.componentInstance;
  });

  // jsdom never lays out elements (clientHeight is always 0), so the CDK virtual
  // scroll viewport thinks it has no space and renders nothing - fake a real size.
  async function setInputs(data: readonly Row[], defs: readonly ColDef<Row>[]): Promise<void> {
    fixture.componentRef.setInput('rowData', data);
    fixture.componentRef.setInput('columnDefs', defs);
    fixture.detectChanges();

    const viewportDebug = fixture.debugElement.query(By.directive(CdkVirtualScrollViewport));
    if (viewportDebug) {
      Object.defineProperty(viewportDebug.nativeElement, 'clientHeight', { value: 400, configurable: true });
      viewportDebug.injector.get(CdkVirtualScrollViewport).checkViewportSize();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    }
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('defaults rowData and columnDefs to empty arrays', () => {
    expect(component.rowData()).toEqual([]);
    expect(component.columnDefs()).toEqual([]);
  });

  it('renders a header cell per visible column', async () => {
    await setInputs(rowData, columnDefs);
    const headers = (fixture.nativeElement as HTMLElement).querySelectorAll('[role="columnheader"]');
    expect(headers.length).toBe(3);
    expect(headers[1].textContent?.trim()).toBe('Name');
  });

  it('renders one row per data item with formatted values', async () => {
    await setInputs(rowData, columnDefs);
    const rows = (fixture.nativeElement as HTMLElement).querySelectorAll('.gd-row:not(.gd-row--header)');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Ada');
    expect(rows[0].textContent).toContain('91%');
  });

  it('hides columns marked hide:true', async () => {
    await setInputs(rowData, [...columnDefs, { field: 'id', headerName: 'Hidden', hide: true }]);
    const headers = (fixture.nativeElement as HTMLElement).querySelectorAll('[role="columnheader"]');
    expect(headers.length).toBe(3);
  });

  it('applies defaultColDef to columns without their own value', async () => {
    fixture.componentRef.setInput('defaultColDef', { flex: 2 } satisfies ColDef<Row>);
    await setInputs(rowData, [{ field: 'name' }]);
    expect(component['columns']()[0].style['flex']).toBe('2 1 0');
  });

  it('shows an empty state message when there are no rows', async () => {
    await setInputs([], columnDefs);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No rows to display');
  });

  it('emits gridReady once with row/column counts', async () => {
    const events: GridReadyEvent[] = [];
    component.gridReady.subscribe((event) => events.push(event));
    await setInputs(rowData, columnDefs);
    expect(events).toEqual([{ rowCount: 2, columnCount: 3 }]);
  });
});
