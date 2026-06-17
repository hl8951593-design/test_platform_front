import { useEffect, useMemo, useState } from "react";
import { Icon } from "./Icon";

interface PaginationProps {
  compact?: boolean;
  itemLabel?: string;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  page: number;
  pageSize: number;
  pageSizeOptions?: number[];
  total: number;
}

export function usePagination<T>(items: T[], initialPageSize = 10, resetKey = "") {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialPageSize);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));

  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const pageItems = useMemo(
    () => items.slice((page - 1) * pageSize, page * pageSize),
    [items, page, pageSize],
  );

  const setPageSize = (nextPageSize: number) => {
    setPageSizeState(nextPageSize);
    setPage(1);
  };

  return { page, pageItems, pageSize, setPage, setPageSize, totalPages };
}

function visiblePages(page: number, totalPages: number) {
  const candidates = new Set([1, totalPages, page - 1, page, page + 1]);
  return [...candidates].filter((item) => item >= 1 && item <= totalPages).sort((left, right) => left - right);
}

export function Pagination({
  compact = false,
  itemLabel = "条记录",
  onPageChange,
  onPageSizeChange,
  page,
  pageSize,
  pageSizeOptions = [10, 20, 50],
  total,
}: PaginationProps) {
  if (total === 0) return null;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, total);
  const pages = visiblePages(currentPage, totalPages);

  return (
    <nav aria-label="分页导航" className={compact ? "pagination pagination-compact" : "pagination"}>
      <span className="pagination-summary">
        {compact ? `${currentPage} / ${totalPages}` : `显示 ${start}-${end}，共 ${total} ${itemLabel}`}
      </span>
      {!compact && (
        <label className="pagination-size">
          <span>每页</span>
          <select
            aria-label="每页条数"
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            value={pageSize}
          >
            {pageSizeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <span>条</span>
        </label>
      )}
      <div className="pagination-pages">
        <button
          aria-label="上一页"
          disabled={currentPage === 1}
          onClick={() => onPageChange(currentPage - 1)}
          type="button"
        >
          <Icon name="chevron_left" />
        </button>
        {!compact && pages.map((pageNumber, index) => (
          <span className="pagination-page-slot" key={pageNumber}>
            {index > 0 && pageNumber - pages[index - 1] > 1 && <i>...</i>}
            <button
              aria-current={pageNumber === currentPage ? "page" : undefined}
              className={pageNumber === currentPage ? "active" : ""}
              onClick={() => onPageChange(pageNumber)}
              type="button"
            >
              {pageNumber}
            </button>
          </span>
        ))}
        <button
          aria-label="下一页"
          disabled={currentPage === totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          type="button"
        >
          <Icon name="chevron_right" />
        </button>
      </div>
    </nav>
  );
}
