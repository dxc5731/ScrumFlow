export const MAX_FILE_BYTES = 5 * 1024 * 1024

const DB_NAME = "scrumflow-course-assets"
const STORE_NAME = "blobs"

const assetEndpoint = (key: string) => `/api/local-assets/${encodeURIComponent(key)}`

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("当前环境不支持 IndexedDB"))
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("附件数据库打开失败"))
  })
}

export function isBlobStoreAvailable() {
  return typeof fetch !== "undefined"
}

export function createBlobKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `blob-${crypto.randomUUID()}`
    : `blob-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export async function putBlob(key: string, blob: Blob) {
  if (blob.size > MAX_FILE_BYTES) {
    throw new Error(`单个文件不能超过 ${MAX_FILE_BYTES / 1024 / 1024}MB`)
  }
  const response = await fetch(assetEndpoint(key), {
    method: "PUT",
    headers: { "Content-Type": blob.type || "application/octet-stream" },
    body: blob,
  })
  if (!response.ok) throw new Error(`附件保存失败（${response.status}）`)
  return key
}

export async function getBlob(key: string) {
  const response = await fetch(assetEndpoint(key))
  if (response.ok) return response.blob()
  if (response.status !== 404) throw new Error(`附件读取失败（${response.status}）`)

  // 兼容切换到本地文件存储前已写入当前浏览器 IndexedDB 的附件。
  if (typeof indexedDB === "undefined") return undefined
  const database = await openDatabase()
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const request = database
      .transaction(STORE_NAME, "readonly")
      .objectStore(STORE_NAME)
      .get(key)
    request.onsuccess = () => resolve(request.result as Blob | undefined)
    request.onerror = () => reject(request.error ?? new Error("附件读取失败"))
  })
  database.close()
  if (blob) await putBlob(key, blob).catch(() => undefined)
  return blob
}

export async function deleteBlob(key: string) {
  const response = await fetch(assetEndpoint(key), { method: "DELETE" })
  if (!response.ok && response.status !== 404)
    throw new Error(`附件删除失败（${response.status}）`)

  if (typeof indexedDB === "undefined") return
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite")
    transaction.objectStore(STORE_NAME).delete(key)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error("附件删除失败"))
  })
  database.close()
}
