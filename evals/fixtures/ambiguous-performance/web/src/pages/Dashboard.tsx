import { useEffect, useState } from 'react';

interface Panel {
  key: string;
  rows: unknown[];
}

const PANEL_PATHS = ['/api/dashboard/open', '/api/dashboard/overdue', '/api/dashboard/recent'];

export function Dashboard() {
  const [panels, setPanels] = useState<Panel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const loaded: Panel[] = [];
      for (const path of PANEL_PATHS) {
        const response = await fetch(path);
        const rows = (await response.json()) as unknown[];
        loaded.push({ key: path, rows });
      }
      if (!cancelled) {
        setPanels(loaded);
        setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <p>Loading…</p>;
  }

  return (
    <div className="dashboard">
      {panels.map((panel) => (
        <section key={panel.key}>
          <h2>{panel.key}</h2>
          <p>{panel.rows.length} rows</p>
        </section>
      ))}
    </div>
  );
}
