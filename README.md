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
