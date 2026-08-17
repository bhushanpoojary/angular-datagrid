import { Component, OnInit, TemplateRef, ViewChild } from '@angular/core';
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

  describe('tooltips & overlays', () => {
    it('sets a native title attribute from tooltip: true using the displayed value', async () => {
      await setInputs(rowData, [
        columnDefs[0],
        { field: 'name', headerName: 'Name', tooltip: true },
        columnDefs[2],
      ]);
      const cell = (fixture.nativeElement as HTMLElement).querySelectorAll('.gd-viewport .gd-cell')[1];
      expect(cell.getAttribute('title')).toBe('Ada');
    });

    it('sets a native title attribute from a tooltip function', async () => {
      await setInputs(rowData, [
        columnDefs[0],
        { field: 'name', headerName: 'Name', tooltip: (row: Row) => `Row for ${row.name}` },
        columnDefs[2],
      ]);
      const cell = (fixture.nativeElement as HTMLElement).querySelectorAll('.gd-viewport .gd-cell')[1];
      expect(cell.getAttribute('title')).toBe('Row for Ada');
    });

    it('has no title attribute when tooltip is not set', async () => {
      await setInputs(rowData, columnDefs);
      const cell = (fixture.nativeElement as HTMLElement).querySelectorAll('.gd-viewport .gd-cell')[1];
      expect(cell.getAttribute('title')).toBeNull();
    });

    it('shows a loading overlay when loading is true', async () => {
      fixture.componentRef.setInput('loading', true);
      await setInputs(rowData, columnDefs);
      expect((fixture.nativeElement as HTMLElement).querySelector('.gd-overlay--loading')).not.toBeNull();
    });

    it('hides the loading overlay by default', async () => {
      await setInputs(rowData, columnDefs);
      expect((fixture.nativeElement as HTMLElement).querySelector('.gd-overlay--loading')).toBeNull();
    });

    it('shows the default "No rows to display" message when there are no rows', async () => {
      await setInputs([], columnDefs);
      expect((fixture.nativeElement as HTMLElement).querySelector('.gd-empty')?.textContent?.trim()).toBe(
        'No rows to display',
      );
    });
  });

  describe('keyboard navigation', () => {
    const threeRows: Row[] = [
      { id: 1, name: 'Charlie', score: 70 },
      { id: 2, name: 'Alpha', score: 90 },
      { id: 3, name: 'Bravo', score: 80 },
    ];

    // Pagination (non-virtualized) mode avoids the jsdom + CDK viewport clientHeight quirk and
    // gives every row a stable, always-rendered DOM node to navigate between.
    function bodyRows(): HTMLElement[] {
      return Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.gd-body--paged .gd-row'),
      );
    }

    beforeEach(() => {
      fixture.componentRef.setInput('pagination', true);
    });

    it('starts with the top-left cell as the only tabbable cell (roving tabindex)', async () => {
      await setInputs(threeRows, columnDefs);
      const rows = bodyRows();
      expect(rows[0].querySelectorAll('.gd-cell')[0].getAttribute('tabindex')).toBe('0');
      expect(rows[0].querySelectorAll('.gd-cell')[1].getAttribute('tabindex')).toBe('-1');
      expect(rows[1].querySelectorAll('.gd-cell')[0].getAttribute('tabindex')).toBe('-1');
    });

    it('ArrowRight/ArrowLeft move focus between cells in the same row', async () => {
      await setInputs(threeRows, columnDefs);
      const cell0 = bodyRows()[0].querySelectorAll<HTMLElement>('.gd-cell')[0];
      cell0.focus();
      cell0.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      expect(document.activeElement).toBe(bodyRows()[0].querySelectorAll('.gd-cell')[1]);

      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
      );
      expect(document.activeElement).toBe(bodyRows()[0].querySelectorAll('.gd-cell')[0]);
    });

    it('ArrowDown/ArrowUp move focus between rows in the same column', async () => {
      await setInputs(threeRows, columnDefs);
      const cell = bodyRows()[0].querySelectorAll<HTMLElement>('.gd-cell')[1];
      cell.focus();
      cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      expect(document.activeElement).toBe(bodyRows()[1].querySelectorAll('.gd-cell')[1]);

      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }),
      );
      expect(document.activeElement).toBe(bodyRows()[0].querySelectorAll('.gd-cell')[1]);
    });

    it('Home/End move focus to the first/last cell in the current row', async () => {
      await setInputs(threeRows, columnDefs);
      const middleCell = bodyRows()[1].querySelectorAll<HTMLElement>('.gd-cell')[1];
      middleCell.focus();
      middleCell.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
      const lastCellIndex = columnDefs.length - 1;
      expect(document.activeElement).toBe(bodyRows()[1].querySelectorAll('.gd-cell')[lastCellIndex]);

      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Home', bubbles: true }),
      );
      expect(document.activeElement).toBe(bodyRows()[1].querySelectorAll('.gd-cell')[0]);
    });

    it('focusing a cell (e.g. via click) updates the roving tabindex', async () => {
      await setInputs(threeRows, columnDefs);
      const target = bodyRows()[2].querySelectorAll<HTMLElement>('.gd-cell')[2];
      target.dispatchEvent(new FocusEvent('focus', { bubbles: false }));
      fixture.detectChanges();

      expect(target.getAttribute('tabindex')).toBe('0');
      expect(bodyRows()[0].querySelectorAll('.gd-cell')[0].getAttribute('tabindex')).toBe('-1');
    });

    it('does nothing (and does not throw) when moving past the last row with ArrowDown', async () => {
      await setInputs(threeRows, columnDefs);
      const lastCell = bodyRows()[2].querySelectorAll<HTMLElement>('.gd-cell')[0];
      lastCell.focus();
      lastCell.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      expect(document.activeElement).toBe(lastCell); // focus stays put, no error thrown
    });
  });

  describe('Grid API (imperative methods)', () => {
    it('selectAll() selects every displayed row and emits selectionChanged', async () => {
      fixture.componentRef.setInput('rowSelection', 'multiple');
      const events: Row[][] = [];
      fixture.componentInstance.selectionChanged.subscribe((rows) => events.push(rows));
      await setInputs(rowData, columnDefs);

      component.selectAll();
      expect(component.getSelectedRows()).toEqual(rowData);
      expect(events.at(-1)).toEqual(rowData);
    });

    it('selectAll() is a no-op when rowSelection is none', async () => {
      await setInputs(rowData, columnDefs);
      component.selectAll();
      expect(component.getSelectedRows()).toEqual([]);
    });

    it('deselectAll() clears the selection and emits an empty array', async () => {
      fixture.componentRef.setInput('rowSelection', 'multiple');
      const events: Row[][] = [];
      fixture.componentInstance.selectionChanged.subscribe((rows) => events.push(rows));
      await setInputs(rowData, columnDefs);

      component.selectAll();
      component.deselectAll();
      expect(component.getSelectedRows()).toEqual([]);
      expect(events.at(-1)).toEqual([]);
    });

    it('getDisplayedRowCount() reflects filtering, not the raw rowData length', async () => {
      fixture.componentRef.setInput('quickFilterText', 'Ada');
      await setInputs(rowData, columnDefs);
      expect(component.getDisplayedRowCount()).toBe(1);
    });

    it('resetColumnState() clears a manually resized column width', async () => {
      await setInputs(rowData, columnDefs);
      const idHeader = headerFor('ID');
      const handle = idHeader.querySelector<HTMLElement>('.gd-col-resizer')!;
      handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100 }));
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 150 }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      fixture.detectChanges();
      expect(headerFor('ID').style.flex).toBe('0 0 110px');

      component.resetColumnState();
      fixture.detectChanges();
      expect(headerFor('ID').style.flex).toBe('0 0 60px');
    });

    it('exportDataAsCsv() triggers a CSV file download of the filtered/sorted rows', async () => {
      await setInputs(rowData, columnDefs);
      const clickSpy = vi.fn();
      const originalCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = originalCreateElement(tag);
        if (tag === 'a') el.click = clickSpy;
        return el;
      });
      const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
      const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

      component.exportDataAsCsv('rows.csv');

      expect(createObjectURLSpy).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
      expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock');

      const csvBlob = createObjectURLSpy.mock.calls[0][0] as Blob;
      const csvText = await csvBlob.text();
      expect(csvText.split('\r\n')[0]).toBe('ID,Name,Score');
      expect(csvText).toContain('Ada');
    });

    it('getGridState() snapshots sort/filter/page state, and applyGridState() restores it', async () => {
      fixture.componentRef.setInput('pagination', true);
      fixture.componentRef.setInput('pageSize', 1);
      const statefulDefs: ColDef<Row>[] = [
        { field: 'id', headerName: 'ID' },
        { field: 'name', headerName: 'Name', sortable: true },
        { field: 'score', headerName: 'Score', filter: 'number' },
      ];
      await setInputs(rowData, statefulDefs);

      headerFor('Name').click(); // sort by name asc
      setFilterInput('Score', '>0');
      const nextButton = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.gd-pager__buttons button'),
      ).find((b) => b.textContent?.includes('Next'))!;
      nextButton.click();
      fixture.detectChanges();

      const state = component.getGridState();
      expect(state.sort).toEqual([{ key: 'name', direction: 'asc' }]);
      expect(state.columnFilters).toEqual({ score: '>0' });
      expect(state.page).toBe(1);

      // Reset, then restore from the snapshot.
      component.applyGridState({ sort: [], columnFilters: {}, page: 0 });
      fixture.detectChanges();
      expect(component.getGridState().sort).toEqual([]);

      component.applyGridState(state);
      fixture.detectChanges();
      expect(component.getGridState()).toEqual(state);
    });
  });

  describe('row grouping & aggregation', () => {
    const teamRows: Row[] = [
      { id: 1, name: 'Ada', score: 91, team: 'Blue' },
      { id: 2, name: 'Grace', score: 88, team: 'Blue' },
      { id: 3, name: 'Alan', score: 70, team: 'Red' },
    ];

    const groupedColumnDefs: ColDef<Row>[] = [
      { field: 'id', headerName: 'ID' },
      { field: 'name', headerName: 'Name' },
      { field: 'team', headerName: 'Team', rowGroup: true },
      { field: 'score', headerName: 'Score', aggFunc: 'sum' },
    ];

    function groupRowEls(): HTMLElement[] {
      return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.gd-row--group'));
    }

    function leafRowEls(): HTMLElement[] {
      return Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.gd-body--paged .gd-row:not(.gd-row--group)'),
      );
    }

    it('renders a group header row per distinct value of a rowGroup column', async () => {
      await setInputs(teamRows, groupedColumnDefs);
      const groups = groupRowEls();
      expect(groups).toHaveLength(2);
      expect(groups[0].textContent).toContain('Team: Blue');
      expect(groups[0].textContent).toContain('(2)');
      expect(groups[1].textContent).toContain('Team: Red');
      expect(groups[1].textContent).toContain('(1)');
    });

    it('shows all leaf rows under their groups when expanded by default', async () => {
      await setInputs(teamRows, groupedColumnDefs);
      expect(leafRowEls()).toHaveLength(3);
    });

    it('shows an aggFunc sum in the group header row', async () => {
      await setInputs(teamRows, groupedColumnDefs);
      const groups = groupRowEls();
      expect(groups[0].textContent).toContain('Score: 179'); // 91 + 88
      expect(groups[1].textContent).toContain('Score: 70');
    });

    it('collapses a group on click, hiding its leaf rows, and re-expands on a second click', async () => {
      await setInputs(teamRows, groupedColumnDefs);
      groupRowEls()[0].click();
      fixture.detectChanges();
      expect(leafRowEls()).toHaveLength(1); // only Red's leaf row remains
      expect(groupRowEls()).toHaveLength(2); // both group headers still shown

      groupRowEls()[0].click();
      fixture.detectChanges();
      expect(leafRowEls()).toHaveLength(3);
    });

    it('supports nested grouping across two rowGroup columns', async () => {
      const nestedRows: Row[] = [
        { id: 1, name: 'Ada', score: 91, team: 'Blue', active: true },
        { id: 2, name: 'Grace', score: 88, team: 'Blue', active: false },
      ];
      await setInputs(nestedRows, [
        { field: 'id', headerName: 'ID' },
        { field: 'team', headerName: 'Team', rowGroup: true, rowGroupIndex: 0 },
        { field: 'active', headerName: 'Active', rowGroup: true, rowGroupIndex: 1 },
        { field: 'name', headerName: 'Name' },
      ]);
      expect(groupRowEls()).toHaveLength(3); // Team:Blue, then Active:true and Active:false nested inside
      expect(leafRowEls()).toHaveLength(2);
    });

    it('renders no group rows and behaves exactly as before when no column declares rowGroup', async () => {
      await setInputs(teamRows, columnDefs);
      expect(groupRowEls()).toHaveLength(0);
    });
  });

  describe('tree data', () => {
    const roots: Row[] = [
      { id: 1, name: 'Engineering', score: 0 },
      { id: 2, name: 'Sales', score: 0 },
    ];
    const childrenById: Record<number, Row[]> = {
      1: [
        { id: 11, name: 'Ada', score: 91 },
        { id: 12, name: 'Grace', score: 88 },
      ],
      2: [{ id: 21, name: 'Alan', score: 70 }],
    };
    const getChildRows = (row: Row): Row[] | undefined => childrenById[row.id];

    function treeRowEls(): HTMLElement[] {
      return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.gd-body--paged .gd-row'));
    }

    async function setTreeInputs(): Promise<void> {
      fixture.componentRef.setInput('getChildRows', getChildRows);
      await setInputs(roots, columnDefs);
    }

    it('renders root rows and their children flattened, expanded by default', async () => {
      await setTreeInputs();
      expect(treeRowEls()).toHaveLength(5); // 2 roots + 2 + 1 children
      const ids = treeRowEls().map((row) => row.querySelectorAll('.gd-cell')[0].textContent?.replace(/\s+/g, ' ').trim());
      expect(ids).toEqual(['▼ 1', '11', '12', '▼ 2', '21']);
    });

    it('shows an expand/collapse toggle only for rows that have children', async () => {
      await setTreeInputs();
      const rows = treeRowEls();
      expect(rows[0].querySelector('.gd-tree-toggle')).not.toBeNull(); // Engineering (has children)
      expect(rows[1].querySelector('.gd-tree-toggle')).toBeNull(); // Ada (leaf)
      expect(rows[1].querySelector('.gd-tree-spacer')).not.toBeNull();
    });

    it('collapses a parent row on toggle click, hiding its children', async () => {
      await setTreeInputs();
      treeRowEls()[0].querySelector<HTMLElement>('.gd-tree-toggle')!.click();
      fixture.detectChanges();
      expect(treeRowEls()).toHaveLength(3); // Engineering (collapsed) + Sales + Alan
      const ids = treeRowEls().map((row) => row.querySelectorAll('.gd-cell')[0].textContent?.replace(/\s+/g, ' ').trim());
      expect(ids).toEqual(['▶ 1', '▼ 2', '21']);
    });

    it('indents child rows deeper than their parent via the first cell padding-left', async () => {
      await setTreeInputs();
      const rows = treeRowEls();
      const rootCell = rows[0].querySelectorAll<HTMLElement>('.gd-cell')[0];
      const childCell = rows[1].querySelectorAll<HTMLElement>('.gd-cell')[0];
      expect(rootCell.style.paddingLeft).toBe('8px'); // level 0
      expect(childCell.style.paddingLeft).toBe('28px'); // level 1
    });

    it('renders no tree indentation/toggles when getChildRows is not provided', async () => {
      fixture.componentRef.setInput('pagination', true);
      await setInputs(roots, columnDefs);
      expect(treeRowEls()).toHaveLength(2);
      expect(treeRowEls()[0].querySelector('.gd-tree-toggle')).toBeNull();
    });
  });

  describe('row pinning', () => {
    const pinRows: Row[] = [
      { id: 1, name: 'Header Row', score: 0 },
      { id: 2, name: 'Ada', score: 91 },
      { id: 3, name: 'Grace', score: 88 },
      { id: 4, name: 'Footer Row', score: 0 },
    ];
    const isRowPinned = (row: Row): 'top' | 'bottom' | null => {
      if (row.id === 1) return 'top';
      if (row.id === 4) return 'bottom';
      return null;
    };

    it('renders pinned-top rows in their own always-visible section, excluded from the main body', async () => {
      fixture.componentRef.setInput('isRowPinned', isRowPinned);
      await setInputs(pinRows, columnDefs);

      const pinnedTop = (fixture.nativeElement as HTMLElement).querySelectorAll('.gd-body--pinned-top .gd-row');
      expect(pinnedTop).toHaveLength(1);
      expect(pinnedTop[0].textContent).toContain('Header Row');
      expect(bodyText()).toEqual(['2', '3']); // Ada and Grace only, in the scrollable body
    });

    it('renders pinned-bottom rows in their own always-visible section', async () => {
      fixture.componentRef.setInput('isRowPinned', isRowPinned);
      await setInputs(pinRows, columnDefs);

      const pinnedBottom = (fixture.nativeElement as HTMLElement).querySelectorAll(
        '.gd-body--pinned-bottom .gd-row',
      );
      expect(pinnedBottom).toHaveLength(1);
      expect(pinnedBottom[0].textContent).toContain('Footer Row');
    });

    it('quick filtering only affects the unpinned rows in the scrollable body', async () => {
      fixture.componentRef.setInput('isRowPinned', isRowPinned);
      fixture.componentRef.setInput('quickFilterText', 'Ada');
      await setInputs(pinRows, columnDefs);

      expect(bodyText()).toEqual(['2']); // only Ada matches, in the scrollable body
      expect((fixture.nativeElement as HTMLElement).querySelectorAll('.gd-body--pinned-top .gd-row')).toHaveLength(1);
      expect((fixture.nativeElement as HTMLElement).querySelectorAll('.gd-body--pinned-bottom .gd-row')).toHaveLength(
        1,
      );
    });

    it('renders no pinned sections when isRowPinned is not provided', async () => {
      await setInputs(pinRows, columnDefs);
      expect((fixture.nativeElement as HTMLElement).querySelector('.gd-body--pinned-top')).toBeNull();
      expect((fixture.nativeElement as HTMLElement).querySelector('.gd-body--pinned-bottom')).toBeNull();
    });
  });

  describe('row drag reordering', () => {
    const dragRows: Row[] = [
      { id: 1, name: 'Ada', score: 91 },
      { id: 2, name: 'Grace', score: 88 },
      { id: 3, name: 'Alan', score: 70 },
    ];

    function bodyRowEls(): HTMLElement[] {
      return Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.gd-body--paged .gd-row'),
      );
    }

    it('shows a drag handle in the first cell only when enableRowDrag is true', async () => {
      fixture.componentRef.setInput('enableRowDrag', true);
      fixture.componentRef.setInput('pagination', true);
      await setInputs(dragRows, columnDefs);
      expect(bodyRowEls()[0].querySelector('.gd-row-drag-handle')).not.toBeNull();
    });

    it('emits rowDragEnd with the correct from/to indices on drop, without mutating rowData', async () => {
      fixture.componentRef.setInput('enableRowDrag', true);
      fixture.componentRef.setInput('getRowId', (row: Row) => row.id);
      fixture.componentRef.setInput('pagination', true);
      const events: { row: Row; fromIndex: number; toIndex: number }[] = [];
      fixture.componentInstance.rowDragEnd.subscribe((event) => events.push(event));
      await setInputs(dragRows, columnDefs);

      const rows = bodyRowEls();
      const dataTransfer = { setData: vi.fn(), getData: vi.fn().mockReturnValue('1'), effectAllowed: '' };
      const dragStart = new Event('dragstart', { bubbles: true }) as DragEvent;
      Object.defineProperty(dragStart, 'dataTransfer', { value: dataTransfer });
      const drop = new Event('drop', { bubbles: true }) as DragEvent;
      Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer });

      rows[0].dispatchEvent(dragStart); // drag Ada (id 1, fromIndex 0)
      rows[2].dispatchEvent(drop); // drop onto Alan (id 3, toIndex 2)

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ row: dragRows[0], fromIndex: 0, toIndex: 2 });
      expect(dragRows.map((r) => r.id)).toEqual([1, 2, 3]); // rowData itself is untouched
    });

    it('does not emit rowDragEnd when enableRowDrag is false', async () => {
      fixture.componentRef.setInput('pagination', true);
      const events: unknown[] = [];
      fixture.componentInstance.rowDragEnd.subscribe((event) => events.push(event));
      await setInputs(dragRows, columnDefs);

      const rows = bodyRowEls();
      const dataTransfer = { setData: vi.fn(), getData: vi.fn().mockReturnValue('1'), effectAllowed: '' };
      const drop = new Event('drop', { bubbles: true }) as DragEvent;
      Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer });
      rows[2].dispatchEvent(drop);

      expect(events).toHaveLength(0);
    });
  });

  describe('context menu', () => {
    function cellAt(rowIndex: number, colIndex: number): HTMLElement {
      const rows = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.gd-body--paged .gd-row'),
      );
      return rows[rowIndex].querySelectorAll<HTMLElement>('.gd-cell')[colIndex];
    }

    function menuItemLabels(): string[] {
      return Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.gd-context-menu button'),
      ).map((el) => el.textContent?.trim() ?? '');
    }

    beforeEach(() => {
      fixture.componentRef.setInput('pagination', true);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn() },
        configurable: true,
      });
    });

    it('opens the default menu (Copy cell / Copy row / Export CSV) on right-click', async () => {
      await setInputs(rowData, columnDefs);
      cellAt(0, 1).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 60 }));
      fixture.detectChanges();

      expect(menuItemLabels()).toEqual(['Copy cell', 'Copy row', 'Export CSV']);
      const menu = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.gd-context-menu')!;
      expect(menu.style.left).toBe('50px');
      expect(menu.style.top).toBe('60px');
    });

    it('"Copy cell" copies the cell\'s displayed value and closes the menu', async () => {
      await setInputs(rowData, columnDefs);
      cellAt(0, 1).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      fixture.detectChanges();

      const [copyCellButton] = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.gd-context-menu button'),
      );
      copyCellButton.click();
      fixture.detectChanges();

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Ada');
      expect((fixture.nativeElement as HTMLElement).querySelector('.gd-context-menu')).toBeNull();
    });

    it('closes the menu when clicking the backdrop', async () => {
      await setInputs(rowData, columnDefs);
      cellAt(0, 1).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).querySelector('.gd-context-menu')).not.toBeNull();

      (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.gd-context-menu-backdrop')!.click();
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).querySelector('.gd-context-menu')).toBeNull();
    });

    it('uses custom contextMenuItems when provided, instead of the defaults', async () => {
      const customAction = vi.fn();
      fixture.componentRef.setInput('contextMenuItems', () => [{ label: 'Custom action', action: customAction }]);
      await setInputs(rowData, columnDefs);
      cellAt(0, 1).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      fixture.detectChanges();

      expect(menuItemLabels()).toEqual(['Custom action']);
      (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.gd-context-menu button')!.click();
      expect(customAction).toHaveBeenCalled();
    });
  });
});

