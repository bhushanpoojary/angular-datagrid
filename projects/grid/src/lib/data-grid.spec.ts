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
  active?: boolean;
  team?: string;
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

  describe('editing', () => {
    // Fresh objects per test - these tests mutate rows in place, and a shared `const`
    // across `it` blocks would leak edits from one test into the next.
    let twoRows: Row[];
    beforeEach(() => {
      twoRows = [
        { id: 1, name: 'Charlie', score: 70, active: false, team: 'Red' },
        { id: 2, name: 'Alpha', score: 90, active: true, team: 'Blue' },
      ];
    });

    function cellAt(rowIndex: number, colIndex: number): HTMLElement {
      const rows = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
          '.gd-viewport .gd-row, .gd-body--paged .gd-row',
        ),
      );
      const cells = rows[rowIndex].querySelectorAll<HTMLElement>('.gd-cell');
      return cells[colIndex];
    }

    it('does nothing on double-click when the column is not editable', async () => {
      await setInputs(twoRows, columnDefs);
      cellAt(0, 1).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      fixture.detectChanges();
      expect(cellAt(0, 1).querySelector('.gd-edit-input')).toBeNull();
    });

    it('text editor: double-click starts editing, Enter commits, and cellValueChanged fires', async () => {
      const events: unknown[] = [];
      component.cellValueChanged.subscribe((e) => events.push(e));
      await setInputs(twoRows, [
        { field: 'id', headerName: 'ID' },
        { field: 'name', headerName: 'Name', editable: true },
        { field: 'score', headerName: 'Score' },
      ]);

      const cell = cellAt(0, 1);
      cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      fixture.detectChanges();

      const input = cell.querySelector<HTMLInputElement>('.gd-edit-input');
      expect(input).not.toBeNull();
      expect(input!.value).toBe('Charlie');

      input!.value = 'Charlotte';
      input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      fixture.detectChanges();

      expect(cellAt(0, 1).querySelector('.gd-edit-input')).toBeNull();
      expect(cellAt(0, 1).textContent?.trim()).toBe('Charlotte');
      expect(twoRows[0].name).toBe('Charlotte');
      expect(events).toEqual([{ row: twoRows[0], field: 'name', oldValue: 'Charlie', newValue: 'Charlotte' }]);
    });

    it('Escape cancels an edit without committing', async () => {
      await setInputs(twoRows, [
        { field: 'id', headerName: 'ID' },
        { field: 'name', headerName: 'Name', editable: true },
      ]);
      const cell = cellAt(0, 1);
      cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      fixture.detectChanges();

      const input = cell.querySelector<HTMLInputElement>('.gd-edit-input')!;
      input.value = 'Should not stick';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();

      expect(cellAt(0, 1).querySelector('.gd-edit-input')).toBeNull();
      expect(cellAt(0, 1).textContent?.trim()).toBe('Charlie');
    });

    it('commits on blur too (e.g. clicking elsewhere)', async () => {
      await setInputs(twoRows, [
        { field: 'id', headerName: 'ID' },
        { field: 'name', headerName: 'Name', editable: true },
      ]);
      const cell = cellAt(0, 1);
      cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      fixture.detectChanges();

      const input = cell.querySelector<HTMLInputElement>('.gd-edit-input')!;
      input.value = 'Via blur';
      input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
      fixture.detectChanges();

      expect(cellAt(0, 1).textContent?.trim()).toBe('Via blur');
    });

    it('number editor coerces the committed value to a number', async () => {
      await setInputs(twoRows, [
        { field: 'id', headerName: 'ID' },
        { field: 'score', headerName: 'Score', editable: true, cellEditor: 'number' },
      ]);
      const cell = cellAt(0, 1);
      cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      fixture.detectChanges();

      const input = cell.querySelector<HTMLInputElement>('.gd-edit-input')!;
      input.value = '95';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      fixture.detectChanges();

      expect(twoRows[0].score).toBe(95);
      expect(typeof twoRows[0].score).toBe('number');
    });

    it('checkbox editor toggles a boolean value', async () => {
      await setInputs(twoRows, [
        { field: 'id', headerName: 'ID' },
        { field: 'active', headerName: 'Active', editable: true, cellEditor: 'checkbox' },
      ]);
      const cell = cellAt(0, 1);
      cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      fixture.detectChanges();

      const checkbox = cell.querySelector<HTMLInputElement>('.gd-edit-input')!;
      expect(checkbox.checked).toBe(false);
      checkbox.checked = true;
      checkbox.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
      fixture.detectChanges();

      expect(twoRows[0].active).toBe(true);
    });

    it('select editor commits the matching option value', async () => {
      await setInputs(twoRows, [
        { field: 'id', headerName: 'ID' },
        {
          field: 'team',
          headerName: 'Team',
          editable: true,
          cellEditor: 'select',
          cellEditorParams: {
            options: [
              { label: 'Red', value: 'Red' },
              { label: 'Blue', value: 'Blue' },
              { label: 'Green', value: 'Green' },
            ],
          },
        },
      ]);
      const cell = cellAt(0, 1);
      cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      fixture.detectChanges();

      const select = cell.querySelector<HTMLSelectElement>('.gd-edit-input')!;
      select.value = 'Green';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      fixture.detectChanges();

      expect(twoRows[0].team).toBe('Green');
    });

    it('singleClickEdit: a single click starts editing instead of double-click', async () => {
      fixture.componentRef.setInput('singleClickEdit', true);
      await setInputs(twoRows, [
        { field: 'id', headerName: 'ID' },
        { field: 'name', headerName: 'Name', editable: true },
      ]);
      const cell = cellAt(0, 1);
      cell.click();
      fixture.detectChanges();
      expect(cell.querySelector('.gd-edit-input')).not.toBeNull();
    });

    it('a valueSetter is used instead of directly mutating the field, when provided', async () => {
      const valueSetter = vi.fn((row: Row, value: unknown) => {
        row.name = `[edited] ${value as string}`;
      });
      await setInputs(twoRows, [
        { field: 'id', headerName: 'ID' },
        { field: 'name', headerName: 'Name', editable: true, valueSetter },
      ]);
      const cell = cellAt(0, 1);
      cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      fixture.detectChanges();

      const input = cell.querySelector<HTMLInputElement>('.gd-edit-input')!;
      input.value = 'Zed';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      fixture.detectChanges();

      expect(valueSetter).toHaveBeenCalledWith(twoRows[0], 'Zed');
      expect(twoRows[0].name).toBe('[edited] Zed');
    });
  });

  describe('column ops', () => {
    function headerCells(): HTMLElement[] {
      return Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('[role="columnheader"]'),
      );
    }

    it('drag-resizes a column via its resize handle, widening the flex-basis', async () => {
      await setInputs(rowData, columnDefs);
      const idHeader = headerFor('ID');
      const handle = idHeader.querySelector<HTMLElement>('.gd-col-resizer')!;
      expect(handle).not.toBeNull();

      handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100 }));
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 150 }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      fixture.detectChanges();

      expect(idHeader.style.flex).toBe('0 0 110px'); // 60px initial width + 50px drag delta
    });

    it('stops resizing once mouseup fires (further mousemove has no effect)', async () => {
      await setInputs(rowData, columnDefs);
      const idHeader = headerFor('ID');
      const handle = idHeader.querySelector<HTMLElement>('.gd-col-resizer')!;

      handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100 }));
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 120 }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 500 }));
      fixture.detectChanges();

      expect(idHeader.style.flex).toBe('0 0 80px'); // only the pre-mouseup delta applied
    });

    it('does not render a resize handle when resizable is explicitly false', async () => {
      await setInputs(rowData, [{ field: 'id', headerName: 'ID', width: 60, resizable: false }, ...columnDefs.slice(1)]);
      expect(headerFor('ID').querySelector('.gd-col-resizer')).toBeNull();
    });

    it('reorders columns via header drag-and-drop', async () => {
      await setInputs(rowData, columnDefs);
      expect(headerCells().map((el) => el.textContent?.trim().charAt(0))).toEqual(['I', 'N', 'S']); // ID, Name, Score

      // jsdom doesn't implement DataTransfer in this test environment - a minimal stand-in
      // (setData/getData backed by a Map) is enough to exercise the reorder logic.
      const store = new Map<string, string>();
      const dataTransfer = {
        setData: (type: string, value: string) => store.set(type, value),
        getData: (type: string) => store.get(type) ?? '',
        effectAllowed: '',
      } as unknown as DataTransfer;
      const idHeader = headerFor('ID');
      const scoreHeader = headerFor('Score');

      const dragStart = new Event('dragstart', { bubbles: true }) as DragEvent;
      Object.defineProperty(dragStart, 'dataTransfer', { value: dataTransfer });
      const dragOver = new Event('dragover', { bubbles: true }) as DragEvent;
      Object.defineProperty(dragOver, 'dataTransfer', { value: dataTransfer });
      const drop = new Event('drop', { bubbles: true }) as DragEvent;
      Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer });

      idHeader.dispatchEvent(dragStart);
      scoreHeader.dispatchEvent(dragOver);
      scoreHeader.dispatchEvent(drop);
      fixture.detectChanges();

      expect(headerFor('Name')).toBeTruthy();
      const order = headerCells().map((el) => el.textContent?.trim().split(' ')[0]);
      expect(order).toEqual(['Name', 'Score', 'ID']); // ID moved to Score's former position
    });

    it('pins a column left with sticky positioning and a zero left offset', async () => {
      await setInputs(rowData, [{ ...columnDefs[0], pinned: 'left' }, ...columnDefs.slice(1)]);
      const idHeader = headerFor('ID');
      expect(idHeader.style.position).toBe('sticky');
      expect(idHeader.style.left).toBe('0px');
    });

    it('pins a column right with sticky positioning and a zero right offset', async () => {
      await setInputs(rowData, [...columnDefs.slice(0, 2), { ...columnDefs[2], pinned: 'right' }]);
      const scoreHeader = headerFor('Score');
      expect(scoreHeader.style.position).toBe('sticky');
      expect(scoreHeader.style.right).toBe('0px');
    });

    it('clusters pinned-left and pinned-right columns even if declared out of order', async () => {
      await setInputs(rowData, [
        { field: 'id', headerName: 'ID', width: 60 },
        { field: 'name', headerName: 'Name', pinned: 'left' },
        { field: 'score', headerName: 'Score', valueFormatter: (v) => `${v}%` },
      ]);
      const order = headerCells().map((el) => el.textContent?.trim().split(' ')[0]);
      expect(order).toEqual(['Name', 'ID', 'Score']);
    });
  });

  describe('cell/row styling', () => {
    function bodyRowDivs(): HTMLElement[] {
      return Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
          '.gd-viewport .gd-row, .gd-body--paged .gd-row',
        ),
      );
    }

    it('applies a class from cellClassRules only when its predicate matches', async () => {
      const highScore: ColDef<Row> = {
        field: 'score',
        headerName: 'Score',
        cellClassRules: { 'gd-high-score': ({ value }) => (value as number) >= 90 },
      };
      await setInputs(rowData, [columnDefs[0], columnDefs[1], highScore]);
      const cells = bodyRowDivs().map((row) => row.querySelectorAll('.gd-cell')[2]);
      expect(cells[0].classList).toContain('gd-high-score'); // Ada: 91
      expect(cells[1].classList).not.toContain('gd-high-score'); // Grace: 88
    });

    it('applies a row class from rowClassRules only when its predicate matches', async () => {
      fixture.componentRef.setInput('rowClassRules', { 'gd-inactive-row': (row: Row) => row.active === false });
      await setInputs(
        [
          { id: 1, name: 'Ada', score: 91, active: true },
          { id: 2, name: 'Grace', score: 88, active: false },
        ],
        columnDefs,
      );
      const rows = bodyRowDivs();
      expect(rows[0].classList).not.toContain('gd-inactive-row');
      expect(rows[1].classList).toContain('gd-inactive-row');
    });

    it('uses getRowHeight per-row in paginated (non-virtualized) mode', async () => {
      fixture.componentRef.setInput('pagination', true);
      fixture.componentRef.setInput('getRowHeight', (row: Row) => (row.id === 2 ? 60 : 36));
      await setInputs(rowData, columnDefs);
      const rows = bodyRowDivs();
      expect(rows[0].style.height).toBe('36px');
      expect(rows[1].style.height).toBe('60px');
    });
  });

  describe('themes & density', () => {
    it('defaults to the light theme and normal density (no data attributes forced beyond the input defaults)', async () => {
      await setInputs(rowData, columnDefs);
      const root = (fixture.nativeElement as HTMLElement).querySelector('.gd-root')!;
      expect(root.getAttribute('data-gd-theme')).toBe('light');
      expect(root.getAttribute('data-gd-density')).toBe('normal');
    });

    it('reflects the theme and density inputs as data attributes', async () => {
      fixture.componentRef.setInput('theme', 'dark');
      fixture.componentRef.setInput('density', 'compact');
      await setInputs(rowData, columnDefs);
      const root = (fixture.nativeElement as HTMLElement).querySelector('.gd-root')!;
      expect(root.getAttribute('data-gd-theme')).toBe('dark');
      expect(root.getAttribute('data-gd-density')).toBe('compact');
    });
  });
});
