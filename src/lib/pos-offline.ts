import type {
  PdvCatalogProduct,
  PosPaymentMethod,
} from "@/lib/pos.functions";

const DB_NAME = "norte-sul-pos";
const DB_VERSION = 1;
const STORE_CATALOG = "catalog";
const STORE_OUTBOX = "outbox";
const STORE_KV = "kv";

export type PendingPosSale = {
  id: string;
  createdAt: string;
  cashSessionId: string;
  idempotencyKey: string;
  items: Array<{ product_id: string; quantity: number }>;
  payments: Array<{
    method: PosPaymentMethod;
    amount: number;
    installments?: number;
    provider?: string;
    provider_reference?: string;
  }>;
  discountAmount: number;
  customerId?: string;
  attempts: number;
  lastError?: string;
};

type CatalogRow = PdvCatalogProduct & {
  warehouseId: string;
  cachedAt: string;
};

type KvRow = {
  key: string;
  value: unknown;
  updatedAt: string;
};

function supported() {
  return (
    typeof window !== "undefined" &&
    "indexedDB" in window
  );
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!supported()) {
      reject(new Error("IndexedDB indisponível"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_CATALOG)) {
        const store = db.createObjectStore(STORE_CATALOG, {
          keyPath: ["warehouseId", "id"],
        });
        store.createIndex("warehouseId", "warehouseId", {
          unique: false,
        });
      }

      if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
        db.createObjectStore(STORE_OUTBOX, {
          keyPath: "id",
        });
      }

      if (!db.objectStoreNames.contains(STORE_KV)) {
        db.createObjectStore(STORE_KV, {
          keyPath: "key",
        });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        request.error ??
          new Error("Falha ao abrir cache local do PDV"),
      );
  });
}

async function transaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  work: (
    store: IDBObjectStore,
  ) => IDBRequest<T> | void,
) {
  const db = await openDb();

  return new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let request: IDBRequest<T> | void;

    try {
      request = work(store);
    } catch (error) {
      db.close();
      reject(error);
      return;
    }

    let value: T | undefined;

    if (request) {
      request.onsuccess = () => {
        value = request.result;
      };
      request.onerror = () =>
        reject(
          request.error ??
            new Error("Falha no armazenamento local"),
        );
    }

    tx.oncomplete = () => {
      db.close();
      resolve(value);
    };
    tx.onerror = () => {
      db.close();
      reject(
        tx.error ??
          new Error("Falha na transação local"),
      );
    };
    tx.onabort = () => {
      db.close();
      reject(
        tx.error ??
          new Error("Transação local cancelada"),
      );
    };
  });
}

export async function cachePdvCatalog(
  warehouseId: string,
  products: PdvCatalogProduct[],
) {
  if (
    !supported() ||
    !warehouseId ||
    products.length === 0
  ) {
    return;
  }

  const db = await openDb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(
      STORE_CATALOG,
      "readwrite",
    );
    const store = tx.objectStore(STORE_CATALOG);
    const cachedAt = new Date().toISOString();

    for (const product of products) {
      store.put({
        ...product,
        warehouseId,
        cachedAt,
      } satisfies CatalogRow);
    }

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function replacePdvCatalogSnapshot(
  warehouseId: string,
  products: PdvCatalogProduct[],
) {
  if (!supported() || !warehouseId) return;

  const db = await openDb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(
      STORE_CATALOG,
      "readwrite",
    );
    const store = tx.objectStore(STORE_CATALOG);
    const index = store.index("warehouseId");
    const cursor = index.openCursor(
      IDBKeyRange.only(warehouseId),
    );
    const cachedAt = new Date().toISOString();

    cursor.onsuccess = () => {
      const current = cursor.result;
      if (current) {
        current.delete();
        current.continue();
        return;
      }

      for (const product of products) {
        store.put({
          ...product,
          warehouseId,
          cachedAt,
        } satisfies CatalogRow);
      }
    };

    cursor.onerror = () => reject(cursor.error);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(
        tx.error ??
          new Error(
            "Falha ao substituir snapshot local",
          ),
      );
    };
  });
}

