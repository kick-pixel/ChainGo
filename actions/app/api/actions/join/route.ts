/**
 * Solana Actions API — join 端点
 *
 * GET  /api/actions/join?game=<player1_pubkey>&gid=<game_id>
 *   → 返回 Blink 元数据（渲染战书卡片）
 *
 * POST /api/actions/join?game=<player1_pubkey>&gid=<game_id>
 *   → 构造 join_game TX 返回给前端签名
 *   → 包含 Race Condition 防护（status != 0 则拒绝）
 *
 * OPTIONS /api/actions/join
 *   → CORS preflight
 *
 * 部署说明:
 *   1. vercel --prod 获得 URL
 *   2. 替换下方 PROGRAM_ID 为已部署合约的真实地址
 *   3. 替换 TMA_URL 为已部署的 TMA URL
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js'

// ─────────────────────────────────────────────
// 配置（部署后替换）
// ─────────────────────────────────────────────
// ── Config from environment variables (.env.local) ──────────────────
// Next.js reads process.env.* from .env.local automatically
const RPC = process.env.RPC_URL || 'https://api.devnet.solana.com'
const DUMMY_PROGRAM_ID = '11111111111111111111111111111111'
const TMA_URL = process.env.TMA_URL || 'http://localhost:5173'
const ACTIONS_URL = process.env.ACTIONS_URL || 'http://localhost:3000'

function publicKeyFromEnv(key: string, fallback: string): PublicKey {
  const raw = process.env[key] || fallback
  try {
    return new PublicKey(raw)
  } catch {
    console.warn(`[ChainGo Actions] ${key} is not a valid public key, using fallback`)
    return new PublicKey(fallback)
  }
}

const PROGRAM_ID = publicKeyFromEnv('PROGRAM_ID', DUMMY_PROGRAM_ID)

// ─────────────────────────────────────────────
// 辅助函数
// ─────────────────────────────────────────────

/** 计算游戏账户 PDA */
function getGamePda(player1: PublicKey, gameId: bigint): PublicKey {
  const gameIdSeed = Buffer.alloc(8)
  gameIdSeed.writeBigUInt64LE(gameId)
  return PublicKey.findProgramAddressSync(
    [Buffer.from('game'), player1.toBuffer(), gameIdSeed],
    PROGRAM_ID
  )[0]
}

/**
 * join_game 指令 discriminator
 * 计算方式: sha256("global:join_game").slice(0, 8)
 *
 * Verified with:
 *   node -e "const c=require('crypto');console.log([...c.createHash('sha256').update('global:join_game').digest().slice(0,8)])"
 */
const JOIN_GAME_DISCRIMINATOR = Buffer.from([107, 112, 18, 38, 56, 173, 60, 128])

// ─────────────────────────────────────────────
// CORS helper
// ─────────────────────────────────────────────
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept-Encoding',
    'Content-Type': 'application/json',
    'X-Action-Version': '2.2.1',
    'X-Blockchain-Ids': 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
  }
}

function actionError(message: string, status: number) {
  return NextResponse.json({ message }, { status, headers: corsHeaders() })
}

// ─────────────────────────────────────────────
// GET — 渲染 Blink 战书卡片
// ─────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const gameId = req.nextUrl.searchParams.get('game')
  const gidParam = req.nextUrl.searchParams.get('gid')
  if (!gameId) {
    return actionError('Missing game param', 400)
  }
  if (!gidParam) {
    return actionError('Missing gid param', 400)
  }

  // 验证 gameId 是合法 pubkey
  let player1Pubkey: PublicKey
  try {
    player1Pubkey = new PublicKey(gameId)
  } catch {
    return actionError('Invalid game id', 400)
  }

  let gid: bigint
  try {
    gid = BigInt(gidParam)
  } catch {
    return actionError('Invalid gid', 400)
  }

  // 从链上读取游戏状态（可选，增强卡片信息）
  let gameExists = false
  try {
    const conn = new Connection(RPC)
    const gamePda = getGamePda(player1Pubkey, gid)
    const accountInfo = await conn.getAccountInfo(gamePda)
    gameExists = accountInfo !== null
  } catch {
    // RPC 失败时降级显示静态卡片
  }

  const shortId = gameId.slice(0, 6)

  return NextResponse.json({
    // 注意：Blinks 客户端要求 icon 为 PNG/JPG/GIF，不支持 SVG
    // 如无法转换 SVG，可用外部图片服务或直接 base64 嵌入 PNG
    icon: `${ACTIONS_URL}/og-card.svg`,
    title: 'ChainGo Gomoku Challenge',
    description: gameExists
      ? `${shortId}... has opened a fully on-chain Gomoku match. Join with one signature, then play at sub-second speed on MagicBlock ER.`
      : `${shortId}... opened a ChainGo challenge.`,
    label: 'Accept Challenge',
    links: {
      actions: [
        {
          label: 'Accept Challenge',
          href: `/api/actions/join?game=${gameId}&gid=${gidParam}`,
        },
      ],
    },
  }, { headers: corsHeaders() })
}

