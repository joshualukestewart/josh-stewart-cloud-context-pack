namespace Api.Services;

public enum CheckoutStep
{
    Cart = 0,
    Delivery = 1,
    Payment = 2
}

public sealed record Cart(
    string CartId,
    string CustomerEmail,
    string DeliveryNotes,
    decimal Value,
    int ItemCount);

public sealed class CheckoutService
{
    private readonly ILogger<CheckoutService> _logger;

    public CheckoutService(ILogger<CheckoutService> logger)
    {
        _logger = logger;
    }

    public Task StartAsync(Cart cart, CancellationToken cancellationToken)
    {
        return Task.CompletedTask;
    }

    public Task CompleteAsync(Cart cart, CancellationToken cancellationToken)
    {
        return Task.CompletedTask;
    }

    public Task AbandonAsync(Cart cart, CheckoutStep lastStep, CancellationToken cancellationToken)
    {
        return Task.CompletedTask;
    }
}
