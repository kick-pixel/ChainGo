/**
 * program.ts �?Anchor 程序交互封装
 *
 * 所有与链上合约 & MagicBlock ER 的交互在此封装�? * 注意: IDL 是手写版本，部署后应替换�?anchor build 生成�?JSON�? */

import { AnchorProvider, BN, Program } from '@coral-xyz/anchor'
import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
} from '@solana/web3.js'
import {
  DELEGATION_PROGRAM_ID as SDK_DELEGATION_PROGRAM_ID,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
} from '@magicblock-labs/ephemeral-rollups-sdk'

// ─────────────────────────────────────────────
// 网络配置
// ─────────────────────────────────────────────

/** 部署后由 deploy.sh 自动替换 */
// Environment Config - read from .env.local
// Copy app/.env.example -> app/.env.local and fill in values

const DUMMY_PROGRAM_ID = '11111111111111111111111111111111'

function requireEnv(key: string, fallback: string): string {
  const val = (import.meta.env as Record<string, string>)[key]
  if (!val) {
    console.warn(`[ChainGo] env ${key} not set, using fallback`)
    return fallback
  }
  return val
}

function publicKeyEnv(key: string, fallback: PublicKey | string): PublicKey {
  const fallbackKey = typeof fallback === 'string' ? new PublicKey(fallback) : fallback
  const raw = requireEnv(key, fallbackKey.toBase58())
  try {
    return new PublicKey(raw)
  } catch {
    console.warn(`[ChainGo] env ${key} is not a valid public key, using fallback`)
    return fallbackKey
  }
}

/** Program ID - configure VITE_PROGRAM_ID in .env.local */
export const PROGRAM_ID = publicKeyEnv('VITE_PROGRAM_ID', DUMMY_PROGRAM_ID)

/** Solana base-chain RPC - configure VITE_BASE_RPC in .env.local */
export const BASE_ENDPOINT =
  (import.meta.env.VITE_BASE_RPC as string) || 'https://api.devnet.solana.com'

/** Explorer cluster label: devnet, testnet, mainnet-beta, or custom */
export const SOLANA_CLUSTER =
  (import.meta.env.VITE_SOLANA_CLUSTER as string) ||
  (BASE_ENDPOINT.includes('devnet') ? 'devnet' :
    BASE_ENDPOINT.includes('testnet') ? 'testnet' :
      BASE_ENDPOINT.includes('mainnet') ? 'mainnet-beta' : 'custom')

export const NETWORK_LABEL =
  SOLANA_CLUSTER === 'mainnet-beta' ? 'Mainnet' :
    SOLANA_CLUSTER === 'devnet' ? 'Devnet' :
      SOLANA_CLUSTER === 'testnet' ? 'Testnet' : 'Custom RPC'

function explorerClusterParam(): string {
  if (SOLANA_CLUSTER === 'mainnet-beta') return ''
  if (SOLANA_CLUSTER === 'devnet' || SOLANA_CLUSTER === 'testnet') {
    return `?cluster=${SOLANA_CLUSTER}`
  }
  return `?cluster=custom&customUrl=${encodeURIComponent(BASE_ENDPOINT)}`
}

export function explorerAddressUrl(address: PublicKey | string): string {
  const value = typeof address === 'string' ? address : address.toBase58()
  return `https://explorer.solana.com/address/${value}${explorerClusterParam()}`
}

