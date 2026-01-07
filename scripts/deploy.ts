#!/usr/bin/env ts-node

/**
 * ProfitMaxi Deployment Script
 * 
 * Deploys and initializes the ProfitMaxi protocol.
 * 
 * Usage:
 *   yarn deploy:devnet
 *   yarn deploy:mainnet
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

// Configuration
interface DeployConfig {
  network: 'devnet' | 'mainnet-beta' | 'localnet';
  rpcEndpoint: string;
  walletPath: string;
  protocolFeeBps: number;
  keeperFeeBps: number;
}

const CONFIGS: Record<string, DeployConfig> = {
  devnet: {
    network: 'devnet',
    rpcEndpoint: 'https://api.devnet.solana.com',
    walletPath: '~/.config/solana/devnet.json',
    protocolFeeBps: 10, // 0.1%
    keeperFeeBps: 10,   // 0.1%
  },
  'mainnet-beta': {
    network: 'mainnet-beta',
    rpcEndpoint: process.env.MAINNET_RPC || 'https://api.mainnet-beta.solana.com',
    walletPath: '~/.config/solana/mainnet.json',
    protocolFeeBps: 10,
    keeperFeeBps: 10,
  },
  localnet: {
    network: 'localnet',
    rpcEndpoint: 'http://localhost:8899',
    walletPath: '~/.config/solana/id.json',
    protocolFeeBps: 10,
    keeperFeeBps: 10,
  },
};

async function loadWallet(walletPath: string): Promise<Keypair> {
  const expandedPath = walletPath.replace('~', process.env.HOME || '');
  const secretKey = JSON.parse(fs.readFileSync(expandedPath, 'utf-8'));
  return Keypair.fromSecretKey(new Uint8Array(secretKey));
}

async function checkBalance(
  connection: Connection,
  publicKey: PublicKey,
  minBalance: number
): Promise<void> {
  const balance = await connection.getBalance(publicKey);
  if (balance < minBalance) {
    throw new Error(
      `Insufficient balance: ${balance / LAMPORTS_PER_SOL} SOL. ` +
      `Need at least ${minBalance / LAMPORTS_PER_SOL} SOL.`
    );
  }
  console.log(`Wallet balance: ${balance / LAMPORTS_PER_SOL} SOL`);
}

async function deployProgram(config: DeployConfig): Promise<PublicKey> {
  console.log(`\n🚀 Deploying ProfitMaxi to ${config.network}...\n`);

  // Load wallet
  const wallet = await loadWallet(config.walletPath);
  console.log(`Deployer: ${wallet.publicKey.toBase58()}`);

  // Connect
  const connection = new Connection(config.rpcEndpoint, 'confirmed');
  console.log(`RPC: ${config.rpcEndpoint}`);

  // Check balance
  await checkBalance(connection, wallet.publicKey, 5 * LAMPORTS_PER_SOL);

  // Load program binary
  const programSoPath = path.join(__dirname, '../target/deploy/profitmaxi.so');
  if (!fs.existsSync(programSoPath)) {
    throw new Error('Program binary not found. Run `anchor build` first.');
  }

  // Deploy using Anchor CLI
  console.log('\nDeploying program...');
  const { execSync } = require('child_process');
  
  try {
    execSync(
      `anchor deploy --provider.cluster ${config.network}`,
      { stdio: 'inherit' }
    );
  } catch (error) {
    throw new Error('Program deployment failed');
  }

  // Read program ID from keypair
  const programKeypairPath = path.join(
    __dirname,
    '../target/deploy/profitmaxi-keypair.json'
  );
  const programKeypair = await loadWallet(programKeypairPath);
  const programId = programKeypair.publicKey;

  console.log(`\n✅ Program deployed: ${programId.toBase58()}`);

  return programId;
}

async function initializeProtocol(
  connection: Connection,
  wallet: Keypair,
  programId: PublicKey,
  config: DeployConfig
): Promise<void> {
  console.log('\n📝 Initializing protocol...');

  // Derive config PDA
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('config')],
    programId
  );

  console.log(`Config PDA: ${configPda.toBase58()}`);

  // Check if already initialized
  const configAccount = await connection.getAccountInfo(configPda);
  if (configAccount) {
    console.log('Protocol already initialized, skipping...');
    return;
  }

  // Build and send initialize transaction
  // In production, use the SDK or Anchor's program.methods
  console.log(`Protocol fee: ${config.protocolFeeBps} bps`);
  console.log(`Keeper fee: ${config.keeperFeeBps} bps`);

  // Placeholder - use SDK in production
  console.log('\n⚠️  Manual initialization required via SDK or CLI');
  console.log('Run: npx ts-node scripts/initialize.ts');
}

async function verifyDeployment(
  connection: Connection,
  programId: PublicKey
): Promise<void> {
  console.log('\n🔍 Verifying deployment...');

  const accountInfo = await connection.getAccountInfo(programId);
  if (!accountInfo) {
    throw new Error('Program account not found');
  }

  if (!accountInfo.executable) {
    throw new Error('Program account is not executable');
  }

  console.log(`Program size: ${accountInfo.data.length} bytes`);
  console.log(`Owner: ${accountInfo.owner.toBase58()}`);
  console.log('\n✅ Deployment verified');
}

async function saveDeploymentInfo(
  network: string,
  programId: PublicKey,
  configPda: PublicKey
): Promise<void> {
  const deploymentInfo = {
    network,
    programId: programId.toBase58(),
    configPda: configPda.toBase58(),
    deployedAt: new Date().toISOString(),
  };

  const deploymentsDir = path.join(__dirname, '../deployments');
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir);
  }

  const filePath = path.join(deploymentsDir, `${network}.json`);
  fs.writeFileSync(filePath, JSON.stringify(deploymentInfo, null, 2));
  console.log(`\n📄 Deployment info saved to ${filePath}`);
}

async function main() {
  const network = process.argv[2] || 'devnet';
  const config = CONFIGS[network];

  if (!config) {
    console.error(`Unknown network: ${network}`);
    console.error(`Available networks: ${Object.keys(CONFIGS).join(', ')}`);
    process.exit(1);
  }

  try {
    // Deploy program
    const programId = await deployProgram(config);

    // Connect for initialization
    const connection = new Connection(config.rpcEndpoint, 'confirmed');
    const wallet = await loadWallet(config.walletPath);

    // Verify deployment
    await verifyDeployment(connection, programId);

    // Initialize protocol
    await initializeProtocol(connection, wallet, programId, config);

    // Save deployment info
    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('config')],
      programId
    );
    await saveDeploymentInfo(network, programId, configPda);

    console.log('\n🎉 Deployment complete!\n');
    console.log('Next steps:');
    console.log('1. Update SDK with new program ID');
    console.log('2. Initialize protocol if not done automatically');
    console.log('3. Set up keeper infrastructure');
    console.log('4. Test with small orders first');

  } catch (error) {
    console.error('\n❌ Deployment failed:', error);
    process.exit(1);
  }
}

main();
