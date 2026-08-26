namespace Api.Services;

public sealed class DiscountCalculator
{
    public const decimal MaxDiscountRate = 0.30m;

    private const decimal RatePerLoyaltyYear = 0.05m;

    /// <summary>
    /// Returns the discount amount (not the rate) for a subtotal.
    /// </summary>
    public decimal Calculate(decimal subtotal, int loyaltyYears)
    {
        if (subtotal < 0m)
        {
            throw new ArgumentOutOfRangeException(nameof(subtotal), "Subtotal cannot be negative.");
        }

        if (loyaltyYears <= 0)
        {
            return 0m;
        }

        var rate = Math.Min(loyaltyYears * RatePerLoyaltyYear, MaxDiscountRate);
        return decimal.Round(subtotal * rate, 2, MidpointRounding.AwayFromZero);
    }
}
