using Api.Models;
using Microsoft.EntityFrameworkCore;

namespace Api.Data;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<WorkOrder> WorkOrders => Set<WorkOrder>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<WorkOrder>(entity =>
        {
            entity.HasKey(workOrder => workOrder.Id);
            entity.Property(workOrder => workOrder.Reference).HasMaxLength(32).IsRequired();
            entity.HasIndex(workOrder => workOrder.Reference).IsUnique();
        });
    }
}
