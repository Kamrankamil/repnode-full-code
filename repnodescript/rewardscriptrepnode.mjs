
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, ".env") });

import express from "express";
import mysql from "mysql2";
import Web3 from "web3";
import bodyParser from "body-parser";


const app = express();
const port = 3001;

// Middleware to parse JSON
app.use(bodyParser.json());

const allowedOrigins = new Set([
  "http://localhost:3000",
  "http://localhost:8080",
]);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
  }

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

// MySQL connection setup
const connection = mysql.createConnection({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "xeneablockchaindb",

});
console.log("Connected To Database.");

// Connect to MySQL
connection.connect((err) => {
  if (err) {
    console.error("Error connecting to database: " + err.stack);
    return;
  }
});

const db = connection.promise();
const STAKING_POLL_INTERVAL_MS = 60_000;
const rpcUrl = process.env.RPC_URL || "https://rpc.iic-blockchain.com";
const MIN_DEPOSIT_CONFIRMATIONS = Number(process.env.MIN_DEPOSIT_CONFIRMATIONS || 3);

// Set up Web3
const web3 = new Web3(new Web3.providers.HttpProvider(rpcUrl));
console.log(`Using RPC URL: ${rpcUrl}`);
const repnodeAccessChallenges = new Map();
const REPNODE_CHALLENGE_TTL_MS = 5 * 60 * 1000;

const rawPrivateKey = process.env.PRIVATE_KEY || "";
const privateKey = rawPrivateKey.startsWith("0x") ? rawPrivateKey : `0x${rawPrivateKey}`;

if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  console.error("Invalid PRIVATE_KEY. Set a 64-hex private key in .env (with or without 0x). Exiting.");
  process.exit(1);
}

const account = web3.eth.accounts.privateKeyToAccount(privateKey);
web3.eth.accounts.wallet.add(account);
web3.eth.defaultAccount = account.address;

const generateReference = (prefix) => {
  return `${prefix}-${Math.random().toString(16).slice(2, 10).toUpperCase()}-${Date.now()}`;
};

const ensureRepnodeStakingTables = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS staking_deposit_intents (
      id INT AUTO_INCREMENT PRIMARY KEY,
      wallet_address VARCHAR(191) NOT NULL,
      source_wallet_address VARCHAR(191) NOT NULL,
      vault_address VARCHAR(191) NOT NULL,
      amount_saya DECIMAL(20,8) NOT NULL,
      tx_hash VARCHAR(80) DEFAULT NULL,
      expected_from_block BIGINT DEFAULT NULL,
      detected_block_number BIGINT DEFAULT NULL,
      confirmations INT NOT NULL DEFAULT 0,
      status VARCHAR(32) NOT NULL DEFAULT 'pending_wallet_tx',
      error_message TEXT DEFAULT NULL,
      credited_at DATETIME DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_staking_deposit_wallet (wallet_address, created_at),
      INDEX idx_staking_deposit_status (status, updated_at),
      UNIQUE KEY uniq_staking_deposit_tx (tx_hash)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
};

await ensureRepnodeStakingTables();

const logTransactionRecord = async (
  walletAddress,
  transactionHash,
  transactionType,
  amount,
  status = "Completed"
) => {
  const txQuery = `
    INSERT INTO transactions (wallet_address, transaction_hash, transaction_type, amount, status)
    VALUES (?, ?, ?, ?, ?)
  `;

  await db.query(txQuery, [walletAddress, transactionHash, transactionType, amount, status]);
};

