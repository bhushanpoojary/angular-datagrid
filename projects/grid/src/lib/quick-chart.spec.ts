import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { buildChartSeries, QuickChart } from './quick-chart';

describe('buildChartSeries', () => {
  it('maps rows into label/value points using the given fields', () => {
    const rows = [
      { name: 'Ada', score: 91 },
      { name: 'Grace', score: 88 },
    ];
    expect(buildChartSeries(rows, { labelField: 'name', valueField: 'score' })).toEqual([
      { label: 'Ada', value: 91 },
      { label: 'Grace', value: 88 },
    ]);
  });

  it('returns an empty array for empty input', () => {
    expect(buildChartSeries([], { labelField: 'name', valueField: 'score' })).toEqual([]);
  });
});

describe('QuickChart', () => {
  @Component({
    imports: [QuickChart],
    template: `<gd-quick-chart [data]="data" [width]="200" [height]="100" />`,
  })
  class HostComponent {
    data = [
      { label: 'A', value: 10 },
      { label: 'B', value: 20 },
    ];
  }

  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('renders one <rect> per data point', () => {
    const rects = (fixture.nativeElement as HTMLElement).querySelectorAll('rect');
    expect(rects).toHaveLength(2);
  });

  it('scales the tallest bar to fill the chart area (the point with the max value)', () => {
    const rects = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('rect'));
    const heights = rects.map((rect) => Number(rect.getAttribute('height')));
    expect(heights[1]).toBeGreaterThan(heights[0]); // B (20) taller than A (10)
    expect(heights[1]).toBeCloseTo(60, 0); // chartHeight = 100 - 20 - 20 = 60, at max value
  });

  it('renders the label and value text for each bar', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('A');
    expect(text).toContain('10');
    expect(text).toContain('B');
    expect(text).toContain('20');
  });

  it('renders no bars for empty data', async () => {
    const emptyFixture = TestBed.createComponent(HostComponent);
    emptyFixture.componentInstance.data = [];
    emptyFixture.detectChanges();
    expect((emptyFixture.nativeElement as HTMLElement).querySelectorAll('rect')).toHaveLength(0);
  });
});
