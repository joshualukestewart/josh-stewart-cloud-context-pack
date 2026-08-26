using Api.Endpoints;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddAuthentication();
builder.Services.AddAuthorization();

var app = builder.Build();

app.UseAuthentication();
app.UseAuthorization();

app.MapPublicSearch();

app.MapGroup("/api/internal")
   .RequireAuthorization()
   .MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.Run();
