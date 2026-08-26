using Api.Common;

namespace Api.Services;

public sealed record Customer(int Id, string Name, bool IsActive);

public interface ICustomerRepository
{
    Task<Customer?> FindAsync(int id, CancellationToken cancellationToken);
}

public sealed class CustomerService
{
    private readonly ICustomerRepository _customerRepository;

    public CustomerService(ICustomerRepository customerRepository)
    {
        _customerRepository = customerRepository;
    }

    public async Task<Result<Customer>> GetCustomerAsync(int id, CancellationToken cancellationToken)
    {
        if (id <= 0)
        {
            return Result<Customer>.Fail("Customer id must be positive.");
        }

        var customer = await _customerRepository.FindAsync(id, cancellationToken);
        if (customer is null)
        {
            return Result<Customer>.Fail($"Customer {id} was not found.");
        }

        return Result<Customer>.Ok(customer);
    }
}
