import { pivotData } from './pivot';

interface Sale {
  region: string;
  product: string;
  amount: number;
}

const sales: Sale[] = [
  { region: 'West', product: 'Widget', amount: 100 },
  { region: 'West', product: 'Widget', amount: 50 },
  { region: 'West', product: 'Gadget', amount: 30 },
  { region: 'East', product: 'Widget', amount: 20 },
];

describe('pivotData', () => {
  it('produces one row per distinct rowField value and one column per distinct columnField value', () => {
    const result = pivotData(sales, { rowField: 'region', columnField: 'product', valueField: 'amount' });
    expect(result.rowData.map((row) => row['region'])).toEqual(['East', 'West']); // sorted
    expect(result.columnDefs.map((col) => col.field)).toEqual(['region', 'Gadget', 'Widget']);
  });

  it('sums the value field at each row/column intersection by default', () => {
    const result = pivotData(sales, { rowField: 'region', columnField: 'product', valueField: 'amount' });
    const west = result.rowData.find((row) => row['region'] === 'West')!;
    expect(west['Widget']).toBe(150); // 100 + 50
    expect(west['Gadget']).toBe(30);
  });

  it('fills missing row/column intersections with null', () => {
    const result = pivotData(sales, { rowField: 'region', columnField: 'product', valueField: 'amount' });
    const east = result.rowData.find((row) => row['region'] === 'East')!;
    expect(east['Gadget']).toBeNull(); // East has no Gadget sales
  });

  it('supports avg/min/max/count aggFunc', () => {
    const west = (fn: 'avg' | 'min' | 'max' | 'count') =>
      pivotData(sales, { rowField: 'region', columnField: 'product', valueField: 'amount', aggFunc: fn }).rowData.find(
        (row) => row['region'] === 'West',
      )!['Widget'];

    expect(west('avg')).toBe(75); // (100 + 50) / 2
    expect(west('min')).toBe(50);
    expect(west('max')).toBe(100);
    expect(west('count')).toBe(2);
  });

  it('pins the row-label column left and uses rowHeaderName when provided', () => {
    const result = pivotData(sales, {
      rowField: 'region',
      columnField: 'product',
      valueField: 'amount',
      rowHeaderName: 'Region',
    });
    expect(result.columnDefs[0]).toMatchObject({ field: 'region', headerName: 'Region', pinned: 'left' });
  });

  it('returns empty rowData/columnDefs (just the row-label column) for an empty input', () => {
    const result = pivotData([], { rowField: 'region', columnField: 'product', valueField: 'amount' });
    expect(result.rowData).toEqual([]);
    expect(result.columnDefs).toEqual([{ field: 'region', headerName: 'region', pinned: 'left' }]);
  });
});
