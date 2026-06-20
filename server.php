<?php
// --- Repnode Key Management Helpers ---
function encryptKey($plaintext, $key) {
    $iv = random_bytes(16);
    $ciphertext = openssl_encrypt($plaintext, 'aes-256-cbc', $key, OPENSSL_RAW_DATA, $iv);
    return bin2hex($iv) . ':' . bin2hex($ciphertext);
}

function decryptKey($encrypted, $key) {
    list($ivHex, $cipherHex) = explode(':', $encrypted);
    $iv = hex2bin($ivHex);
    $ciphertext = hex2bin($cipherHex);
    return openssl_decrypt($ciphertext, 'aes-256-cbc', $key, OPENSSL_RAW_DATA, $iv);
}

function normalizeWalletAddress($address) {
    if (!is_string($address)) {
        return $address;
    }

    return strtolower(trim($address));
}

// 1. Allow the extension to access this file (CORS & Credentials)
if (isset($_SERVER['HTTP_ORIGIN'])) {
    header("Access-Control-Allow-Origin: {$_SERVER['HTTP_ORIGIN']}");
    header('Access-Control-Allow-Credentials: true');
    header('Access-Control-Max-Age: 86400');
}

if ($_SERVER['REQUEST_METHOD'] == 'OPTIONS') {
    if (isset($_SERVER['HTTP_ACCESS_CONTROL_REQUEST_METHOD']))
        header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
    if (isset($_SERVER['HTTP_ACCESS_CONTROL_REQUEST_HEADERS']))
        header("Access-Control-Allow-Headers: {$_SERVER['HTTP_ACCESS_CONTROL_REQUEST_HEADERS']}");
    exit(0);
}

ini_set('display_errors', 1);
error_reporting(E_ALL & ~E_WARNING & ~E_NOTICE);
header('Content-Type: application/json');

// --- LOAD PHPMAILER ---
require 'vendor/autoload.php';

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\SMTP;
use PHPMailer\PHPMailer\Exception;

// 2. Set Session Cookie Parameters
session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'domain' => '',
    'secure' => false,
    'httponly' => true,
    'samesite' => 'Lax'
]);

date_default_timezone_set('UTC');
session_start();

/* DATABASE CONFIG */
$localEnvPath = __DIR__ . '/.env';
if (is_file($localEnvPath)) {
    $localEnv = parse_ini_file($localEnvPath, false, INI_SCANNER_RAW) ?: [];
    foreach ($localEnv as $envName => $envValue) {
        if (getenv($envName) === false) {
            putenv($envName . '=' . $envValue);
        }
    }
}

$host = getenv('DB_HOST') ?: 'localhost';
$user = getenv('DB_USER') ?: 'root';
$pass = getenv('DB_PASSWORD') ?: '';
$db   = getenv('DB_NAME') ?: 'xeneablockchaindb';

$conn = new mysqli($host, $user, $pass, $db);
if ($conn->connect_error) {
    die(json_encode(['success'=>false,'error'=>'DB Failed: '.$conn->connect_error]));
}

$ENCRYPTION_KEY = getenv('ENCRYPTION_KEY') ?: '';

/* OTP STORAGE */
if (!isset($_SESSION['otp'])) { $_SESSION['otp'] = []; }
if (!isset($_SESSION['otp_store'])) { $_SESSION['otp_store'] = []; }

/* STAKING CONFIG */
define('DINNAR_TO_SAYA_RATE', 12.5);

/* ------------------------------------------------------------------
   HELPER FUNCTIONS
   ------------------------------------------------------------------ */

