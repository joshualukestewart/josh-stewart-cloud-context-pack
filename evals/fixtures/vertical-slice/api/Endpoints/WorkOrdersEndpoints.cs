using Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Api.Endpoints;

public static class WorkOrdersEndpoints
{
    public static IEndpointRouteBuilder MapWorkOrders(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/workorders");

        group.MapGet("/", async (AppDbContext db, CancellationToken cancellationToken) =>
            await db.WorkOrders
                .OrderByDescending(workOrder => workOrder.CreatedAt)
                .Select(workOrder => new
                {
                    id = workOrder.Id,
                    reference = workOrder.Reference,
                    status = workOrder.Status.ToString(),
                    createdAt = workOrder.CreatedAt
                })
                .ToListAsync(cancellationToken));

        return app;
    }
}