const logStakingActivity = async (
  walletAddress,
  activityType,
  assetSymbol,
  amount,
  status,
  referenceCode,
  metadata = null
) => {
  const metadataJson = metadata ? JSON.stringify(metadata) : null;
  const activityQuery = `
    INSERT INTO staking_activities (wallet_address, activity_type, asset_symbol, amount, status, reference_code, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  await db.query(activityQuery, [
    walletAddress,
    activityType,
    assetSymbol,
    amount,
    status,
    referenceCode,
    metadataJson,
  ]);
};

const ensureStakingWalletRecord = async (walletAddress) => {
  const [seedRows] = await db.query(
    `SELECT username, email FROM wallet_addresses WHERE address = ? LIMIT 1`,
    [walletAddress]
  );

  const ownerName = seedRows[0]?.username || null;
  const contactEmail = seedRows[0]?.email || null;

  await db.query(
    `INSERT INTO staking_wallets (address, owner_name, contact_email, dinnar_balance, saya_balance, staked_balance, total_rewards_claimed)
     VALUES (?, ?, ?, 2500.0000, 0.0000, 0.0000, 0.0000)
     ON DUPLICATE KEY UPDATE
       owner_name = VALUES(owner_name),
       contact_email = VALUES(contact_email)`,
    [walletAddress, ownerName, contactEmail]
  );
};

const getStakingWalletSummary = async (walletAddress) => {
  await ensureStakingWalletRecord(walletAddress);

  const [walletRows] = await db.query(
    `SELECT address, owner_name, contact_email, dinnar_balance, saya_balance, staked_balance, total_rewards_claimed, created_at, updated_at
     FROM staking_wallets
     WHERE address = ?
     LIMIT 1`,
    [walletAddress]
  );

  if (walletRows.length === 0) {
    return null;
  }

  const wallet = walletRows[0];

  const [positionRows] = await db.query(
    `SELECT id, amount_saya, duration_days, apr_rate, reward_estimate, status, source_asset, start_at, end_at, claimed_reward, claimed_at, created_at
     FROM staking_positions
     WHERE wallet_address = ?
     ORDER BY created_at DESC`,
    [walletAddress]
  );

  const [activityRows] = await db.query(
    `SELECT activity_type, asset_symbol, amount, status, reference_code, metadata, created_at
     FROM staking_activities
     WHERE wallet_address = ?
     ORDER BY created_at DESC
     LIMIT 20`,
    [walletAddress]
  );

  const [depositRows] = await db.query(
    `SELECT id, source_wallet_address, vault_address, amount_saya, tx_hash, expected_from_block, detected_block_number, confirmations, status, error_message, credited_at, created_at, updated_at
     FROM staking_deposit_intents
     WHERE wallet_address = ?
     ORDER BY created_at DESC
     LIMIT 20`,
    [walletAddress]
  );

  return {
    custody: {
      vaultAddress: account.address,
      rpcUrl,
      minDepositConfirmations: MIN_DEPOSIT_CONFIRMATIONS,
    },
    wallet: {
      address: wallet.address,
      ownerName: wallet.owner_name,
      contactEmail: wallet.contact_email,
      dinnarBalance: Number(wallet.dinnar_balance || 0),
      sayaBalance: Number(wallet.saya_balance || 0),
      stakedBalance: Number(wallet.staked_balance || 0),
      totalRewardsClaimed: Number(wallet.total_rewards_claimed || 0),
      createdAt: wallet.created_at,
      updatedAt: wallet.updated_at,
    },
    positions: positionRows.map((position) => ({
      id: position.id,
      amountSaya: Number(position.amount_saya || 0),
      durationDays: Number(position.duration_days || 0),
      aprRate: Number(position.apr_rate || 0),
      rewardEstimate: Number(position.reward_estimate || 0),
      status: position.status,
      sourceAsset: position.source_asset,
      startAt: position.start_at,
      endAt: position.end_at,
      claimedReward: Number(position.claimed_reward || 0),
      claimedAt: position.claimed_at,
      createdAt: position.created_at,
    })),
    activities: activityRows.map((activity) => ({
      type: activity.activity_type,
      asset: activity.asset_symbol,
      amount: Number(activity.amount || 0),
      status: activity.status,
      reference: activity.reference_code,
      metadata: activity.metadata ? JSON.parse(activity.metadata) : null,
      createdAt: activity.created_at,
    })),
    deposits: depositRows.map((deposit) => ({
      id: deposit.id,
      sourceWalletAddress: deposit.source_wallet_address,
      vaultAddress: deposit.vault_address,
      amountSaya: Number(deposit.amount_saya || 0),
      txHash: deposit.tx_hash,
      expectedFromBlock: deposit.expected_from_block,
      detectedBlockNumber: deposit.detected_block_number,
      confirmations: Number(deposit.confirmations || 0),
      status: deposit.status,
      errorMessage: deposit.error_message,
      creditedAt: deposit.credited_at,
      createdAt: deposit.created_at,
      updatedAt: deposit.updated_at,
    })),
  };
};

const getPendingDepositIntents = async (limit = 25) => {
  const [rows] = await db.query(
    `SELECT id, wallet_address, source_wallet_address, vault_address, amount_saya, tx_hash, expected_from_block, detected_block_number, confirmations, status, error_message, credited_at, created_at, updated_at
     FROM staking_deposit_intents
     WHERE status IN ('pending_wallet_tx', 'pending_confirmations')
        OR (status = 'failed' AND error_message = 'Transaction not found')
     ORDER BY created_at ASC
     LIMIT ?`,
    [limit]
  );

  return rows;
};

const verifyDepositIntentOnChain = async (intent) => {
  if (!intent.tx_hash) {
    return {
      status: 'pending_wallet_tx',
      confirmations: 0,
      message: 'Waiting for wallet transaction hash.',
    };
  }

  const tx = await web3.eth.getTransaction(intent.tx_hash);
  if (!tx) {
    return {
      status: 'pending_confirmations',
      confirmations: 0,
      message: 'Transaction not visible on RPC yet.',
    };
  }

  const receipt = await web3.eth.getTransactionReceipt(intent.tx_hash);
  if (!receipt) {
    return {
      status: 'pending_confirmations',
      confirmations: 0,
      message: 'Transaction pending confirmation.',
    };
  }

  if (!receipt.status) {
    return {
      status: 'failed',
      confirmations: 0,
      message: 'Transaction reverted on chain.',
    };
  }

  const expectedAmountWei = BigInt(web3.utils.toWei(String(intent.amount_saya), 'ether'));
  const actualValueWei = BigInt(tx.value || '0');
  const normalizedTo = String(tx.to || '').toLowerCase();
  const normalizedFrom = String(tx.from || '').toLowerCase();
  const expectedVault = String(intent.vault_address || '').toLowerCase();
  const expectedFrom = String(intent.source_wallet_address || '').toLowerCase();

  if (normalizedTo !== expectedVault) {
    return {
      status: 'failed',
      confirmations: 0,
      message: `Deposit destination mismatch. Expected ${expectedVault}, received ${normalizedTo}.`,
    };
  }

  if (normalizedFrom !== expectedFrom) {
    return {
      status: 'failed',
      confirmations: 0,
      message: `Deposit source mismatch. Expected ${expectedFrom}, received ${normalizedFrom}.`,
    };
  }

  if (actualValueWei !== expectedAmountWei) {
    return {
      status: 'failed',
      confirmations: 0,
      message: `Deposit amount mismatch. Expected ${expectedAmountWei.toString()} Wei, received ${actualValueWei.toString()} Wei.`,
    };
  }

  const latestBlock = await web3.eth.getBlockNumber();
  const confirmations = Number(latestBlock) - Number(receipt.blockNumber) + 1;

  if (confirmations < MIN_DEPOSIT_CONFIRMATIONS) {
    return {
      status: 'pending_confirmations',
      confirmations,
      blockNumber: Number(receipt.blockNumber),
      message: `Waiting for ${MIN_DEPOSIT_CONFIRMATIONS} confirmations.`,
    };
  }

  return {
    status: 'confirmed',
    confirmations,
    blockNumber: Number(receipt.blockNumber),
    message: 'Deposit confirmed on chain.',
  };
};

const creditConfirmedDeposit = async (intent, verification) => {
  await db.beginTransaction();

  try {
    const [currentIntentRows] = await db.query(
      `SELECT status FROM staking_deposit_intents WHERE id = ? LIMIT 1`,
      [intent.id]
    );

    if (currentIntentRows.length === 0) {
      throw new Error(`Deposit intent ${intent.id} no longer exists.`);
    }

    if (currentIntentRows[0].status === 'confirmed') {
      await db.commit();
      return {
        status: 'already_confirmed',
        intentId: intent.id,
      };
    }

    await ensureStakingWalletRecord(intent.wallet_address);

    await db.query(
      `UPDATE staking_deposit_intents
       SET status = 'confirmed',
           confirmations = ?,
           detected_block_number = ?,
           error_message = NULL,
           credited_at = NOW()
       WHERE id = ?`,
      [verification.confirmations, verification.blockNumber, intent.id]
    );

    await db.query(
      `UPDATE staking_wallets
       SET saya_balance = saya_balance + ?
       WHERE address = ?`,
      [intent.amount_saya, intent.wallet_address]
    );

    await db.query(
      `UPDATE wallet_addresses
       SET balance = balance + ?
       WHERE address = ?`,
      [intent.amount_saya, intent.wallet_address]
    );

    const reference = generateReference('DEP');
    await logStakingActivity(
      intent.wallet_address,
      'deposit-confirmed',
      'SAYA',
      Number(intent.amount_saya || 0),
      'Completed',
      reference,
      {
        intentId: intent.id,
        txHash: intent.tx_hash,
        confirmations: verification.confirmations,
        sourceWalletAddress: intent.source_wallet_address,
      }
    );

    await logTransactionRecord(
      intent.wallet_address,
      intent.tx_hash,
      'Staking Deposit',
      Number(intent.amount_saya || 0),
      'Completed'
    );

    await db.commit();

    return {
      status: 'confirmed',
      intentId: intent.id,
      txHash: intent.tx_hash,
      amountSaya: Number(intent.amount_saya || 0),
      confirmations: verification.confirmations,
    };
  } catch (error) {
    await db.rollback();
    throw error;
  }
};

const processPendingDeposits = async () => {
  try {
    const intents = await getPendingDepositIntents();
    const outcomes = [];

    for (const intent of intents) {
      try {
        const verification = await verifyDepositIntentOnChain(intent);

        if (verification.status === 'confirmed') {
          const credited = await creditConfirmedDeposit(intent, verification);
          outcomes.push(credited);
          continue;
        }

        await db.query(
          `UPDATE staking_deposit_intents
           SET status = ?, confirmations = ?, detected_block_number = ?, error_message = ?
           WHERE id = ?`,
          [
            verification.status,
            verification.confirmations || 0,
            verification.blockNumber || null,
            verification.message || null,
            intent.id,
          ]
        );

        outcomes.push({
          status: verification.status,
          intentId: intent.id,
          message: verification.message,
          confirmations: verification.confirmations || 0,
        });
      } catch (error) {
        const errorMessage = error?.message || String(error);

        await db.query(
          `UPDATE staking_deposit_intents
           SET status = 'pending_confirmations', error_message = ?
           WHERE id = ?`,
          [errorMessage, intent.id]
        );

        outcomes.push({
          status: 'pending_confirmations',
          intentId: intent.id,
          message: `Deposit verification will be retried: ${errorMessage}`,
        });
      }
    }

    return outcomes;
  } catch (error) {
    console.error('Failed to process pending deposits:', error);
    return [];
  }
};

const getMaturedActiveStakes = async (limit = 10) => {
  const [rows] = await db.query(
    `SELECT
        sp.id,
        sp.wallet_address,
        sp.amount_saya,
        sp.duration_days,
        sp.apr_rate,
        sp.reward_estimate,
        sp.start_at,
        sp.end_at,
        sw.saya_balance,
        sw.staked_balance,
        sw.total_rewards_claimed
      FROM staking_positions sp
      INNER JOIN staking_wallets sw ON sw.address = sp.wallet_address
      WHERE sp.status = 'active' AND sp.end_at <= NOW()
      ORDER BY sp.end_at ASC
      LIMIT ?`,
    [limit]
  );

  return rows;
};

const settleMaturedStake = async (position) => {
  const principalAmount = Number(position.amount_saya || 0);
  const rewardAmount = Number(position.reward_estimate || 0);
  const totalAmount = principalAmount + rewardAmount;

  const receipt = await sendNativeTransfer({
    walletAddress: position.wallet_address,
    amount: totalAmount,
    contextLabel: `Staking Maturity #${position.id}`,
  });

  await db.beginTransaction();

  try {
    const [claimResult] = await db.query(
      `UPDATE staking_positions
       SET status = 'claimed', claimed_reward = ?, claimed_at = NOW()
       WHERE id = ? AND wallet_address = ? AND status = 'active'`,
      [rewardAmount, position.id, position.wallet_address]
    );

    if (claimResult.affectedRows !== 1) {
      throw new Error(`Stake position ${position.id} was not claimable during settlement.`);
    }

    // The payout leaves the vault for the user's on-chain wallet. Keep the
    // remaining liquid custody balance unchanged instead of re-crediting it.
    const newSayaBalance = Number(position.saya_balance || 0);
    const newStakedBalance = Math.max(0, Number(position.staked_balance || 0) - principalAmount);
    const newTotalRewardsClaimed = Number(position.total_rewards_claimed || 0) + rewardAmount;

    await db.query(
      `UPDATE staking_wallets
       SET saya_balance = ?, staked_balance = ?, total_rewards_claimed = ?
       WHERE address = ?`,
      [newSayaBalance, newStakedBalance, newTotalRewardsClaimed, position.wallet_address]
    );

    await db.query(
      `UPDATE wallet_addresses
       SET balance = ?
       WHERE address = ?`,
      [newSayaBalance, position.wallet_address]
    );

    const reference = generateReference("STM");
    await logStakingActivity(
      position.wallet_address,
      "stake-claimed",
      "SAYA",
      totalAmount,
      "Completed",
      reference,
      {
        positionId: position.id,
        principal: principalAmount,
        reward: rewardAmount,
        txHash: receipt.transactionHash,
        settlementMode: "auto",
      }
    );

    await logTransactionRecord(
      position.wallet_address,
      receipt.transactionHash,
      "Staking Payout",
      totalAmount,
      "Completed"
    );

    await db.commit();

    return {
      positionId: position.id,
      walletAddress: position.wallet_address,
      txHash: receipt.transactionHash,
      principalAmount,
      rewardAmount,
      totalAmount,
      sayaBalanceAfterPayout: newSayaBalance,
      stakedBalanceAfterPayout: newStakedBalance,
    };
  } catch (error) {
    await db.rollback();
    throw error;
  }
};

