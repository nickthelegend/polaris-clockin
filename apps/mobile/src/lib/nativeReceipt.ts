import * as SecureStore from 'expo-secure-store';
import { createReceiptJournal } from './pendingReceipt';
const PENDING = 'polaris.pending.receipt.v1';
export const receiptJournal = createReceiptJournal({
  get: () => SecureStore.getItemAsync(PENDING),
  set: (value) => SecureStore.setItemAsync(PENDING, value),
  clear: () => SecureStore.deleteItemAsync(PENDING),
});
