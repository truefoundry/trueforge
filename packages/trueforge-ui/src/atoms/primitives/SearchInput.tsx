import { Icon } from '../../icons/Icon.js';
import { cn } from '../lib/cn.js';

type SearchInputProps = {
  query: string;
  setQuery: (query: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  iconClassName?: string;
  /** Icon size in CSS pixels (passed to Lucide `size`). */
  iconSize?: number;
  /** When false, do not steal focus on mount (e.g. nested menu search). Default true. */
  autoFocus?: boolean;
};

const SearchInput = ({
  query,
  setQuery,
  placeholder = 'Search',
  className,
  inputClassName,
  iconClassName,
  iconSize,
  autoFocus = true,
}: SearchInputProps) => {
  return (
    <label className={cn('relative block', className)}>
      <Icon
        name="search"
        size={iconSize}
        className={cn(
          'text-text-secondary pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2',
          iconClassName,
        )}
      />
      <input
        type="search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={placeholder}
        className={cn(
          'border-input-border bg-input-box-bg text-text-primary placeholder:text-text-secondary/70 h-8 w-full rounded-md border py-1 pr-3 pl-8 text-sm outline-none',
          inputClassName,
        )}
        autoFocus={autoFocus}
      />
    </label>
  );
};

export default SearchInput;