const processMaturedStakes = async () => {
  try {
    const maturedPositions = await getMaturedActiveStakes();

    if (maturedPositions.length === 0) {
      return [];
    }

    const settlements = [];
    for (const position of maturedPositions) {
      try {
        const result = await settleMaturedStake(position);
        settlements.push({ status: "success", ...result });
      } catch (error) {
        console.error(`Failed to settle matured stake ${position.id}:`, error);
        settlements.push({
          status: "error",
          positionId: position.id,
          walletAddress: position.wallet_address,
          error: error?.message || String(error),
        });
      }
    }

    return settlements;
  } catch (error) {
    console.error("Failed to process matured stakes:", error);
    return [];
  }
};

const sendNativeTransfer = async ({ walletAddress, amount, contextLabel }) => {
  if (!walletAddress || !amount || Number(amount) <= 0) {
    throw new Error("Invalid wallet address or transfer amount.");
  }

  if (!web3.utils.isAddress(walletAddress)) {
    throw new Error(`Invalid wallet address format: ${walletAddress}`);
  }

  await web3.eth.getBlockNumber();
  const accountBalanceWei = await web3.eth.getBalance(account.address);
  const transferAmountInWei = web3.utils.toWei(amount.toString(), "ether");
  const gasPrice = await web3.eth.getGasPrice();
  const gasLimit = 21000;
  const totalCost = BigInt(transferAmountInWei) + BigInt(gasPrice) * BigInt(gasLimit);

  if (BigInt(accountBalanceWei) < totalCost) {
    throw new Error(
      `Insufficient node wallet balance for transfer + gas. Balance Wei: ${accountBalanceWei}, Needed Wei: ${totalCost.toString()}`
    );
  }

  const nonce = await web3.eth.getTransactionCount(account.address, "pending");
  const tx = {
    from: account.address,
    to: walletAddress,
    value: transferAmountInWei,
    gas: gasLimit,
    gasPrice,
    nonce,
  };

  console.log(`[${contextLabel}] Attempting to send ${transferAmountInWei} Wei to ${walletAddress}`);

  const signedTx = await web3.eth.accounts.signTransaction(tx, privateKey);
  const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);

  if (!receipt || !receipt.status) {
    throw new Error(`${contextLabel} transfer failed. No successful receipt returned.`);
  }

  console.log(`[${contextLabel}] Transaction successful, hash: ${receipt.transactionHash}`);
  return receipt;
};

