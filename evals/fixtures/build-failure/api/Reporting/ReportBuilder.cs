namespace Api.Reporting;

public sealed record MonthlySummary(int Year, int Month, decimal Total);

public sealed class ReportBuilder
{
    public MonthlySummary Build(int year, int month, IReadOnlyList<decimal> amounts)
    {
        decimal total = 0m;
        foreach (var amount in amounts)
        {
            total += amount;
        }

        return new MonthlySummary(year, month, total);
    }
}
