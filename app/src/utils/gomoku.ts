/**
 * gomoku.ts — 前端赢局检测 + Bitboard 工具
 *
 * 设计原则: "链下算，链上验"
 *   与合约 verify_win_line() 完全对称。
 *   position = row * 15 + col  (0 ~ 224)
 */

export const BOARD_SIZE = 15
export const BOARD_CELLS = BOARD_SIZE * BOARD_SIZE // 225
export const BITBOARD_BYTES = 29 // ceil(225 / 8)

export enum Cell {
  Empty = 0,
  P1 = 1,
  P2 = 2,
}

// 与合约 status 字段对应
export enum GameStatus {
  WaitingP2 = 0,
  Playing = 1,
  P1Win = 2,
  P2Win = 3,
  P1Resign = 4,
  P2Resign = 5,
  Draw = 6,
}

// ─────────────────────────────────────────────
// Bitboard 工具
// ─────────────────────────────────────────────

/** 将两个 bitboard（Uint8Array/number[]）转换为 225 格 Cell 数组 */
export function bitboardsToGrid(
  boardP1: Uint8Array | number[],
  boardP2: Uint8Array | number[]
): Cell[] {
  const grid = new Array<Cell>(BOARD_CELLS).fill(Cell.Empty)
  for (let pos = 0; pos < BOARD_CELLS; pos++) {
    const byteIdx = pos >> 3
    const bitIdx = pos & 7
    if (boardP1[byteIdx] & (1 << bitIdx)) {
      grid[pos] = Cell.P1
    } else if (boardP2[byteIdx] & (1 << bitIdx)) {
      grid[pos] = Cell.P2
    }
  }
  return grid
}

// ─────────────────────────────────────────────
// 坐标工具
// ─────────────────────────────────────────────

export function toPos(row: number, col: number): number {
  return row * BOARD_SIZE + col
}

export function fromPos(pos: number): [number, number] {
  return [Math.floor(pos / BOARD_SIZE), pos % BOARD_SIZE]
}

// ─────────────────────────────────────────────
// 赢局检测
// ─────────────────────────────────────────────

/**
 * 检测最后落子是否形成五连珠。
 * 以 lastPos 为中心向4个方向延伸，时间复杂度 O(1)。
 *
 * @returns 5个获胜坐标，或 null
 */
export function detectWin(
  grid: Cell[],
  lastPos: number,
  player: Cell
): number[] | null {
  const [row, col] = fromPos(lastPos)
  const directions: [number, number][] = [
    [0, 1],   // 横
    [1, 0],   // 纵
    [1, 1],   // 主对角线 \
    [1, -1],  // 反对角线 /
  ]
  for (const [dr, dc] of directions) {
    const line = collectLine(grid, row, col, dr, dc, player)
    if (line !== null) return line
  }
  return null
}

/**
 * 沿一个方向双向收集同色连续位置，返回 5 连珠的5个坐标（不含更长的截断），或 null。
 *
 * FIX: 之前用 "取中间5个" 的方式在长连时可能选取不连续的5个；
 *      现在改为: 连续 >= 5 即从第0个取连续5个（正确的获胜序列）。
 */
function collectLine(
  grid: Cell[],
  row: number,
  col: number,
  dr: number,
  dc: number,
  player: Cell
): number[] | null {
  // 从起点向正向收集
  const forward: number[] = []
  for (let i = 0; i < 5; i++) {
    const r = row + dr * i
    const c = col + dc * i
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) break
    if (grid[toPos(r, c)] === player) forward.push(toPos(r, c))
    else break
  }

  // 从起点向反向收集（不含起点）
  const backward: number[] = []
  for (let i = 1; i < 5; i++) {
    const r = row - dr * i
    const c = col - dc * i
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) break
    if (grid[toPos(r, c)] === player) backward.push(toPos(r, c))
    else break
  }

  // 合并：backward 倒序在前，forward 在后
  const total = [...backward.reverse(), ...forward]

  if (total.length >= 5) {
    // FIX: 直接取开头5个，因为所有元素都是连续同色的
    return total.slice(0, 5)
  }
  return null
}

// ─────────────────────────────────────────────
// 连线验证 (与合约 verify_win_line 对称)
// ─────────────────────────────────────────────

/**
 * 验证5个落子位置是否构成合法连线。
 * 在发送 claim_win 之前调用，避免无效交易。
 */
export function verifyWinLine(positions: number[]): boolean {
  if (positions.length !== 5) return false

  const sorted = [...positions].sort((a, b) => a - b)
  const rows = sorted.map((p) => Math.floor(p / BOARD_SIZE))
  const cols = sorted.map((p) => p % BOARD_SIZE)

  // 横向: 同行，列依次+1
  if (rows.every((r) => r === rows[0])) {
    if ([1, 2, 3, 4].every((i) => cols[i] === cols[i - 1] + 1)) return true
  }

  // 纵向: 同列，行依次+1
  if (cols.every((c) => c === cols[0])) {
    if ([1, 2, 3, 4].every((i) => rows[i] === rows[i - 1] + 1)) return true
  }

  // 主对角线 (\): 行+1, 列+1
  if ([1, 2, 3, 4].every((i) => rows[i] === rows[i - 1] + 1 && cols[i] === cols[i - 1] + 1)) {
    return true
  }

  // 反对角线 (/): 行+1, 列-1
  // FIX: cols[i-1] > 0 防止数字下溢
  if (
    [1, 2, 3, 4].every(
      (i) => rows[i] === rows[i - 1] + 1 && cols[i - 1] > 0 && cols[i] + 1 === cols[i - 1]
    )
  ) {
    return true
  }

  return false
}

// ─────────────────────────────────────────────
// UI 辅助
// ─────────────────────────────────────────────

export function isOccupied(grid: Cell[], pos: number): boolean {
  return grid[pos] !== Cell.Empty
}

/**
 * 根据游戏状态和本人身份返回状态文本。
 *
 * FIX: Playing 状态下需区分当前是谁的回合
 */
export function getStatusText(
  status: GameStatus,
  isP1: boolean,
  currentTurn?: number
): string {
  switch (status) {
    case GameStatus.WaitingP2:
      return 'Waiting for opponent...'
    case GameStatus.Playing: {
      // 有 currentTurn 时精确显示
      if (currentTurn !== undefined) {
        const myTurn = (isP1 && currentTurn === 0) || (!isP1 && currentTurn === 1)
        return myTurn ? 'Your move' : 'Waiting for opponent...'
      }
      return isP1 ? 'Your move' : 'Waiting for opponent...'
    }
    case GameStatus.P1Win:
      return isP1 ? 'You won' : 'You lost'
    case GameStatus.P2Win:
      return isP1 ? 'You lost' : 'You won'
    case GameStatus.P1Resign:
      return isP1 ? 'You resigned' : 'Opponent resigned. You won.'
    case GameStatus.P2Resign:
      return isP1 ? 'Opponent resigned. You won.' : 'You resigned'
    case GameStatus.Draw:
      return 'Draw'
    default:
      return 'Loading...'
  }
}