// Function to get two random wallets
let selectedWallets = [];

const getRandomWallets = () => {
  connection.query(
    "SELECT address FROM wallet_addresses ORDER BY RAND() LIMIT 4",
    (error, results) => {
      if (error) {
        console.error("Error fetching random wallets:", error);
        return;
      }
      selectedWallets = results;
      console.log("Selected wallets:", selectedWallets);
    }
  );
};

// Function to save rewards in the database
const saveRewardsInDatabase = async () => {
  try {
    const balance = await web3.eth.getBalance(account.address);
    const balanceInEther = web3.utils.fromWei(balance, "ether");
    console.log(`Node balance: ${balanceInEther} SAYA`);

    // Fetch total rewards sent so far from transactions table
    const rewardQuery = `
      SELECT COALESCE(SUM(amount), 0) AS total_reward_sent
      FROM transactions
      WHERE transaction_type = 'Mining Reward' AND status = 'Completed'
    `;

    connection.query(rewardQuery, (error, results) => {
      if (error) {
        console.error("Error fetching total reward from database:", error);
        return;
      }
      const totalRewardSent = results[0]?.total_reward_sent || 0;
      console.log(`Total reward sent so far: ${totalRewardSent} SAYA`);

      const availableBalance = balanceInEther - totalRewardSent;
      console.log(
        `Available balance after deducting rewards: ${availableBalance} SAYA`
      );
      // Calculate 40% of the available balance
      const rewardPool = (availableBalance * 40) / 100;
      console.log(`Reward pool (40% of balance): ${rewardPool} SAYA`);

      const allUsers = selectedWallets.length;
      if (allUsers === 0) {
        console.log("No wallets selected for reward distribution.");
        return;
      }

      // Calculate reward per user
      const rewardPerUser = rewardPool / allUsers;
      console.log(`Reward per user: ${rewardPerUser} SAYA`);

      const totalUsersReward = rewardPerUser * allUsers;

      // Check for sufficient balance
      if (availableBalance < totalUsersReward) {
        console.log(
          "Insufficient balance after considering total rewards to save new rewards."
        );
        return;
      }

      const totalUsers = selectedWallets.length; // Get the count of selected wallets

      for (const wallet of selectedWallets) {
        // Save reward as a transaction record
        const txQuery = `
        INSERT INTO transactions (wallet_address, transaction_hash, transaction_type, amount, status)
        VALUES (?, UUID(), 'Mining Reward', ?, 'Completed')
      `;
        connection.query(
          txQuery,
          [wallet.address, rewardPerUser],
          (error, results) => {
            if (error) {
              console.error(
                "Error inserting reward transaction:",
                error
              );
            } else {
              console.log(
                `Reward transaction of ${rewardPerUser} SAYA logged for ${wallet.address}`
              );
            }
          }
        );

        // Optionally, update the total reward amount in the main wallet table
        const updateQuery =
          "UPDATE wallet_addresses SET reward_amount = reward_amount + ? WHERE address = ?";
        connection.query(
          updateQuery,
          [rewardPerUser, wallet.address],
          (error, results) => {
            if (error) {
              console.error(
                "Error updating reward in wallet_addresses:",
                error
              );
            }
          }
        );
      }

    });
  } catch (error) {
    console.error("Error saving rewards in the database:", error);
  }
};

