export default function Home() {
  const actionsUrl = process.env.ACTIONS_URL || 'https://actions-rho.vercel.app'
  const tmaUrl = process.env.TMA_URL || 'https://app-omega-two-90.vercel.app'
  const actionUrl = `${actionsUrl}/api/actions/join?game=<YOUR_PUBKEY>&gid=<GAME_ID>`
  const appChallengeUrl = `${tmaUrl}?game=<YOUR_PUBKEY>&gid=<GAME_ID>`

  return (
    <main style={{ fontFamily: 'system-ui', padding: '2rem', background: '#0a0f1e', color: '#fff', minHeight: '100vh' }}>
      <h1>⬛⬜ ChainGo Actions API</h1>
      <p style={{ color: '#94a3b8' }}>Solana Actions API for ChainGo</p>

      <h2 style={{ marginTop: '2rem', color: '#3b82f6' }}>Endpoints</h2>
      <ul style={{ lineHeight: 2 }}>
        <li>
          <code style={{ color: '#22c55e' }}>GET /api/actions/join?game=&lt;player1_pubkey&gt;</code>
          <br /><span style={{ color: '#64748b' }}>Returns Blink challenge metadata</span>
        </li>
        <li>
          <code style={{ color: '#f97316' }}>POST /api/actions/join?game=&lt;player1_pubkey&gt;</code>
          <br /><span style={{ color: '#64748b' }}>Builds an unsigned join_game transaction for wallet signing</span>
        </li>
        <li>
          <code style={{ color: '#a855f7' }}>POST /api/actions/join/complete?game=&lt;player1_pubkey&gt;</code>
          <br /><span style={{ color: '#64748b' }}>Renders the completion card after signing</span>
        </li>
      </ul>

      <h2 style={{ marginTop: '2rem', color: '#3b82f6' }}>Test Links</h2>
      <p style={{ color: '#94a3b8' }}>
        App challenge link:
        <br />
        <code style={{ display: 'block', marginTop: '0.5rem', padding: '1rem', background: '#162040', borderRadius: '8px', wordBreak: 'break-all' }}>
          {appChallengeUrl}
        </code>
      </p>
      <p style={{ color: '#94a3b8' }}>
        Direct Solana Action URL:
        <br />
        <code style={{ display: 'block', marginTop: '0.5rem', padding: '1rem', background: '#162040', borderRadius: '8px', wordBreak: 'break-all' }}>
          {actionUrl}
        </code>
      </p>
    </main>
  )
}
