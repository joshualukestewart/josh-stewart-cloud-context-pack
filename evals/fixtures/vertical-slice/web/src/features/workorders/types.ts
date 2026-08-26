export type WorkOrderStatus = 'Open' | 'InProgress' | 'Closed';

export interface WorkOrder {
  id: number;
  reference: string;
  status: WorkOrderStatus;
  createdAt: string;
}
