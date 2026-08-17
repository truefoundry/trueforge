import { Icon } from '../../icons/Icon.js';

type SearchInputProps = {
  query: string;
  setQuery: (query: string) => void;
  placeholder?: string;
};

const SearchInput = ({ query, setQuery, placeholder = 'Search' }: SearchInputProps) => {
  return (
    <label className="relative block">
      <Icon
        name="search"
        className="text-text-secondary pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
      />
      <input
        type="search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={placeholder}
        className="border-input-border bg-input-box-bg text-text-primary placeholder:text-text-secondary/70 h-9 w-full rounded-md border py-1 pr-3 pl-8 text-sm outline-none"
        autoFocus
      />
    </label>
  );
};

export default SearchInput;
