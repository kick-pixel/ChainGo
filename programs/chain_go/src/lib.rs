use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::cpi::{delegate_account, DelegateAccounts, DelegateConfig};
use ephemeral_rollups_sdk::ephem::commit_and_undelegate_accounts;
use session_keys::{session_auth_or, Session, SessionError, SessionToken};

declare_id!("9eFVwR68X9oc3nLyUMgTQu1esXQpgawhGJk7dp1KkKMJ");

// ─────────────────────────────────────────────
// 常量
// ─────────────────────────────────────────────
const BOARD_SIZE: u8 = 15;
const BOARD_CELLS: u8 = 225; // 15 * 15
const BITBOARD_BYTES: usize = 29; // ceil(225 / 8)

// GameState 空间计算:
//   8   discriminator
//   32  player1: Pubkey
//   32  player2: Pubkey
//   8   game_id: u64
//   29  board_p1: [u8; 29]
//   29  board_p2: [u8; 29]
//   1   current_turn: u8
//   1   status: u8
//   1   move_count: u8
//   1   bump: u8
// = 142 bytes

// ─────────────────────────────────────────────
// 账户结构
// ─────────────────────────────────────────────
#[account]
pub struct GameState {
    pub player1: Pubkey,
    pub player2: Pubkey,
    pub game_id: u64,
    /// 玩家1落子位图: bit[row*15+col] = 1 表示 P1 在此落子
    pub board_p1: [u8; BITBOARD_BYTES],
    /// 玩家2落子位图
    pub board_p2: [u8; BITBOARD_BYTES],
    /// 0 = P1 回合, 1 = P2 回合
    pub current_turn: u8,
    /// 0=待加入, 1=进行中, 2=P1胜, 3=P2胜, 4=P1认输, 5=P2认输, 6=平局
    pub status: u8,
    /// 已落子数 (max 225, u8 足够)
    pub move_count: u8,
    pub bump: u8,
}

impl GameState {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 29 + 29 + 1 + 1 + 1 + 1; // = 142

    /// 检查某位置是否已有子 (任意玩家)
    pub fn is_occupied(&self, pos: u8) -> bool {
        Self::get_bit(&self.board_p1, pos) || Self::get_bit(&self.board_p2, pos)
    }

    /// 读取 bitboard 中某位置的 bit
    pub fn get_bit(board: &[u8; BITBOARD_BYTES], pos: u8) -> bool {
        let byte_idx = (pos / 8) as usize;
        let bit_idx = pos % 8;
        board[byte_idx] & (1 << bit_idx) != 0
    }

    /// 在 bitboard 中设置某位置的 bit
    pub fn set_bit(board: &mut [u8; BITBOARD_BYTES], pos: u8) {
        let byte_idx = (pos / 8) as usize;
        let bit_idx = pos % 8;
        board[byte_idx] |= 1 << bit_idx;
    }
}

// ─────────────────────────────────────────────
// 错误码
// ─────────────────────────────────────────────
#[error_code]
pub enum ChainGoError {
    #[msg("游戏状态不允许此操作")]
    InvalidGameStatus,
    #[msg("不是你的回合")]
    NotYourTurn,
    #[msg("该位置已有棋子")]
    CellOccupied,
    #[msg("位置超出棋盘范围 (0-224)")]
    InvalidPosition,
    #[msg("赢局声明无效: 5个位置不全属于该玩家")]
    InvalidWinClaim,
    #[msg("赢局声明无效: 5个位置未连成线")]
    NotALine,
    #[msg("你不是本局玩家")]
    NotAPlayer,
    #[msg("不能和自己对弈")]
    CannotPlaySelf,
    // FIX: 移除了未使用的 AlreadyJoined — 合约用 InvalidGameStatus 覆盖此场景
}

// ─────────────────────────────────────────────
// 程序指令
// ─────────────────────────────────────────────
#[program]
pub mod chain_go {
    use super::*;

    /// P1 创建游戏，指定 P2 地址
    pub fn create_game(ctx: Context<CreateGame>, game_id: u64, player2: Pubkey) -> Result<()> {
        require!(
            ctx.accounts.player1.key() != player2,
            ChainGoError::CannotPlaySelf
        );
        let game = &mut ctx.accounts.game;
        game.player1 = ctx.accounts.player1.key();
        game.player2 = player2;
        game.game_id = game_id;
        game.board_p1 = [0u8; BITBOARD_BYTES];
        game.board_p2 = [0u8; BITBOARD_BYTES];
        game.current_turn = 0; // P1 先手
        game.status = 0;       // 待加入
        game.move_count = 0;
        game.bump = ctx.bumps.game;
        msg!("游戏创建, pda={}", ctx.accounts.game.key());
        Ok(())
    }

