const DATA_VIEWS = new Set(["cookies", "localStorage", "sessionStorage"]);

export function makeFavoriteItemId(dataView, itemId) {
  if (!DATA_VIEWS.has(dataView) || typeof itemId !== "string" || !itemId) {
    throw new TypeError("A supported data view and item ID are required.");
  }

  return `${dataView}:${itemId}`;
}

export function normalizeFavoriteItemIds(itemIds) {
  if (!Array.isArray(itemIds)) {
    return [];
  }

  return [...new Set(itemIds.filter((itemId) => typeof itemId === "string" && itemId))];
}

export function sortFavoriteRowsFirst(rows, favoriteItemIds, dataView) {
  const favorites = favoriteItemIds instanceof Set
    ? favoriteItemIds
    : new Set(normalizeFavoriteItemIds(favoriteItemIds));

  return rows
    .map((row, index) => ({
      row,
      index,
      favorite: favorites.has(makeFavoriteItemId(dataView, row.id))
    }))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.index - b.index)
    .map(({ row }) => row);
}
