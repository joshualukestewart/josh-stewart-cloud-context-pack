using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;

namespace Api.Services;

public sealed class AttachmentStorageService
{
    private const string ContainerName = "workorder-attachments";

    private readonly BlobContainerClient _container;
    private readonly ILogger<AttachmentStorageService> _logger;

    public AttachmentStorageService(IConfiguration configuration, ILogger<AttachmentStorageService> logger)
    {
        var connectionString = configuration["Storage:ConnectionString"]
            ?? throw new InvalidOperationException("Storage:ConnectionString is not configured.");

        var serviceClient = new BlobServiceClient(connectionString);
        _container = serviceClient.GetBlobContainerClient(ContainerName);
        _logger = logger;
    }

    public async Task<Uri> UploadAsync(string blobName, Stream content, CancellationToken cancellationToken)
    {
        var blob = _container.GetBlobClient(blobName);
        await blob.UploadAsync(content, overwrite: true, cancellationToken);
        _logger.LogInformation("Uploaded attachment {BlobName}", blobName);
        return blob.Uri;
    }

    public async Task<Stream> DownloadAsync(string blobName, CancellationToken cancellationToken)
    {
        var blob = _container.GetBlobClient(blobName);
        BlobDownloadStreamingResult result = await blob.DownloadStreamingAsync(cancellationToken: cancellationToken);
        return result.Content;
    }
}