// Endpoint to handle reward transfer when requested by the PHP API
app.post("/transferReward", async (req, res) => {
  const { wallet_address, reward_amount } = req.body;

  if (!wallet_address || !reward_amount || Number(reward_amount) <= 0) {
    return res.json({
      status: "error",
      message: "Invalid wallet address or reward amount."
    });
  }

  if (!web3.utils.isAddress(wallet_address)) {
    return res.json({
      status: "error",
      message: "Invalid wallet address format.",
      error: wallet_address
    });
  }

  try {
    const receipt = await sendNativeTransfer({
      walletAddress: wallet_address,
      amount: reward_amount,
      contextLabel: "Reward Claim"
    });

    await logTransactionRecord(wallet_address, receipt.transactionHash, "Reward Claim", reward_amount);

    res.json({
      status: "success",
      message: "Reward transferred to wallet.",
      txHash: receipt.transactionHash,
    });
  } catch (error) {
    console.error("Error during transaction:", error);
    const errorMessage = error?.message || String(error);

    res.json({
      status: "error",
      message: errorMessage.includes("nonce too low") ? "Nonce issue. Please try again." : "Error during transaction.",
      error: errorMessage,
    });
  }
});

app.post("/transferStakePayout", async (req, res) => {
  const {
    wallet_address,
    principal_amount,
    reward_amount,
    total_amount,
    position_id,
  } = req.body;

  const payoutAmount = Number(total_amount || 0) > 0
    ? Number(total_amount)
    : Number(principal_amount || 0) + Number(reward_amount || 0);

  if (!wallet_address || payoutAmount <= 0) {
    return res.json({
      status: "error",
      message: "Invalid wallet address or staking payout amount.",
    });
  }

  try {
    const receipt = await sendNativeTransfer({
      walletAddress: wallet_address,
      amount: payoutAmount,
      contextLabel: "Staking Payout"
    });

    await logTransactionRecord(wallet_address, receipt.transactionHash, "Staking Payout", payoutAmount);

    res.json({
      status: "success",
      message: "Staking payout transferred to wallet.",
      txHash: receipt.transactionHash,
      positionId: position_id ?? null,
      principalAmount: Number(principal_amount || 0),
      rewardAmount: Number(reward_amount || 0),
      totalAmount: payoutAmount,
    });
  } catch (error) {
    console.error("Error during staking payout:", error);
    const errorMessage = error?.message || String(error);
    res.json({
      status: "error",
      message: errorMessage.includes("nonce too low") ? "Nonce issue. Please try again." : "Error during staking payout.",
      error: errorMessage,
    });
  }
});

