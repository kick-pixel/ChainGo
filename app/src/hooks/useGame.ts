/**
 * useGame.ts — 游戏状态管理 Hook
 *
 * 整合 Anchor + MagicBlock 的状态管理，提供:
 *  - 创建/加入游戏（含开放匹配模式）
 *  - 落子 (通过 ER 实现低延迟 + 乐观更新)
 *  - 赢局声明 ("链下算，链上验")
 *  - 实时状态同步 (WebSocket)
 *  - 主链轮询（Player A 等待 B 加入 + 自动 delegate）
 *  - localStorage 游戏恢复
 *
 * Privy 集成说明:
 *   如使用 Privy Embedded Wallet，需将 useAnchorWallet 替换为
 *   useSolanaWallets()（来自 @privy-io/react-auth 或 @privy-io/solana）。
 *   详见 B-3 注释。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAnchorWallet, useConnection, useWallet } from '@solana/wallet-adapter-react'
import { AnchorProvider } from '@coral-xyz/anchor'
import { Connection, PublicKey, Transaction } from '@solana/web3.js'
import { useSessionKeyManager } from '@magicblock-labs/gum-react-sdk'
import bs58 from 'bs58'
import {
  Cell,
  GameStatus,
  bitboardsToGrid,
  detectWin,
  verifyWinLine,
} from '../utils/gomoku'
import {
  GameStateAccount,
  BASE_ENDPOINT,
  ER_ENDPOINT,
  buildCreateGameTx,
  buildCreateOpenGameTx,
  buildJoinGameTx,
  buildDelegateTx,
  buildUndelegateTx,
  buildPlaceStoneTx,
  buildClaimWinTx,
  buildResignTx,
  fetchGameState,
  getGamePda,
  PROGRAM_ID,
  subscribeGameState,
  unsubscribeGameState,
} from '../utils/program'

// ─────────────────────────────────────────────
// localStorage 键 & 存储结构
// ─────────────────────────────────────────────
const LS_KEY = 'chaingo:currentGame'
const LS_TTL = 30 * 60 * 1000 // 30 分钟
const SESSION_TOP_UP_LAMPORTS = 5_000_000 // 0.005 SOL, enough for devnet/ER gameplay tests.
const SESSION_EXPIRY_MINUTES = 60

interface SavedGame {
  gamePda: string
  player1: string
  gameId: number
  timestamp: number
}

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────
export interface GameHookState {
  grid: Cell[]
  status: GameStatus
  currentTurn: number
  moveCount: number
  player1: PublicKey | null
  player2: PublicKey | null
  gamePda: PublicKey | null
  gameId: number | null
  winPositions: number[] | null
  isP1: boolean
  isP2: boolean
  isMyTurn: boolean
  sessionReady: boolean
  sessionPublicKey: PublicKey | null
  loading: boolean
  error: string | null
  txHash: string | null
  txNetwork: 'base' | 'er' | null
  enableSession: () => Promise<boolean>
  // actions — 返回 true 表示成功
  createGame: (opponentAddress: string) => Promise<boolean>
  createOpenGame: () => Promise<boolean>
  joinGame: (creatorAddress: string, gameId: number) => Promise<boolean>
  joinTmaAsPlayer2: (player1Address: string, gameId: number) => Promise<boolean>
  placeStone: (position: number) => Promise<void>
  resign: () => Promise<void>
  resetGame: () => void
  clearError: () => void
}

// ─────────────────────────────────────────────
// Hook 实现
// ─────────────────────────────────────────────
export function useGame(): GameHookState {
  const { connection } = useConnection()
  const anchorWallet = useAnchorWallet()
  const { connected } = useWallet()
  const wallet = connected ? anchorWallet : null
  const sessionWallet = useSessionKeyManager(anchorWallet as any, connection, 'devnet')
  // ─── Privy 集成（B-3）─────────────────────
  // 若使用 Privy，取消下面注释，并注释掉上方的 useAnchorWallet：
  //
  // import { useSolanaWallets } from '@privy-io/react-auth'
  // const { wallets } = useSolanaWallets()
  // const privyWallet = wallets[0]
  // const wallet = privyWallet ? {
  //   publicKey: new PublicKey(privyWallet.address),
  //   signTransaction: (tx: Transaction) => privyWallet.signTransaction(tx),
  //   signAllTransactions: (txs: Transaction[]) => privyWallet.signAllTransactions(txs),
  // } : null
  // ──────────────────────────────────────────

  // 游戏状态
  const [grid, setGrid] = useState<Cell[]>(new Array(225).fill(Cell.Empty))
  const [status, setStatus] = useState<GameStatus>(GameStatus.WaitingP2)
  const [currentTurn, setCurrentTurn] = useState(0)
  const [moveCount, setMoveCount] = useState(0)
  const [player1, setPlayer1] = useState<PublicKey | null>(null)
  const [player2, setPlayer2] = useState<PublicKey | null>(null)
  const [gamePda, setGamePda] = useState<PublicKey | null>(null)
  const [gameId, setGameId] = useState<number | null>(null)
  const [winPositions, setWinPositions] = useState<number[] | null>(null)

  // UI 状态
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [txNetwork, setTxNetwork] = useState<'base' | 'er' | null>(null)

  // refs — 避免闭包陷阱
  const subscriptionRef = useRef<number | null>(null)
  const erConnectionRef = useRef<Connection | null>(null)
  const gamePdaRef = useRef<PublicKey | null>(null)
  const isP1Ref = useRef(false)
  const mainnetPollerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── 派生状态 ──────────────────────────────
  const myKey = wallet?.publicKey ?? null
  const isP1 = myKey !== null && player1 !== null && myKey.equals(player1)
  const isP2 = myKey !== null && player2 !== null && myKey.equals(player2)
  const isMyTurn = status === GameStatus.Playing &&
    ((isP1 && currentTurn === 0) || (isP2 && currentTurn === 1))
  const sessionReady = Boolean(sessionWallet.sessionToken && sessionWallet.publicKey)
  const sessionPublicKey = sessionWallet.publicKey

  // 保持 ref 同步，供回调内使用
  useEffect(() => { gamePdaRef.current = gamePda }, [gamePda])
  useEffect(() => { isP1Ref.current = isP1 }, [isP1])

  // ── Connection 工厂 ──────────────────────
  const getErConn = useCallback((): Connection => {
    if (!erConnectionRef.current) {
      erConnectionRef.current = new Connection(ER_ENDPOINT, 'confirmed')
    }
    return erConnectionRef.current
  }, [])

  // ── Provider 工厂 ─────────────────────────
  /** ER Provider — 用于 place_stone / claim_win / resign / undelegate */
  const getErProvider = useCallback(
    (): AnchorProvider => {
      if (!wallet) throw new Error('Connect a wallet first')
      return new AnchorProvider(getErConn(), wallet, {
        commitment: 'confirmed',
        skipPreflight: true,  // ER 必须 skipPreflight
      })
    },
    [wallet, getErConn]
  )

  /** 主链 Provider — 用于 create/join/delegate + 主链轮询 */
  const getBaseProvider = useCallback((): AnchorProvider => {
    if (!wallet) throw new Error('Connect a wallet first')
    return new AnchorProvider(
      new Connection(BASE_ENDPOINT, 'confirmed'),
      wallet,
      { commitment: 'confirmed' }
    )
  }, [wallet])

  // 兼容旧代码，默认返回主链 Provider
  const getProvider = useCallback(
    (conn?: Connection): AnchorProvider => {
      if (!wallet) throw new Error('Connect a wallet first')
      return new AnchorProvider(conn ?? connection, wallet, { commitment: 'confirmed' })
    },
    [wallet, connection]
  )

  // ── 状态应用 ─────────────────────────────
  const applyGameState = useCallback(
    (account: GameStateAccount, pda: PublicKey) => {
      const newGrid = bitboardsToGrid(
        new Uint8Array(account.boardP1),
        new Uint8Array(account.boardP2)
      )
      setPlayer1(account.player1)
      setPlayer2(account.player2)
      setGamePda(pda)
      setGameId(account.gameId.toNumber())
      setGrid(newGrid)
      setCurrentTurn(account.currentTurn)
      setStatus(account.status as GameStatus)
      setMoveCount(account.moveCount)
    },
    []
  )

  // ── ER WebSocket 订阅 ─────────────────────
  const startErSubscription = useCallback(
    (pda: PublicKey) => {
      const erConn = getErConn()
      if (subscriptionRef.current !== null) {
        unsubscribeGameState(erConn, subscriptionRef.current)
      }
      subscriptionRef.current = subscribeGameState(erConn, pda, (_data) => {
        // 账户变化时重新拉取并应用状态
        fetchGameState(getErProvider(), pda)
          .then((acc) => { if (acc) applyGameState(acc, pda) })
          .catch(() => {/* ignore */})
      })
    },
    [getErConn, getErProvider, applyGameState]
  )

  // 兼容旧名称
  const startSubscription = startErSubscription

  // ── 主链轮询 ─────────────────────────────
  /**
   * Player A 在 create_open_game 成功后开启主链轮询，
   * 等待 B 调用 join_game 使 status 变为 1，然后自动 delegate。
   */
  const startMainnetPolling = useCallback((pda: PublicKey, p1: PublicKey) => {
    if (mainnetPollerRef.current) clearInterval(mainnetPollerRef.current)

    mainnetPollerRef.current = setInterval(async () => {
      try {
        const acc = await fetchGameState(getBaseProvider(), pda)
        if (acc && acc.status === 1) {
          // 先停止轮询
          clearInterval(mainnetPollerRef.current!)
          mainnetPollerRef.current = null

          try {
            // B 加入后，才能调用 delegate（合约要求 status == 1）
            const delegateTx = await buildDelegateTx(
              getBaseProvider(), p1, wallet!.publicKey, acc.gameId
            )
            await sendBaseTx(delegateTx)
            startErSubscription(pda)
            applyGameState(acc, pda)
          } catch (e: any) {
            const message = e?.message ?? 'Unknown wallet error'
            const alreadyProcessed = message.toLowerCase().includes('already been processed')
            const isWalletDisconnected =
              message.toLowerCase().includes('not connected') ||
              message.toLowerCase().includes('user rejected')

            if (alreadyProcessed) {
              setError(null)
              startErSubscription(pda)
              applyGameState(acc, pda)
              return
            }

            if (isWalletDisconnected) {
              setError(
                `Failed to delegate to ER: ${message}. Reconnect Player A wallet, then create a new challenge.`
              )
              return
            }

            setError(`Failed to delegate to ER: ${message}. Retrying in 5 seconds.`)
            // 使用 setTimeout 避免递归导致的调用栈问题
            setTimeout(() => startMainnetPolling(pda, p1), 5000)
          }
        }
      } catch (fetchErr: any) {
        // 主链 RPC 请求失败时不中断轮询，静默重试
        console.warn('Base-chain state fetch failed, retrying:', fetchErr.message)
      }
    }, 2000)
  }, [getBaseProvider, wallet, startErSubscription, applyGameState])

  // ── 基础链发送 ────────────────────────────
  const sendBaseTx = useCallback(
    async (tx: Transaction): Promise<string> => {
      if (!wallet) throw new Error('Wallet is not connected')
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash('confirmed')
      tx.recentBlockhash = blockhash
      tx.feePayer = wallet.publicKey
      const signed = await wallet.signTransaction(tx)
      const signature = signed.signature
      if (!signature) throw new Error('Signed transaction is missing a signature')
      const sig = bs58.encode(signature)

      try {
        await connection.sendRawTransaction(signed.serialize())
      } catch (e: any) {
        const message = e?.message ?? ''
        if (!message.toLowerCase().includes('already been processed')) {
          throw e
        }
      }

      await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        'confirmed'
      )
      return sig
    },
    [wallet, connection]
  )

  // ── ER 发送 ──────────────────────────────
  const sendErTx = useCallback(
    async (tx: Transaction): Promise<string> => {
      if (!wallet) throw new Error('Wallet is not connected')
      const erConn = getErConn()
      const { blockhash, lastValidBlockHeight } =
        await erConn.getLatestBlockhash('confirmed')
      tx.recentBlockhash = blockhash
      tx.feePayer = wallet.publicKey
      const signed = await wallet.signTransaction(tx)
      const sig = await erConn.sendRawTransaction(signed.serialize(), {
        skipPreflight: true,
      })
      await erConn.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        'confirmed'
      )
      return sig
    },
    [wallet, getErConn]
  )

  const ensureSession = useCallback(async (): Promise<{ publicKey: PublicKey; token: PublicKey } | null> => {
    if (!wallet?.publicKey) {
      setError('Connect a wallet first')
      return null
    }

    if (sessionWallet.publicKey && sessionWallet.sessionToken) {
      return {
        publicKey: sessionWallet.publicKey,
        token: new PublicKey(sessionWallet.sessionToken),
      }
    }

    try {
      const created = await sessionWallet.createSession(
        PROGRAM_ID,
        SESSION_TOP_UP_LAMPORTS,
        SESSION_EXPIRY_MINUTES
      )
      if (created?.publicKey && created.sessionToken) {
        return {
          publicKey: created.publicKey,
          token: new PublicKey(created.sessionToken),
        }
      }
      setError('Session key was not created')
      return null
    } catch (e: any) {
      setError(e.message ?? 'Failed to create session key')
      return null
    }
  }, [wallet, sessionWallet])

  const enableSession = useCallback(async (): Promise<boolean> => {
    const session = await ensureSession()
    return Boolean(session)
  }, [ensureSession])

  const sendSessionErTx = useCallback(
    async (tx: Transaction, feePayer: PublicKey): Promise<string> => {
      if (!sessionWallet.signTransaction) {
        throw new Error('Session key is not ready')
      }
      const erConn = getErConn()
      const { blockhash, lastValidBlockHeight } =
        await erConn.getLatestBlockhash('confirmed')
      tx.recentBlockhash = blockhash
      tx.feePayer = feePayer
      const signed = await sessionWallet.signTransaction(tx, erConn, {
        skipPreflight: true,
        preflightCommitment: 'confirmed',
      })
      const sig = await erConn.sendRawTransaction(signed.serialize(), {
        skipPreflight: true,
      })
      await erConn.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        'confirmed'
      )
      return sig
    },
    [sessionWallet, getErConn]
  )

  // ── localStorage 操作 ─────────────────────
  const saveGameToStorage = useCallback((pda: PublicKey, p1: PublicKey, gameId: number) => {
    try {
      const saved: SavedGame = {
        gamePda: pda.toBase58(),
        player1: p1.toBase58(),
        gameId,
        timestamp: Date.now(),
      }
      localStorage.setItem(LS_KEY, JSON.stringify(saved))
    } catch {/* localStorage 可能在某些环境不可用 */}
  }, [])

  const clearGameFromStorage = useCallback(() => {
    try { localStorage.removeItem(LS_KEY) } catch {/* noop */}
  }, [])

  // ── 公开操作 ──────────────────────────────

  /** 创建游戏（指定对手） — 返回 true 表示成功 */
  const createGame = useCallback(
    async (opponentAddress: string): Promise<boolean> => {
      if (!wallet?.publicKey) { setError('Connect a wallet first'); return false }
      setLoading(true); setError(null)
      try {
        const opponent = new PublicKey(opponentAddress)
        const gameId = Date.now()
        const provider = getBaseProvider()
        const tx = await buildCreateGameTx(provider, wallet.publicKey, opponent, gameId)
        const sig = await sendBaseTx(tx)
        setTxHash(sig); setTxNetwork('base')

        const [pda] = getGamePda(wallet.publicKey, gameId)
        const acc = await fetchGameState(provider, pda)
        if (acc) {
          applyGameState(acc, pda)
          saveGameToStorage(pda, wallet.publicKey, gameId)
          startMainnetPolling(pda, wallet.publicKey)
        }
        return true
      } catch (e: any) {
        setError(e.message ?? 'Failed to create game')
        return false
      } finally {
        setLoading(false)
      }
    },
    [wallet, getBaseProvider, sendBaseTx, applyGameState, saveGameToStorage, startMainnetPolling]
  )

  /**
   * 创建开放游戏 — 无需指定对手，等待任意人接单
   * 成功后开启主链轮询，检测到 B 加入后自动 delegate
   */
  const createOpenGame = useCallback(async (): Promise<boolean> => {
    if (!wallet?.publicKey) { setError('Connect a wallet first'); return false }
    setLoading(true); setError(null)
    try {
      const gameId = Date.now()
      const provider = getBaseProvider()
      const tx = await buildCreateOpenGameTx(provider, wallet.publicKey, gameId)
      const sig = await sendBaseTx(tx)
      setTxHash(sig); setTxNetwork('base')

      const [pda] = getGamePda(wallet.publicKey, gameId)
      const acc = await fetchGameState(provider, pda)
      if (acc) {
        applyGameState(acc, pda)
        // 保存到 localStorage，防止 A 强退后状态丢失
        saveGameToStorage(pda, wallet.publicKey, gameId)
        // 开启主链轮询，等待 B 加入（B 加入后自动 delegate）
        startMainnetPolling(pda, wallet.publicKey)
      }
      return true
    } catch (e: any) {
      setError(e.message ?? 'Failed to create open challenge')
      return false
    } finally {
      setLoading(false)
    }
  }, [wallet, getBaseProvider, sendBaseTx, applyGameState, saveGameToStorage, startMainnetPolling])

  /** 加入游戏（前端直接调用，用于非 Blink 路径）— 返回 true 表示成功 */
  const joinGame = useCallback(
    async (creatorAddress: string, gameId: number): Promise<boolean> => {
      if (!wallet?.publicKey) { setError('Connect a wallet first'); return false }
      if (!Number.isFinite(gameId) || gameId <= 0) {
        setError('Enter the challenge game ID')
        return false
      }
      setLoading(true); setError(null)
      try {
        const creator = new PublicKey(creatorAddress)
        const [pda] = getGamePda(creator, gameId)
        const provider = getProvider()
        const tx = await buildJoinGameTx(provider, pda, wallet.publicKey)
        const sig = await sendBaseTx(tx)
        setTxHash(sig); setTxNetwork('base')

        const acc = await fetchGameState(provider, pda)
        if (acc) { applyGameState(acc, pda); startSubscription(pda) }
        return true
      } catch (e: any) {
        try {
          const creator = new PublicKey(creatorAddress)
          const [pda] = getGamePda(creator, gameId)
          const provider = getProvider()
          const acc = await fetchGameState(provider, pda)
          if (
            acc &&
            acc.status === GameStatus.Playing &&
            wallet.publicKey.equals(acc.player2)
          ) {
            applyGameState(acc, pda)
            startSubscription(pda)
            return true
          }
        } catch {
          // Fall through to the original join error.
        }
        setError(e.message ?? 'Failed to join game')
        return false
      } finally {
        setLoading(false)
      }
    },
    [wallet, getProvider, sendBaseTx, applyGameState, startSubscription]
  )

  /**
   * B 通过 Blink successUrl 或 Bot start_param 进入 TMA 后加载游戏状态。
   * 无需链上操作（B 已在 Blink 里签名 join_game），只需拉取状态并启动订阅。
   */
  const joinTmaAsPlayer2 = useCallback(async (player1Address: string, gameId: number): Promise<boolean> => {
    try {
      const creator = new PublicKey(player1Address)
      const [pda] = getGamePda(creator, gameId)
      const acc = await fetchGameState(getBaseProvider(), pda)
      if (acc && acc.status === 1) {
        applyGameState(acc, pda)
        startErSubscription(pda)
        return true
      }
      return false
    } catch (e: any) {
      setError(e.message ?? 'Failed to load game state')
      return false
    }
  }, [getBaseProvider, applyGameState, startErSubscription])

  /** 落子 (ER 低延迟 + 乐观更新 + 自动 claim_win + undelegate) */
  const placeStone = useCallback(
    async (position: number): Promise<void> => {
      const pda = gamePdaRef.current
      if (!wallet?.publicKey || !pda) return
      if (!isMyTurn) { setError('It is not your turn'); return }
      if (grid[position] !== Cell.Empty) { setError('This cell is already occupied'); return }

      setLoading(true); setError(null)
      try {
        const session = await ensureSession()
        if (!session) return

        const tx = await buildPlaceStoneTx(
          getErProvider(),
          pda,
          session.publicKey,
          position,
          session.token
        )
        const sig = await sendSessionErTx(tx, session.publicKey)
        setTxHash(sig); setTxNetwork('er')

        // 乐观更新本地棋盘
        const myCell = isP1Ref.current ? Cell.P1 : Cell.P2
        const newGrid = [...grid]
        newGrid[position] = myCell
        setGrid(newGrid)

        const newMoveCount = moveCount + 1
        const win = detectWin(newGrid, position, myCell)

        if (win && verifyWinLine(win)) {
          // 先展示赢棋，再异步 claim + undelegate
          setWinPositions(win)
          setStatus(isP1Ref.current ? GameStatus.P1Win : GameStatus.P2Win)
          clearGameFromStorage()

          // claim_win → undelegate（链式调用）
          buildClaimWinTx(getErProvider(), pda, session.publicKey, win, session.token)
            .then((claimTx) => sendSessionErTx(claimTx, session.publicKey))
            .then((claimSig) => {
              setTxHash(claimSig)
              setTxNetwork('er')
            })
            .then(() => {
              // 获取 player1 地址用于构建 undelegate TX
              const p1 = player1
              if (p1 && gameId !== null) {
                return buildUndelegateTx(getErProvider(), p1, wallet.publicKey, gameId)
              }
            })
            .then((undelegateTx) => undelegateTx && sendErTx(undelegateTx))
            .then((undelegateSig) => {
              if (undelegateSig) {
                setTxHash(undelegateSig)
                setTxNetwork('er')
              }
            })
            .catch((e: any) => setError(`Failed to claim or settle win: ${e.message}`))
        } else if (newMoveCount >= 225) {
          setStatus(GameStatus.Draw)
          clearGameFromStorage()
        } else {
          setCurrentTurn((t) => 1 - t)
          setMoveCount(newMoveCount)
        }
      } catch (e: any) {
        setError(e.message ?? 'Failed to place stone')
      } finally {
        setLoading(false)
      }
    },
    [wallet, grid, isMyTurn, moveCount, player1, gameId, getErProvider, sendErTx, sendSessionErTx, ensureSession, clearGameFromStorage]
  )

  /** 认输 — 认输后调用 undelegate */
  const resign = useCallback(async (): Promise<void> => {
    const pda = gamePdaRef.current
    if (!wallet?.publicKey || !pda) return
    setLoading(true); setError(null)
    try {
      const session = await ensureSession()
      if (!session) return

      const tx = await buildResignTx(getErProvider(), pda, session.publicKey, session.token)
      await sendSessionErTx(tx, session.publicKey)
      setStatus(isP1Ref.current ? GameStatus.P1Resign : GameStatus.P2Resign)
      clearGameFromStorage()

      // 认输后调用 undelegate
      const p1 = player1
      if (p1 && gameId !== null) {
        buildUndelegateTx(getErProvider(), p1, wallet.publicKey, gameId)
          .then(sendErTx)
          .catch((e: any) => setError(`Failed to undelegate: ${e.message}`))
      }
    } catch (e: any) {
      setError(e.message ?? 'Failed to resign')
    } finally {
      setLoading(false)
    }
  }, [wallet, player1, gameId, getErProvider, sendErTx, sendSessionErTx, ensureSession, clearGameFromStorage])

  /** 重置回大厅状态 */
  const resetGame = useCallback(() => {
    // 停止主链轮询
    if (mainnetPollerRef.current) {
      clearInterval(mainnetPollerRef.current)
      mainnetPollerRef.current = null
    }
    // 停止 ER 订阅
    const erConn = erConnectionRef.current
    if (subscriptionRef.current !== null && erConn) {
      unsubscribeGameState(erConn, subscriptionRef.current)
      subscriptionRef.current = null
    }
    setGrid(new Array(225).fill(Cell.Empty))
    setStatus(GameStatus.WaitingP2)
      setCurrentTurn(0); setMoveCount(0)
      setPlayer1(null); setPlayer2(null); setGamePda(null); setGameId(null)
    setWinPositions(null); setError(null); setTxHash(null); setTxNetwork(null)
    clearGameFromStorage()
  }, [clearGameFromStorage])

  const clearError = useCallback(() => setError(null), [])

  // ── TMA 启动时恢复游戏状态 ───────────────
  useEffect(() => {
    // 尝试从 localStorage 恢复（仅在未进入游戏时）
    if (status !== GameStatus.WaitingP2 || !wallet?.publicKey) return
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (!raw) return
      const saved: SavedGame = JSON.parse(raw)
      // 超过 30 分钟的对局视为已过期
      if (Date.now() - saved.timestamp > LS_TTL) {
        localStorage.removeItem(LS_KEY)
        return
      }
      // 只恢复属于当前钱包的游戏
      if (saved.player1 !== wallet.publicKey.toBase58()) return
      const pda = new PublicKey(saved.gamePda)
      const p1 = new PublicKey(saved.player1)
      if (!saved.gameId) return
      fetchGameState(getBaseProvider(), pda).then(acc => {
        if (!acc) return
        if (acc.status === 0) {
          // B 未加入，恢复轮询
          applyGameState(acc, pda)
          startMainnetPolling(pda, p1)
        } else if (acc.status === 1) {
          // 游戏进行中，恢复 ER 订阅
          applyGameState(acc, pda)
          startErSubscription(pda)
        }
      })
    } catch {/* ignore parse errors */}
  }, [wallet?.publicKey]) // 仅在钱包连接时触发一次

  // ── 清理 ──────────────────────────────────
  useEffect(() => {
    return () => {
      if (mainnetPollerRef.current) clearInterval(mainnetPollerRef.current)
      const erConn = erConnectionRef.current
      if (subscriptionRef.current !== null && erConn) {
        unsubscribeGameState(erConn, subscriptionRef.current)
      }
    }
  }, [])

  return {
    grid, status, currentTurn, moveCount,
    player1, player2, gamePda, gameId, winPositions,
    isP1, isP2, isMyTurn,
    sessionReady, sessionPublicKey,
    loading, error, txHash, txNetwork,
    enableSession,
    createGame, createOpenGame, joinGame, joinTmaAsPlayer2,
    placeStone, resign, resetGame, clearError,
  }
}