// ─────────────────────────────────────────────
// OPTIONS — CORS preflight
// ─────────────────────────────────────────────
export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders() })
}

// ─────────────────────────────────────────────
// POST — 构造 join_game TX 返回给前端签名
// ─────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const gameId = req.nextUrl.searchParams.get('game')
    const gidParam = req.nextUrl.searchParams.get('gid')
    if (!gameId) {
      return actionError('Missing game param', 400)
    }
    if (!gidParam) {
      return actionError('Missing gid param', 400)
    }

    // 解析请求体
    const body = await req.json()
    if (!body.account) {
      return actionError('Missing account field', 400)
    }

    let player2Pubkey: PublicKey
    let player1Pubkey: PublicKey
    try {
      player2Pubkey = new PublicKey(body.account)
      player1Pubkey = new PublicKey(gameId)
    } catch {
      return actionError('Invalid public key format', 400)
    }

    let gid: bigint
    try {
      gid = BigInt(gidParam)
    } catch {
      return actionError('Invalid gid', 400)
    }

    const conn = new Connection(RPC, 'confirmed')
    const gamePda = getGamePda(player1Pubkey, gid)

    // ── Race Condition 防护 ─────────────────
    // GameState 内存布局（按 lib.rs 定义）:
    //   offset 0:     8 bytes  discriminator
    //   offset 8:     32 bytes player1: Pubkey
    //   offset 40:    32 bytes player2: Pubkey
    //   offset 72:    8 bytes  game_id: u64
    //   offset 80:    29 bytes board_p1: [u8; 29]
    //   offset 109:   29 bytes board_p2: [u8; 29]
    //   offset 138:   1 byte   current_turn: u8
    //   offset 139:   1 byte   status: u8   ← 在此读取
    const accountInfo = await conn.getAccountInfo(gamePda)
    if (!accountInfo) {
      return actionError('Game not found. It may have been cancelled.', 404)
    }

    const status = accountInfo.data[139]
    if (status !== 0) {
      return actionError('This game has already started or ended.', 400)
    }

    // ── 构造 join_game TX ──────────────────
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: player2Pubkey, isSigner: true, isWritable: false },
        { pubkey: gamePda, isSigner: false, isWritable: true },
      ],
      data: JOIN_GAME_DISCRIMINATOR,
    })

    const { blockhash } = await conn.getLatestBlockhash()
    const tx = new Transaction()
    tx.add(ix)
    tx.recentBlockhash = blockhash
    tx.feePayer = player2Pubkey
    // 注意：服务端不签名，由用户钱包签名

    const tmaUrl = `${TMA_URL}?game=${gameId}&gid=${gidParam}`

    return NextResponse.json({
      transaction: Buffer.from(
        tx.serialize({ requireAllSignatures: false })
      ).toString('base64'),
      // message 是兜底：旧版钱包客户端不支持 links.next 时显示此文本
      message: `Challenge accepted. Open ChainGo to start playing: ${tmaUrl}`,
      links: {
        next: {
          type: 'post',
          href: `/api/actions/join/complete?game=${gameId}&gid=${gidParam}`,
        },
      },
    }, { headers: corsHeaders() })
  } catch (e: any) {
    console.error('[POST /api/actions/join]', e)
    return actionError(e.message ?? 'Internal server error', 500)
  }
}
