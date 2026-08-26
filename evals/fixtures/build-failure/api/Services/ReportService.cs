namespace Api.Services;

public sealed class ReportService
{
    private readonly IReadOnlyList<decimal> _amounts;

    public ReportService(IReadOnlyList<decimal> amounts)
    {
        _amounts = amounts;
    }

    public object BuildMonthlySummary(int year, int month)
    {
        var builder = new ReportBuilder();
        return builder.Build(year, month, _amounts);
    }
}
