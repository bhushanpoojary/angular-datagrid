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

  function bodyText(): string[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll(
        '.gd-viewport .gd-row .gd-cell:first-child, .gd-body--paged .gd-row .gd-cell:first-child',
      ),
    ).map((el) => (el.textContent ?? '').trim());
  }

  function headerFor(name: string): HTMLElement {
    const headers = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('[role="columnheader"]'),
    );
    const header = headers.find((el) => el.textContent?.includes(name));
    if (!header) throw new Error(`header ${name} not found`);
    return header;
  }

  function setFilterInput(headerName: string, value: string): void {
    const filterInput = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      `[aria-label="Filter ${headerName}"]`,
    );
    if (!filterInput) throw new Error(`filter input for ${headerName} not found`);
    filterInput.value = value;
    filterInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
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

  describe('sorting', () => {
    const threeRows: Row[] = [
      { id: 1, name: 'Charlie', score: 70 },
      { id: 2, name: 'Alpha', score: 90 },
      { id: 3, name: 'Bravo', score: 80 },
    ];
    const sortableDefs: ColDef<Row>[] = [
      { field: 'id', headerName: 'ID' },
      { field: 'name', headerName: 'Name', sortable: true },
      { field: 'score', headerName: 'Score', sortable: true },
    ];

    it('applies declarative default sort (lowest sortIndex wins)', async () => {
      await setInputs(threeRows, [
        { field: 'id', headerName: 'ID' },
        { field: 'name', headerName: 'Name', sortable: true, sort: 'asc', sortIndex: 1 },
        { field: 'score', headerName: 'Score', sortable: true, sort: 'desc', sortIndex: 0 },
      ]);
      expect(bodyText()).toEqual(['2', '3', '1']); // sorted by score desc: 90, 80, 70
    });

    it('ignores clicks on non-sortable headers', async () => {
      await setInputs(threeRows, sortableDefs);
      headerFor('ID').click();
      fixture.detectChanges();
      expect(bodyText()).toEqual(['1', '2', '3']);
    });

    it('cycles a single column asc -> desc -> unsorted on repeated clicks', async () => {
      await setInputs(threeRows, sortableDefs);
      const nameHeader = headerFor('Name');

      nameHeader.click();
      fixture.detectChanges();
      expect(bodyText()).toEqual(['2', '3', '1']); // Alpha, Bravo, Charlie

      nameHeader.click();
      fixture.detectChanges();
      expect(bodyText()).toEqual(['1', '3', '2']); // Charlie, Bravo, Alpha

      nameHeader.click();
      fixture.detectChanges();
      expect(bodyText()).toEqual(['1', '2', '3']); // back to original order
    });

    it('supports multi-column sort via shift-click', async () => {
      const tied: Row[] = [
        { id: 1, name: 'B', score: 50 },
        { id: 2, name: 'A', score: 50 },
        { id: 3, name: 'A', score: 40 },
      ];
      await setInputs(tied, sortableDefs);

      headerFor('Score').click();
      fixture.detectChanges();
      headerFor('Name').dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
      fixture.detectChanges();

      // score asc first (40, 50, 50), name asc breaks the score=50 tie (A before B)
      expect(bodyText()).toEqual(['3', '2', '1']);
    });

    it('uses a custom comparator when provided', async () => {
      await setInputs(threeRows, [
        { field: 'id', headerName: 'ID' },
        { field: 'name', headerName: 'Name' },
        {
          field: 'score',
          headerName: 'Score',
          sortable: true,
          comparator: (a, b) => (b as number) - (a as number), // reversed vs. default
        },
      ]);
      headerFor('Score').click();
      fixture.detectChanges();
      expect(bodyText()).toEqual(['2', '3', '1']); // reversed comparator flips the usual asc order
    });
  });

  describe('filtering', () => {
    const threeRows: Row[] = [
      { id: 1, name: 'Charlie', score: 70 },
      { id: 2, name: 'Alpha', score: 90 },
      { id: 3, name: 'Bravo', score: 80 },
    ];

    it('does not render a filter row when no column declares `filter`', async () => {
      await setInputs(threeRows, [
        { field: 'id', headerName: 'ID' },
        { field: 'name', headerName: 'Name' },
      ]);
      expect((fixture.nativeElement as HTMLElement).querySelector('.gd-row--filter')).toBeNull();
    });

    it('filters rows by a text column (case-insensitive substring)', async () => {
      await setInputs(threeRows, [
        { field: 'id', headerName: 'ID' },
        { field: 'name', headerName: 'Name', filter: 'text' },
        { field: 'score', headerName: 'Score' },
      ]);
      setFilterInput('Name', 'ha');
      expect(bodyText()).toEqual(['1', '2']); // Charlie, Alpha (both contain "ha")
    });

    it('filters a number column using comparison operators', async () => {
      await setInputs(threeRows, [
        { field: 'id', headerName: 'ID' },
        { field: 'name', headerName: 'Name' },
        { field: 'score', headerName: 'Score', filter: 'number' },
      ]);
      setFilterInput('Score', '>75');
      expect(bodyText()).toEqual(['2', '3']); // 90 and 80
    });

    it('combines a quick filter across all columns with column filters', async () => {
      await setInputs(threeRows, [
        { field: 'id', headerName: 'ID' },
        { field: 'name', headerName: 'Name', filter: 'text' },
        { field: 'score', headerName: 'Score' },
      ]);
      fixture.componentRef.setInput('quickFilterText', '80');
      fixture.detectChanges();
      expect(bodyText()).toEqual(['3']); // only Bravo has score 80
    });

    it('shows the empty state when filters match nothing', async () => {
      await setInputs(threeRows, [
        { field: 'id', headerName: 'ID' },
        { field: 'name', headerName: 'Name', filter: 'text' },
      ]);
      setFilterInput('Name', 'zzz');
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('No rows to display');
    });
  });

  describe('pagination', () => {
    const fiveRows: Row[] = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      name: `Row ${i + 1}`,
      score: i,
    }));

    function pagerText(): string {
      return (fixture.nativeElement as HTMLElement).querySelector('.gd-pager')?.textContent ?? '';
    }

    function clickPagerButton(label: string): void {
      const buttons = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.gd-pager__buttons button'),
      );
      const button = buttons.find((b) => b.textContent?.includes(label));
      if (!button) throw new Error(`pager button "${label}" not found`);
      button.click();
      fixture.detectChanges();
    }

    it('shows only pageSize rows per page and a range summary', async () => {
      fixture.componentRef.setInput('pagination', true);
      fixture.componentRef.setInput('pageSize', 2);
      await setInputs(fiveRows, columnDefs);
      expect(bodyText()).toEqual(['1', '2']);
      expect(pagerText()).toContain('1-2 of 5');
      expect(pagerText()).toContain('Page 1 of 3');
    });

    it('navigates with Next/Prev/First/Last', async () => {
      fixture.componentRef.setInput('pagination', true);
      fixture.componentRef.setInput('pageSize', 2);
      await setInputs(fiveRows, columnDefs);

      clickPagerButton('Next');
      expect(bodyText()).toEqual(['3', '4']);

      clickPagerButton('Last');
      expect(bodyText()).toEqual(['5']);
      expect(pagerText()).toContain('Page 3 of 3');

      clickPagerButton('First');
      expect(bodyText()).toEqual(['1', '2']);

      clickPagerButton('Next');
      clickPagerButton('Prev');
      expect(bodyText()).toEqual(['1', '2']);
    });

    it('clamps back onto a valid page when filtering shrinks the result set', async () => {
      fixture.componentRef.setInput('pagination', true);
      fixture.componentRef.setInput('pageSize', 2);
      await setInputs(fiveRows, [
        { field: 'id', headerName: 'ID' },
        { field: 'name', headerName: 'Name', filter: 'text' },
        { field: 'score', headerName: 'Score' },
      ]);

      clickPagerButton('Last'); // page 3 of 3 (row 5 only)
      setFilterInput('Name', 'Row 1'); // only "Row 1" matches -> 1 row, 1 page
      expect(bodyText()).toEqual(['1']);
      expect(pagerText()).toContain('Page 1 of 1');
    });

    it('does not render a pager when pagination is disabled', async () => {
      await setInputs(fiveRows, columnDefs);
      expect((fixture.nativeElement as HTMLElement).querySelector('.gd-pager')).toBeNull();
    });
  });

  describe('selection', () => {
    const threeRows: Row[] = [
      { id: 1, name: 'Charlie', score: 70 },
      { id: 2, name: 'Alpha', score: 90 },
      { id: 3, name: 'Bravo', score: 80 },
    ];

    function bodyRows(): HTMLElement[] {
      return Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
          '.gd-viewport .gd-row, .gd-body--paged .gd-row',
        ),
      );
    }

    function checkboxIn(row: HTMLElement): HTMLInputElement {
      const checkbox = row.querySelector<HTMLInputElement>('.gd-select-checkbox');
      if (!checkbox) throw new Error('checkbox not found in row');
      return checkbox;
    }

    it('does nothing when rowSelection is "none" (default)', async () => {
      await setInputs(threeRows, columnDefs);
      bodyRows()[0].click();
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).querySelector('.gd-row--selected')).toBeNull();
    });

    it('single mode: selects one row and clicking it again deselects it', async () => {
      fixture.componentRef.setInput('rowSelection', 'single');
      const events: Row[][] = [];
      component.selectionChanged.subscribe((rows) => events.push(rows));
      await setInputs(threeRows, columnDefs);

      const rows = bodyRows();
      rows[0].click();
      fixture.detectChanges();
      expect(rows[0].classList).toContain('gd-row--selected');
      expect(events.at(-1)).toEqual([threeRows[0]]);

      rows[1].click();
      fixture.detectChanges();
      expect(bodyRows()[0].classList).not.toContain('gd-row--selected');
      expect(bodyRows()[1].classList).toContain('gd-row--selected');

      bodyRows()[1].click();
      fixture.detectChanges();
      expect(bodyRows()[1].classList).not.toContain('gd-row--selected');
      expect(events.at(-1)).toEqual([]);
    });

    it('multiple mode: checkbox column toggles individual rows and header toggles select-all', async () => {
      fixture.componentRef.setInput('rowSelection', 'multiple');
      const events: Row[][] = [];
      component.selectionChanged.subscribe((rows) => events.push(rows));
      await setInputs(threeRows, [{ field: 'id', headerName: '', checkboxSelection: true }, ...columnDefs]);

      const rows = bodyRows();
      checkboxIn(rows[0]).click();
      checkboxIn(rows[2]).click();
      fixture.detectChanges();
      expect(events.at(-1)?.map((r) => r.id).sort()).toEqual([1, 3]);

      const selectAll = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
        '[aria-label="Select all rows"]',
      );
      selectAll?.click();
      fixture.detectChanges();
      expect(events.at(-1)?.length).toBe(3);

      selectAll?.click();
      fixture.detectChanges();
      expect(events.at(-1)).toEqual([]);
    });

    it('keeps selection tied to a real row id (getRowId) across sorting', async () => {
      fixture.componentRef.setInput('rowSelection', 'single');
      fixture.componentRef.setInput('getRowId', (row: Row) => row.id);
      await setInputs(threeRows, [
        { field: 'id', headerName: 'ID' },
        { field: 'name', headerName: 'Name', sortable: true },
        { field: 'score', headerName: 'Score' },
      ]);

      bodyRows()[1].click(); // selects Alpha (id 2), currently at position 1
      fixture.detectChanges();
      expect(bodyRows()[1].classList).toContain('gd-row--selected');

      headerFor('Name').click(); // sort by name asc -> reorders rows
      fixture.detectChanges();
      const rows = bodyRows();
      const selectedIndex = rows.findIndex((row) => row.classList.contains('gd-row--selected'));
      expect(bodyText()[selectedIndex]).toBe('2'); // Alpha's id, still selected after reordering
    });
  });
});