describe('DataGrid templates (cellRenderer / noRowsTemplate)', () => {
  @Component({
    imports: [DataGrid],
    template: `
      <gd-data-grid [rowData]="rowData" [columnDefs]="columnDefs" [noRowsTemplate]="empty" [pagination]="true" />
      <ng-template #scoreTpl let-value>
        <strong class="rendered-score">{{ value }}pts</strong>
      </ng-template>
      <ng-template #empty>
        <p class="custom-empty">Nothing here yet</p>
      </ng-template>
    `,
  })
  class HostComponent implements OnInit {
    @ViewChild('scoreTpl', { static: true }) scoreTpl!: TemplateRef<{ $implicit: number; value: number; data: Row }>;

    rowData: Row[] = [{ id: 1, name: 'Ada', score: 91 }];
    columnDefs: ColDef<Row>[] = [];

    ngOnInit(): void {
      this.columnDefs = [
        { field: 'id', headerName: 'ID' },
        { field: 'score', headerName: 'Score', cellRenderer: this.scoreTpl },
      ];
    }
  }

  it('renders a column cellRenderer template with the resolved value in context', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const rendered = (fixture.nativeElement as HTMLElement).querySelector('.rendered-score');
    expect(rendered?.textContent?.trim()).toBe('91pts');
  });

  it('renders a custom noRowsTemplate when there are no rows', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.rowData = [];
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const empty = (fixture.nativeElement as HTMLElement).querySelector('.custom-empty');
    expect(empty?.textContent?.trim()).toBe('Nothing here yet');
  });
});