export function explorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}${explorerClusterParam()}`
}

/** MagicBlock Ephemeral Rollup RPC - configure VITE_ER_RPC in .env.local */
export const ER_ENDPOINT =
  (import.meta.env.VITE_ER_RPC as string) || 'https://devnet-as.magicblock.app'

/** MagicBlock delegation program - configure VITE_DELEGATION_PROGRAM_ID in .env.local */
export const DELEGATION_PROGRAM_ID = publicKeyEnv(
  'VITE_DELEGATION_PROGRAM_ID',
  SDK_DELEGATION_PROGRAM_ID
)

// MagicBlock Addresses - get from https://docs.magicblock.gg/address-book
// Configure VITE_MAGIC_CONTEXT and VITE_MAGIC_PROGRAM in .env.local
export const MAGIC_CONTEXT_DEVNET = publicKeyEnv('VITE_MAGIC_CONTEXT', MAGIC_CONTEXT_ID)
export const MAGIC_PROGRAM_DEVNET = publicKeyEnv('VITE_MAGIC_PROGRAM', MAGIC_PROGRAM_ID)

/** Actions API base URL - configure VITE_ACTIONS_BASE_URL in .env.local */
export const ACTIONS_BASE_URL =
  (import.meta.env.VITE_ACTIONS_BASE_URL as string) || 'http://localhost:3000'

/** TMA frontend URL - configure VITE_TMA_URL in .env.local */
export const TMA_BASE_URL =
  (import.meta.env.VITE_TMA_URL as string) || 'http://localhost:5173'

// ─────────────────────────────────────────────
// 手写 IDL (与合�?lib.rs 保持同步)
//
// Anchor �?Rust snake_case �?TS camelCase:
//   board_p1 �?boardP1
//   current_turn �?currentTurn
//   move_count �?moveCount
// ─────────────────────────────────────────────
export const IDL = {
  version: '0.1.0',
  name: 'chain_go',
  instructions: [
    {
      name: 'createGame',
      discriminator: [124, 69, 75, 66, 184, 220, 72, 206],
      accounts: [
        { name: 'player1', writable: true, signer: true },
        { name: 'game', writable: true },
        { name: 'systemProgram' },
      ],
      args: [
        { name: 'gameId', type: 'u64' },
        { name: 'player2', type: 'pubkey' },
      ],
    },
    {
      name: 'createOpenGame',
      discriminator: [21, 197, 163, 202, 2, 248, 119, 151],
      accounts: [
        { name: 'player1', writable: true, signer: true },
        { name: 'game', writable: true },
        { name: 'systemProgram' },
      ],
      args: [{ name: 'gameId', type: 'u64' }],
    },
    {
      name: 'joinGame',
      discriminator: [107, 112, 18, 38, 56, 173, 60, 128],
      accounts: [
        { name: 'player2', signer: true },
        { name: 'game', writable: true },
      ],
      args: [],
    },
    {
      name: 'delegateGame',
      discriminator: [116, 183, 70, 107, 112, 223, 122, 210],
      accounts: [
        { name: 'payer', writable: true, signer: true },
        { name: 'game', writable: true },
        { name: 'buffer', writable: true },
        { name: 'ownerProgram' },
        { name: 'delegationRecord', writable: true },
        { name: 'delegationMetadata', writable: true },
        { name: 'delegationProgram' },
        { name: 'magicContext', writable: true },
        { name: 'systemProgram' },
      ],
      args: [],
    },
    {
      name: 'undelegateGame',
      discriminator: [40, 145, 154, 66, 48, 111, 127, 1],
      accounts: [
        { name: 'payer', writable: true, signer: true },
        { name: 'game', writable: true },
        { name: 'magicContext', writable: true },
        { name: 'magicProgram' },
      ],
      args: [],
    },
    {
      name: 'placeStone',
      discriminator: [133, 252, 207, 98, 250, 92, 129, 112],
      accounts: [
        { name: 'player', signer: true },
        { name: 'game', writable: true },
        { name: 'sessionToken', optional: true },
      ],
      args: [{ name: 'position', type: 'u8' }],
    },
    {
      name: 'claimWin',
      discriminator: [163, 215, 101, 246, 25, 134, 110, 194],
      accounts: [
        { name: 'player', signer: true },
        { name: 'game', writable: true },
        { name: 'sessionToken', optional: true },
      ],
      // FIX: Anchor 0.31 �?fixed-size array �?IDL 格式
      args: [{ name: 'positions', type: { array: ['u8', 5] } }],
    },
    {
      name: 'resign',
      discriminator: [177, 177, 153, 96, 88, 149, 206, 225],
      accounts: [
        { name: 'player', signer: true },
        { name: 'game', writable: true },
        { name: 'sessionToken', optional: true },
      ],
      args: [],
    },
  ],
  accounts: [
    {
      name: 'gameState',
      discriminator: [144, 94, 208, 172, 248, 99, 134, 120],
    },
  ],
  types: [
    {
      name: 'gameState',
      type: {
        kind: 'struct',
        fields: [
          { name: 'player1', type: 'pubkey' },
          { name: 'player2', type: 'pubkey' },
          { name: 'gameId', type: 'u64' },
          { name: 'boardP1', type: { array: ['u8', 29] } },
          { name: 'boardP2', type: { array: ['u8', 29] } },
          { name: 'currentTurn', type: 'u8' },
          { name: 'status', type: 'u8' },
          { name: 'moveCount', type: 'u8' },
          { name: 'bump', type: 'u8' },
        ],
      },
    },
  ],
  errors: [],
  // Anchor 0.31 2-arg Program: programId must be in IDL as 'address'
  address: PROGRAM_ID.toBase58(),
} as const

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────
export interface GameStateAccount {
  player1: PublicKey
  player2: PublicKey
  gameId: BN
  /** Anchor 返回 number[]，使用时�?new Uint8Array(boardP1) 转换 */
  boardP1: number[]
  boardP2: number[]
  currentTurn: number
  status: number
  moveCount: number
  bump: number
}

// ─────────────────────────────────────────────
// PDA
// ─────────────────────────────────────────────

/**
 * 计算游戏账户 PDA�? * seeds = ["game", player1.pubkey]
 * FIX: 同步版本避免 await 地方混用 async/sync
 */
export function getGamePda(player1: PublicKey, gameId: number | BN): [PublicKey, number] {
  const id = BN.isBN(gameId) ? gameId : new BN(gameId)
  const gameIdSeed = id.toArrayLike(Buffer, 'le', 8)
  return PublicKey.findProgramAddressSync(
    [Buffer.from('game'), player1.toBuffer(), gameIdSeed],
    PROGRAM_ID
  )
}

// ─────────────────────────────────────────────
// buffer PDA �?delegate_game 所需
// ⚠️ seeds 格式必须�?MagicBlock SDK 一�?// 推荐: import { getBufferPda } from '@magicblock-labs/ephemeral-rollups-sdk'
// ─────────────────────────────────────────────
function getBufferPda(gamePda: PublicKey): PublicKey {
  return delegateBufferPdaFromDelegatedAccountAndOwnerProgram(gamePda, PROGRAM_ID)
}

function getDelegationRecordPda(gamePda: PublicKey): PublicKey {
  return delegationRecordPdaFromDelegatedAccount(gamePda)
}

function getDelegationMetadataPda(gamePda: PublicKey): PublicKey {
  return delegationMetadataPdaFromDelegatedAccount(gamePda)
}

// ─────────────────────────────────────────────
// Program 工厂
// ─────────────────────────────────────────────
export function getProgram(provider: AnchorProvider): Program<any> {
  // Anchor 0.31: 2-arg constructor �?programId is read from IDL.address
  return new Program(IDL as any, provider)
}

/**
 * Anchor 0.31 �?Program 泛型推导深度过大（TS2589），
 * 对所有方法调用统一使用 `as any` 绕过，运行时行为不变�? */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function prog(provider: AnchorProvider): any {
  return getProgram(provider)
}

// ─────────────────────────────────────────────
// 交易构建
// ─────────────────────────────────────────────

/** 创建游戏 �?在基础链上执行（指定对手地址模式�?*/
export async function buildCreateGameTx(
  provider: AnchorProvider,
  player1: PublicKey,
  player2: PublicKey,
  gameId: number
): Promise<Transaction> {
  const [gamePda] = getGamePda(player1, gameId)
  return prog(provider).methods.createGame(new BN(gameId), player2)
    .accounts({ player1, game: gamePda, systemProgram: SystemProgram.programId })
    .transaction()
}

/** 创建开放游�?�?player2 为空（Pubkey::default），等待任意人接�?*/
export async function buildCreateOpenGameTx(
  provider: AnchorProvider,
  player1: PublicKey,
  gameId: number
): Promise<Transaction> {
  const [gamePda] = getGamePda(player1, gameId)
  return prog(provider).methods.createOpenGame(new BN(gameId))
    .accounts({ player1, game: gamePda, systemProgram: SystemProgram.programId })
    .transaction()
}

/** 加入游戏 �?在基础链上执行 */
export async function buildJoinGameTx(
  provider: AnchorProvider,
  gamePda: PublicKey,
  player2: PublicKey
): Promise<Transaction> {
  return prog(provider).methods.joinGame()
    .accounts({ player2, game: gamePda })
    .transaction()
}

/**
 * 委派游戏账户�?Ephemeral Rollup �?在基础链上执行
 * ⚠️ 必须�?join_game 之后调用（合约要�?status == 1�? */
export async function buildDelegateTx(
  provider: AnchorProvider,
  player1: PublicKey,
  payer: PublicKey,
  gameId: number | BN
): Promise<Transaction> {
  const [gamePda] = getGamePda(player1, gameId)
  const bufferPda = getBufferPda(gamePda)
  const delegationRecord = getDelegationRecordPda(gamePda)
  const delegationMetadata = getDelegationMetadataPda(gamePda)
  return prog(provider).methods.delegateGame()
    .accounts({
      payer,
      game: gamePda,
      buffer: bufferPda,
      ownerProgram: PROGRAM_ID,
      delegationRecord,
      delegationMetadata,
      delegationProgram: DELEGATION_PROGRAM_ID,
      magicContext: MAGIC_CONTEXT_DEVNET,
      systemProgram: SystemProgram.programId,
    })
    .transaction()
}

/**
 * 反委派游戏账户回主链 �?必须�?ER Provider 发�? * ⚠️ 注意：undelegate 必须通过 ER 网络发送，不能用主�?Provider
 */
export async function buildUndelegateTx(
  erProvider: AnchorProvider,
  player1: PublicKey,
  payer: PublicKey,
  gameId: number | BN
): Promise<Transaction> {
  const [gamePda] = getGamePda(player1, gameId)
  return prog(erProvider).methods.undelegateGame()
    .accounts({
      payer,
      game: gamePda,
      magicContext: MAGIC_CONTEXT_DEVNET,
      magicProgram: MAGIC_PROGRAM_DEVNET,
    })
    .transaction()
}

/**
 * 落子 �?通过 ER 执行（低延迟�? * provider 应使�?ER Connection
 */
export async function buildPlaceStoneTx(
  provider: AnchorProvider,
  gamePda: PublicKey,
  player: PublicKey,
  position: number,
  sessionToken?: PublicKey | null
): Promise<Transaction> {
  return prog(provider).methods.placeStone(position)
    .accounts({ player, game: gamePda, sessionToken: sessionToken ?? null })
    .transaction()
}

/**
 * 声明赢局 �?"链下算，链上�?
 * positions: 前端检测到�?个获胜坐�? */
export async function buildClaimWinTx(
  provider: AnchorProvider,
  gamePda: PublicKey,
  player: PublicKey,
  positions: number[],
  sessionToken?: PublicKey | null
): Promise<Transaction> {
  if (positions.length !== 5) {
    throw new Error(`claim_win requires exactly 5 positions; received ${positions.length}`)
  }
  return prog(provider).methods.claimWin(positions as [number, number, number, number, number])
    .accounts({ player, game: gamePda, sessionToken: sessionToken ?? null })
    .transaction()
}

/** 认输 */
export async function buildResignTx(
  provider: AnchorProvider,
  gamePda: PublicKey,
  player: PublicKey,
  sessionToken?: PublicKey | null
): Promise<Transaction> {
  return prog(provider).methods.resign()
    .accounts({ player, game: gamePda, sessionToken: sessionToken ?? null })
    .transaction()
}

// ─────────────────────────────────────────────
// 查询 & 订阅
// ─────────────────────────────────────────────

/**
 * 拉取游戏状态�? * FIX: 捕获所有异常（包括账户不存在），返�?null 而非 throw
 */
export async function fetchGameState(
  provider: AnchorProvider,
  gamePda: PublicKey
): Promise<GameStateAccount | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prog = getProgram(provider) as any
    const account = await prog.account.gameState.fetch(gamePda)
    return account as unknown as GameStateAccount
  } catch {
    return null
  }
}

/** 订阅账户变化 (WebSocket) */
export function subscribeGameState(
  connection: Connection,
  gamePda: PublicKey,
  onUpdate: (data: Buffer) => void
): number {
  return connection.onAccountChange(
    gamePda,
    (info) => onUpdate(Buffer.from(info.data)),
    'confirmed'
  )
}

/** 取消账户订阅 */
export function unsubscribeGameState(
  connection: Connection,
  subscriptionId: number
): void {
  // FIX: removeAccountChangeListener 返回 Promise，加 catch 防止未处理的 rejection
  connection.removeAccountChangeListener(subscriptionId).catch(() => {/* noop */ })
}