    /// P2 加入游戏
    /// - 开放模式 (player2 == Pubkey::default()): 任意人接单，将调用者注册为 player2
    /// - 定向模式 (player2 已指定): 必须是指定的 player2
    pub fn join_game(ctx: Context<JoinGame>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        // status==0 才能加入；若已 1，则 InvalidGameStatus
        require!(game.status == 0, ChainGoError::InvalidGameStatus);

        if game.player2 == Pubkey::default() {
            // 开放模式：任意人接单，将调用者注册为 player2
            require!(
                ctx.accounts.player2.key() != game.player1,
                ChainGoError::CannotPlaySelf
            );
            game.player2 = ctx.accounts.player2.key();
        } else {
            // 定向模式：必须是指定的 player2
            require!(
                ctx.accounts.player2.key() == game.player2,
                ChainGoError::NotAPlayer
            );
        }
        game.status = 1; // 进行中
        msg!("P2 加入, 游戏开始!");
        Ok(())
    }

    /// 开放匹配模式：player2 为全零，等待任意人接单
    pub fn create_open_game(ctx: Context<CreateOpenGame>, game_id: u64) -> Result<()> {
        let game = &mut ctx.accounts.game;
        game.player1 = ctx.accounts.player1.key();
        game.player2 = Pubkey::default(); // 全零，表示"开放"
        game.game_id = game_id;
        game.board_p1 = [0u8; BITBOARD_BYTES];
        game.board_p2 = [0u8; BITBOARD_BYTES];
        game.current_turn = 0; // P1 先手
        game.status = 0;       // 待加入
        game.move_count = 0;
        game.bump = ctx.bumps.game;
        msg!("开放游戏创建, pda={}", ctx.accounts.game.key());
        Ok(())
    }

    /// 委托账户到 Ephemeral Rollup
    /// 调用方: 任意玩家均可发起，通常由创建游戏后立即调用
    pub fn delegate_game(ctx: Context<DelegateGame>) -> Result<()> {
        // FIX: 使用 status 字段引用时，需先读出，避免 borrow 冲突
        let status = ctx.accounts.game.status;
        let player1_key = ctx.accounts.game.player1;
        let game_id = ctx.accounts.game.game_id.to_le_bytes();

        require!(status == 1, ChainGoError::InvalidGameStatus);

        let payer = ctx.accounts.payer.to_account_info();
        let game_info = ctx.accounts.game.to_account_info();
        // MagicBlock SDK appends the PDA bump internally. Passing the bump here
        // would derive a different signer and fail with "signer privilege escalated".
        let seeds: &[&[u8]] = &[b"game", player1_key.as_ref(), game_id.as_ref()];

        delegate_account(
            DelegateAccounts {
                payer: &payer,
                pda: &game_info,
                owner_program: &ctx.accounts.owner_program,
                buffer: &ctx.accounts.buffer,
                delegation_record: &ctx.accounts.delegation_record,
                delegation_metadata: &ctx.accounts.delegation_metadata,
                delegation_program: &ctx.accounts.delegation_program,
                system_program: &ctx.accounts.system_program,
            },
            seeds,
            DelegateConfig {
                commit_frequency_ms: 500, // 每 500ms 同步一次状态到主链
                validator: None,
            },
        )?;

        msg!("账户已委托到 Ephemeral Rollup");
        Ok(())
    }

