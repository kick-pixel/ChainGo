import React, { useMemo, useState } from 'react'
import { WalletMultiButton, useWalletModal } from '@solana/wallet-adapter-react-ui'
import { useWallet } from '@solana/wallet-adapter-react'
import { Game } from './components/Game'

const App: React.FC = () => {
  const { publicKey, connecting, disconnect } = useWallet()
  const { setVisible } = useWalletModal()
  const [copiedAppLink, setCopiedAppLink] = useState(false)

  const walletOpenInfo = useMemo(() => {
    const userAgent = navigator.userAgent || ''
    const isTelegram = Boolean((window as any).Telegram?.WebApp) || /Telegram/i.test(userAgent)
    const isMobile = /Android|iPhone|iPad|iPod/i.test(userAgent)
    const appUrl = window.location.href
    const ref = window.location.origin
    const phantomUrl = `https://phantom.app/ul/browse/${encodeURIComponent(appUrl)}?ref=${encodeURIComponent(ref)}`
    const solflareUrl = `https://solflare.com/ul/v1/browse/${encodeURIComponent(appUrl)}?ref=${encodeURIComponent(ref)}`

    return { isTelegram, isMobile, appUrl, phantomUrl, solflareUrl }
  }, [])
  const useMobileWalletUx = walletOpenInfo.isTelegram || walletOpenInfo.isMobile

  const handleWalletClick = () => {
    if (publicKey) {
      disconnect().catch(() => {})
      return
    }

    setVisible(true)
  }

  const handleCopyAppLink = async () => {
    try {
      await navigator.clipboard.writeText(walletOpenInfo.appUrl)
      setCopiedAppLink(true)
      setTimeout(() => setCopiedAppLink(false), 2000)
    } catch {
      // Clipboard can be blocked in some in-app browsers.
    }
  }

  const walletButtonText = publicKey
    ? `${publicKey.toBase58().slice(0, 4)}...${publicKey.toBase58().slice(-4)}`
    : connecting
      ? 'Connecting'
      : 'Connect'

  return (
    <div className="app">
      {/* 顶栏 */}
      <header className="header">
        <div className="header-brand">
          <span className="brand-stone">⬛⬜</span>
          <span className="brand-name">ChainGo</span>
          <span className="brand-tag">On-chain Gomoku</span>
        </div>
        <div className="header-right">
          <div className="er-badge">⚡ MagicBlock ER</div>
          {useMobileWalletUx ? (
            <button className="wallet-connect-btn" type="button" onClick={handleWalletClick}>
              <span className="wallet-connect-icon">{publicKey ? '●' : '▯'}</span>
              <span>{walletButtonText}</span>
            </button>
          ) : (
            <WalletMultiButton />
          )}
        </div>
      </header>

      {/* 主体 */}
      <main className="main">
        {!publicKey ? (
          <div className="connect-prompt">
            <div className="connect-icon">⬛⬜</div>
            <h1 className="connect-title">ChainGo</h1>
            <p className="connect-desc">
              Real-time on-chain Gomoku powered by MagicBlock Ephemeral Rollups
              <br />
              <span className="highlight">Sub-second moves · Verifiable settlement</span>
            </p>
            {useMobileWalletUx && (
              <div className="wallet-help-card">
                <div className="wallet-help-kicker">Telegram wallet mode</div>
                <h2 className="wallet-help-title">Choose the path that opens your wallet</h2>
                <p className="wallet-help-copy">
                  Telegram WebView cannot inject Phantom's browser extension. If the selector does
                  not open, launch ChainGo inside a wallet browser instead.
                </p>
                <div className="wallet-help-actions">
                  <button className="wallet-help-primary" type="button" onClick={() => setVisible(true)}>
                    Try Solflare
                  </button>
                  <a className="wallet-help-secondary" href={walletOpenInfo.solflareUrl}>
                    Open Solflare
                  </a>
                  <a className="wallet-help-primary" href={walletOpenInfo.phantomUrl}>
                    Open Phantom
                  </a>
                  <button className="wallet-help-secondary" type="button" onClick={handleCopyAppLink}>
                    {copiedAppLink ? 'Copied' : 'Copy Link'}
                  </button>
                </div>
              </div>
            )}
            {useMobileWalletUx ? (
              <button className="connect-main-btn" type="button" onClick={handleWalletClick}>
                {walletButtonText}
              </button>
            ) : (
              <div className="desktop-wallet-entry">
                <WalletMultiButton />
              </div>
            )}
          </div>
        ) : (
          <Game />
        )}
      </main>

      {/* 页脚 */}
      <footer className="footer">
        <span>Built for Colosseum Frontier Hackathon 2026 · Powered by MagicBlock</span>
      </footer>
    </div>
  )
}

export default App
