import { createStore } from 'zustand/vanilla'
import type { Stratum, StratumTrashItem, Trench } from '@/types'
import { db, syncAll } from '@/hooks/usePersistentStore'

/** 恢复结果：成功 / 原探方不存在 / 单位号已被在册单位占用 */
export type RestoreResult =
  | { ok: true; stratum: Stratum }
  | { ok: false; reason: 'trench-missing'; trenchLabel: string }
  | { ok: false; reason: 'code-occupied'; occupiedBy: Stratum }

export interface StratumTrashState {
  items: StratumTrashItem[]
  loaded: boolean
  hydrate: () => Promise<void>
  /**
   * 把误删单位移入暂存区（事务）：从在册表移除并写入整条快照。
   * @param stratum 被删地层单位
   * @param reason 恢复原因（如 整理时误删）
   * @param trench 原所属探方（用于保存探方显示名快照）
   */
  moveToTrash: (stratum: Stratum, reason: string, trench: Trench | undefined) => Promise<StratumTrashItem>
  /**
   * 放回原探方：仅当原探方仍存在且原单位号仍空闲时成功；
   * 编号已被占用则条目留在暂存区，并通过结果说明碰上了哪个单位。
   */
  restore: (id: string) => Promise<RestoreResult>
  /** 彻底放弃：删除暂存条目，并清理引用该单位的悬空层位关系（事务） */
  purge: (id: string) => Promise<void>
}

function trenchDisplayName(trench: Trench | undefined, trenchId: string): string {
  return trench ? `${trench.area} · ${trench.code}` : `已删探方（${trenchId}）`
}

export const stratumTrashStore = createStore<StratumTrashState>((set, get) => ({
  items: [],
  loaded: false,
  hydrate: async () => {
    const items = await syncAll<StratumTrashItem>(db.stratumTrash)
    items.sort((a, b) => a.deletedAt.localeCompare(b.deletedAt))
    set({ items, loaded: true })
  },
  moveToTrash: async (stratum, reason, trench) => {
    const item: StratumTrashItem = {
      id: stratum.id,
      stratum,
      deletedAt: new Date().toISOString(),
      trenchId: stratum.trenchId,
      trenchLabel: trenchDisplayName(trench, stratum.trenchId),
      reason: reason.trim()
    }
    await db.transaction('rw', db.strata, db.stratumTrash, async () => {
      await db.strata.delete(stratum.id)
      await db.stratumTrash.put(item)
    })
    await get().hydrate()
    return item
  },
  restore: async (id) => {
    const item = get().items.find((entry) => entry.id === id)
    if (!item) {
      return { ok: false, reason: 'trench-missing', trenchLabel: '未知探方' }
    }
    const trench = await db.trenches.get(item.trenchId)
    if (!trench) {
      return { ok: false, reason: 'trench-missing', trenchLabel: item.trenchLabel }
    }
    const targetCode = item.stratum.code.trim().toUpperCase()
    const siblings = await db.strata.where('trenchId').equals(item.trenchId).toArray()
    const occupiedBy = siblings.find((row) => row.code.trim().toUpperCase() === targetCode)
    if (occupiedBy) {
      // 单位号已被占用：什么都不写，条目继续留在暂存区
      return { ok: false, reason: 'code-occupied', occupiedBy }
    }
    await db.transaction('rw', db.strata, db.stratumTrash, async () => {
      await db.strata.put(item.stratum)
      await db.stratumTrash.delete(id)
    })
    await get().hydrate()
    return { ok: true, stratum: item.stratum }
  },
  purge: async (id) => {
    const item = get().items.find((entry) => entry.id === id)
    await db.transaction('rw', db.stratumTrash, db.relations, async () => {
      await db.stratumTrash.delete(id)
      if (item) {
        const orphanIds = await db.relations
          .where('unitAId')
          .equals(item.stratum.id)
          .primaryKeys()
        const reverseIds = await db.relations
          .where('unitBId')
          .equals(item.stratum.id)
          .primaryKeys()
        await db.relations.bulkDelete([...new Set([...orphanIds, ...reverseIds])])
      }
    })
    await get().hydrate()
  }
}))
