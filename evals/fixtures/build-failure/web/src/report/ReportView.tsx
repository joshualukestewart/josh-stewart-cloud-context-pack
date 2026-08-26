import { useMemo } from 'react';
import { BarChart } from './charts/BarChart';

export function ReportView({ amounts }: { amounts: number[] }) {
  const series = useMemo(
    () => amounts.map((value, index) => ({ label: `M${index + 1}`, value })),
    [amounts],
  );

  return (
    <section aria-label="Monthly report">
      <BarChart series={series} />
    </section>
  );
}
