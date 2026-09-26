/** 单位类型 */
export const UNIT_TYPES = ['地层', '灰坑', '房址', '沟', '墓葬'] as const
export type UnitType = (typeof UNIT_TYPES)[number]

/** 包含物 */
export const INCLUSIONS = ['陶片', '骨', '炭屑', '石器'] as const
export type Inclusion = (typeof INCLUSIONS)[number]

/** Stratum 地层单位 */
export interface Stratum {
  id: string
  trenchId: string
  /** 单位号，如 H12、L03 */
  code: string
  type: UnitType
  /** 开口层位 */
  openLayer: string
  /** 距地表深度上界（米） */
  topDepth: number
  /** 距地表深度下界（米） */
  bottomDepth: number
  /** 土质土色 */
  soil: string
  inclusions: Inclusion[]
  /** 堆积成因推测 */
  formation: string
  date: string
  /** 绘图与拍照编号 */
  drawingNo: string
}

/** 厚度（米） */
export function stratumThickness(stratum: Pick<Stratum, 'topDepth' | 'bottomDepth'>): number {
  return Math.round(Math.abs(stratum.bottomDepth - stratum.topDepth) * 100) / 100
}

/** 层序是否倒置：上界深度大于下界深度即倒置 */
export function isDepthInverted(stratum: Pick<Stratum, 'topDepth' | 'bottomDepth'>): boolean {
  return stratum.topDepth > stratum.bottomDepth
}

/** 同一探方内占用该单位号的在册单位（无冲突返回 null） */
export function findCodeConflict(strata: Stratum[], candidate: Pick<Stratum, 'id' | 'trenchId' | 'code'>): Stratum | null {
  return (
    strata.find(
      (item) =>
        item.id !== candidate.id &&
        item.trenchId === candidate.trenchId &&
        item.code.trim().toUpperCase() === candidate.code.trim().toUpperCase()
    ) ?? null
  )
}

/** 单位号在同一探方内是否重复 */
export function isCodeDuplicated(strata: Stratum[], candidate: Pick<Stratum, 'id' | 'trenchId' | 'code'>): boolean {
  return findCodeConflict(strata, candidate) !== null
}

/** 暂存区条目：误删地层单位的整条快照，向工地核对后可放回原探方 */
export interface StratumTrashEntry {
  id: string
  /** 删除时的整条快照（开口层位、土质土色、绘图号等原样保留） */
  snapshot: Stratum
  /** 删除发生时间（ISO 字符串） */
  deletedAt: string
  /** 原所属探方 id */
  trenchId: string
  /** 原所属探方显示名快照（探方后续变动仍可追溯） */
  trenchLabel: string
  /** 恢复原因：删除时填写的暂存缘由 */
  reason: string
}