    /// 落子 (通过 ER 执行: 零 gas, 毫秒确认)
    #[session_auth_or(
        ctx.accounts.player.key() == ctx.accounts.game.player1
            || ctx.accounts.player.key() == ctx.accounts.game.player2,
        ChainGoError::NotAPlayer
    )]
    pub fn place_stone(ctx: Context<PlaceStone>, position: u8) -> Result<()> {
        // FIX: position 检查放在最前面，防止越界后续操作
        require!(position < BOARD_CELLS, ChainGoError::InvalidPosition);

        let authority = ctx.accounts.player_authority();
        let game = &mut ctx.accounts.game;
        require!(game.status == 1, ChainGoError::InvalidGameStatus);

        let is_p1 = authority == game.player1;
        let is_p2 = authority == game.player2;
        require!(is_p1 || is_p2, ChainGoError::NotAPlayer);
        require!(
            (game.current_turn == 0 && is_p1) || (game.current_turn == 1 && is_p2),
            ChainGoError::NotYourTurn
        );

        require!(!game.is_occupied(position), ChainGoError::CellOccupied);

        if is_p1 {
            GameState::set_bit(&mut game.board_p1, position);
        } else {
            GameState::set_bit(&mut game.board_p2, position);
        }

        game.move_count += 1;

        // 平局: 225 手全落完
        if game.move_count == BOARD_CELLS {
            game.status = 6;
            msg!("棋盘满, 平局!");
            return Ok(());
        }

        game.current_turn = 1 - game.current_turn;

        msg!(
            "落子: pos={} (row={}, col={}), turn→{}",
            position,
            position / BOARD_SIZE,
            position % BOARD_SIZE,
            game.current_turn
        );
        Ok(())
    }

    /// 声明赢局 — "链下算，链上验" 核心设计
    ///
    /// 前端检测到5连珠后将5个位置传入，合约验证:
    ///   1. 位置合法 (0-224)
    ///   2. 5个位置均属于调用者
    ///   3. 5个位置连成一线
    ///
    /// FIX: claim_win 不再校验 current_turn（玩家检测到赢局时，
    ///      刚落完子回合已切换，若校验 current_turn 会导致错误拒绝）
    #[session_auth_or(
        ctx.accounts.player.key() == ctx.accounts.game.player1
            || ctx.accounts.player.key() == ctx.accounts.game.player2,
        ChainGoError::NotAPlayer
    )]
    pub fn claim_win(ctx: Context<ClaimWin>, positions: [u8; 5]) -> Result<()> {
        let authority = ctx.accounts.player_authority();
        let game = &mut ctx.accounts.game;
        require!(game.status == 1, ChainGoError::InvalidGameStatus);

        let is_p1 = authority == game.player1;
        let is_p2 = authority == game.player2;
        require!(is_p1 || is_p2, ChainGoError::NotAPlayer);

        // 验证1: 5个位置在棋盘内 & 属于调用者
        // FIX: 避免在 borrow 后再 borrow game，先复制 board
        let board = if is_p1 { game.board_p1 } else { game.board_p2 };
        for &pos in positions.iter() {
            require!(pos < BOARD_CELLS, ChainGoError::InvalidPosition);
            require!(
                GameState::get_bit(&board, pos),
                ChainGoError::InvalidWinClaim
            );
        }

        // 验证2: 5个位置连成一线
        require!(verify_win_line(&positions), ChainGoError::NotALine);

        game.status = if is_p1 { 2 } else { 3 };
        msg!("玩家 {} 赢了! 位置: {:?}", ctx.accounts.player.key(), positions);
        Ok(())
    }

    /// 认输
    #[session_auth_or(
        ctx.accounts.player.key() == ctx.accounts.game.player1
            || ctx.accounts.player.key() == ctx.accounts.game.player2,
        ChainGoError::NotAPlayer
    )]
    pub fn resign(ctx: Context<Resign>) -> Result<()> {
        let authority = ctx.accounts.player_authority();
        let game = &mut ctx.accounts.game;
        require!(game.status == 1, ChainGoError::InvalidGameStatus);

        let is_p1 = authority == game.player1;
        let is_p2 = authority == game.player2;
        require!(is_p1 || is_p2, ChainGoError::NotAPlayer);

        game.status = if is_p1 { 4 } else { 5 };
        msg!("玩家 {} 认输", ctx.accounts.player.key());
        Ok(())
    }

    /// 反委托: 游戏结束后将账户从 ER 归还主链
    pub fn undelegate_game(ctx: Context<UndelegateGame>) -> Result<()> {
        let status = ctx.accounts.game.status;
        require!(status >= 2, ChainGoError::InvalidGameStatus);

        let game_info = ctx.accounts.game.to_account_info();
        commit_and_undelegate_accounts(
            &ctx.accounts.payer.to_account_info(),
            vec![&game_info],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
            None,
        )?;

        msg!("账户已从 Ephemeral Rollup 反委托回主链");
        Ok(())
    }
}

// ─────────────────────────────────────────────
// Account 上下文
// ─────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct CreateGame<'info> {
    #[account(mut)]
    pub player1: Signer<'info>,

    #[account(
        init_if_needed,
        payer = player1,
        space = GameState::LEN,
        seeds = [b"game", player1.key().as_ref(), game_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub game: Account<'info, GameState>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinGame<'info> {
    pub player2: Signer<'info>,

    #[account(
        mut,
        seeds = [b"game", game.player1.as_ref(), game.game_id.to_le_bytes().as_ref()],
        bump = game.bump,
        // constraint 已移至 join_game 指令函数内部
        // 支持开放模式（player2 == Pubkey::default()）和定向模式
    )]
    pub game: Account<'info, GameState>,
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct CreateOpenGame<'info> {
    #[account(mut)]
    pub player1: Signer<'info>,

    #[account(
        init_if_needed,
        payer = player1,
        space = GameState::LEN,
        seeds = [b"game", player1.key().as_ref(), game_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub game: Account<'info, GameState>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DelegateGame<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"game", game.player1.as_ref(), game.game_id.to_le_bytes().as_ref()],
        bump = game.bump,
    )]
    pub game: Account<'info, GameState>,

    /// CHECK: buffer account for delegation program
    #[account(mut)]
    pub buffer: AccountInfo<'info>,

    /// CHECK: owner program of the delegated PDA
    pub owner_program: AccountInfo<'info>,

    /// CHECK: delegation record PDA
    #[account(mut)]
    pub delegation_record: AccountInfo<'info>,

    /// CHECK: delegation metadata PDA
    #[account(mut)]
    pub delegation_metadata: AccountInfo<'info>,

    /// CHECK: delegation program
    pub delegation_program: AccountInfo<'info>,

    /// CHECK: magic context
    #[account(mut)]
    pub magic_context: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts, Session)]
