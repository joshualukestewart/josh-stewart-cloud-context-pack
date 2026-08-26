-- Record of the production schema as at the last release.
-- This file is a record of what is deployed, not a working script.
-- Row count at capture time: approximately 41,900,000.

CREATE TABLE [dbo].[WorkOrders]
(
    [Id]         INT                IDENTITY (1, 1) NOT NULL,
    [Reference]  NVARCHAR (32)      NOT NULL,
    [Status]     INT                NOT NULL,
    [CreatedAt]  DATETIMEOFFSET (7) NOT NULL,
    CONSTRAINT [PK_WorkOrders] PRIMARY KEY CLUSTERED ([Id] ASC)
);

CREATE UNIQUE NONCLUSTERED INDEX [IX_WorkOrders_Reference]
    ON [dbo].[WorkOrders] ([Reference] ASC);