app.get('/staking/config', (_req, res) => {
  res.json({
    status: 'success',
    vaultAddress: account.address,
    rpcUrl,
    minDepositConfirmations: MIN_DEPOSIT_CONFIRMATIONS,
  });
});

app.post('/staking/deposit-intents', async (req, res) => {
  const walletAddress = String(req.body.wallet_address || '').trim().toLowerCase();
  const sourceWalletAddress = String(req.body.source_wallet_address || walletAddress).trim().toLowerCase();
  const amountSaya = Number(req.body.amount || 0);

  if (!walletAddress || !sourceWalletAddress || amountSaya <= 0) {
    return res.status(400).json({
      status: 'error',
      message: 'wallet_address, source_wallet_address, and a positive amount are required.',
    });
  }

  try {
    const currentBlock = await web3.eth.getBlockNumber();
    const [result] = await db.query(
      `INSERT INTO staking_deposit_intents (wallet_address, source_wallet_address, vault_address, amount_saya, expected_from_block, status)
       VALUES (?, ?, ?, ?, ?, 'pending_wallet_tx')`,
      [walletAddress, sourceWalletAddress, account.address, amountSaya, Number(currentBlock)]
    );

    res.json({
      status: 'success',
      intentId: result.insertId,
      vaultAddress: account.address,
      amountSaya,
      expectedFromBlock: Number(currentBlock),
      minDepositConfirmations: MIN_DEPOSIT_CONFIRMATIONS,
    });
  } catch (error) {
    console.error('Error creating staking deposit intent:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error creating staking deposit intent.',
      error: error?.message || String(error),
    });
  }
});

