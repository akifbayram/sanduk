import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Label } from '@/components/ui/label';
import { SearchInput } from '@/components/ui/search-input';
import { type SortDirection, SortHeader } from '@/components/ui/sort-header';
import { useToast } from '@/components/ui/toast';
import { checkoutItem, returnItem } from '@/features/checkouts/useCheckouts';
import { addItemsToShoppingList, removeFromShoppingList } from '@/features/shopping-list/useShoppingList';
import { Events, notify } from '@/lib/eventBus';
import { cn } from '@/lib/utils';
import type { BinItem, ItemCheckout } from '@/types';
import { ItemListCheckoutRow } from './ItemListCheckoutRow';
import { ItemListPagination } from './ItemListPagination';
import { ItemListReadOnlyRow } from './ItemListReadOnlyRow';
import { ItemListRow } from './ItemListRow';
import { ACTIONS_COL_WIDTH, QTY_COL_WIDTH } from './itemListLayout';
import { type SortColumn, sortBinItems } from './itemListSort';
import { removeItemFromBin, renameItem, reorderItems } from './useBins';
import { useItemPageSize } from './useItemPageSize';
import { useItemPagination } from './useItemPagination';

// Filter-search input appears once the bin has more than this many items.
// The page-size preference itself lives in Settings → Preferences → Display.
const FILTER_THRESHOLD = 15;

interface ItemListProps {
  items: BinItem[];
  binId?: string;
  readOnly?: boolean;
  hideWhenEmpty?: boolean;
  hideHeader?: boolean;
  checkouts?: ItemCheckout[];
  onItemsChange?: (items: BinItem[]) => void;
  headerExtra?: React.ReactNode;
  /** Node rendered inside the card below items, separated by a subtle divider.
   *  When set, the card renders even if there are no items (so the slot stays visible). */
  footerSlot?: React.ReactNode;
}

