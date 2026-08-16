import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DataGrid } from './data-grid';

describe('DataGrid', () => {
  let component: DataGrid;
  let fixture: ComponentFixture<DataGrid>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DataGrid],
    }).compileComponents();

    fixture = TestBed.createComponent(DataGrid);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('defaults rowData and columnDefs to empty arrays', () => {
    expect(component.rowData()).toEqual([]);
    expect(component.columnDefs()).toEqual([]);
  });
});