function ensureStakingTables($conn) {
    $walletTableSql = "
        CREATE TABLE IF NOT EXISTS staking_wallets (
            address VARCHAR(191) PRIMARY KEY,
            owner_name VARCHAR(255) NULL,
            contact_email VARCHAR(255) NULL,
            dinnar_balance DECIMAL(18,4) NOT NULL DEFAULT 2500.0000,
            saya_balance DECIMAL(18,4) NOT NULL DEFAULT 0.0000,
            staked_balance DECIMAL(18,4) NOT NULL DEFAULT 0.0000,
            total_rewards_claimed DECIMAL(18,4) NOT NULL DEFAULT 0.0000,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ";

    $positionsTableSql = "
        CREATE TABLE IF NOT EXISTS staking_positions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            wallet_address VARCHAR(191) NOT NULL,
            amount_saya DECIMAL(18,4) NOT NULL,
            duration_days INT NOT NULL,
            apr_rate DECIMAL(8,4) NOT NULL,
            reward_estimate DECIMAL(18,4) NOT NULL,
            status VARCHAR(32) NOT NULL DEFAULT 'active',
            source_asset VARCHAR(32) NOT NULL DEFAULT 'SAYA',
            start_at DATETIME NOT NULL,
            end_at DATETIME NOT NULL,
            claimed_reward DECIMAL(18,4) NOT NULL DEFAULT 0.0000,
            claimed_at DATETIME NULL,
            notes TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_staking_wallet_status (wallet_address, status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ";

    $activityTableSql = "
        CREATE TABLE IF NOT EXISTS staking_activities (
            id INT AUTO_INCREMENT PRIMARY KEY,
            wallet_address VARCHAR(191) NOT NULL,
            activity_type VARCHAR(64) NOT NULL,
            asset_symbol VARCHAR(32) NOT NULL,
            amount DECIMAL(18,4) NOT NULL,
            status VARCHAR(32) NOT NULL DEFAULT 'Completed',
            reference_code VARCHAR(80) NOT NULL,
            metadata TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_staking_activity_wallet (wallet_address, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ";

    if (!$conn->query($walletTableSql)) {
        throw new Exception('Failed to create staking_wallets table: ' . $conn->error);
    }

    if (!$conn->query($positionsTableSql)) {
        throw new Exception('Failed to create staking_positions table: ' . $conn->error);
    }

    if (!$conn->query($activityTableSql)) {
        throw new Exception('Failed to create staking_activities table: ' . $conn->error);
    }
}

function getStakingDurations() {
    return [
        1 => 1.0,
        30 => 8.5,
        90 => 12.5,
        180 => 18.0,
        365 => 24.0
    ];
}

function getStakingDurationSeconds($durationDays) {
    if ((int)$durationDays === 1) {
        return 60;
    }

    return (int)$durationDays * 86400;
}

function getStakingDurationLabel($durationDays, $aprRate) {
    if ((int)$durationDays === 1) {
        return '1 minute test at ' . rtrim(rtrim(number_format((float)$aprRate, 2, '.', ''), '0'), '.') . '% APR';
    }

    return (int)$durationDays . ' days at ' . rtrim(rtrim(number_format((float)$aprRate, 2, '.', ''), '0'), '.') . '% APR';
}

function getStakingRemainingLabel($secondsRemaining, $durationDays) {
    if ((int)$durationDays === 1) {
        $minutesRemaining = max(1, (int)ceil($secondsRemaining / 60));
        return $minutesRemaining === 1 ? '1 minute remaining' : $minutesRemaining . ' minutes remaining';
    }

    $daysRemaining = max(0, (int)ceil($secondsRemaining / 86400));
    return $daysRemaining === 1 ? '1 day remaining' : $daysRemaining . ' days remaining';
}

function generateStakingReference($prefix) {
    return $prefix . '-' . strtoupper(bin2hex(random_bytes(4))) . '-' . date('YmdHis');
}

function syncSayaBalanceToPrimaryWallet($conn, $address, $sayaBalance) {
    $stmt = $conn->prepare("UPDATE wallet_addresses SET balance = ? WHERE address = ?");
    if (!$stmt) {
        return;
    }

    $stmt->bind_param("ds", $sayaBalance, $address);
    $stmt->execute();
    $stmt->close();
}

function fetchPrimaryWalletProfile($conn, $address) {
    $stmt = $conn->prepare("SELECT username, email, balance FROM wallet_addresses WHERE address = ? LIMIT 1");
    if (!$stmt) {
        throw new Exception('Failed to prepare primary wallet query: ' . $conn->error);
    }

    $stmt->bind_param("s", $address);
    $stmt->execute();
    $result = $stmt->get_result();
    $wallet = $result->fetch_assoc() ?: null;
    $stmt->close();

    return $wallet;
}

function fetchOrCreateStakingWallet($conn, $address) {
    ensureStakingTables($conn);

    $primaryWallet = fetchPrimaryWalletProfile($conn, $address);
    $ownerName = $primaryWallet['username'] ?? null;
    $contactEmail = $primaryWallet['email'] ?? null;
    $primarySayaBalance = isset($primaryWallet['balance']) ? (float)$primaryWallet['balance'] : 0.0;

    $stmt = $conn->prepare("SELECT * FROM staking_wallets WHERE address = ?");
    if (!$stmt) {
        throw new Exception('Failed to prepare staking wallet query: ' . $conn->error);
    }

    $stmt->bind_param("s", $address);
    $stmt->execute();
    $result = $stmt->get_result();
    $wallet = $result->fetch_assoc();
    $stmt->close();

    if ($wallet) {
        $needsSync = ($wallet['owner_name'] ?? null) !== $ownerName
            || ($wallet['contact_email'] ?? null) !== $contactEmail
            || (float)$wallet['saya_balance'] !== $primarySayaBalance;

        if ($needsSync) {
            $syncStmt = $conn->prepare("UPDATE staking_wallets SET owner_name = ?, contact_email = ?, saya_balance = ? WHERE address = ?");
            if (!$syncStmt) {
                throw new Exception('Failed to prepare staking wallet sync: ' . $conn->error);
            }

            $syncStmt->bind_param("ssds", $ownerName, $contactEmail, $primarySayaBalance, $address);
            if (!$syncStmt->execute()) {
                $error = $syncStmt->error;
                $syncStmt->close();
                throw new Exception('Failed to sync staking wallet from common wallet: ' . $error);
            }
            $syncStmt->close();

            $wallet['owner_name'] = $ownerName;
            $wallet['contact_email'] = $contactEmail;
            $wallet['saya_balance'] = $primarySayaBalance;
        }

        return $wallet;
    }

    $defaultDinnarBalance = 2500.0;
    $insertStmt = $conn->prepare("INSERT INTO staking_wallets (address, owner_name, contact_email, dinnar_balance, saya_balance) VALUES (?, ?, ?, ?, ?)");
    if (!$insertStmt) {
        throw new Exception('Failed to prepare staking wallet insert: ' . $conn->error);
    }

    $insertStmt->bind_param("sssdd", $address, $ownerName, $contactEmail, $defaultDinnarBalance, $primarySayaBalance);
    if (!$insertStmt->execute()) {
        $insertStmt->close();
        throw new Exception('Failed to create staking wallet: ' . $conn->error);
    }
    $insertStmt->close();

    return [
        'address' => $address,
        'owner_name' => $ownerName,
        'contact_email' => $contactEmail,
        'dinnar_balance' => $defaultDinnarBalance,
        'saya_balance' => $primarySayaBalance,
        'staked_balance' => 0,
        'total_rewards_claimed' => 0
    ];
}

function recordStakingActivity($conn, $address, $activityType, $assetSymbol, $amount, $status, $referenceCode, $metadata = null) {
    $metadataJson = $metadata ? json_encode($metadata) : null;
    $stmt = $conn->prepare("INSERT INTO staking_activities (wallet_address, activity_type, asset_symbol, amount, status, reference_code, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)");
    if (!$stmt) {
        throw new Exception('Failed to prepare staking activity insert: ' . $conn->error);
    }

    $stmt->bind_param("sssdsis", $address, $activityType, $assetSymbol, $amount, $status, $referenceCode, $metadataJson);
    $stmt->close();
}

function insertStakingActivity($conn, $address, $activityType, $assetSymbol, $amount, $status, $referenceCode, $metadata = null) {
    $metadataJson = $metadata ? json_encode($metadata) : null;
    $stmt = $conn->prepare("INSERT INTO staking_activities (wallet_address, activity_type, asset_symbol, amount, status, reference_code, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)");
    if (!$stmt) {
        throw new Exception('Failed to prepare staking activity insert: ' . $conn->error);
    }

    $stmt->bind_param("sssdsss", $address, $activityType, $assetSymbol, $amount, $status, $referenceCode, $metadataJson);
    if (!$stmt->execute()) {
        $error = $stmt->error;
        $stmt->close();
        throw new Exception('Failed to insert staking activity: ' . $error);
    }
    $stmt->close();
}

function getStakingDashboardData($conn, $address) {
    ensureStakingTables($conn);
    $wallet = fetchOrCreateStakingWallet($conn, $address);
    $durationConfig = getStakingDurations();

    $positionsStmt = $conn->prepare("SELECT id, amount_saya, duration_days, apr_rate, reward_estimate, status, source_asset, start_at, end_at, claimed_reward, claimed_at, created_at FROM staking_positions WHERE wallet_address = ? ORDER BY created_at DESC");
    if (!$positionsStmt) {
        throw new Exception('Failed to prepare staking positions query: ' . $conn->error);
    }

    $positionsStmt->bind_param("s", $address);
    $positionsStmt->execute();
    $positionsResult = $positionsStmt->get_result();

    $positions = [];
    $totalProjectedReward = 0.0;
    $totalClaimableReward = 0.0;
    $totalActiveStaked = 0.0;
    $now = time();

    while ($row = $positionsResult->fetch_assoc()) {
        $amount = (float)$row['amount_saya'];
        $rewardEstimate = (float)$row['reward_estimate'];
        $durationDays = (int)$row['duration_days'];
        $status = $row['status'];
        $startAt = strtotime($row['start_at']);
        $endAt = strtotime($row['end_at']);
        $durationSeconds = max(1, $endAt - $startAt);
        $elapsedSeconds = min(max(0, $now - $startAt), $durationSeconds);
        $progressPercent = round(($elapsedSeconds / $durationSeconds) * 100, 2);
        $accruedReward = round($rewardEstimate * ($elapsedSeconds / $durationSeconds), 4);
        $canClaim = $status === 'active' && $now >= $endAt;
        $secondsRemaining = max(0, $endAt - $now);

        if ($status === 'active') {
            $totalProjectedReward += $rewardEstimate;
            $totalActiveStaked += $amount;
            if ($canClaim) {
                $totalClaimableReward += $rewardEstimate;
            }
        }

        $positions[] = [
            'id' => (int)$row['id'],
            'amountSaya' => $amount,
            'durationDays' => $durationDays,
            'durationLabel' => getStakingDurationLabel($durationDays, (float)$row['apr_rate']),
            'aprRate' => (float)$row['apr_rate'],
            'rewardEstimate' => $rewardEstimate,
            'status' => $canClaim ? 'claimable' : $status,
            'sourceAsset' => $row['source_asset'],
            'startAt' => $row['start_at'],
            'endAt' => $row['end_at'],
            'progressPercent' => $status === 'claimed' ? 100 : $progressPercent,
            'accruedReward' => $status === 'claimed' ? (float)$row['claimed_reward'] : $accruedReward,
            'claimedReward' => (float)$row['claimed_reward'],
            'claimedAt' => $row['claimed_at'],
            'canClaim' => $canClaim,
            'daysRemaining' => $canClaim || $status === 'claimed' ? 0 : max(0, ceil(($endAt - $now) / 86400)),
            'remainingLabel' => $canClaim || $status === 'claimed' ? 'Ready to release principal and reward.' : getStakingRemainingLabel($secondsRemaining, $durationDays)
        ];
    }
    $positionsStmt->close();

    $activitiesStmt = $conn->prepare("SELECT activity_type, asset_symbol, amount, status, reference_code, metadata, created_at FROM staking_activities WHERE wallet_address = ? ORDER BY created_at DESC LIMIT 12");
    if (!$activitiesStmt) {
        throw new Exception('Failed to prepare staking activity query: ' . $conn->error);
    }

    $activitiesStmt->bind_param("s", $address);
    $activitiesStmt->execute();
    $activitiesResult = $activitiesStmt->get_result();

    $activities = [];
    while ($activity = $activitiesResult->fetch_assoc()) {
        $activities[] = [
            'type' => $activity['activity_type'],
            'asset' => $activity['asset_symbol'],
            'amount' => (float)$activity['amount'],
            'status' => $activity['status'],
            'reference' => $activity['reference_code'],
            'metadata' => $activity['metadata'] ? json_decode($activity['metadata'], true) : null,
            'createdAt' => $activity['created_at']
        ];
    }
    $activitiesStmt->close();

    return [
        'wallet' => [
            'address' => $wallet['address'],
            'ownerName' => $wallet['owner_name'] ?? null,
            'contactEmail' => $wallet['contact_email'] ?? null,
            'dinnarBalance' => (float)$wallet['dinnar_balance'],
            'sayaBalance' => (float)$wallet['saya_balance'],
            'stakedBalance' => (float)$wallet['staked_balance'],
            'totalRewardsClaimed' => (float)$wallet['total_rewards_claimed']
        ],
        'config' => [
            'dinnarToSayaRate' => DINNAR_TO_SAYA_RATE,
            'durationOptions' => array_map(function ($days, $apr) {
                return ['days' => (int)$days, 'apr' => (float)$apr, 'label' => getStakingDurationLabel((int)$days, (float)$apr)];
            }, array_keys($durationConfig), array_values($durationConfig))
        ],
        'summary' => [
            'totalActiveStaked' => round($totalActiveStaked, 4),
            'totalProjectedReward' => round($totalProjectedReward, 4),
            'totalClaimableReward' => round($totalClaimableReward, 4),
            'totalRewardsClaimed' => (float)$wallet['total_rewards_claimed']
        ],
        'positions' => $positions,
        'activities' => $activities
    ];
}

function sendEmailOTP($email, $otp){
    $username = 'faizanshaikh0342@gmail.com';
    $password = getenv('SMTP_PASSWORD') ?: '';

    $mail = new PHPMailer(true);

    try {
        $mail->isSMTP();
        $mail->Host       = 'smtp.gmail.com';
        $mail->SMTPAuth   = true;
        $mail->Username   = $username;
        $mail->Password   = $password;
        $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
        $mail->Port       = 587;

        $mail->setFrom($username, 'Verification Service');
        $mail->addAddress($email);

        $mail->isHTML(true);
        $mail->Subject = 'Your Email OTP';
        $mail->Body    = "Your OTP is: <b>$otp</b>";
        $mail->AltBody = "Your OTP is: $otp";

        $mail->send();
        return true;
    } catch (Exception $e) {
        error_log("Mailer Error: " . $mail->ErrorInfo);
        return false;
    }
}

function sendSMSOTP($phone, $otp){
    $sid = getenv('TWILIO_ACCOUNT_SID') ?: '';
    $token = getenv('TWILIO_AUTH_TOKEN') ?: '';
    $from = getenv('TWILIO_FROM_NUMBER') ?: '';

    $url = "https://api.twilio.com/2010-04-01/Accounts/$sid/Messages.json";

    $data = [
        "From" => $from,
        "To"   => $phone,
        "Body" => "Your OTP is: $otp"
    ];

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($data));
    curl_setopt($ch, CURLOPT_USERPWD, "$sid:$token");
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode >= 200 && $httpCode < 300) {
        return true;
    } else {
        return false;
    }
}

/* ------------------------------------------------------------------
   GLOBAL INPUT HANDLING & LOGGING
   ------------------------------------------------------------------ */

// 1. Capture Input (Supports both JSON body and URL Parameters)
$jsonInput = json_decode(file_get_contents("php://input"), true);
if (!empty($jsonInput)) {
    $input = $jsonInput;
} else {
    $input = $_REQUEST;
}

if (isset($input['address'])) {
    $input['address'] = normalizeWalletAddress($input['address']);
}

if (isset($input['wallet_address'])) {
    $input['wallet_address'] = normalizeWalletAddress($input['wallet_address']);
}

$action = $_GET['action'] ?? $input['action'] ?? "UNKNOWN_ACTION";

// 2. GLOBAL CONSOLE LOGGING
error_log("------------------------------------------------------");
error_log(" [API HIT] Action: " . $action);
error_log(" [TIME]    " . date("Y-m-d H:i:s"));
error_log(" [PARAMS]  " . print_r($input, true));
error_log("------------------------------------------------------");


/* ------------------------------------------------------------------
   MAIN SWITCH LOGIC
   ------------------------------------------------------------------ */
switch ($action) {

    // 0. ✅ REP NODE KEY MANAGEMENT
    case 'addRepNodeKey':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            http_response_code(405);
            echo json_encode(['success' => false, 'error' => 'Method not allowed']);
            exit;
        }

        $node_id = $input['node_id'] ?? null;
        $private_key = $input['private_key'] ?? null;

        if (!$node_id || !$private_key) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'node_id and private_key required']);
            exit;
        }

        $encrypted = encryptKey($private_key, $ENCRYPTION_KEY);
        $stmt = $conn->prepare("INSERT INTO repnode_keys (node_id, encrypted_private_key) VALUES (?, ?) ON DUPLICATE KEY UPDATE encrypted_private_key = VALUES(encrypted_private_key)");
        $stmt->bind_param("is", $node_id, $encrypted);

        if ($stmt->execute()) {
            echo json_encode(['success' => true, 'node_id' => $node_id]);
        } else {
            http_response_code(500);
            echo json_encode(['success' => false, 'error' => 'DB error', 'details' => $stmt->error]);
        }

        $stmt->close();
        exit;

    case 'repnode-keys':
        if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
            http_response_code(405);
            echo json_encode(['success' => false, 'error' => 'Method not allowed']);
            exit;
        }

        $result = $conn->query("SELECT node_id, encrypted_private_key FROM repnode_keys ORDER BY node_id ASC");
        $keys = [];

        if ($result) {
            while ($row = $result->fetch_assoc()) {
                $keys[] = $row;
            }
        }

        echo json_encode($keys);
        exit;

    // 0b. ✅ ADMIN: GET ALL WALLETS
    case 'wallets':
        if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
            http_response_code(405);
            echo json_encode(['success' => false, 'error' => 'Method not allowed']);
            exit;
        }

        $result = $conn->query("SELECT address, balance, reward_amount, created_at FROM wallet_addresses ORDER BY created_at DESC LIMIT 1000");
        $wallets = [];

        if ($result) {
            while ($row = $result->fetch_assoc()) {
                $wallets[] = [
                    'address' => $row['address'],
                    'balance' => (float)$row['balance'],
                    'reward_amount' => (float)$row['reward_amount'],
                    'repnode_id' => null,
                    'created_at' => $row['created_at']
                ];
            }
        }

        echo json_encode($wallets);
        exit;

    // 0c. ✅ ADMIN: GET ALL TRANSACTIONS
    case 'get-all-transactions':
        if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
            http_response_code(405);
            echo json_encode(['success' => false, 'error' => 'Method not allowed']);
            exit;
        }

        $result = $conn->query("SELECT id, wallet_address, transaction_hash, transaction_type, amount, status, created_at FROM transactions ORDER BY created_at DESC LIMIT 1000");
        $transactions = [];

        if ($result) {
            while ($row = $result->fetch_assoc()) {
                $transactions[] = [
                    'id' => (int)$row['id'],
                    'date' => $row['created_at'],
                    'type' => $row['transaction_type'],
                    'amount' => (float)$row['amount'],
                    'status' => $row['status'],
                    'txHash' => $row['transaction_hash'],
                    'wallet_address' => $row['wallet_address']
                ];
            }
        }

        echo json_encode(['success' => true, 'transactions' => $transactions]);
        exit;

    // 0d. ✅ REPNODE: GET STATS FOR ADDRESS
    case 'get-repnode-stats':
        $address = $input['address'] ?? '';

        if (empty($address)) {
            echo json_encode(['success' => false, 'message' => 'Address is required']);
            exit;
        }

        $walletStmt = $conn->prepare("SELECT balance, reward_amount FROM wallet_addresses WHERE address = ?");
        $walletStmt->bind_param("s", $address);
        $walletStmt->execute();
        $walletResult = $walletStmt->get_result();
        $walletRow = $walletResult->fetch_assoc();
        $walletStmt->close();

        $txStmt = $conn->prepare("SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM transactions WHERE wallet_address = ?");
        $txStmt->bind_param("s", $address);
        $txStmt->execute();
        $txResult = $txStmt->get_result();
        $txRow = $txResult->fetch_assoc();
        $txStmt->close();

        $statusStmt = $conn->prepare("SELECT status FROM transactions WHERE wallet_address = ? ORDER BY created_at DESC LIMIT 1");
        $statusStmt->bind_param("s", $address);
        $statusStmt->execute();
        $statusResult = $statusStmt->get_result();
        $statusRow = $statusResult->fetch_assoc();
        $statusStmt->close();

        echo json_encode([
            'success' => true,
            'balance' => isset($walletRow['balance']) ? (float)$walletRow['balance'] : 0,
            'rewardAmount' => isset($walletRow['reward_amount']) ? (float)$walletRow['reward_amount'] : 0,
            'totalRewards' => (float)$txRow['total'],
            'totalTransactions' => (int)$txRow['count'],
            'status' => $statusRow['status'] ?? 'Active'
        ]);
        exit;

    case 'get-staking-dashboard':
        $address = trim($input['address'] ?? '');

        if ($address === '') {
            echo json_encode(['success' => false, 'message' => 'Address is required']);
            exit;
        }

        try {
            $dashboard = getStakingDashboardData($conn, $address);
            echo json_encode(['success' => true] + $dashboard);
        } catch (Exception $e) {
            http_response_code(500);
            echo json_encode(['success' => false, 'message' => $e->getMessage()]);
        }
        exit;

    case 'exchange-staking-asset':
        $address = trim($input['address'] ?? '');
        $direction = $input['direction'] ?? '';
        $amount = isset($input['amount']) ? (float)$input['amount'] : 0;

        if ($address === '' || $amount <= 0) {
            echo json_encode(['success' => false, 'message' => 'Address and a positive amount are required']);
            exit;
        }

        if ($direction !== 'dinnar-to-saya' && $direction !== 'saya-to-dinnar') {
            echo json_encode(['success' => false, 'message' => 'Invalid exchange direction']);
            exit;
        }

        try {
            ensureStakingTables($conn);
            $conn->begin_transaction();

            $wallet = fetchOrCreateStakingWallet($conn, $address);
            $dinnarBalance = (float)$wallet['dinnar_balance'];
            $sayaBalance = (float)$wallet['saya_balance'];

            if ($direction === 'dinnar-to-saya') {
                if ($dinnarBalance < $amount) {
                    throw new Exception('Insufficient DINNAR balance for this exchange');
                }

                $convertedAmount = round($amount * DINNAR_TO_SAYA_RATE, 4);
                $newDinnarBalance = $dinnarBalance - $amount;
                $newSayaBalance = $sayaBalance + $convertedAmount;
                $assetSymbol = 'DINNAR';
                $metadata = ['receivedAsset' => 'SAYA', 'receivedAmount' => $convertedAmount, 'rate' => DINNAR_TO_SAYA_RATE];
            } else {
                if ($sayaBalance < $amount) {
                    throw new Exception('Insufficient SAYA balance for this exchange');
                }

                $convertedAmount = round($amount / DINNAR_TO_SAYA_RATE, 4);
                $newDinnarBalance = $dinnarBalance + $convertedAmount;
                $newSayaBalance = $sayaBalance - $amount;
                $assetSymbol = 'SAYA';
                $metadata = ['receivedAsset' => 'DINNAR', 'receivedAmount' => $convertedAmount, 'rate' => DINNAR_TO_SAYA_RATE];
            }

            $updateStmt = $conn->prepare("UPDATE staking_wallets SET dinnar_balance = ?, saya_balance = ? WHERE address = ?");
            $updateStmt->bind_param("dds", $newDinnarBalance, $newSayaBalance, $address);
            if (!$updateStmt->execute()) {
                $error = $updateStmt->error;
                $updateStmt->close();
                throw new Exception('Failed to update balances: ' . $error);
            }
            $updateStmt->close();

            syncSayaBalanceToPrimaryWallet($conn, $address, $newSayaBalance);
            insertStakingActivity($conn, $address, 'asset-exchange', $assetSymbol, $amount, 'Completed', generateStakingReference('EXC'), $metadata);

            $conn->commit();
            $dashboard = getStakingDashboardData($conn, $address);
            echo json_encode([
                'success' => true,
                'message' => 'Exchange completed successfully',
                'convertedAmount' => $convertedAmount
            ] + $dashboard);
        } catch (Exception $e) {
            $conn->rollback();
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => $e->getMessage()]);
        }
        exit;

    case 'create-saya-stake':
        $address = trim($input['address'] ?? '');
        $amount = isset($input['amount']) ? (float)$input['amount'] : 0;
        $durationDays = isset($input['durationDays']) ? (int)$input['durationDays'] : 0;
        $durationConfig = getStakingDurations();

        if ($address === '' || $amount <= 0 || !isset($durationConfig[$durationDays])) {
            echo json_encode(['success' => false, 'message' => 'Address, amount, and valid duration are required']);
            exit;
        }

        try {
            ensureStakingTables($conn);
            $conn->begin_transaction();

            $wallet = fetchOrCreateStakingWallet($conn, $address);
            $sayaBalance = (float)$wallet['saya_balance'];
            if ($sayaBalance < $amount) {
                throw new Exception('Not enough SAYA balance to create this stake');
            }

            $aprRate = (float)$durationConfig[$durationDays];
            $durationSeconds = getStakingDurationSeconds($durationDays);
            $rewardEstimate = round($amount * ($aprRate / 100) * ($durationSeconds / (365 * 86400)), 4);
            if ($durationDays === 1 && $rewardEstimate < 0.0001) {
                $rewardEstimate = 0.0001;
            }
            $startAt = date('Y-m-d H:i:s');
            $endAt = date('Y-m-d H:i:s', time() + $durationSeconds);

            $positionStmt = $conn->prepare("INSERT INTO staking_positions (wallet_address, amount_saya, duration_days, apr_rate, reward_estimate, start_at, end_at, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
            $notes = 'SAYA-only PoA staking position';
            $positionStmt->bind_param("sdiddsss", $address, $amount, $durationDays, $aprRate, $rewardEstimate, $startAt, $endAt, $notes);
            if (!$positionStmt->execute()) {
                $error = $positionStmt->error;
                $positionStmt->close();
                throw new Exception('Failed to create staking position: ' . $error);
            }
            $createdPositionId = (int)$positionStmt->insert_id;
            $positionStmt->close();

            $newSayaBalance = $sayaBalance - $amount;
            $newStakedBalance = (float)$wallet['staked_balance'] + $amount;
            $walletStmt = $conn->prepare("UPDATE staking_wallets SET saya_balance = ?, staked_balance = ? WHERE address = ?");
            $walletStmt->bind_param("dds", $newSayaBalance, $newStakedBalance, $address);
            if (!$walletStmt->execute()) {
                $error = $walletStmt->error;
                $walletStmt->close();
                throw new Exception('Failed to update staking wallet: ' . $error);
            }
            $walletStmt->close();

            syncSayaBalanceToPrimaryWallet($conn, $address, $newSayaBalance);
            $stakeReference = generateStakingReference('STK');
            insertStakingActivity($conn, $address, 'stake-created', 'SAYA', $amount, 'Locked', $stakeReference, ['positionId' => $createdPositionId, 'durationDays' => $durationDays, 'aprRate' => $aprRate, 'rewardEstimate' => $rewardEstimate, 'walletBalanceAfterStake' => $newSayaBalance]);

            $conn->commit();
            $dashboard = getStakingDashboardData($conn, $address);
            echo json_encode([
                'success' => true,
                'message' => 'SAYA stake created successfully',
                'createdStake' => [
                    'positionId' => $createdPositionId,
                    'reference' => $stakeReference,
                    'amountSaya' => round($amount, 4),
                    'durationDays' => $durationDays,
                    'walletBalanceAfterStake' => round($newSayaBalance, 4),
                    'stakedBalanceAfterStake' => round($newStakedBalance, 4)
                ]
            ] + $dashboard);
        } catch (Exception $e) {
            $conn->rollback();
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => $e->getMessage()]);
        }
        exit;

    case 'claim-saya-stake':
        $address = trim($input['address'] ?? '');
        $positionId = isset($input['positionId']) ? (int)$input['positionId'] : 0;

        if ($address === '' || $positionId <= 0) {
            echo json_encode(['success' => false, 'message' => 'Address and positionId are required']);
            exit;
        }

        try {
            ensureStakingTables($conn);
            $conn->begin_transaction();

            $positionStmt = $conn->prepare("SELECT id, amount_saya, reward_estimate, status, end_at FROM staking_positions WHERE id = ? AND wallet_address = ? LIMIT 1");
            $positionStmt->bind_param("is", $positionId, $address);
            $positionStmt->execute();
            $positionResult = $positionStmt->get_result();
            $position = $positionResult->fetch_assoc();
            $positionStmt->close();

            if (!$position) {
                throw new Exception('Staking position not found');
            }

            if ($position['status'] !== 'active') {
                throw new Exception('This staking position is no longer active');
            }

            if (time() < strtotime($position['end_at'])) {
                throw new Exception('This stake has not matured yet');
            }

            $wallet = fetchOrCreateStakingWallet($conn, $address);
            $principal = (float)$position['amount_saya'];
            $reward = (float)$position['reward_estimate'];
            $totalReturn = $principal + $reward;

            $postData = json_encode([
                'wallet_address' => $address,
                'principal_amount' => round($principal, 8),
                'reward_amount' => round($reward, 8),
                'total_amount' => round($totalReturn, 8),
                'position_id' => $positionId
            ]);

            $ch = curl_init('http://localhost:3001/transferStakePayout');
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_POSTFIELDS, $postData);
            $payoutResponse = curl_exec($ch);
            $curlError = curl_error($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            if ($payoutResponse === false) {
                throw new Exception('Staking payout service unreachable: ' . $curlError . ' (HTTP ' . $httpCode . ')');
            }

            $nodeResponse = json_decode($payoutResponse, true);
            if (!$nodeResponse || ($nodeResponse['status'] ?? null) !== 'success') {
                $errorMessage = $nodeResponse['error'] ?? $nodeResponse['message'] ?? 'Unknown staking payout service error';
                throw new Exception('Staking payout failed: ' . $errorMessage);
            }

            $payoutTxHash = $nodeResponse['txHash'] ?? null;

            $claimStmt = $conn->prepare("UPDATE staking_positions SET status = 'claimed', claimed_reward = ?, claimed_at = NOW() WHERE id = ? AND wallet_address = ?");
            $claimStmt->bind_param("dis", $reward, $positionId, $address);
            if (!$claimStmt->execute()) {
                $error = $claimStmt->error;
                $claimStmt->close();
                throw new Exception('Failed to update staking position: ' . $error);
            }
            $claimStmt->close();

            // The principal and reward were transferred out of custody to the
            // user's on-chain wallet, so they must not become lockable again.
            $newSayaBalance = (float)$wallet['saya_balance'];
            $newStakedBalance = max(0, (float)$wallet['staked_balance'] - $principal);
            $newTotalRewardsClaimed = (float)$wallet['total_rewards_claimed'] + $reward;

            $walletStmt = $conn->prepare("UPDATE staking_wallets SET saya_balance = ?, staked_balance = ?, total_rewards_claimed = ? WHERE address = ?");
            $walletStmt->bind_param("ddds", $newSayaBalance, $newStakedBalance, $newTotalRewardsClaimed, $address);
            if (!$walletStmt->execute()) {
                $error = $walletStmt->error;
                $walletStmt->close();
                throw new Exception('Failed to settle staking wallet: ' . $error);
            }
            $walletStmt->close();

            syncSayaBalanceToPrimaryWallet($conn, $address, $newSayaBalance);
            insertStakingActivity($conn, $address, 'stake-claimed', 'SAYA', $totalReturn, 'Completed', generateStakingReference('CLM'), ['principal' => $principal, 'reward' => $reward, 'txHash' => $payoutTxHash, 'positionId' => $positionId]);

            $conn->commit();
            $dashboard = getStakingDashboardData($conn, $address);
            echo json_encode([
                'success' => true,
                'message' => 'Stake released to common wallet successfully',
                'txHash' => $payoutTxHash,
                'principalAmount' => round($principal, 8),
                'rewardAmount' => round($reward, 8),
                'totalAmount' => round($totalReturn, 8)
            ] + $dashboard);
        } catch (Exception $e) {
            $conn->rollback();
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => $e->getMessage()]);
        }
        exit;

    // 1. GET USER BY ADDRESS
    case "get-user-by-address":
        $address = $input['address'] ?? '';
        $stmt = $conn->prepare("SELECT * FROM wallet_addresses WHERE address=?");
        $stmt->bind_param("s", $address);
        $stmt->execute();
        $res = $stmt->get_result();
        if ($res->num_rows == 0) {
            echo json_encode(['success'=>false, 'message'=>"Address not found"]);
            exit;
        }
        echo json_encode(['success'=>true,'user'=>$res->fetch_assoc()]);
        exit;

    // 2. SEND EMAIL OTP (Legacy/Single)
    case "send-email-otp":
        $email = $input['email'] ?? '';
        $otp = rand(100000, 999999);

        error_log("**************");
        error_log(" ✅ EMAIL OTP: " . $email);
        error_log(" ✅ OTP:       " . $otp);
        error_log("**************");

        $_SESSION['otp'][$email] = $otp;

        if(sendEmailOTP($email, $otp)){
            echo json_encode(['success'=>true, 'otp'=>$otp]);
        } else {
            echo json_encode(['success'=>false, 'message'=>'Failed to send Email']);
        }
        exit;

    // 3. SEND SMS OTP (Legacy/Single)
    case "send-sms-otp":
        $phone = $input['phone'] ?? '';
        $otp = rand(100000, 999999);

        error_log("**************");
        error_log(" ✅ PHONE OTP: " . $phone);
        error_log(" ✅ OTP:       " . $otp);
        error_log("**************");

        $_SESSION['otp'][$phone] = $otp;

        if(sendSMSOTP($phone, $otp)){
            echo json_encode(['success'=>true, 'otp'=>$otp]);
        } else {
            echo json_encode(['success'=>false, 'message'=>'Failed to send SMS']);
        }
        exit;

    // 4. VERIFY OTPS (Legacy/Single Step)
    case "verify-otps":
        $key = $input['key'] ?? '';
        $otp = $input['otp'] ?? '';

        error_log("**************");
        error_log(" ✅ KEY:  " . $key);
        error_log(" ✅ OTP:  " . $otp);
        error_log("**************");

        if (!isset($_SESSION['otp'][$key]) || $_SESSION['otp'][$key] != $otp) {
            echo json_encode(['verified'=>false]);
            exit;
        }

        echo json_encode(['verified'=>true]);
        exit;

    // 4b. VERIFY EMAIL OTP (Onboarding step-by-step)
    case 'verify-email-otp':
        $email = $input['email'] ?? '';
        $otp   = $input['otp'] ?? '';

        if (empty($email) || empty($otp)) {
            echo json_encode(['success'=>false, 'message'=>'Email and OTP are required']);
            exit;
        }

        $storedEmailOtp = $_SESSION['otp_store'][$email] ?? $_SESSION['otp'][$email] ?? '';

        if ($storedEmailOtp != $otp) {
            echo json_encode(['success'=>false, 'message'=>'Invalid OTP']);
            exit;
        }

        echo json_encode(['success'=>true, 'message'=>'Email OTP Verified']);
        exit;

    // 5. INITIATE VERIFICATION (Onboarding)
    case 'initiate-verification':
        $address = $input['address'] ?? '';
        if (!$address) { echo json_encode(['exists' => false]); exit; }

        $stmt = $conn->prepare("SELECT * FROM wallet_addresses WHERE address = ?");
        $stmt->bind_param("s", $address);
        $stmt->execute();
        $res = $stmt->get_result();

        if ($res->num_rows === 0) { echo json_encode(['exists' => false]); exit; }

        $user = $res->fetch_assoc();
        $email = $user['email'];
        $phone = !empty($user['phone']) ? $user['phone'] : $user['number'];

        $otpEmail = rand(100000, 999999);
        $otpSMS   = rand(100000, 999999);

        error_log("**************");
        error_log(" ✅ EMAIL OTP: " . $otpEmail);
        error_log(" ✅ SMS OTP:   " . $otpSMS);
        error_log(" Storing for address: " . $address);
        error_log("**************");

        // Prefer DB OTP storage; fallback to session when schema doesn't support OTP columns.
        $updateStmt = $conn->prepare("UPDATE wallet_addresses SET email_otp = ?, phone_otp = ?, otp_created_at = NOW() WHERE address = ?");
        if ($updateStmt) {
            $updateStmt->bind_param("sss", $otpEmail, $otpSMS, $address);
            $result = $updateStmt->execute();
            $affectedRows = $updateStmt->affected_rows;
            $updateStmt->close();

            error_log(" UPDATE result: " . ($result ? "SUCCESS" : "FAILED"));
            error_log(" Affected rows: " . $affectedRows);
        } else {
            error_log(" OTP DB storage unavailable, falling back to session: " . $conn->error);
            $_SESSION['otp_store'][$email] = $otpEmail;
            $_SESSION['otp_store'][$phone] = $otpSMS;
        }

        sendEmailOTP($email, $otpEmail);
        sendSMSOTP($phone, $otpSMS);

        echo json_encode([
            'exists'   => true,
            'username' => $user['username'],
            'email'    => $email,
            'phone'    => $phone,
            'emailOtp' => $otpEmail,
            'smsOtp'   => $otpSMS
        ]);
        exit;

    // 5b. ACCOUNT VERIFICATION (Onboarding Alias)
    case 'account-verification':
        $address = $input['address'] ?? '';
        if (!$address) { echo json_encode(['exists' => false]); exit; }

        $stmt = $conn->prepare("SELECT * FROM wallet_addresses WHERE address = ?");
        $stmt->bind_param("s", $address);
        $stmt->execute();
        $res = $stmt->get_result();

        if ($res->num_rows === 0) { echo json_encode(['exists' => false]); exit; }

        $user = $res->fetch_assoc();
        $email = $user['email'];
        $phone = !empty($user['phone']) ? $user['phone'] : $user['number'];

        $otpEmail = rand(100000, 999999);
        $otpSMS   = rand(100000, 999999);

        error_log("**************");
        error_log(" ✅ EMAIL OTP: " . $otpEmail);
        error_log(" ✅ SMS OTP:   " . $otpSMS);
        error_log("**************");

        $_SESSION['otp_store'][$email] = $otpEmail;
        $_SESSION['otp_store'][$phone] = $otpSMS;

        sendEmailOTP($email, $otpEmail);
        sendSMSOTP($phone, $otpSMS);

        echo json_encode([
            'exists'   => true,
            'username' => $user['username'],
            'email'    => $email,
            'phone'    => $phone,
            'emailOtp' => $otpEmail,
            'smsOtp'   => $otpSMS
        ]);
        exit;

    // 6b. VERIFY BOTH OTPS (Onboarding Alias)
    case 'account-verify-otp':
         $email = $input['email'] ?? '';
         $phone = $input['phone'] ?? '';
         $emailOtp = $input['emailOtp'] ?? '';
         $phoneOtp = $input['phoneOtp'] ?? '';

         $storedEmailOtp = $_SESSION['otp_store'][$email] ?? '';
         $storedPhoneOtp = $_SESSION['otp_store'][$phone] ?? '';

         if ($storedEmailOtp != $emailOtp || $storedPhoneOtp != $phoneOtp) {
             echo json_encode(['success'=>false,'message'=>'Invalid OTP']);
             exit;
         }
         echo json_encode(['success'=>true,'message'=>'OTP Verified']);
         exit;

    // 6. VERIFY BOTH OTPS (Onboarding)
    case 'verify-otp':
         $address = $input['address'] ?? '';
         $email = $input['email'] ?? '';
         $phone = $input['phone'] ?? '';
         $emailOtp = $input['emailOtp'] ?? '';
         $phoneOtp = $input['phoneOtp'] ?? '';

         error_log("**************");
         error_log(" 🔍 VERIFY OTP REQUEST:");
         error_log(" Address: " . $address);
         error_log(" Email: " . $email);
         error_log(" Phone: " . $phone);
         error_log(" Email OTP (input): " . $emailOtp);
         error_log(" Phone OTP (input): " . $phoneOtp);
         
         $storedEmailOtp = $_SESSION['otp_store'][$email] ?? '';
         $storedPhoneOtp = $_SESSION['otp_store'][$phone] ?? '';
         $otpCreatedAt = null;
         $userAddress = $address;

         // Get OTPs from database when supported by schema.
         if (!empty($address)) {
             $stmt = $conn->prepare("SELECT email_otp, phone_otp, otp_created_at, address FROM wallet_addresses WHERE address = ?");
             if ($stmt) {
                 $stmt->bind_param("s", $address);
             }
         } else {
             $stmt = $conn->prepare("SELECT email_otp, phone_otp, otp_created_at, address FROM wallet_addresses WHERE LOWER(email) = LOWER(?)");
             if ($stmt) {
                 $stmt->bind_param("s", $email);
             }
         }

         if ($stmt) {
             $stmt->execute();
             $result = $stmt->get_result();
             
             if ($result->num_rows === 0) {
                 error_log(" ❌ User not found!");
                 echo json_encode(['success'=>false,'message'=>'User not found']);
                 $stmt->close();
                 exit;
             }
             
             $row = $result->fetch_assoc();
             $storedEmailOtp = $row['email_otp'] ?? $storedEmailOtp;
             $storedPhoneOtp = $row['phone_otp'] ?? $storedPhoneOtp;
             $otpCreatedAt = $row['otp_created_at'] ?? null;
             $userAddress = $row['address'] ?? $userAddress;

             $stmt->close();
         } else {
             error_log(" OTP DB verification unavailable, using session fallback: " . $conn->error);
         }

         error_log(" Email OTP (stored): '" . $storedEmailOtp . "'");
         error_log(" Phone OTP (stored): '" . $storedPhoneOtp . "'");
         error_log(" OTP Created At: " . $otpCreatedAt);
         error_log(" User Address: " . $userAddress);
         error_log("**************");

         // Check if OTPs are empty
         if (empty($storedEmailOtp) || empty($storedPhoneOtp)) {
             error_log(" ❌ No OTP found in database!");
             echo json_encode(['success'=>false,'message'=>'No OTP found. Please request verification first.']);
             exit;
         }

         // Check if OTP expired (15 minutes)
         if ($otpCreatedAt) {
             $otpTime = strtotime($otpCreatedAt);
             $currentTime = time();
             if (($currentTime - $otpTime) > 900) {
                 error_log(" ❌ OTP Expired!");
                 echo json_encode(['success'=>false,'message'=>'OTP expired. Please request a new one.']);
                 exit;
             }
         }

         // Convert to string for comparison
         if (strval($storedEmailOtp) != strval($emailOtp) || strval($storedPhoneOtp) != strval($phoneOtp)) {
             error_log(" ❌ OTP Mismatch!");
             echo json_encode(['success'=>false,'message'=>'Invalid OTP']);
             exit;
         }
         
         // Clear OTPs after successful verification
         $clearStmt = $conn->prepare("UPDATE wallet_addresses SET email_otp = NULL, phone_otp = NULL WHERE address = ?");
         if ($clearStmt) {
             $clearStmt->bind_param("s", $userAddress);
             $clearStmt->execute();
             $clearStmt->close();
         }
         if (!empty($email)) { unset($_SESSION['otp_store'][$email]); }
         if (!empty($phone)) { unset($_SESSION['otp_store'][$phone]); }
         
         error_log(" ✅ OTP Match!");
         echo json_encode(['success'=>true,'message'=>'OTP Verified']);
         exit;

    // 7. VERIFY OTP AND REGISTER WITH KBA (UPDATED)
    case 'verify-otpss':
        $emailOtp = $input['emailOtp'] ?? '';
        $phoneOtp = $input['phoneOtp'] ?? '';
        $username = $input['username'] ?? '';
        $number   = $input['number']   ?? '';
        $address  = $input['address']  ?? '';
        $email    = $input['email']    ?? '';
        $phone    = $input['phone']    ?? '';

        // ✅ KBA Fields
        $placeOfBirth = $input['placeOfBirth'] ?? '';
        $firstSchool = $input['firstSchool'] ?? '';
        $favoriteColor = $input['favoriteColor'] ?? '';
        $motherMaidenName = $input['motherMaidenName'] ?? '';
        $firstPetName = $input['firstPetName'] ?? '';
        $childhoodFriend = $input['childhoodFriend'] ?? '';

        error_log("**************");
        error_log(" 🔐 KBA DATA RECEIVED:");
        error_log(" Place of Birth: " . $placeOfBirth);
        error_log(" First School: " . $firstSchool);
        error_log(" Favorite Color: " . $favoriteColor);
        error_log(" Mother's Maiden Name: " . $motherMaidenName);
        error_log(" First Pet: " . $firstPetName);
        error_log(" Childhood Friend: " . $childhoodFriend);
        error_log("**************");

        $storedEmailOtp = $_SESSION['otp_store'][$email] ?? '';
        $storedPhoneOtp = $_SESSION['otp_store'][$phone] ?? '';

        if ($storedEmailOtp != $emailOtp || $storedPhoneOtp != $phoneOtp) {
            echo json_encode(['success'=>false,'message'=>'Invalid OTP']);
            exit;
        }

        // Check if user already exists
        $checkStmt = $conn->prepare("SELECT * FROM wallet_addresses WHERE address = ?");
        $checkStmt->bind_param("s", $address);
        $checkStmt->execute();
        $checkRes = $checkStmt->get_result();

        if ($checkRes->num_rows > 0) {
            $existingUser = $checkRes->fetch_assoc();
            echo json_encode(['success'=>true,'message'=>'User already exists','user'=>$existingUser]);
            exit;
        }

        // ✅ Hash KBA answers (IMPORTANT: Hash for security!)
        $hashedPlaceOfBirth = password_hash(strtolower(trim($placeOfBirth)), PASSWORD_DEFAULT);
        $hashedFirstSchool = password_hash(strtolower(trim($firstSchool)), PASSWORD_DEFAULT);
        $hashedFavoriteColor = password_hash(strtolower(trim($favoriteColor)), PASSWORD_DEFAULT);
        $hashedMotherMaidenName = password_hash(strtolower(trim($motherMaidenName)), PASSWORD_DEFAULT);
        $hashedFirstPetName = password_hash(strtolower(trim($firstPetName)), PASSWORD_DEFAULT);
        $hashedChildhoodFriend = password_hash(strtolower(trim($childhoodFriend)), PASSWORD_DEFAULT);

        $balance = 0;
        $reward_amount = 0;

        // ✅ Updated SQL with KBA columns (REMOVED teacher and hobby)
        $stmt = $conn->prepare("
            INSERT INTO wallet_addresses
            (address, balance, reward_amount, username, email, number,
             place_of_birth, first_school, favorite_color, mother_maiden_name,
             first_pet_name, childhood_friend)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ");

        $stmt->bind_param(
            "sddsssssssss",
            $address,
            $balance,
            $reward_amount,
            $username,
            $email,
            $number,
            $hashedPlaceOfBirth,
            $hashedFirstSchool,
            $hashedFavoriteColor,
            $hashedMotherMaidenName,
            $hashedFirstPetName,
            $hashedChildhoodFriend
        );

        if ($stmt->execute()) {
            unset($_SESSION['otp_store'][$email]);
            unset($_SESSION['otp_store'][$phone]);

            error_log("✅ User registered successfully with KBA data!");

            echo json_encode([
                'success' => true,
                'message' => 'User Registered Successfully with KBA',
                'balance' => 0,
                'reward_amount' => 0
            ]);
        } else {
            error_log("❌ Database Error: " . $stmt->error);
            echo json_encode(['success'=>false, 'message'=>'Database Error: '.$stmt->error]);
        }
    // 8. SEND BOTH OTPS WITH KBA (UPDATED)
    case 'send-otpss':
        $email = $input['email'] ?? '';
        $phone = $input['phone'] ?? '';

        // ✅ KBA Fields (Receive but don't process yet)
        $placeOfBirth = $input['placeOfBirth'] ?? '';
        $firstSchool = $input['firstSchool'] ?? '';
        $favoriteColor = $input['favoriteColor'] ?? '';
        $motherMaidenName = $input['motherMaidenName'] ?? '';
        $firstPetName = $input['firstPetName'] ?? '';
        $childhoodFriend = $input['childhoodFriend'] ?? '';

        // Validate all fields including KBA (REMOVED teacher and hobby)
        if(empty($email) || empty($phone) ||
           empty($placeOfBirth) || empty($firstSchool) || empty($favoriteColor) ||
           empty($motherMaidenName) || empty($firstPetName) || empty($childhoodFriend)) {
            echo json_encode(['success'=>false, 'message'=>'All fields including security questions are required']);
            exit;
        }

        error_log("**************");
        error_log(" 📝 KBA DATA VALIDATED - Ready to send OTPs");
        error_log("**************");

        $otpEmail = rand(100000,999999);
        $otpSMS   = rand(100000,999999);

        error_log("**************");
        error_log(" ✅ EMAIL OTP: " . $otpEmail);
        error_log(" ✅ SMS OTP:   " . $otpSMS);
        error_log("**************");

        $_SESSION['otp_store'][$email] = $otpEmail;
        $_SESSION['otp_store'][$phone] = $otpSMS;

        $emailSent = sendEmailOTP($email, $otpEmail);
        $smsSent   = sendSMSOTP($phone, $otpSMS);

        echo json_encode([
            'success'  => true,
            'emailOtp' => $otpEmail,
            'phoneOtp' => $otpSMS
        ]);
        exit;

    // 9. ✅ NEW: VERIFY KBA FOR TRANSACTION
    case 'verify-kba-transaction':
        $address = $input['address'] ?? '';
        $questionType = $input['questionType'] ?? '';
        $answer = $input['answer'] ?? '';

        if (empty($address) || empty($questionType) || empty($answer)) {
            echo json_encode([
                'success' => false,
                'message' => 'Address, question type, and answer are required'
            ]);
            exit;
        }

        error_log("**************");
        error_log(" 🔐 KBA TRANSACTION VERIFICATION");
        error_log(" Address: " . $address);
        error_log(" Question: " . $questionType);
        error_log(" Answer Provided: " . $answer);
        error_log("**************");

        // Map question types to database columns
        $columnMap = [
            'placeOfBirth' => 'place_of_birth',
            'firstSchool' => 'first_school',
            'favoriteColor' => 'favorite_color',
            'motherMaidenName' => 'mother_maiden_name',
            'firstPetName' => 'first_pet_name',
            'childhoodFriend' => 'childhood_friend'
        ];

        if (!isset($columnMap[$questionType])) {
            echo json_encode([
                'success' => false,
                'message' => 'Invalid question type'
            ]);
            exit;
        }

        $column = $columnMap[$questionType];

        // Get stored hash from database
        $stmt = $conn->prepare("SELECT $column FROM wallet_addresses WHERE address = ?");
        $stmt->bind_param("s", $address);
        $stmt->execute();
        $result = $stmt->get_result();

        if ($row = $result->fetch_assoc()) {
            $storedHash = $row[$column];

            if (empty($storedHash)) {
                echo json_encode([
                    'success' => false,
                    'message' => 'KBA not set for this wallet. Please complete KBA registration.'
                ]);
                exit;
            }

            $normalizedAnswer = strtolower(trim($answer));
            $rawAnswer = trim($answer);

            // Verify answer (case-insensitive, trimmed) with legacy fallback
            if (password_verify($normalizedAnswer, $storedHash) || password_verify($rawAnswer, $storedHash)) {
                error_log("✅ KBA VERIFICATION SUCCESSFUL!");
                echo json_encode([
                    'success' => true,
                    'message' => 'KBA verification successful - Transaction allowed'
                ]);
            } else {
                // Log failed attempt for security monitoring
                error_log("❌ FAILED KBA ATTEMPT - Address: $address, Question: $questionType");

                echo json_encode([
                    'success' => false,
                    'message' => 'Incorrect answer - Transaction blocked for security'
                ]);
            }
        } else {
            error_log("❌ User not found for address: $address");
            echo json_encode([
                'success' => false,
                'message' => 'User not found'
            ]);
        }

        $stmt->close();
        exit;

    // 10. ✅ NEW: GET RANDOM KBA QUESTION FOR TRANSACTION
    case 'get-kba-question':
        $address = $input['address'] ?? '';

        if (empty($address)) {
            echo json_encode([
                'success' => false,
                'message' => 'Address is required'
            ]);
            exit;
        }

        // Check if user exists
        $stmt = $conn->prepare("SELECT address FROM wallet_addresses WHERE address = ?");
        $stmt->bind_param("s", $address);
        $stmt->execute();
        $result = $stmt->get_result();

        if ($result->num_rows === 0) {
            echo json_encode([
                'success' => false,
                'message' => 'User not found'
            ]);
            exit;
        }

        // List of available questions
        $questions = [
            ['type' => 'placeOfBirth', 'text' => 'What is your place of birth?'],
            ['type' => 'firstSchool', 'text' => 'What was your first school attended?'],
            ['type' => 'favoriteColor', 'text' => 'What is your favorite color?'],
            ['type' => 'motherMaidenName', 'text' => "What is your mother's maiden name?"],
            ['type' => 'firstPetName', 'text' => "What was your first pet's name?"],
            ['type' => 'childhoodFriend', 'text' => "What is your childhood best friend's name?"]
        ];

        // Filter questions that have stored KBA hashes
        $availableQuestions = [];
        $columns = [
            'placeOfBirth' => 'place_of_birth',
            'firstSchool' => 'first_school',
            'favoriteColor' => 'favorite_color',
            'motherMaidenName' => 'mother_maiden_name',
            'firstPetName' => 'first_pet_name',
            'childhoodFriend' => 'childhood_friend'
        ];

        $kbaStmt = $conn->prepare("SELECT place_of_birth, first_school, favorite_color, mother_maiden_name, first_pet_name, childhood_friend FROM wallet_addresses WHERE address = ?");
        $kbaStmt->bind_param("s", $address);
        $kbaStmt->execute();
        $kbaResult = $kbaStmt->get_result();
        $kbaRow = $kbaResult->fetch_assoc();
        $kbaStmt->close();

        foreach ($questions as $question) {
            $columnKey = $columns[$question['type']] ?? null;
            if ($columnKey && !empty($kbaRow[$columnKey])) {
                $availableQuestions[] = $question;
            }
        }

        if (count($availableQuestions) === 0) {
            echo json_encode([
                'success' => false,
                'message' => 'KBA not set for this wallet. Please complete KBA registration.'
            ]);
            exit;
        }

        // Select random question
        $randomQuestion = $availableQuestions[array_rand($availableQuestions)];

        error_log("**************");
        error_log(" 🎲 Random KBA Question Selected: " . $randomQuestion['type']);
        error_log("**************");

        echo json_encode([
            'success' => true,
            'question' => $randomQuestion
        ]);
        exit;

    // 11. ✅ NEW: GET ALL REWARDS
    case 'get-all-rewards':
        $countStmt = $conn->prepare("SELECT COUNT(*) as count FROM wallet_addresses");
        $countStmt->execute();
        $countResult = $countStmt->get_result();
        $countRow = $countResult->fetch_assoc();
        $totalMiners = (int)$countRow['count'];
        $countStmt->close();

        $stmt = $conn->prepare("
            SELECT 
                address,
                username,
                email,
                balance,
                reward_amount,
                created_at
            FROM wallet_addresses
            WHERE reward_amount > 0
            ORDER BY reward_amount DESC
            LIMIT 1000
        ");
        
        $stmt->execute();
        $result = $stmt->get_result();
        $rewards = [];

        while($row = $result->fetch_assoc()) {
            $rewards[] = [
                'address' => $row['address'],
                'username' => $row['username'],
                'email' => $row['email'],
                'balance' => (float)$row['balance'],
                'rewardAmount' => (float)$row['reward_amount'],
                'createdAt' => $row['created_at']
            ];
        }

        error_log("✅ Fetched " . count($rewards) . " rewards");

        echo json_encode([
            'success' => true,
            'rewards' => $rewards,
            'totalRewards' => count($rewards),
            'totalMiners' => $totalMiners
        ]);
        $stmt->close();
        exit;

    // 11.5 ✅ GET MINING STATISTICS
    case 'get-mining-stats':
        // Get total miners count
        $minerCount = $conn->query("SELECT COUNT(*) as count FROM wallet_addresses WHERE reward_amount > 0");
        $minerData = $minerCount->fetch_assoc();
        $totalMiners = (int)$minerData['count'];

        // Get total mining rewards
        $rewardSum = $conn->query("SELECT COALESCE(SUM(reward_amount), 0) as total FROM wallet_addresses");
        $rewardData = $rewardSum->fetch_assoc();
        $totalRewards = (float)$rewardData['total'];

        // Calculate average reward per miner
        $avgReward = $totalMiners > 0 ? $totalRewards / $totalMiners : 0;

        // Get total transactions (total mining blocks/events)
        $txCount = $conn->query("SELECT COUNT(*) as count FROM transactions WHERE status = 'Completed'");
        $txData = $txCount->fetch_assoc();
        $totalTransactions = (int)$txData['count'];

        // Get regions (estimated from distinct addresses)
        $regionCount = 45; // Static for now, can be updated dynamically

        echo json_encode([
            'success' => true,
            'totalMiners' => $totalMiners,
            'totalRewards' => round($totalRewards, 2),
            'averageReward' => round($avgReward, 4),
            'totalTransactions' => $totalTransactions,
            'totalRegions' => $regionCount,
            'apr' => 12.5
        ]);
        exit;

    // 12. ✅ NEW: GET REWARDS FOR SPECIFIC ADDRESS
    case 'get-user-rewards':
        $address = $input['address'] ?? '';

        if (empty($address)) {
            echo json_encode([
                'success' => false,
                'message' => 'Address is required'
            ]);
            exit;
        }

        // First, calculate total rewards from transactions table
        $transStmt = $conn->prepare("
            SELECT COALESCE(SUM(amount), 0) as total_rewards
            FROM transactions
            WHERE wallet_address = ? AND status = 'Completed'
        ");
        $transStmt->bind_param("s", $address);
        $transStmt->execute();
        $transResult = $transStmt->get_result();
        $transRow = $transResult->fetch_assoc();
        $calculatedReward = (float)$transRow['total_rewards'];
        $transStmt->close();

        // Update the reward_amount in wallet_addresses table
        $updateStmt = $conn->prepare("
            UPDATE wallet_addresses 
            SET reward_amount = ? 
            WHERE address = ?
        ");
        $updateStmt->bind_param("ds", $calculatedReward, $address);
        $updateStmt->execute();
        $updateStmt->close();

        // Now fetch the updated user data
        $stmt = $conn->prepare("
            SELECT 
                address,
                username,
                email,
                balance,
                reward_amount,
                last_claim_amount,
                last_claim_tx,
                last_claim_at,
                created_at
            FROM wallet_addresses
            WHERE address = ?
        ");
        
        $stmt->bind_param("s", $address);
        $stmt->execute();
        $result = $stmt->get_result();

        if ($row = $result->fetch_assoc()) {
            echo json_encode([
                'success' => true,
                'reward' => [
                    'address' => $row['address'],
                    'username' => $row['username'],
                    'email' => $row['email'],
                    'balance' => (float)$row['balance'],
                    'rewardAmount' => (float)$row['reward_amount'],
                    'lastClaimAmount' => isset($row['last_claim_amount']) ? (float)$row['last_claim_amount'] : null,
                    'lastClaimTx' => $row['last_claim_tx'] ?? null,
                    'lastClaimAt' => $row['last_claim_at'] ?? null,
                    'createdAt' => $row['created_at']
                ]
            ]);
        } else {
            echo json_encode([
                'success' => false,
                'message' => 'User not found'
            ]);
        }

        $stmt->close();
        exit;

    // 13. ✅ GET USER TRANSACTION HISTORY FROM DATABASE
    case 'get-user-transactions':
        $address = $input['address'] ?? '';
        $period = $input['period'] ?? 'weekly'; // weekly, monthly, yearly

        error_log("get-user-transactions - Address: $address, Period: $period");

        if (empty($address)) {
            echo json_encode([
                'success' => false,
                'message' => 'Address is required'
            ]);
            exit;
        }

        // Calculate date range based on period
        $dateCondition = '';
        if ($period === 'weekly') {
            $dateCondition = "AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)";
        } elseif ($period === 'monthly') {
            $dateCondition = "AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)";
        } elseif ($period === 'yearly') {
            $dateCondition = "AND created_at >= DATE_SUB(NOW(), INTERVAL 1 YEAR)";
        }

        // Fetch real transactions from transactions table
        $stmt = $conn->prepare("
            SELECT 
                id,
                transaction_hash,
                transaction_type,
                amount,
                status,
                created_at
            FROM transactions
            WHERE wallet_address = ? $dateCondition
            ORDER BY created_at DESC
        ");
        
        $stmt->bind_param("s", $address);
        $stmt->execute();
        $result = $stmt->get_result();

        $transactions = [];
        $totalAmount = 0;
        
        while ($row = $result->fetch_assoc()) {
            $amount = (float)$row['amount'];
            $totalAmount += $amount;
            
            $transactions[] = [
                'id' => (int)$row['id'],
                'date' => $row['created_at'],
                'type' => $row['transaction_type'],
                'amount' => $amount,
                'status' => $row['status'],
                'txHash' => $row['transaction_hash']
            ];
        }

        error_log("Found " . count($transactions) . " transactions for address: $address");

        echo json_encode([
            'success' => true,
            'transactions' => $transactions,
            'totalTransactions' => count($transactions),
            'totalAmount' => round($totalAmount, 4)
        ]);
        
        $stmt->close();
        exit;


    case "claim_reward":
        $address = $input['address'] ?? null;
        if (!$address) {
            echo json_encode([
                'success' => false,
                'error' => 'Address is required',
                'datetime' => date('Y-m-d H:i:s')
            ]);
            exit;
        }
        
        $sql = "SELECT reward_amount, balance FROM wallet_addresses WHERE address = ?";
        $stmt = $conn->prepare($sql);
        $stmt->bind_param("s", $address);
        $stmt->execute();
        $result = $stmt->get_result();
        $row = $result->fetch_assoc();
        if ($row && $row['reward_amount'] >= 100) {
            $rewardAmount = $row['reward_amount'];
            $currentBalance = $row['balance'];
            // Send reward request to JavaScript server
            $postData = json_encode(['wallet_address' => $address, 'reward_amount' => (string)$rewardAmount]);
            $ch = curl_init('http://localhost:3001/transferReward');
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_POSTFIELDS, $postData);
            $response = curl_exec($ch);
            $curlError = curl_error($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            if ($response === false) {
                echo json_encode([
                    'success' => false,
                    'error' => 'Reward transfer service unreachable',
                    'details' => $curlError,
                    'httpCode' => $httpCode,
                    'datetime' => date('Y-m-d H:i:s')
                ]);
                exit;
            }

            $jsResponse = json_decode($response, true);
            if ($jsResponse && ($jsResponse['status'] ?? null) === 'success') {
                // Update balance and reward amount in the database
                $newBalance = $currentBalance + $rewardAmount;
                $stmt = $conn->prepare("UPDATE wallet_addresses SET reward_amount = 0, balance = ?, last_claim_amount = ?, last_claim_tx = ?, last_claim_at = NOW() WHERE address = ?");
                $stmt->bind_param("ddss", $newBalance, $rewardAmount, $jsResponse['txHash'], $address);
                $stmt->execute();
                echo json_encode([
                    'success' => true,
                    'message' => 'Reward claimed',
                    'claimed_amount' => $rewardAmount,
                    'transactionHash' => $jsResponse['txHash'],
                    'last_claim_amount' => $rewardAmount,
                    'last_claim_tx' => $jsResponse['txHash'],
                    'new_balance' => $newBalance,
                    'reward_amount' => 0,
                    'datetime' => date('Y-m-d H:i:s')
                ]);
            } else {
                $detailMessage = null;
                if (is_array($jsResponse)) {
                    $detailMessage = $jsResponse['error'] ?? $jsResponse['message'] ?? null;
                }
                echo json_encode([
                    'success' => false,
                    'error' => 'Failed to transfer reward',
                    'details' => $detailMessage ?? $response,
                    'httpCode' => $httpCode,
                    'datetime' => date('Y-m-d H:i:s')
                ]);
            }
        } else {
            echo json_encode([
                'success' => false,
                'error' => 'Insufficient reward amount to claim',
                'datetime' => date('Y-m-d H:i:s')
            ]);
        }
        $stmt->close();
        exit;

    default:
        error_log(" [ERROR] Invalid Route Accessed: " . $action);
        echo json_encode(['success'=>false,'message'=>"Invalid API Route"]);
        exit;
}
?>