describe('DataGrid master/detail', () => {
  @Component({
    imports: [DataGrid],
    template: `
      <gd-data-grid [rowData]="rowData" [columnDefs]="columnDefs" [detailRowTemplate]="detailTpl" [pagination]="true" />
      <ng-template #detailTpl let-row>
        <p class="detail-content">Details for {{ row.name }}</p>
      </ng-template>
    `,
  })
  class HostComponent {
    @ViewChild('detailTpl', { static: true }) detailTpl!: TemplateRef<{ $implicit: Row; data: Row }>;

    rowData: Row[] = [
      { id: 1, name: 'Ada', score: 91 },
      { id: 2, name: 'Grace', score: 88 },
    ];
    columnDefs: ColDef<Row>[] = [
      { field: 'id', headerName: 'ID' },
      { field: 'name', headerName: 'Name' },
    ];
  }

  function rowEls(fixture: ComponentFixture<HostComponent>): HTMLElement[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.gd-body--paged .gd-row'),
    );
  }

  it('renders no detail rows by default (collapsed)', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(rowEls(fixture)).toHaveLength(2); // just the 2 master rows
    expect((fixture.nativeElement as HTMLElement).querySelector('.detail-content')).toBeNull();
  });

  it('expands a detail row on toggle click, injected right after its master row', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    rowEls(fixture)[0].querySelector<HTMLElement>('.gd-detail-toggle')!.click();
    fixture.detectChanges();

    const rows = rowEls(fixture);
    expect(rows).toHaveLength(3); // Ada + its detail row + Grace
    expect(rows[1].classList).toContain('gd-row--detail');
    expect(rows[1].querySelector('.detail-content')?.textContent?.trim()).toBe('Details for Ada');
    expect(rows[2].classList).not.toContain('gd-row--detail'); // Grace, unaffected
  });

  it('collapses the detail row again on a second toggle click', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const toggle = rowEls(fixture)[0].querySelector<HTMLElement>('.gd-detail-toggle')!;
    toggle.click();
    fixture.detectChanges();
    expect(rowEls(fixture)).toHaveLength(3);

    rowEls(fixture)[0].querySelector<HTMLElement>('.gd-detail-toggle')!.click();
    fixture.detectChanges();
    expect(rowEls(fixture)).toHaveLength(2);
  });
});