app.post('/staking/deposit-intents/:intentId/attachTx', async (req, res) => {
  const intentId = Number(req.params.intentId || 0);
  const txHash = String(req.body.tx_hash || '').trim();

  if (!intentId || !/^0x[0-9a-fA-F]+$/.test(txHash)) {
    return res.status(400).json({
      status: 'error',
      message: 'A valid intentId and tx_hash are required.',
    });
  }

  try {
    const [result] = await db.query(
      `UPDATE staking_deposit_intents
       SET tx_hash = ?, status = 'pending_confirmations', error_message = NULL
       WHERE id = ?`,
      [txHash, intentId]
    );

    if (result.affectedRows !== 1) {
      return res.status(404).json({
        status: 'error',
        message: 'Deposit intent not found.',
      });
    }

    const [intentRows] = await db.query(
      `SELECT * FROM staking_deposit_intents WHERE id = ? LIMIT 1`,
      [intentId]
    );

    const outcomes = await processPendingDeposits();

    res.json({
      status: 'success',
      intent: intentRows[0] || null,
      processing: outcomes.filter((entry) => entry.intentId === intentId),
    });
  } catch (error) {
    console.error('Error attaching staking deposit tx hash:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error attaching staking deposit tx hash.',
      error: error?.message || String(error),
    });
  }
});

app.get('/staking/deposits/:walletAddress', async (req, res) => {
  const walletAddress = String(req.params.walletAddress || '').trim().toLowerCase();

  try {
    const [rows] = await db.query(
      `SELECT id, source_wallet_address, vault_address, amount_saya, tx_hash, expected_from_block, detected_block_number, confirmations, status, error_message, credited_at, created_at, updated_at
       FROM staking_deposit_intents
       WHERE wallet_address = ?
       ORDER BY created_at DESC`,
      [walletAddress]
    );

    res.json({
      status: 'success',
      deposits: rows.map((deposit) => ({
        id: deposit.id,
        sourceWalletAddress: deposit.source_wallet_address,
        vaultAddress: deposit.vault_address,
        amountSaya: Number(deposit.amount_saya || 0),
        txHash: deposit.tx_hash,
        expectedFromBlock: deposit.expected_from_block,
        detectedBlockNumber: deposit.detected_block_number,
        confirmations: Number(deposit.confirmations || 0),
        status: deposit.status,
        errorMessage: deposit.error_message,
        creditedAt: deposit.credited_at,
        createdAt: deposit.created_at,
        updatedAt: deposit.updated_at,
      })),
    });
  } catch (error) {
    console.error('Error fetching staking deposits:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error fetching staking deposits.',
      error: error?.message || String(error),
    });
  }
});

app.get('/staking/deposits/pending', async (_req, res) => {
  try {
    const rows = await getPendingDepositIntents(50);
    res.json({
      status: 'success',
      count: rows.length,
      deposits: rows.map((deposit) => ({
        id: deposit.id,
        walletAddress: deposit.wallet_address,
        sourceWalletAddress: deposit.source_wallet_address,
        amountSaya: Number(deposit.amount_saya || 0),
        txHash: deposit.tx_hash,
        confirmations: Number(deposit.confirmations || 0),
        status: deposit.status,
        errorMessage: deposit.error_message,
        createdAt: deposit.created_at,
        updatedAt: deposit.updated_at,
      })),
    });
  } catch (error) {
    console.error('Error fetching pending staking deposits:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error fetching pending staking deposits.',
      error: error?.message || String(error),
    });
  }
});

app.post('/staking/processDeposits', async (_req, res) => {
  try {
    const outcomes = await processPendingDeposits();
    res.json({
      status: 'success',
      processed: outcomes.length,
      deposits: outcomes,
    });
  } catch (error) {
    console.error('Error processing staking deposits:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error processing staking deposits.',
      error: error?.message || String(error),
    });
  }
});

app.get("/staking/wallet/:walletAddress", async (req, res) => {
  try {
    const walletAddress = String(req.params.walletAddress || "").trim().toLowerCase();
    const summary = await getStakingWalletSummary(walletAddress);

    if (!summary) {
      return res.status(404).json({
        status: "error",
        message: "Staking wallet not found.",
      });
    }

    res.json({
      status: "success",
      ...summary,
    });
  } catch (error) {
    console.error("Error fetching staking wallet summary:", error);
    res.status(500).json({
      status: "error",
      message: "Error fetching staking wallet summary.",
      error: error?.message || String(error),
    });
  }
});

