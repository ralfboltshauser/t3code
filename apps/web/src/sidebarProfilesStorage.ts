import { type SidebarProfileMutation, type SidebarProfilesDocument } from "@t3tools/contracts";
import {
  applySidebarProfileMutation,
  defaultSidebarProfiles,
  validateSidebarProfiles,
} from "@t3tools/client-runtime/sidebar-profiles";

const DATABASE = "t3code-sidebar-profiles";
const STORE = "profiles";
const KEY = "document";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Cannot open profile storage."));
    request.onblocked = () => reject(new Error("Close other T3 tabs to upgrade profile storage."));
  });
}

export async function transactSidebarProfiles(
  mutation?: SidebarProfileMutation,
): Promise<SidebarProfilesDocument> {
  if (window.desktopBridge?.getSidebarProfiles) {
    return mutation
      ? window.desktopBridge.mutateSidebarProfiles(mutation)
      : window.desktopBridge.getSidebarProfiles();
  }
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, mutation ? "readwrite" : "readonly");
    const store = transaction.objectStore(STORE);
    const request = store.get(KEY);
    let result: SidebarProfilesDocument;
    let failure: unknown;
    request.onsuccess = () => {
      try {
        const current =
          request.result === undefined
            ? defaultSidebarProfiles()
            : validateSidebarProfiles(request.result);
        result = mutation ? applySidebarProfileMutation(current, mutation) : current;
        if (mutation) store.put(result, KEY);
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    };
    transaction.oncomplete = () => {
      database.close();
      resolve(result);
    };
    transaction.onerror = () => {
      database.close();
      reject(failure ?? transaction.error ?? new Error("Cannot save profiles."));
    };
    transaction.onabort = () => {
      database.close();
      reject(failure ?? transaction.error ?? new Error("Profile update was cancelled."));
    };
  });
}
