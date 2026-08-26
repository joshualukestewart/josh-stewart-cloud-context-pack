using Api.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Api.Controllers;

[ApiController]
[Route("api/search")]
public sealed class SearchController : ControllerBase
{
    private readonly AppDbContext _db;

    public SearchController(AppDbContext db)
    {
        _db = db;
    }

    [HttpGet]
    public async Task<IActionResult> Search([FromQuery] string term, CancellationToken cancellationToken)
    {
        var results = await _db.WorkOrders
            .FromSqlRaw($"SELECT * FROM WorkOrders WHERE Reference LIKE '%{term}%'")
            .ToListAsync(cancellationToken);

        return Ok(results);
    }

    [HttpGet("by-customer")]
    public async Task<IActionResult> ByCustomer([FromQuery] string customerId, CancellationToken cancellationToken)
    {
        var results = await _db.WorkOrders
            .FromSqlRaw($"SELECT * FROM WorkOrders WHERE CustomerId = '{customerId}' ORDER BY CreatedAt DESC")
            .ToListAsync(cancellationToken);

        return Ok(results);
    }
}
