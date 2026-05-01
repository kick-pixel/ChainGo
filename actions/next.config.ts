import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // 允许来自所有来源的 API 请求（Blinks 规范要求）
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type,Authorization,Content-Encoding,Accept-Encoding' },
          { key: 'Content-Encoding', value: 'compress' },
          // Blinks / Solana Actions 规范头
          { key: 'X-Action-Version', value: '2.2.1' },
          // devnet chain ID
          { key: 'X-Blockchain-Ids', value: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' },
        ],
      },
    ]
  },
}

export default nextConfig
