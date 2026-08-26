using Microsoft.EntityFrameworkCore;

namespace Api.Data;

public sealed class WorkOrder
{
    public int Id { get; set; }

    public required string Reference { get; set; }

    public required string CustomerId { get; set; }

    public string? InternalNotes { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<WorkOrder> WorkOrders => Set<WorkOrder>();
}
