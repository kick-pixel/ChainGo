﻿/**
 * Game.tsx — 主游戏组件
 *
 * 视图状态机:
 *   'lobby'  → 大厅 (创建 or 加入)
 *   'waiting'→ 等待对手 (已创建开放游戏，等 P2 加入)
 *   'game'   → 对战中
 *   'over'   → 游戏结束
 *
 * TMA 集成:
 *   - 启动时读取 URL ?game= 参数（B 从 Blink successUrl 进入）
 *   - 等待视图改为分享 Blink 按钮（@twa-dev/sdk）
 */

import React, { useState } from 'react'
import { Board } from './Board'
import { GameStatus, getStatusText } from '../utils/gomoku'
import { useGame } from '../hooks/useGame'
import { useWallet } from '@solana/wallet-adapter-react'
import {
  ACTIONS_BASE_URL,
  TMA_BASE_URL,
  NETWORK_LABEL,
  explorerAddressUrl,
  explorerTxUrl,
} from '../utils/program'

// ── @twa-dev/sdk 集成 ─────────────────────
// npm install @twa-dev/sdk
// 如果未安装，提供降级 stub
let WebApp: any = null
try {
  WebApp = require('@twa-dev/sdk').default
} catch {
  // 非 Telegram 环境，降级处理
  WebApp = {
    ready: () => {},
    expand: () => {},
    platform: 'unknown',
    initDataUnsafe: {},
    openTelegramLink: (url: string) => window.open(url, '_blank'),
  }
}

/** ChainGo Actions API 域名（需与 vercel 部署 URL 保持一致） */
// ACTIONS_BASE_URL is imported from '../utils/program' (reads VITE_ACTIONS_BASE_URL)
/** TMA URL（Vercel 部署后替换） */
// TMA_URL removed - use TMA_BASE_URL imported from '../utils/program'

type ViewState = 'lobby' | 'waiting' | 'game' | 'over'

