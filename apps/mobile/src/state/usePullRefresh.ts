import { useCallback, useState } from "react";

/**
 * Pull-to-refresh state owned by the gesture, not by background polling.
 * Binding RefreshControl to the poller's loading flag leaves the iOS spinner
 * stuck (and the screen offset) when a poll toggles it while the tab is hidden.
 */
export function usePullRefresh(refresh: () => Promise<unknown> | void) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);
  return { refreshing, onRefresh };
}
