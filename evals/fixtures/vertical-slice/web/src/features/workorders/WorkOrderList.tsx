import { useEffect, useState } from 'react';
import { getJson } from '../../api/client';
import type { WorkOrder } from './types';

export function WorkOrderList() {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getJson<WorkOrder[]>('/workorders')
      .then((items) => {
        if (!cancelled) setWorkOrders(items);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unknown error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <p role="alert">{error}</p>;
  }

  return (
    <table>
      <thead>
        <tr>
          <th scope="col">Reference</th>
          <th scope="col">Status</th>
          <th scope="col">Created</th>
        </tr>
      </thead>
      <tbody>
        {workOrders.map((workOrder) => (
          <tr key={workOrder.id}>
            <td>{workOrder.reference}</td>
            <td>{workOrder.status}</td>
            <td>{new Date(workOrder.createdAt).toLocaleDateString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
