namespace Api.Models;

public enum WorkOrderStatus
{
    Open = 0,
    InProgress = 1,
    Closed = 2
}

public sealed class WorkOrder
{
    public int Id { get; set; }

    public required string Reference { get; set; }

    public WorkOrderStatus Status { get; set; } = WorkOrderStatus.Open;

    public DateTimeOffset CreatedAt { get; set; }
}
