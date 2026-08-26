namespace Api.Endpoints;

public static class PublicSearchEndpoints
{
    public static IEndpointRouteBuilder MapPublicSearch(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/public");

        group.MapGet("/search", (string term, int page = 1) =>
            Results.Ok(new
            {
                term,
                page,
                results = Array.Empty<string>()
            }));

        group.MapGet("/search/suggest", (string prefix) =>
            Results.Ok(new
            {
                prefix,
                suggestions = Array.Empty<string>()
            }));

        return app;
    }
}
