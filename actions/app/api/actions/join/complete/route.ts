/**
 * 完成卡片端点
 *
 * POST /api/actions/join/complete?game=<player1_pubkey>&gid=<game_id>
 *
 * 钱包客户端（如 Phantom）在用户签名 join_game 成功后，
 * 自动请求此端点（通过 links.next），渲染"完成"状态卡片。
 * 旧版客户端忽略 links.next，只显示 POST 响应中的 message 字段。
 */

import { NextRequest, NextResponse } from 'next/server'

const TMA_URL = process.env.TMA_URL || 'http://localhost:5173'
const ACTIONS_URL = process.env.ACTIONS_URL || 'http://localhost:3000'

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

export async function POST(req: NextRequest) {
  const gameId = req.nextUrl.searchParams.get('game')
  const gid = req.nextUrl.searchParams.get('gid')
  if (!gameId) {
    return NextResponse.json(
      { message: 'Missing game param' },
      { status: 400, headers: corsHeaders() }
    )
  }
  if (!gid) {
    return NextResponse.json(
      { message: 'Missing gid param' },
      { status: 400, headers: corsHeaders() }
    )
  }

  const tmaUrl = `${TMA_URL}?game=${gameId}&gid=${gid}`

  return NextResponse.json({
    icon: `${ACTIONS_URL}/og-card.svg`,
    title: 'Challenge Accepted',
    description: 'You joined the match. Open ChainGo to return to Telegram and start playing.',
    label: 'Open ChainGo',
    links: {
      actions: [
        {
          label: 'Open ChainGo',
          href: tmaUrl,
          type: 'external',
        },
      ],
    },
  }, { headers: corsHeaders() })
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders() })
}