export function ItemList({ items, binId, readOnly, hideWhenEmpty, hideHeader, checkouts = [], onItemsChange, headerExtra, footerSlot }: ItemListProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>('');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const { showToast, updateToast } = useToast();
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(new Set());
  const pendingDeletesRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const deleteBatchRef = useRef<{ toastId: number; ids: Set<string> } | null>(null);

  const checkoutMap = useMemo(() => {
    const map = new Map<string, ItemCheckout>();
    for (const co of checkouts) map.set(co.item_id, co);
    return map;
  }, [checkouts]);

  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const savedTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  function markSaved(itemId: string) {
    setSavedIds(prev => new Set(prev).add(itemId));
    const existing = savedTimersRef.current.get(itemId);
    if (existing) clearTimeout(existing);
    savedTimersRef.current.set(itemId, setTimeout(() => {
      setSavedIds(prev => { const next = new Set(prev); next.delete(itemId); return next; });
      savedTimersRef.current.delete(itemId);
    }, 600));
  }

  // View mode = binId set, parent doesn't control items.
  // Mutations update localItems immediately and persist quietly, skipping the full bin refetch.
  const viewMode = binId != null && !onItemsChange;
  const [localItems, setLocalItems] = useState(items);
  const prevItemsRef = useRef(items);
  if (items !== prevItemsRef.current) {
    prevItemsRef.current = items;
    setLocalItems(items);
  }
  const effectiveItems = viewMode ? localItems : items;

  const reorderTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const displayItems = useMemo(
    () => effectiveItems.filter((item) => !pendingDeleteIds.has(item.id)),
    [effectiveItems, pendingDeleteIds],
  );

  const [filterQuery, setFilterQuery] = useState('');
  const showFilter = displayItems.length > FILTER_THRESHOLD;

  useEffect(() => {
    if (!showFilter) setFilterQuery('');
  }, [showFilter]);

  const filteredItems = useMemo(() => {
    if (!filterQuery) return displayItems;
    const lower = filterQuery.toLowerCase();
    return displayItems.filter((i) => i.name.toLowerCase().includes(lower));
  }, [displayItems, filterQuery]);

  const { pageSize } = useItemPageSize();
  const {
    page,
    setPage,
    totalPages,
    visibleItems,
    rangeStart,
    rangeEnd,
    jumpToLastPage,
  } = useItemPagination(filteredItems, pageSize, [filterQuery, sortColumn, sortDirection, pageSize]);

  // Jump to the last page whenever the upstream `items` count grows (i.e. the
  // parent/server added one). We intentionally watch the raw `items` prop, NOT
  // `effectiveItems` or `displayItems`: (a) adds only arrive via the prop in
  // both form- and view-mode, so `items` is the authoritative signal; (b)
  // `displayItems` grows when a pending delete is undone, and we must NOT jump
  // in that case — the user is actively trying to retrieve something, not add.
  const prevItemsLengthRef = useRef(items.length);
  useEffect(() => {
    if (items.length > prevItemsLengthRef.current) {
      jumpToLastPage();
    }
    prevItemsLengthRef.current = items.length;
  }, [items.length, jumpToLastPage]);

  const onItemsChangeRef = useRef(onItemsChange);
  onItemsChangeRef.current = onItemsChange;
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const handleHeaderSort = useCallback((column: string, direction: SortDirection) => {
    if (column !== 'name' && column !== 'qty') return;
    setSortColumn(column);
    setSortDirection(direction);
    const source = viewMode ? localItems : items;
    const sorted = sortBinItems(source, column, direction);
    if (onItemsChange) {
      onItemsChange(sorted);
      return;
    }
    if (!binId) return;
    setLocalItems(sorted);
    if (reorderTimerRef.current) clearTimeout(reorderTimerRef.current);
    reorderTimerRef.current = setTimeout(() => {
      reorderItems(binId, sorted.map((i) => i.id), { quiet: true }).catch(() => {
        showToast({ message: 'Failed to sort items', variant: 'error' });
      });
    }, 500);
  }, [items, localItems, viewMode, binId, onItemsChange, showToast]);

  async function handleSaveEdit(itemId: string, value: string, quantity: number | null) {
    const next = effectiveItems.map((i) => (i.id === itemId ? { ...i, name: value, quantity } : i));
    if (onItemsChange) {
      onItemsChange(next);
      markSaved(itemId);
      return;
    }
    if (!binId) return;
    setLocalItems(next);
    try {
      await renameItem(binId, itemId, value, quantity, { quiet: true });
      markSaved(itemId);
    } catch {
      setLocalItems(items);
      showToast({ message: 'Failed to update item', variant: 'error' });
    }
  }

  function handleDelete(itemId: string) {
    if (pendingDeleteIds.has(itemId)) return;
    // Snapshot at click time: if the item has an active checkout, the server's
    // FK CASCADE will remove the checkout row along with the item — we need to
    // nudge CHECKOUTS subscribers so the "N out" count refreshes.
    const hadCheckout = checkoutMap.has(itemId);
    setPendingDeleteIds((prev) => new Set(prev).add(itemId));

    const timerId = setTimeout(() => {
      pendingDeletesRef.current.delete(itemId);
      const batch = deleteBatchRef.current;
      if (batch) {
        batch.ids.delete(itemId);
        if (batch.ids.size === 0) deleteBatchRef.current = null;
      }
      const next = itemsRef.current.filter((i) => i.id !== itemId);
      if (onItemsChangeRef.current) {
        onItemsChangeRef.current(next);
        return;
      }
      setLocalItems(next);
      if (binId) {
        removeItemFromBin(binId, itemId, { quiet: true })
          .then(() => {
            if (hadCheckout) notify(Events.CHECKOUTS);
          })
          .catch(() => {
            setLocalItems(itemsRef.current);
            setPendingDeleteIds((prev) => { const n = new Set(prev); n.delete(itemId); return n; });
            showToast({ message: 'Failed to delete item', variant: 'error' });
          });
      }
    }, 5000);
    pendingDeletesRef.current.set(itemId, timerId);

    // Coalesce into the active batch (if any) so rapid deletes share one toast
    // with a single Undo. The batch lives as long as any pending delete in it.
    const isNewBatch = !deleteBatchRef.current;
    const batch = deleteBatchRef.current ?? { toastId: 0, ids: new Set<string>() };
    if (isNewBatch) deleteBatchRef.current = batch;
    batch.ids.add(itemId);

    const undo = () => {
      const ids = Array.from(batch.ids);
      for (const id of ids) {
        const pending = pendingDeletesRef.current.get(id);
        if (pending != null) {
          clearTimeout(pending);
          pendingDeletesRef.current.delete(id);
        }
      }
      batch.ids.clear();
      if (deleteBatchRef.current === batch) deleteBatchRef.current = null;
      setPendingDeleteIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
    };

    const count = batch.ids.size;
    const addToList = () => {
      if (!binId) return;
      const ids = Array.from(batch.ids);
      const names = ids
        .map((itemId) => itemsRef.current.find((i) => i.id === itemId)?.name)
        .filter((n): n is string => !!n);
      if (names.length === 0) return;
      void addItemsToShoppingList(binId, names)
        .then((entries) => {
          showToast({
            message: names.length === 1 ? 'Added to shopping list' : `Added ${names.length} to list`,
            variant: 'success',
            action: {
              label: 'Undo',
              onClick: () => {
                void Promise.all(entries.map((e) => removeFromShoppingList(e.id)));
              },
            },
          });
        })
        .catch(() => {
          showToast({ message: 'Failed to add to list', variant: 'error' });
        });
    };
    const payload = {
      message: count === 1 ? 'Item removed' : `${count} items removed`,
      duration: 5500,
      action: { label: 'Undo', onClick: undo },
      secondaryAction: { label: count === 1 ? 'Add to list' : 'Add all to list', onClick: addToList },
    };
    if (isNewBatch) {
      batch.toastId = showToast(payload);
    } else {
      updateToast(batch.toastId, payload);
    }
  }

  async function handleCheckout(itemId: string) {
    if (!binId) return;
    try {
      await checkoutItem(binId, itemId);
      showToast({ message: 'Item checked out' });
    } catch {
      showToast({ message: 'Failed to check out item' });
    }
  }

  async function handleReturn(itemId: string) {
    if (!binId) return;
    try {
      await returnItem(binId, itemId);
      showToast({ message: 'Item returned' });
    } catch {
      showToast({ message: 'Failed to return item' });
    }
  }

  useEffect(() => {
    const pending = pendingDeletesRef;
    const saved = savedTimersRef;
    const reorder = reorderTimerRef;
    return () => {
      for (const t of saved.current.values()) clearTimeout(t);
      clearTimeout(reorder.current);

      const entries = [...pending.current.entries()];
      pending.current.clear();
      if (entries.length === 0) return;
      for (const [, timerId] of entries) clearTimeout(timerId);

      const ids = new Set(entries.map(([id]) => id));
      if (onItemsChangeRef.current) {
        onItemsChangeRef.current(itemsRef.current.filter((i) => !ids.has(i.id)));
      } else if (binId) {
        for (const id of ids) {
          removeItemFromBin(binId, id, { quiet: true }).catch(() => {});
        }
      }
    };
  }, [binId]);

  if (hideWhenEmpty && items.length === 0) return null;

  const itemWord = displayItems.length === 1 ? 'Item' : 'Items';
  const headerCount = filterQuery
    ? `${filteredItems.length} of ${displayItems.length} ${itemWord}`
    : `${displayItems.length} ${itemWord}`;
  const showSortHeaders = !readOnly && effectiveItems.length >= 2;

  return (
    <div>
      {!hideHeader && (
        <div className="row-spread mb-2 min-h-8">
          <Label>
            {headerCount}
            {checkouts.length > 0 && ` · ${checkouts.length} out`}
          </Label>
          {headerExtra && <span className="inline-flex items-center gap-1.5">{headerExtra}</span>}
        </div>
      )}

      {showFilter && (
        <div className="mb-2">
          <SearchInput
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            onClear={filterQuery ? () => setFilterQuery('') : undefined}
            placeholder="Filter items..."
          />
        </div>
      )}

      {displayItems.length === 0 && !footerSlot ? (
        <p className="text-[14px] text-[var(--text-tertiary)] py-2">
          {readOnly ? 'No items' : 'No items yet — add one below'}
        </p>
      ) : (
        <div className="rounded-[var(--radius-sm)] bg-[var(--bg-input)] border border-[var(--border-flat)] overflow-hidden">
          {displayItems.length > 0 && (
            <div className="row-tight min-h-[44px] px-3.5 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-hover)]">
              {showSortHeaders ? (
                <>
                  <SortHeader label="Name" column="name" currentColumn={sortColumn} currentDirection={sortDirection} onSort={handleHeaderSort} className="flex-1" />
                  <SortHeader label="Qty" column="qty" currentColumn={sortColumn} currentDirection={sortDirection} onSort={handleHeaderSort} defaultDirection="desc" className={cn(QTY_COL_WIDTH, 'justify-end')} />
                </>
              ) : (
                <>
                  <span className="ui-col-header flex-1">Name</span>
                  <span className={cn('ui-col-header', QTY_COL_WIDTH, 'text-right')}>Qty</span>
                </>
              )}
              {!readOnly && (
                <span className={cn('ui-col-header', ACTIONS_COL_WIDTH, 'text-right')}>Actions</span>
              )}
            </div>
          )}
          {displayItems.length > 0 && (
            visibleItems.length === 0 && filterQuery ? (
              <p className="px-3.5 py-3 text-[14px] text-[var(--text-tertiary)] italic">
                No items match &ldquo;{filterQuery}&rdquo;
              </p>
            ) : (
              <div key={page} className="animate-page-enter">
                {visibleItems.map((item, i) => {
                  const checkout = checkoutMap.get(item.id);
                  let row: React.ReactNode;
                  if (checkout) {
                    row = (
                      <ItemListCheckoutRow
                        item={item}
                        checkout={checkout}
                        onReturn={!readOnly && binId ? () => handleReturn(item.id) : undefined}
                        onDelete={!readOnly ? () => handleDelete(item.id) : undefined}
                      />
                    );
                  } else if (readOnly) {
                    row = <ItemListReadOnlyRow item={item} />;
                  } else {
                    row = (
                      <ItemListRow
                        text={item.name}
                        quantity={item.quantity}
                        saved={savedIds.has(item.id)}
                        onCheckout={binId ? () => handleCheckout(item.id) : undefined}
                        onSave={(value, qty) => handleSaveEdit(item.id, value, qty)}
                        onDelete={() => handleDelete(item.id)}
                      />
                    );
                  }
                  return (
                    <div key={item.id}>
                      {i > 0 && <div className="h-px mx-3.5 bg-[var(--border-subtle)]" />}
                      {row}
                    </div>
                  );
                })}
              </div>
            )
          )}
          {footerSlot && (
            <>
              {displayItems.length > 0 && <div className="h-px mx-3.5 bg-[var(--border-subtle)]" />}
              {footerSlot}
            </>
          )}
          <ItemListPagination
            page={page}
            totalPages={totalPages}
            totalCount={filteredItems.length}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            onPageChange={setPage}
            itemLabel={displayItems.length === 1 ? 'item' : 'items'}
          />
        </div>
      )}
    </div>
  );
}