pub struct PlaceStone<'info> {
    pub player: Signer<'info>,

    #[account(
        mut,
        seeds = [b"game", game.player1.as_ref(), game.game_id.to_le_bytes().as_ref()],
        bump = game.bump,
    )]
    pub game: Account<'info, GameState>,

    #[session(
        signer = player,
        authority = player_authority()
    )]
    pub session_token: Option<Account<'info, SessionToken>>,
}

impl<'info> PlaceStone<'info> {
    pub fn player_authority(&self) -> Pubkey {
        self.session_token
            .as_ref()
            .map(|token| token.authority)
            .unwrap_or_else(|| self.player.key())
    }
}

#[derive(Accounts, Session)]
pub struct ClaimWin<'info> {
    pub player: Signer<'info>,

    #[account(
        mut,
        seeds = [b"game", game.player1.as_ref(), game.game_id.to_le_bytes().as_ref()],
        bump = game.bump,
    )]
    pub game: Account<'info, GameState>,

    #[session(
        signer = player,
        authority = player_authority()
    )]
    pub session_token: Option<Account<'info, SessionToken>>,
}

impl<'info> ClaimWin<'info> {
    pub fn player_authority(&self) -> Pubkey {
        self.session_token
            .as_ref()
            .map(|token| token.authority)
            .unwrap_or_else(|| self.player.key())
    }
}

#[derive(Accounts, Session)]
pub struct Resign<'info> {
    pub player: Signer<'info>,

    #[account(
        mut,
        seeds = [b"game", game.player1.as_ref(), game.game_id.to_le_bytes().as_ref()],
        bump = game.bump,
    )]
    pub game: Account<'info, GameState>,

    #[session(
        signer = player,
        authority = player_authority()
    )]
    pub session_token: Option<Account<'info, SessionToken>>,
}

impl<'info> Resign<'info> {
    pub fn player_authority(&self) -> Pubkey {
        self.session_token
            .as_ref()
            .map(|token| token.authority)
            .unwrap_or_else(|| self.player.key())
    }
}

#[derive(Accounts)]
pub struct UndelegateGame<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"game", game.player1.as_ref(), game.game_id.to_le_bytes().as_ref()],
        bump = game.bump,
    )]
    pub game: Account<'info, GameState>,

    /// CHECK: magic context
    #[account(mut)]
    pub magic_context: AccountInfo<'info>,

    /// CHECK: magic program
    pub magic_program: AccountInfo<'info>,
}

// ─────────────────────────────────────────────
// 赢局连线验证 (链上)
//
// 与前端 gomoku.ts::verifyWinLine() 完全对称。
// 输入 positions 不要求有序，函数内部排序后验证。
// 四方向: 横 / 纵 / 主对角线(\) / 反对角线(/)
// ─────────────────────────────────────────────
fn verify_win_line(positions: &[u8; 5]) -> bool {
    let mut sorted = *positions;
    sorted.sort_unstable();

    let rows: [u8; 5] = sorted.map(|p| p / BOARD_SIZE);
    let cols: [u8; 5] = sorted.map(|p| p % BOARD_SIZE);

    // 横向: 同行, 列连续 +1
    if rows.iter().all(|&r| r == rows[0]) {
        if (1..5usize).all(|i| cols[i] == cols[i - 1] + 1) {
            return true;
        }
    }

    // 纵向: 同列, 行连续 +1
    if cols.iter().all(|&c| c == cols[0]) {
        if (1..5usize).all(|i| rows[i] == rows[i - 1] + 1) {
            return true;
        }
    }

    // 主对角线 (\): 行 +1, 列 +1
    if (1..5usize).all(|i| rows[i] == rows[i - 1] + 1 && cols[i] == cols[i - 1] + 1) {
        return true;
    }

    // 反对角线 (/): 排序后行递增, 列递减
    // FIX: cols[i-1] > 0 防止 u8 减法下溢
    if (1..5usize).all(|i| {
        rows[i] == rows[i - 1] + 1 && cols[i - 1] > 0 && cols[i] + 1 == cols[i - 1]
    }) {
        return true;
    }

    false
}
