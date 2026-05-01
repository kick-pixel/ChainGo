#!/bin/bash
# deploy.sh — 在 Linux 服务器上一键编译部署 ChainGo 合约
#
# 前提：已安装 Rust, Solana CLI (>=1.18), Anchor CLI (>=0.31)
# 用法：chmod +x deploy.sh && ./deploy.sh
#
# FIX（来自文档审查）：
#   新增 Anchor.toml cluster 自动切换逻辑，避免人工遗忘导致部署到错误网络。
#   Anchor.toml 的 provider.cluster 平时指向 ER endpoint（用于 place_stone），
#   部署时必须临时改为 devnet RPC，部署后自动还原。
#   新增：部署后输出 JOIN_GAME_DISCRIMINATOR 计算方法。

set -e

echo "═══════════════════════════════════"
echo " ChainGo 部署脚本"
echo " Colosseum Frontier Hackathon 2026"
echo "═══════════════════════════════════"

# ── 1. 配置 ─────────────────────────────────────────────────
CLUSTER="devnet"
DEVNET_RPC="https://api.devnet.solana.com"
ER_ENDPOINT="https://devnet-as.magicblock.app"
PLACEHOLDER="ChGoXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
MIN_DEPLOY_BALANCE_SOL="4"

# ── 2. 检查环境 ──────────────────────────────────────────────
echo "[1/7] 检查环境..."
anchor --version || { echo "❌ 请安装 Anchor CLI: npm i -g @coral-xyz/anchor-cli"; exit 1; }
solana --version
rustc --version

# ── 3. 配置 Solana 集群 ──────────────────────────────────────
echo "[2/7] 配置 Solana devnet..."
solana config set --url $CLUSTER

if [ ! -f ~/.config/solana/id.json ]; then
  echo "生成新钱包..."
  solana-keygen new --no-bip39-passphrase
fi

echo "当前钱包: $(solana address)"
BALANCE=$(solana balance | grep -oP '[0-9.]+')
echo "当前余额: ${BALANCE} SOL"

if (( $(echo "$BALANCE < $MIN_DEPLOY_BALANCE_SOL" | bc -l) )); then
  echo "⚠️  余额不足 ${MIN_DEPLOY_BALANCE_SOL} SOL，自动申请 airdrop..."
  echo "   Session Keys 增大了程序体积，部署升级需要临时 buffer 租金 + ProgramData 扩容租金。"
  solana airdrop 2 || echo "airdrop 失败，请手动执行: solana airdrop 2"
  BALANCE=$(solana balance | grep -oP '[0-9.]+')
  echo "   airdrop 后余额: ${BALANCE} SOL"
fi

# ── 4. 临时切换 Anchor.toml cluster 为 devnet ─────────────────
# FIX: 部署时必须用主链 RPC，避免 anchor deploy 发到 ER
echo "[3/7] 临时切换 Anchor.toml provider.cluster 为 devnet..."
# 备份
cp Anchor.toml Anchor.toml.bak

# 替换（兼容 sed 的不同版本）
if sed --version 2>&1 | grep -q GNU; then
  # Linux GNU sed
  sed -i "s|cluster = \"${ER_ENDPOINT}\"|cluster = \"${DEVNET_RPC}\"|g" Anchor.toml
else
  # macOS BSD sed
  sed -i '' "s|cluster = \"${ER_ENDPOINT}\"|cluster = \"${DEVNET_RPC}\"|g" Anchor.toml
fi

echo "   Anchor.toml cluster → ${DEVNET_RPC}"

# 注册退出时自动还原（即使脚本中途失败也能还原）
restore_anchor_toml() {
  echo ""
  echo "🔄 还原 Anchor.toml cluster 为 ER endpoint..."
  cp Anchor.toml.bak Anchor.toml
  rm -f Anchor.toml.bak
  echo "   Anchor.toml cluster → ${ER_ENDPOINT}"
}
trap restore_anchor_toml EXIT

