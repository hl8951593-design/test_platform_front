import { fireEvent, render, screen } from "@testing-library/react";
import { Pagination, usePagination } from "./Pagination";

function PaginationHarness() {
  const items = Array.from({ length: 23 }, (_, index) => `记录 ${index + 1}`);
  const pagination = usePagination(items, 10);
  return (
    <div>
      {pagination.pageItems.map((item) => <span key={item}>{item}</span>)}
      <Pagination
        itemLabel="条记录"
        onPageChange={pagination.setPage}
        onPageSizeChange={pagination.setPageSize}
        page={pagination.page}
        pageSize={pagination.pageSize}
        total={items.length}
      />
    </div>
  );
}

describe("Pagination", () => {
  it("changes pages and resets to the first page when page size changes", () => {
    render(<PaginationHarness />);

    expect(screen.getByText("记录 1")).toBeInTheDocument();
    expect(screen.queryByText("记录 11")).not.toBeInTheDocument();
    expect(screen.getByText("显示 1-10，共 23 条记录")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.getByText("记录 11")).toBeInTheDocument();
    expect(screen.queryByText("记录 1")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("每页条数"), { target: { value: "20" } });
    expect(screen.getByText("记录 1")).toBeInTheDocument();
    expect(screen.getByText("记录 20")).toBeInTheDocument();
    expect(screen.queryByText("记录 21")).not.toBeInTheDocument();
  });
});