app.get("/staking/matured", async (_req, res) => {
  try {
    const maturedPositions = await getMaturedActiveStakes(50);
    res.json({
      status: "success",
      count: maturedPositions.length,
      positions: maturedPositions.map((position) => ({
        id: position.id,
        walletAddress: position.wallet_address,
        amountSaya: Number(position.amount_saya || 0),
        rewardEstimate: Number(position.reward_estimate || 0),
        endAt: position.end_at,
      })),
    });
  } catch (error) {
    console.error("Error fetching matured staking positions:", error);
    res.status(500).json({
      status: "error",
      message: "Error fetching matured staking positions.",
      error: error?.message || String(error),
    });
  }
});

app.post("/staking/processMatured", async (_req, res) => {
  try {
    const settlements = await processMaturedStakes();
    res.json({
      status: "success",
      processed: settlements.length,
      settlements,
    });
  } catch (error) {
    console.error("Error processing matured staking positions:", error);
    res.status(500).json({
      status: "error",
      message: "Error processing matured staking positions.",
      error: error?.message || String(error),
    });
  }
});

// Endpoint to get all transactions
app.get("/transactions", (req, res) => {
  connection.query(
    `SELECT wallet_address, transaction_hash, transaction_type, amount, status, created_at
     FROM transactions
     ORDER BY created_at DESC`,
    (error, results) => {
      if (error) {
        console.error("Error fetching transactions:", error);
        res.status(500).json({ error: "Error fetching transactions" });
      } else {
        res.json(results);
      }
    }
  );
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "reward-transfer", port });
});

app.get('/repnode/access-challenge/:walletAddress', async (req, res) => {
  const walletAddress = String(req.params.walletAddress || '').trim().toLowerCase();
  if (!web3.utils.isAddress(walletAddress)) {
    return res.status(400).json({ status: 'error', message: 'A valid wallet address is required.' });
  }

  const [registeredRows] = await db.query(
    `SELECT node_id FROM repnode_keys WHERE LOWER(wallet_address) = ? LIMIT 1`,
    [walletAddress]
  );
  if (registeredRows.length === 0) {
    return res.status(403).json({ status: 'error', authorized: false, message: 'This wallet is not assigned to a REP node.' });
  }

  const expiresAt = Date.now() + REPNODE_CHALLENGE_TTL_MS;
  const nonce = crypto.randomBytes(24).toString('hex');
  const message = [
    'IIC REP Node access',
    `Wallet: ${walletAddress}`,
    `Nonce: ${nonce}`,
    `Expires: ${expiresAt}`,
  ].join('\n');

  repnodeAccessChallenges.set(walletAddress, { message, expiresAt });
  res.json({ status: 'success', message, expiresAt });
});

app.post('/repnode/verify-access', async (req, res) => {
  const walletAddress = String(req.body.wallet_address || '').trim().toLowerCase();
  const signature = String(req.body.signature || '').trim();
  const challenge = repnodeAccessChallenges.get(walletAddress);

  if (!web3.utils.isAddress(walletAddress) || !signature || !challenge || challenge.expiresAt < Date.now()) {
    repnodeAccessChallenges.delete(walletAddress);
    return res.status(401).json({ status: 'error', authorized: false, message: 'Access challenge is missing or expired.' });
  }

  try {
    const recoveredAddress = web3.eth.accounts.recover(challenge.message, signature).toLowerCase();
    repnodeAccessChallenges.delete(walletAddress);

    if (recoveredAddress !== walletAddress) {
      return res.status(401).json({ status: 'error', authorized: false, message: 'Wallet signature does not match.' });
    }

    const [rows] = await db.query(
      `SELECT node_id FROM repnode_keys WHERE LOWER(wallet_address) = ? LIMIT 1`,
      [walletAddress]
    );

    if (rows.length === 0) {
      return res.status(403).json({ status: 'error', authorized: false, message: 'This wallet is not assigned to a REP node.' });
    }

    return res.json({ status: 'success', authorized: true, nodeId: Number(rows[0].node_id) });
  } catch (error) {
    repnodeAccessChallenges.delete(walletAddress);
    return res.status(401).json({ status: 'error', authorized: false, message: 'Unable to verify wallet signature.' });
  }
});

// Run getRandomWallets every 60 seconds
setInterval(getRandomWallets, 60000);

// Run saveRewardsInDatabase every 60 seconds
setInterval(saveRewardsInDatabase, 60000);

// Run pending deposit processing every 60 seconds
setInterval(() => {
  processPendingDeposits().catch((error) => {
    console.error('Unhandled staking deposit processor error:', error);
  });
}, STAKING_POLL_INTERVAL_MS);

// Endpoint to get the currently selected wallets
app.get("/randomWallets", (req, res) => {
  res.json(selectedWallets);
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
