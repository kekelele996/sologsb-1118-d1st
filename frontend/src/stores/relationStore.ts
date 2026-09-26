import { createStore } from 'zustand/vanilla'
import type { Relation } from '@/types'
import { db, syncAll, syncDelete, syncPut } from '@/hooks/usePersistentStore'

export interface RelationState {
  relations: Relation[]
  loaded: boolean
  hydrate: () => Promise<void>
  /** 保存前由页面做环路检测，store 只负责写入 */
  save: (relation: Relation) => Promise<void>
  remove: (id: string) => Promise<void>
  removeByStratum: (stratumId: string) => Promise<void>
}

export const relationStore = createStore<RelationState>((set, get) => ({
  relations: [],
  loaded: false,
  hydrate: async () => {
    // 只保留两端单位仍在册的关系：暂存中的地层单位不参与层位关系显示，恢复后自动回来
    const [all, activeIds] = await Promise.all([
      syncAll<Relation>(db.relations),
      db.strata.toCollection().primaryKeys()
    ])
    const activeSet = new Set(activeIds)
    const relations = all.filter((item) => activeSet.has(item.unitAId) && activeSet.has(item.unitBId))
    relations.sort((a, b) => a.id.localeCompare(b.id))
    set({ relations, loaded: true })
  },
  save: async (relation) => {
    await syncPut<Relation>(db.relations, relation)
    await get().hydrate()
  },
  remove: async (id) => {
    await syncDelete<Relation>(db.relations, id)
    await get().hydrate()
  },
  removeByStratum: async (stratumId) => {
    const targets = get().relations.filter((item) => item.unitAId === stratumId || item.unitBId === stratumId)
    await Promise.all(targets.map((item) => syncDelete<Relation>(db.relations, item.id)))
    await get().hydrate()
  }
}))