export async function readCachedPdvCatalog(
  warehouseId: string,
  search = "",
) {
  if (!supported() || !warehouseId) {
    return [] as PdvCatalogProduct[];
  }

  const db = await openDb();

  const rows = await new Promise<CatalogRow[]>(
    (resolve, reject) => {
      const tx = db.transaction(
        STORE_CATALOG,
        "readonly",
      );
      const index = tx
        .objectStore(STORE_CATALOG)
        .index("warehouseId");
      const request = index.getAll(
        IDBKeyRange.only(warehouseId),
      );

      request.onsuccess = () =>
        resolve(
          (request.result ?? []) as CatalogRow[],
        );
      request.onerror = () =>
        reject(request.error);
      tx.oncomplete = () => db.close();
    },
  );

  const term = search
    .trim()
    .toLocaleLowerCase("pt-BR");

  return rows
    .filter(
      (row) =>
        !term ||
        [
          row.name,
          row.sku,
          row.internal_code ?? "",
          row.manufacturer_code ?? "",
        ].some((value) =>
          value
            .toLocaleLowerCase("pt-BR")
            .includes(term),
        ),
    )
    .slice(0, 20)
    .map(
      ({
        warehouseId: _warehouse,
        cachedAt: _cachedAt,
        ...product
      }) => product,
    );
}

export async function findCachedPdvProductsByCode(
  warehouseId: string,
  code: string,
) {
  const rows = await readCachedPdvCatalog(
    warehouseId,
    code,
  );
  const normalized = code.trim();

  return rows.filter((row) =>
    [
      row.sku,
      row.internal_code,
      row.manufacturer_code,
    ].some((value) => value === normalized),
  );
}

export async function enqueuePendingPosSale(
  sale: Omit<
    PendingPosSale,
    "id" | "createdAt" | "attempts"
  >,
) {
  const row: PendingPosSale = {
    ...sale,
    id: sale.idempotencyKey,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };

  await transaction(
    STORE_OUTBOX,
    "readwrite",
    (store) => store.put(row),
  );

  return row;
}

export async function listPendingPosSales() {
  const rows = await transaction<PendingPosSale[]>(
    STORE_OUTBOX,
    "readonly",
    (store) => store.getAll(),
  );

  return (rows ?? []).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}

export async function removePendingPosSale(
  id: string,
) {
  await transaction(
    STORE_OUTBOX,
    "readwrite",
    (store) => store.delete(id),
  );
}

export async function markPendingPosSaleFailure(
  id: string,
  error: string,
) {
  const current = await transaction<PendingPosSale>(
    STORE_OUTBOX,
    "readonly",
    (store) => store.get(id),
  );

  if (!current) return;

  await transaction(
    STORE_OUTBOX,
    "readwrite",
    (store) =>
      store.put({
        ...current,
        attempts: current.attempts + 1,
        lastError: error.slice(0, 500),
      }),
  );
}

export async function countPendingPosSales() {
  const count = await transaction<number>(
    STORE_OUTBOX,
    "readonly",
    (store) => store.count(),
  );

  return count ?? 0;
}

export async function setPosLocalValue(
  key: string,
  value: unknown,
) {
  await transaction(
    STORE_KV,
    "readwrite",
    (store) =>
      store.put({
        key,
        value,
        updatedAt: new Date().toISOString(),
      } satisfies KvRow),
  );
}

export async function getPosLocalValue<T>(
  key: string,
) {
  const row = await transaction<KvRow>(
    STORE_KV,
    "readonly",
    (store) => store.get(key),
  );

  return (row?.value ?? null) as T | null;
}

export async function deletePosLocalValue(
  key: string,
) {
  await transaction(
    STORE_KV,
    "readwrite",
    (store) => store.delete(key),
  );
}

export function isLikelyNetworkError(
  error: unknown,
) {
  const message =
    error instanceof Error
      ? error.message
      : String(error ?? "");

  return (
    (typeof navigator !== "undefined" &&
      !navigator.onLine) ||
    /failed to fetch|network|fetch failed|load failed|connection/i.test(
      message,
    )
  );
}
