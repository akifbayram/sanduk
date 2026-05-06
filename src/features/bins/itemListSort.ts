import type { SortDirection } from '@/components/ui/sort-header';
import type { BinItem } from '@/types';

export type SortColumn = '' | 'name' | 'qty';

function compareByName(a: BinItem, b: BinItem): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

export function sortBinItems(items: BinItem[], column: SortColumn, direction: SortDirection): BinItem[] {
  if (column === 'name') {
    return [...items].sort((a, b) => direction === 'asc' ? compareByName(a, b) : -compareByName(a, b));
  }
  if (column === 'qty') {
    return [...items].sort((a, b) => {
      const aNull = a.quantity == null;
      const bNull = b.quantity == null;
      if (aNull && bNull) return compareByName(a, b);
      if (aNull) return 1;
      if (bNull) return -1;
      const qa = a.quantity as number;
      const qb = b.quantity as number;
      const diff = direction === 'desc' ? qb - qa : qa - qb;
      return diff !== 0 ? diff : compareByName(a, b);
    });
  }
  return items;
}
