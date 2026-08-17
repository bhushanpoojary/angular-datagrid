import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export interface ChartDatum {
  label: string;
  value: number;
}

interface ChartBar extends ChartDatum {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A minimal, dependency-free SVG bar chart - typically fed from `DataGrid.getSelectedRows()`
 * (via `buildChartSeries()`) to give a "quick chart from selection" without pulling in a full
 * charting library. Intentionally scoped to bar charts only for v1 - the simplest, most broadly
 * useful chart type to render correctly with plain SVG geometry. */
@Component({
  selector: 'gd-quick-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.viewBox]="'0 0 ' + width() + ' ' + height()"
      [attr.width]="width()"
      [attr.height]="height()"
      class="gd-chart"
      role="img"
      [attr.aria-label]="ariaLabel()"
    >
      @for (bar of bars(); track bar.label) {
        <rect [attr.x]="bar.x" [attr.y]="bar.y" [attr.width]="bar.width" [attr.height]="bar.height" [attr.fill]="color()" />
        <text [attr.x]="bar.x + bar.width / 2" [attr.y]="height() - 6" text-anchor="middle" class="gd-chart-label">
          {{ bar.label }}
        </text>
        <text [attr.x]="bar.x + bar.width / 2" [attr.y]="bar.y - 4" text-anchor="middle" class="gd-chart-value">
          {{ bar.value }}
        </text>
      }
    </svg>
  `,
  styles: `
    .gd-chart {
      font-family: var(--gd-font-family, sans-serif);
      overflow: visible;
    }

    .gd-chart-label {
      font-size: 11px;
      fill: var(--gd-muted-color, #666);
    }

    .gd-chart-value {
      font-size: 11px;
      fill: var(--gd-text-color, #1a1a1a);
      font-weight: 600;
    }
  `,
})
export class QuickChart {
  readonly data = input<readonly ChartDatum[]>([]);
  readonly width = input<number>(400);
  readonly height = input<number>(200);
  readonly color = input<string>('#2563eb');
  readonly ariaLabel = input<string>('Bar chart');

  protected readonly bars = computed<ChartBar[]>(() => {
    const points = this.data();
    const w = this.width();
    const h = this.height();
    if (points.length === 0) return [];

    const topMargin = 20;
    const bottomMargin = 20;
    const chartHeight = h - topMargin - bottomMargin;
    const gap = 8;
    const barWidth = (w - gap * (points.length + 1)) / points.length;
    const maxValue = Math.max(...points.map((point) => point.value), 1);

    return points.map((point, index) => {
      const barHeight = (Math.max(point.value, 0) / maxValue) * chartHeight;
      return {
        ...point,
        x: gap + index * (barWidth + gap),
        y: topMargin + (chartHeight - barHeight),
        width: barWidth,
        height: barHeight,
      };
    });
  });
}

/** Maps rows (e.g. `DataGrid.getSelectedRows()`) into chart-ready `{label, value}` points. */
export function buildChartSeries<TData>(
  rows: readonly TData[],
  options: { labelField: keyof TData & string; valueField: keyof TData & string },
): ChartDatum[] {
  return rows.map((row) => ({
    label: String(row[options.labelField]),
    value: Number(row[options.valueField]),
  }));
}
