# PharmaTrack

PharmaTrack is a small Ethereum app for checking medicine batches. A manufacturer can register a batch, supply-chain partners can pass it to the next holder, and anyone can check its code to see whether it is genuine, expired, or recalled.

**Student:** Sia Sachin Nadkarni

**Registration number:** 230905522

**Assignment:** Blockchain Technology - Assignment 2

## How it works

The person who deploys the contract is the regulator. The regulator can approve manufacturers and recall batches. Approved manufacturers can add batches. The current holder can transfer a batch, and anyone can look up a batch or check its custody history.

The smart contract is in `contracts/PharmaTrack.sol`. The web page is in `frontend/`, and `test/test.js` contains the Ganache tests.

## Run the app

Install the project dependencies from the project folder:

```bash
npm install
```

To run the automated tests:

```bash
npm test
```

The tests compile the contract, run it on a local Ganache chain, and check these cases:

- **Valid:** approve a manufacturer, register and verify a batch, transfer custody, and recall a batch.
- **Invalid:** try an empty medicine name, zero quantity, past expiry, duplicate code, zero address, unknown batch, or transfer of a recalled or expired batch.
- **Unauthorized:** try to register as an unapproved account, use regulator actions from another account, or transfer a batch you do not hold.

When the suite completes, it writes the observed results to `test/test-results.md`.

The test results have not yet been generated for this submission. Run `npm test` and include the resulting file before submitting.

## Compile and deploy

1. Open [Remix](https://remix.ethereum.org) and open `contracts/PharmaTrack.sol`.
2. In **Solidity Compiler**, select version 0.8.20 or newer and compile the contract.
3. In **Deploy & Run**, choose **Injected Provider - MetaMask**. Use Sepolia or Ganache, and make sure MetaMask is set to the same network.
4. Deploy the contract and confirm the transaction in MetaMask.
5. Copy the deployed contract address into the app and the deployment details below.

## Open the web app

From the `frontend` folder, start a local web server:

```bash
python -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000), connect MetaMask, and load the deployed contract. The regulator can approve a manufacturer. That manufacturer can register a batch, and users can verify its code or view its details and custody trail.

## Deployment details

These details still need to be filled in after deployment:

- **Network:** Sepolia or Ganache
- **Contract address:** not deployed yet
- **Regulator address:** add the deployer address
- **Deployment transaction:** add the transaction hash

## Screenshots

Add screenshots of the real Remix compilation and deployment, MetaMask connection, a successful transaction, a failed transaction, and batch data shown in the app. Do not use mock screenshots as transaction evidence.

The repository currently includes [a screenshot of the local app before wallet connection](screenshots/07-interface-live.png). It shows the interface only; no contract is loaded and no blockchain data is displayed.

## Safety

Never add a wallet seed phrase, private key, or password to this repository. This is a student project and has not been audited for production use.
