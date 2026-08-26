export interface BarChartPoint {
  label: string;
  value: number;
}

export function BarChart({ series }: { series: BarChartPoint[] }) {
  const max = series.reduce((highest, point) => Math.max(highest, point.value), 0);

  return (
    <ul>
      {series.map((point) => (
        <li key={point.label}>
          <span>{point.label}</span>
          <span style={{ width: `${max === 0 ? 0 : (point.value / max) * 100}%` }} />
        </li>
      ))}
    </ul>
  );
}