# ── 5. 编译合约 ──────────────────────────────────────────────
echo "[4/7] 准备 Program ID 并编译 Anchor 程序..."

mkdir -p target/deploy

if [ ! -f target/deploy/chain_go-keypair.json ]; then
  echo "   生成 program keypair: target/deploy/chain_go-keypair.json"
  solana-keygen new \
    --no-bip39-passphrase \
    --silent \
    -o target/deploy/chain_go-keypair.json
fi

PROGRAM_ID=$(solana address -k target/deploy/chain_go-keypair.json)
echo "   Program ID: $PROGRAM_ID"

# 如果代码中还是 placeholder，替换为真实 Program ID
if grep -q "$PLACEHOLDER" programs/chain_go/src/lib.rs Anchor.toml Anchor.toml.bak; then
  echo "   更新 declare_id! 和相关配置..."
  if sed --version 2>&1 | grep -q GNU; then
	    sed -i "s|${PLACEHOLDER}|${PROGRAM_ID}|g" \
	      programs/chain_go/src/lib.rs \
	      Anchor.toml \
	      Anchor.toml.bak
  else
	    sed -i '' "s|${PLACEHOLDER}|${PROGRAM_ID}|g" \
	      programs/chain_go/src/lib.rs \
	      Anchor.toml \
	      Anchor.toml.bak
  fi
fi

anchor build

# ── 6. 部署到 devnet ─────────────────────────────────────────
echo "[5/7] 部署到 devnet..."
anchor deploy --provider.cluster devnet

echo ""
echo "✅ 合约部署成功！"
echo "   Program ID: $PROGRAM_ID"
echo "   Explorer:   https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"

# ── 7. 打印 JOIN_GAME_DISCRIMINATOR ──────────────────────────
# FIX（文档审查遗漏项）：部署后立即打印 discriminator，供 Actions API 使用
echo ""
echo "[6/7] 计算 Anchor 指令 Discriminators..."

if [ -f "target/idl/chain_go.json" ]; then
  echo "   从 IDL 读取（最可靠）："
  # 尝试用 node 解析 IDL（如果环境有 node）
  if command -v node &>/dev/null; then
    node -e "
const idl = require('./target/idl/chain_go.json');
const crypto = require('crypto');
console.log('');
idl.instructions.forEach(ix => {
  const hash = crypto.createHash('sha256').update('global:' + ix.name.replace(/([A-Z])/g, s => '_' + s.toLowerCase()).replace(/^_/, '')).digest();
  const disc = Array.from(hash.slice(0, 8));
  console.log('  ' + ix.name.padEnd(20) + JSON.stringify(disc));
});
console.log('');
console.log('  Verify actions/app/api/actions/join/route.ts uses the same joinGame value.');
" 2>/dev/null || echo "   node 解析失败，请手动查看 target/idl/chain_go.json"
  else
    echo "   ⚠️  未找到 node，请手动查看 target/idl/chain_go.json 中各指令的 discriminant 字段"
  fi
else
  echo "   ⚠️  target/idl/chain_go.json 不存在，请先运行 anchor build"
fi

# ── 8. 编译前端 ──────────────────────────────────────────────
echo "[7/7] 编译前端..."
cd app
npm install
npm run build
cd ..

# 注意：trap EXIT 会在脚本结束时自动调用 restore_anchor_toml

echo ""
echo "═══════════════════════════════════"
echo " 部署完成 ✅"
echo " Program ID: $PROGRAM_ID"
echo " 前端产物:   app/dist/"
echo " 本地预览:   cd app && npm run preview"
echo ""
echo " 下一步："
echo "   1. Set VITE_PROGRAM_ID=$PROGRAM_ID in app/.env.local and Vercel"
echo "   2. Set PROGRAM_ID=$PROGRAM_ID in actions/.env.local and Vercel"
echo "   3. Verify JOIN_GAME_DISCRIMINATOR in Actions API matches the printed value"
echo "   4. vercel --prod (deploy frontend + Actions API)"
echo "═══════════════════════════════════"
