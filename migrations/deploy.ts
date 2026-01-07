// Anchor migration file
// This is run when deploying with `anchor deploy` or `anchor migrate`

const anchor = require('@coral-xyz/anchor');

module.exports = async function (provider: any) {
  // Configure client to use the provider
  anchor.setProvider(provider);

  // Get the program
  // const program = anchor.workspace.Profitmaxi;

  console.log('Deploying ProfitMaxi...');
  console.log('Provider cluster:', provider.connection.rpcEndpoint);

  // The program is automatically deployed by Anchor
  // This migration can be used for post-deployment initialization

  // Example: Initialize protocol if not already done
  // const [configPda] = anchor.web3.PublicKey.findProgramAddressSync(
  //   [Buffer.from('config')],
  //   program.programId
  // );

  // const configAccount = await provider.connection.getAccountInfo(configPda);
  // if (!configAccount) {
  //   console.log('Initializing protocol...');
  //   await program.methods
  //     .initialize(10, 10) // 0.1% fees
  //     .accounts({
  //       admin: provider.wallet.publicKey,
  //       config: configPda,
  //       systemProgram: anchor.web3.SystemProgram.programId,
  //     })
  //     .rpc();
  //   console.log('Protocol initialized');
  // }

  console.log('Migration complete');
};
