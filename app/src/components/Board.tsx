/**
 * Board.tsx — 五子棋棋盘组件 (SVG)
 *
 * 修复: hover 预览改用 React state 管理 (SVG 不支持 CSS 兄弟选择器)
 */

import React, { useState, useCallback } from 'react'
import { Cell, BOARD_SIZE } from '../utils/gomoku'

interface BoardProps {
  grid: Cell[]
  isMyTurn: boolean
  isP1: boolean
  winPositions: number[] | null
  onPlace: (position: number) => void
  disabled?: boolean
}

const CELL_SIZE = 38
const STONE_R = 15
const PAD = 22

export const Board: React.FC<BoardProps> = ({
  grid,
  isMyTurn,
  isP1,
  winPositions,
  onPlace,
  disabled = false,
}) => {
  const [hoverPos, setHoverPos] = useState<number | null>(null)
  const boardPx = CELL_SIZE * (BOARD_SIZE - 1) + PAD * 2
  const winSet = winPositions ? new Set(winPositions) : null

  const canInteract = isMyTurn && !disabled

  const handleClick = useCallback(
    (pos: number) => {
      if (!canInteract || grid[pos] !== Cell.Empty) return
      onPlace(pos)
    },
    [canInteract, grid, onPlace]
  )

  const renderStone = (pos: number, x: number, y: number) => {
    const cell = grid[pos]
    const isWin = winSet?.has(pos) ?? false

    if (cell === Cell.Empty) {
      // 悬停预览
      if (hoverPos === pos && canInteract) {
        return (
          <circle
            key={`hover-${pos}`}
            cx={x} cy={y} r={STONE_R}
            fill={isP1 ? 'rgba(26,26,26,0.35)' : 'rgba(255,255,255,0.35)'}
            stroke={isP1 ? '#555' : '#aaa'}
            strokeWidth={1.5}
            strokeDasharray="4 2"
            pointerEvents="none"
          />
        )
      }
      return null
    }

    const isBlack = cell === Cell.P1
    return (
      <g key={`stone-${pos}`} pointerEvents="none">
        {/* 阴影 */}
        <circle cx={x + 2} cy={y + 2} r={STONE_R} fill="rgba(0,0,0,0.25)" />
        {/* 石头渐变填充 */}
        <circle
          cx={x} cy={y} r={STONE_R}
          fill={isBlack ? `url(#grad-black)` : `url(#grad-white)`}
          stroke={isBlack ? '#1a1a1a' : '#ccc'}
          strokeWidth={1}
        />
        {/* 赢棋光环 */}
        {isWin && (
          <circle
            cx={x} cy={y} r={STONE_R - 4}
            fill="none"
            stroke={isBlack ? 'rgba(255,200,0,0.9)' : 'rgba(255,100,0,0.9)'}
            strokeWidth={2.5}
          />
        )}
      </g>
    )
  }

  return (
    <div style={{ display: 'inline-block', borderRadius: 10, overflow: 'hidden' }}>
      <svg
        width={boardPx}
        height={boardPx}
        style={{ display: 'block', cursor: canInteract ? 'crosshair' : 'default' }}
      >
        {/* 渐变 & 纹理定义 */}
        <defs>
          <radialGradient id="grad-black" cx="35%" cy="30%">
            <stop offset="0%" stopColor="#6b6b6b" />
            <stop offset="100%" stopColor="#111" />
          </radialGradient>
          <radialGradient id="grad-white" cx="35%" cy="30%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#d0d0d0" />
          </radialGradient>
          {/* 木纹纹理：用噪声滤镜模拟 */}
          <filter id="wood-filter" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.02 0.08" numOctaves="3" seed="5" result="noise" />
            <feColorMatrix type="matrix"
              values="0.3 0.2 0 0 0.5
                      0.1 0.1 0 0 0.3
                      0   0   0 0 0.1
                      0   0   0 0.15 0"
              result="coloredNoise" />
            <feBlend in="SourceGraphic" in2="coloredNoise" mode="multiply" />
          </filter>
          <pattern id="wood-pattern" x="0" y="0" width="100%" height="100%" patternUnits="userSpaceOnUse">
            <rect width="100%" height="100%" fill="transparent" filter="url(#wood-filter)" />
          </pattern>
        </defs>

        {/* 棋盘背景 */}
        <rect x={0} y={0} width={boardPx} height={boardPx} fill="#d4a355" rx={0} />
        {/* 木纹纹理 */}
        <rect x={0} y={0} width={boardPx} height={boardPx}
          fill="url(#wood-pattern)" opacity={0.3} />

        {/* 网格线 */}
        {Array.from({ length: BOARD_SIZE }, (_, i) => (
          <g key={`line-${i}`}>
            <line
              x1={PAD + i * CELL_SIZE} y1={PAD}
              x2={PAD + i * CELL_SIZE} y2={PAD + (BOARD_SIZE - 1) * CELL_SIZE}
              stroke="#8b6914" strokeWidth={i === 0 || i === BOARD_SIZE - 1 ? 1.5 : 0.8}
            />
            <line
              x1={PAD} y1={PAD + i * CELL_SIZE}
              x2={PAD + (BOARD_SIZE - 1) * CELL_SIZE} y2={PAD + i * CELL_SIZE}
              stroke="#8b6914" strokeWidth={i === 0 || i === BOARD_SIZE - 1 ? 1.5 : 0.8}
            />
          </g>
        ))}

        {/* 星位（天元+8星）*/}
        {[[3,3],[3,7],[3,11],[7,3],[7,7],[7,11],[11,3],[11,7],[11,11]].map(([r, c]) => (
          <circle
            key={`star-${r}-${c}`}
            cx={PAD + c * CELL_SIZE} cy={PAD + r * CELL_SIZE}
            r={3.5} fill="#7a5c10"
          />
        ))}

        {/* 透明点击区域矩阵 */}
        {Array.from({ length: BOARD_SIZE }, (_, row) =>
          Array.from({ length: BOARD_SIZE }, (_, col) => {
            const pos = row * BOARD_SIZE + col
            const x = PAD + col * CELL_SIZE
            const y = PAD + row * CELL_SIZE
            return (
              <rect
                key={`hit-${pos}`}
                x={x - CELL_SIZE / 2} y={y - CELL_SIZE / 2}
                width={CELL_SIZE} height={CELL_SIZE}
                fill="transparent"
                onMouseEnter={() => canInteract && grid[pos] === Cell.Empty && setHoverPos(pos)}
                onMouseLeave={() => setHoverPos(null)}
                onClick={() => handleClick(pos)}
              />
            )
          })
        )}

        {/* 棋子层 */}
        {Array.from({ length: BOARD_SIZE }, (_, row) =>
          Array.from({ length: BOARD_SIZE }, (_, col) => {
            const pos = row * BOARD_SIZE + col
            const x = PAD + col * CELL_SIZE
            const y = PAD + row * CELL_SIZE
            return renderStone(pos, x, y)
          })
        )}
      </svg>
    </div>
  )
}
