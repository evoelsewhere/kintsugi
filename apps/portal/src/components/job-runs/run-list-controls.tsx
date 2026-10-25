import { Search } from "lucide-react";
import { Chips } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { RUN_FILTERS } from "./run-model";

export function RunListControls({
  filter,
  onFilter,
  search,
  onSearch,
  searchLabel = "Search runs",
  placeholder = "Run, project, actor, or error…",
}: {
  filter: string;
  onFilter: (value: string) => void;
  search: string;
  onSearch: (value: string) => void;
  searchLabel?: string;
  placeholder?: string;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-recessed/45 p-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <Chips label="Run status" options={RUN_FILTERS.map(({ id, label }) => ({ id, label }))} value={filter} onChange={onFilter} />
      <label className="relative block w-full sm:ml-auto sm:max-w-xs">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-text-muted" aria-hidden />
        <Input
          size="small"
          type="search"
          value={search}
          onChange={(event) => onSearch(event.currentTarget.value)}
          placeholder={placeholder}
          aria-label={searchLabel}
          className="pl-8"
        />
      </label>
    </div>
  );
}
