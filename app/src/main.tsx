/**
 * main.tsx — React 应用入口
 *
 * 配置说明:
 *   ConnectionProvider endpoint: 使用 devnet 基础链
 *   ER 调用: 在 useGame.ts 内部维护独立的 ER Connection 实例
 *
 * Privy 集成说明 (B-3):
 *   1. npm install @privy-io/react-auth @privy-io/solana
 *   2. 取消下方 PrivyProvider 注释
 *   3. 替换 useAnchorWallet 为 useSolanaWallets（见 useGame.ts）
 *
 * @twa-dev/sdk:
 *   npm install @twa-dev/sdk
 *   WebApp.ready() 和 WebApp.expand() 在 Game.tsx 内调用
 */

import './polyfills'
import React, { useMemo } from 'react'
import ReactDOM from 'react-dom/client'
import {
  ConnectionProvider,
  WalletProvider,
} from '@solana/wallet-adapter-react'
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import {
  SolflareWalletAdapter,
} from '@solana/wallet-adapter-wallets'
import App from './App'
import './index.css'
import '@solana/wallet-adapter-react-ui/styles.css'
import { BASE_ENDPOINT } from './utils/program'

// ── Privy 集成（B-3）─────────────────────────
// 安装：npm install @privy-io/react-auth @privy-io/solana
// 取消下方注释并填入 appId（在 privy.io 注册后获取）：
//
// import { PrivyProvider } from '@privy-io/react-auth'
// const PRIVY_APP_ID = 'your-privy-app-id' // TODO: 填入真实 App ID
// ──────────────────────────────────────────────

const Root: React.FC = () => {
  const network = WalletAdapterNetwork.Devnet

  const wallets = useMemo(
    () => [
      // Phantom is discovered through the Wallet Standard in modern browsers.
      // Adding the legacy adapter as well can create duplicate adapters and
      // intermittent "not connected" errors during signing.
      new SolflareWalletAdapter(),
    ],
    [network]
  )

  // ── Privy 集成版本（启用 Privy 时取消注释） ──
  // return (
  //   <PrivyProvider
  //     appId={PRIVY_APP_ID}
  //     config={{
  //       embeddedWallets: {
  //         createOnLogin: 'users-without-wallets',
  //         noPromptOnSignature: false,
  //       },
  //       supportedChains: [{ id: 103, name: 'solana-devnet', network: 'solana-devnet' }],
  //     }}
  //   >
  //     <ConnectionProvider endpoint={BASE_ENDPOINT}>
  //       <App />
  //     </ConnectionProvider>
  //   </PrivyProvider>
  // )

  return (
    // FIX: 使用 BASE_ENDPOINT (devnet) 而非 ER endpoint 作为主连接
    // ER 专用连接在 useGame.ts 内部通过 getErConn() 单独维护
    <ConnectionProvider endpoint={BASE_ENDPOINT}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <App />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
