using Microsoft.EntityFrameworkCore;

namespace Api.Data;

public sealed class WorkOrderLine
{
    public int Id { get; set; }

    public int WorkOrderId { get; set; }

    public required string Sku { get; set; }

    public int Quantity { get; set; }
}

public sealed class WorkOrder
{
    public int Id { get; set; }

    public required string Reference { get; set; }

    public int Status { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset? DueAt { get; set; }

    public List<WorkOrderLine> Lines { get; set; } = [];
}

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<WorkOrder> WorkOrders => Set<WorkOrder>();

    public DbSet<WorkOrderLine> WorkOrderLines => Set<WorkOrderLine>();
}
