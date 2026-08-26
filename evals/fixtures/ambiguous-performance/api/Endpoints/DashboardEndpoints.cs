using Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Api.Endpoints;

public static class DashboardEndpoints
{
    public static IEndpointRouteBuilder MapDashboard(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/dashboard");

        group.MapGet("/open", async (AppDbContext db, CancellationToken cancellationToken) =>
        {
            var all = await db.WorkOrders.ToListAsync(cancellationToken);
            return all.Where(workOrder => workOrder.Status == 0).ToList();
        });

        group.MapGet("/overdue", async (AppDbContext db, CancellationToken cancellationToken) =>
        {
            var all = await db.WorkOrders.Include(workOrder => workOrder.Lines).ToListAsync(cancellationToken);
            return all
                .Where(workOrder => workOrder.DueAt < DateTimeOffset.UtcNow && workOrder.Status != 2)
                .ToList();
        });

        group.MapGet("/recent", async (AppDbContext db, CancellationToken cancellationToken) =>
        {
            var all = await db.WorkOrders.ToListAsync(cancellationToken);
            return all.OrderByDescending(workOrder => workOrder.CreatedAt).Take(20).ToList();
        });

        return app;
    }
}
