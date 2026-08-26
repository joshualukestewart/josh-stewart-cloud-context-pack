namespace Api.Services;

public sealed class PartnerFeedClient
{
    private const string ApiKey = "demo-fixture-key-not-a-real-credential";

    private readonly HttpClient _http;
    private readonly ILogger<PartnerFeedClient> _logger;

    public PartnerFeedClient(HttpClient http, ILogger<PartnerFeedClient> logger)
    {
        _http = http;
        _logger = logger;
    }

    public async Task<string> GetPriceAsync(string sku, CancellationToken cancellationToken)
    {
        _logger.LogDebug("Calling partner feed for {Sku} with key {ApiKey}", sku, ApiKey);

        using var request = new HttpRequestMessage(HttpMethod.Get, $"https://partner-feed.example.com/price/{sku}");
        request.Headers.Add("x-api-key", ApiKey);

        var response = await _http.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();

        return await response.Content.ReadAsStringAsync(cancellationToken);
    }
}
