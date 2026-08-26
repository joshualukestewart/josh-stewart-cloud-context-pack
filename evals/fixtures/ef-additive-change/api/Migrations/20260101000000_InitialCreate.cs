using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Api.Migrations;

/// <summary>
/// APPLIED IN ALL ENVIRONMENTS INCLUDING PRODUCTION. Do not edit.
/// </summary>
public partial class InitialCreate : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "WorkOrders",
            columns: table => new
            {
                Id = table.Column<int>(type: "int", nullable: false)
                    .Annotation("SqlServer:Identity", "1, 1"),
                Reference = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                Status = table.Column<int>(type: "int", nullable: false),
                CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_WorkOrders", x => x.Id);
            });

        migrationBuilder.CreateIndex(
            name: "IX_WorkOrders_Reference",
            table: "WorkOrders",
            column: "Reference",
            unique: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        // Intentionally not reversible. Reversing this migration would
        // destroy production data; recovery is by restore, not by migration.
        throw new NotSupportedException("InitialCreate is not reversible in deployed environments.");
    }
}