export const Game: React.FC = () => {
  const { publicKey } = useWallet()
  const game = useGame()

  const [view, setView] = useState<ViewState>('lobby')
  const [opponentInput, setOpponentInput] = useState('')
  const [creatorInput, setCreatorInput] = useState('')
  const [creatorGameIdInput, setCreatorGameIdInput] = useState('')
  const [showResignConfirm, setShowResignConfirm] = useState(false)
  const [copiedChallenge, setCopiedChallenge] = useState(false)
  const [copiedAction, setCopiedAction] = useState(false)
  const [copiedGameId, setCopiedGameId] = useState(false)
  const [copiedProof, setCopiedProof] = useState(false)
  const autoSessionAttemptedRef = React.useRef(false)
  const statusText = getStatusText(game.status, game.isP1, game.currentTurn)

  // ── TMA 启动时读取 URL 参数 ───────────────
  // Player B 从 Blink successUrl 或 Bot start_param 进入时，自动加载游戏
  React.useEffect(() => {
    if (!publicKey) return

    // 方式1：优先从 Telegram WebApp SDK 的启动参数读取
    const startParam = WebApp?.initDataUnsafe?.start_param
    // 方式2：降级到 URL query
    const params = new URLSearchParams(window.location.search)
    const urlGameId = params.get('game')
    const urlGid = params.get('gid')
    const gameId = startParam || urlGameId
    const gid = Number(urlGid)

    if (gameId && Number.isFinite(gid) && gid > 0) {
      game.joinTmaAsPlayer2(gameId, gid).then(ok => {
        if (ok) setView('game')
      })
    }
  }, [publicKey]) // 钱包连接后执行一次

  // ── TMA 初始化 ────────────────────────────
  React.useEffect(() => {
    try {
      WebApp?.ready()
      WebApp?.expand()
    } catch {/* 非 TMA 环境忽略 */}
  }, [])

  // ── 监听游戏状态变化，自动切换视图 ─────────
  React.useEffect(() => {
    if (game.status === GameStatus.Playing && view === 'waiting') {
      setView('game')
    }
    if (game.status >= GameStatus.P1Win && view === 'game') {
      setView('over')
    }
  }, [game.status, view])

  // Once the match starts, proactively request one Session Key approval.
  // If the user rejects it, we do not spam them; they can still use the manual button.
  React.useEffect(() => {
    if (
      view === 'game' &&
      game.status === GameStatus.Playing &&
      (game.isP1 || game.isP2) &&
      !game.sessionReady &&
      !game.loading &&
      !autoSessionAttemptedRef.current
    ) {
      autoSessionAttemptedRef.current = true
      game.enableSession().catch(() => {/* error is surfaced by useGame */})
    }
  }, [view, game.status, game.isP1, game.isP2, game.sessionReady, game.loading])

  // ── 生成分享链接 ─────────────────────────
  // Primary challenge links should not depend on third-party preview services.
  // The app URL can open directly in Telegram, browsers, and wallet in-app
  // browsers, then auto-join after the opponent connects.
  const challengeUrl = publicKey && game.gameId
    ? `${TMA_BASE_URL.replace(/\/$/, '')}?game=${publicKey.toBase58()}&gid=${game.gameId}`
    : ''
  const actionUrl = publicKey && game.gameId
    ? `${ACTIONS_BASE_URL}/api/actions/join?game=${publicKey.toBase58()}&gid=${game.gameId}`
    : ''

  const shareText = 'I opened a fully on-chain ChainGo match. Accept the challenge?'
  const tgShareUrl = challengeUrl
    ? `https://t.me/share/url?url=${encodeURIComponent(challengeUrl)}&text=${encodeURIComponent(shareText)}`
    : ''

  const handleShare = () => {
    if (tgShareUrl) {
      try {
        WebApp?.openTelegramLink(tgShareUrl)
      } catch {
        window.open(tgShareUrl, '_blank')
      }
    }
  }

  const handleCopyChallenge = async () => {
    if (!challengeUrl) return
    try {
      await navigator.clipboard.writeText(challengeUrl)
      setCopiedChallenge(true)
      setTimeout(() => setCopiedChallenge(false), 2000)
    } catch {/* ignore */}
  }

  const handleCopyAction = async () => {
    if (!actionUrl) return
    try {
      await navigator.clipboard.writeText(actionUrl)
      setCopiedAction(true)
      setTimeout(() => setCopiedAction(false), 2000)
    } catch {/* ignore */}
  }

  const handleCopyGameId = async () => {
    if (!game.gameId) return
    try {
      await navigator.clipboard.writeText(String(game.gameId))
      setCopiedGameId(true)
      setTimeout(() => setCopiedGameId(false), 2000)
    } catch {/* ignore */}
  }

  // ── 大厅操作 ──────────────────────────────
  const handleCreateOpen = async () => {
    const ok = await game.createOpenGame()
    if (ok) setView('waiting')
  }

  const handleCreateDirected = async () => {
    const ok = await game.createGame(opponentInput)
    if (ok) setView('waiting')
  }

  const handleJoin = async () => {
    const ok = await game.joinGame(creatorInput, Number(creatorGameIdInput))
    if (ok) setView('game')
  }

  const handleResign = async () => {
    setShowResignConfirm(false)
    await game.resign()
  }

  const handleEnableSession = async () => {
    await game.enableSession()
  }

  const proofText = [
    'ChainGo Match Result',
    `Network: ${NETWORK_LABEL}`,
    `Game ID: ${game.gameId ?? 'unknown'}`,
    `Game PDA: ${game.gamePda?.toBase58() ?? 'unknown'}`,
    game.gamePda ? `Game Account: ${explorerAddressUrl(game.gamePda)}` : null,
    `Black: ${game.player1?.toBase58() ?? 'unknown'}`,
    `White: ${game.player2?.toBase58() ?? 'unknown'}`,
    `Result: ${statusText}`,
    `Move Count: ${game.moveCount}`,
    game.txHash && game.txNetwork === 'base'
      ? `Base-chain TX: ${explorerTxUrl(game.txHash)}`
      : null,
    game.txHash && game.txNetwork === 'er' ? `ER TX: ${game.txHash}` : null,
  ].filter(Boolean).join('\n')

  const handleCopyProof = async () => {
    try {
      await navigator.clipboard.writeText(proofText)
      setCopiedProof(true)
      setTimeout(() => setCopiedProof(false), 2000)
    } catch {/* ignore */}
  }

  const handleBackToLobby = () => {
    game.resetGame()
    setView('lobby')
    setOpponentInput('')
    setCreatorInput('')
    setCreatorGameIdInput('')
  }

  // ── 是否在 Telegram 内 ───────────────────
  const isInTelegram = WebApp?.platform && WebApp.platform !== 'unknown'

  // ──────────────────────────────────────────
  // 大厅视图
  // ──────────────────────────────────────────
  if (view === 'lobby') {
    return (
      <div className="lobby-wrap">
        <div className="lobby-header">
          <h1 className="lobby-main-title">Start A Match</h1>
          <p className="lobby-main-sub">Open a challenge or join by creator address</p>
        </div>

        <div className="lobby-cards">
          {/* 创建开放游戏（主流程） */}
          <div className="lobby-card lobby-card--create">
            <div className="card-icon">⬛</div>
            <h2 className="card-title">Open Challenge</h2>
            <p className="card-desc">Play black first · Share a Blink with any opponent</p>
            <button
              id="create-open-game-btn"
              className="btn btn-primary btn-lg"
              onClick={handleCreateOpen}
              disabled={!publicKey || game.loading}
            >
              {game.loading ? <><span className="btn-spinner" />Creating...</> : 'Open Challenge →'}
            </button>

            {/* 折叠：指定对手模式 */}
            <details className="directed-mode">
              <summary className="directed-summary">Invite a specific wallet</summary>
              <div className="input-group" style={{ marginTop: '0.75rem' }}>
                <input
                  id="opponent-input"
                  className="lobby-input"
                  placeholder="Opponent Base58 public key..."
                  value={opponentInput}
                  onChange={(e) => setOpponentInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateDirected()}
                />
                <button
                  id="create-game-btn"
                  className="btn btn-secondary"
                  onClick={handleCreateDirected}
                  disabled={!publicKey || !opponentInput.trim() || game.loading}
                  style={{ marginTop: '0.5rem', width: '100%' }}
                >
                  Invite Wallet
                </button>
              </div>
            </details>
          </div>

          <div className="lobby-or">
            <span>or</span>
          </div>

          {/* 加入游戏 */}
            <div className="lobby-card lobby-card--join">
            <div className="card-icon">⬜</div>
            <h2 className="card-title">Join Match</h2>
            <p className="card-desc">Play white second · Enter creator wallet + Game ID</p>
            <div className="input-group">
              <label className="input-label">Creator wallet address</label>
              <input
                id="creator-input"
                className="lobby-input"
                placeholder="Base58 public key..."
                value={creatorInput}
                onChange={(e) => setCreatorInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
              />
            </div>
            <div className="input-group" style={{ marginTop: '0.75rem' }}>
              <label className="input-label">Game ID</label>
              <input
                id="creator-game-id-input"
                className="lobby-input"
                placeholder="From challenge link..."
                value={creatorGameIdInput}
                onChange={(e) => setCreatorGameIdInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
              />
            </div>
            <button
              id="join-game-btn"
              className="btn btn-secondary btn-lg"
              onClick={handleJoin}
              disabled={!publicKey || !creatorInput.trim() || !creatorGameIdInput.trim() || game.loading}
            >
              {game.loading ? <><span className="btn-spinner" />Joining...</> : 'Join Match →'}
            </button>
          </div>
        </div>

        {game.error && <ErrorBanner msg={game.error} onClose={game.clearError} />}
      </div>
    )
  }

  // ──────────────────────────────────────────
  // 等待对手视图（开放匹配：分享 Blink）
  // ──────────────────────────────────────────
  if (view === 'waiting') {
    return (
      <div className="waiting-wrap">
        <div className="waiting-card">
          <div className="waiting-anim">
            <div className="pulse-ring" />
            <span className="waiting-icon">⬛</span>
          </div>
          <h2 className="waiting-title">Waiting For Opponent</h2>
          <p className="waiting-desc">
            Share the challenge link. Your opponent joins with one signature.
          </p>

          {game.gameId && (
            <div className="share-box" style={{ marginTop: '1rem' }}>
              <label className="share-label">Game ID</label>
              <div className="share-row">
                <code className="share-addr share-addr--strong">{game.gameId}</code>
                <button
                  id="copy-game-id-btn"
                  className={`btn btn-copy ${copiedGameId ? 'btn-copy--done' : ''}`}
                  onClick={handleCopyGameId}
                >
                  {copiedGameId ? 'Copied' : 'Copy ID'}
                </button>
              </div>
            </div>
          )}

          {/* 主分享按钮（Telegram 环境） */}
          {isInTelegram && (
            <button
              id="share-blink-btn"
              className="btn btn-primary btn-lg"
              onClick={handleShare}
            >
              Share To Telegram
            </button>
          )}

          {/* App challenge URL 复制（默认推荐，不依赖第三方预览服务） */}
          <div className="share-box" style={{ marginTop: '1rem' }}>
            <label className="share-label">Challenge link</label>
            <div className="share-row">
              <code className="share-addr" style={{ fontSize: '0.7rem', wordBreak: 'break-all' }}>
                {challengeUrl}
              </code>
              <button
                id="copy-challenge-btn"
                className={`btn btn-copy ${copiedChallenge ? 'btn-copy--done' : ''}`}
                onClick={handleCopyChallenge}
              >
                {copiedChallenge ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          {/* Solana Actions URL 备用：给支持 Actions/Blinks 的客户端使用 */}
          <div className="share-box share-box--muted">
            <label className="share-label">Solana Action URL</label>
            <div className="share-row">
              <code className="share-addr" style={{ fontSize: '0.7rem', wordBreak: 'break-all' }}>
                {actionUrl}
              </code>
              <button
                id="copy-action-btn"
                className={`btn btn-copy ${copiedAction ? 'btn-copy--done' : ''}`}
                onClick={handleCopyAction}
              >
                {copiedAction ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          <div className="waiting-note">
            <span className="note-dot" />
            Opponent can open the challenge link directly, or manually enter your wallet address and Game ID.
          </div>

          <button className="btn btn-ghost" onClick={handleBackToLobby}>
            Back To Lobby
          </button>
        </div>

        {game.error && <ErrorBanner msg={game.error} onClose={game.clearError} />}
      </div>
    )
  }

  // ──────────────────────────────────────────
  // 对战视图 & 结束视图 (共用棋盘)
  // ──────────────────────────────────────────
  const isOver = view === 'over'

  return (
    <div className="game-wrap">
      {/* ── 顶部状态栏 ── */}
      <div className={`status-bar ${isOver ? 'status-bar--over' : ''} ${game.isMyTurn ? 'status-bar--myturn' : ''}`}>
        <div className="status-left">
          {game.isMyTurn && !isOver && <span className="turn-indicator" />}
          <span className="status-text">{statusText}</span>
        </div>
        <div className="status-right">
          <span className="move-chip">Move {game.moveCount}</span>
          <span className="er-chip">{game.sessionReady ? 'Session Key' : 'Wallet Sign'}</span>
          <span className="er-chip">⚡ ER</span>
          {game.txHash && game.txNetwork === 'base' && (
            <a
              className="tx-chip"
              href={explorerTxUrl(game.txHash)}
              target="_blank"
              rel="noopener noreferrer"
            >
              View TX
            </a>
          )}
          {game.txHash && game.txNetwork === 'er' && (
            <span className="tx-chip" title={game.txHash}>ER TX</span>
          )}
        </div>
      </div>

      {/* ── 玩家信息行 ── */}
      <div className="players-bar">
        <PlayerBadge
          color="black"
          label="Black"
          address={game.player1?.toBase58() ?? ''}
          isMe={game.isP1}
          isActive={game.currentTurn === 0 && game.status === GameStatus.Playing}
        />
        <div className="turn-arrow">
          {game.currentTurn === 0 ? '◀' : '▶'}
        </div>
        <PlayerBadge
          color="white"
          label="White"
          address={game.player2?.toBase58() ?? ''}
          isMe={game.isP2}
          isActive={game.currentTurn === 1 && game.status === GameStatus.Playing}
        />
      </div>

      {!game.sessionReady && (
        <div className="session-note">
          <span className="note-dot" />
          <span>
            Session Key removes repeated move confirmations. If Phantom did not open automatically,
            enable it once here.
          </span>
          <button
            className="btn btn-secondary"
            onClick={handleEnableSession}
            disabled={game.loading}
          >
            Enable Session
          </button>
        </div>
      )}

      {/* ── 棋盘 ── */}
      <div className="board-area">
        <Board
          grid={game.grid}
          isMyTurn={game.isMyTurn}
          isP1={game.isP1}
          winPositions={game.winPositions}
          onPlace={game.placeStone}
          disabled={isOver || game.loading || game.status !== GameStatus.Playing}
        />

        {/* 加载遮罩（不全屏，只覆盖棋盘）*/}
        {game.loading && (
          <div className="board-loading">
            <div className="spinner" />
          </div>
        )}
      </div>

      {/* ── 游戏结束 Banner ── */}
      {isOver && (
        <div className="over-banner">
          <span className="over-emoji">
            {game.status === GameStatus.Draw ? '🤝' :
              ((game.isP1 && game.status === GameStatus.P1Win) ||
               (game.isP2 && game.status === GameStatus.P2Win) ||
               (game.isP1 && game.status === GameStatus.P2Resign) ||
               (game.isP2 && game.status === GameStatus.P1Resign)) ? '🏆' : '😔'}
          </span>
          <span className="over-text">{statusText}</span>
          {game.winPositions && (
            <span className="over-sub">
              Finished on move {game.moveCount}. Result submitted on-chain.
            </span>
          )}
        </div>
      )}

      {isOver && (
        <div className="result-proof-card">
          <div className="result-proof-head">
            <div>
              <span className="share-label">On-chain result proof</span>
              <h3>Match Receipt</h3>
            </div>
            <div className="receipt-stamp">{statusText}</div>
          </div>

          <div className="proof-grid">
            <span>Game ID</span>
            <code>{game.gameId ?? 'unknown'}</code>
            <span>Game PDA</span>
            <code title={game.gamePda?.toBase58()}>{game.gamePda?.toBase58() ?? 'unknown'}</code>
            <span>Network</span>
            <code>{NETWORK_LABEL}</code>
            <span>Players</span>
            <code title={`${game.player1?.toBase58()} vs ${game.player2?.toBase58()}`}>
              {game.player1?.toBase58().slice(0, 6)}...{game.player1?.toBase58().slice(-4)}
              {' vs '}
              {game.player2?.toBase58().slice(0, 6)}...{game.player2?.toBase58().slice(-4)}
            </code>
            <span>Moves</span>
            <code>{game.moveCount}</code>
            <span>Last TX</span>
            <code title={game.txHash ?? undefined}>
              {game.txNetwork === 'er'
                ? 'MagicBlock ER transaction'
                : game.txHash
                  ? `${NETWORK_LABEL} transaction`
                  : 'Pending'}
            </code>
          </div>

          <div className="result-proof-actions">
            <button
              className={`btn btn-copy ${copiedProof ? 'btn-copy--done' : ''}`}
              onClick={handleCopyProof}
            >
              {copiedProof ? 'Copied' : 'Copy Proof'}
            </button>
            {game.txHash && game.txNetwork === 'base' && (
              <a
                className="tx-chip"
                href={explorerTxUrl(game.txHash)}
                target="_blank"
                rel="noopener noreferrer"
              >
                View result transaction
              </a>
            )}
            {game.gamePda && (
              <a
                className="tx-chip"
                href={explorerAddressUrl(game.gamePda)}
                target="_blank"
                rel="noopener noreferrer"
              >
                View game account
              </a>
            )}
          </div>

          {game.txHash && game.txNetwork === 'er' && (
            <p className="proof-hint">
              The last action was finalized on MagicBlock ER. Use the Game Account link above to verify the settled match state on {NETWORK_LABEL}.
            </p>
          )}
        </div>
      )}

      {/* ── 操作行 ── */}
      <div className="action-row">
        {!isOver && game.status === GameStatus.Playing && (game.isP1 || game.isP2) && !showResignConfirm && (
          <button
            id="resign-btn"
            className="btn btn-danger"
            onClick={() => setShowResignConfirm(true)}
            disabled={game.loading}
          >
            Resign
          </button>
        )}

        {showResignConfirm && (
          <div className="confirm-resign">
            <span>Confirm resignation?</span>
            <button className="btn btn-danger btn-sm" onClick={handleResign}>Confirm</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowResignConfirm(false)}>Cancel</button>
          </div>
        )}

        <button className="btn btn-ghost" onClick={handleBackToLobby}>
          Back To Lobby
        </button>
      </div>

      {game.error && <ErrorBanner msg={game.error} onClose={game.clearError} />}
    </div>
  )
}

// ── 子组件 ─────────────────────────────────

const PlayerBadge: React.FC<{
  color: 'black' | 'white'
  label: string
  address: string
  isMe: boolean
  isActive: boolean
}> = ({ color, label, address, isMe, isActive }) => (
  <div className={[
    'player-badge',
    isActive ? 'player-badge--active' : '',
    isMe ? 'player-badge--me' : '',
    `player-badge--${color}`,
  ].join(' ')}>
    <div className="pb-label">{label}</div>
    {isMe && <div className="pb-you">You</div>}
    <div className="pb-addr">{address ? `${address.slice(0, 4)}...${address.slice(-4)}` : '—'}</div>
  </div>
)

const ErrorBanner: React.FC<{ msg: string; onClose: () => void }> = ({ msg, onClose }) => (
  <div className="error-banner" role="alert">
    <span>⚠ {msg}</span>
    <button onClick={onClose} aria-label="Close">×</button>
  </div>
)
