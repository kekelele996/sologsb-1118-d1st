import { createStore } from 'zustand/vanilla'
import type { Stratum, StratumTrashEntry } from '@/types'
import { findCodeConflict } from '@/types'
import { db, syncAll, syncDelete, syncPut } from '@/hooks/usePersistentStore'
import { stratumStore } from '@/stores/stratumStore'
import { trenchStore } from '@/stores/trenchStore'
import { uid } from '@/utils/id'

/** 放回结果：成功；或失败并说明缘由（编号被占用时带出碰上的在册单位） */
export type RestoreResult =
  | { ok: true }
  | { ok: false; reason: 'trench-missing' }
  | { ok: false; reason: 'code-conflict'; conflict: Stratum }

export interface StratumTrashState {
  entries: StratumTrashEntry[]
  loaded: boolean
  hydrate: () => Promise<void>
  /** 误删进入暂存区：保留整条快照，并从在册表移除（编目表/统计/层位关系随即不再显示） */
  trash: (stratum: Stratum, reason: string) => Promise<void>
  /** 放回原探方：仅在原探方单位号仍空闲时成功，否则留在暂存区 */
  restore: (entryId: string) => Promise<RestoreResult>
  /** 彻底删除暂存条目（快照不再保留） */
  drop: (entryId: string) => Promise<void>
}

export const stratumTrashStore = createStore<StratumTrashState>((set, get) => ({
  entries: [],
  loaded: false,
  hydrate: async () => {
    const entries = await syncAll<StratumTrashEntry>(db.stratumTrash)
    entries.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
    set({ entries, loaded: true })
  },
  trash: async (stratum, reason) => {
    const trench = trenchStore.getState().trenches.find((item) => item.id === stratum.trenchId)
    const entry: StratumTrashEntry = {
      id: uid('stt'),
      snapshot: { ...stratum, inclusions: [...stratum.inclusions] },
      deletedAt: new Date().toISOString(),
      trenchId: stratum.trenchId,
      trenchLabel: trench ? `${trench.area} · ${trench.code}` : '未知探方',
      reason: reason.trim() || '整理时误删'
    }
    await syncPut<StratumTrashEntry>(db.stratumTrash, entry)
    await syncDelete<Stratum>(db.strata, stratum.id)
    await Promise.all([get().hydrate(), stratumStore.getState().hydrate()])
  },
  restore: async (entryId) => {
    const entry = get().entries.find((item) => item.id === entryId)
    if (!entry) return { ok: false, reason: 'trench-missing' }
    const trenchExists = trenchStore.getState().trenches.some((item) => item.id === entry.snapshot.trenchId)
    if (!trenchExists) return { ok: false, reason: 'trench-missing' }
    const conflict = findCodeConflict(stratumStore.getState().strata, entry.snapshot)
    if (conflict) return { ok: false, reason: 'code-conflict', conflict }
    await syncPut<Stratum>(db.strata, entry.snapshot)
    await syncDelete<StratumTrashEntry>(db.stratumTrash, entry.id)
    await Promise.all([get().hydrate(), stratumStore.getState().hydrate()])
    return { ok: true }
  },
  drop: async (entryId) => {
    await syncDelete<StratumTrashEntry>(db.stratumTrash, entryId)
    await get().hydrate()
  }
}))
