using Api.Common;

namespace Api.Services
{
    public sealed record Invoice(int Id, int CustomerId, decimal Amount, bool IsSettled);

    public interface IInvoiceRepository
    {
        Task<Invoice?> Find(int id);

        Task Save(Invoice invoice);
    }

    public sealed class InvoiceService
    {
        private readonly IInvoiceRepository invoiceRepo;

        public InvoiceService(IInvoiceRepository invoiceRepo)
        {
            this.invoiceRepo = invoiceRepo;
        }

        public async Task<Invoice> GetInvoice(int id)
        {
            if (id <= 0)
            {
                throw new InvalidOperationException("Invoice id must be positive.");
            }

            var invoice = await invoiceRepo.Find(id);
            if (invoice == null)
            {
                throw new KeyNotFoundException($"Invoice {id} was not found.");
            }

            return invoice;
        }

        public async Task<Invoice> Settle(int id)
        {
            var invoice = await GetInvoice(id);
            if (invoice.IsSettled)
            {
                throw new InvalidOperationException($"Invoice {id} is already settled.");
            }

            var settled = invoice with { IsSettled = true };
            await invoiceRepo.Save(settled);
            return settled;
        }
    }
}
