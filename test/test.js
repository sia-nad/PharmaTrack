// Automated tests for PharmaTrack.
// Compiles the contract with solc-js, starts an in-process Ganache chain,
// deploys, and runs valid / invalid / unauthorised test cases.
//
// Run:  npm install && npm test

const fs = require("fs");
const path = require("path");
const solc = require("solc");
const ganache = require("ganache");
const { ethers } = require("ethers");

const results = [];
function record(id, type, description, expected, observed, pass) {
  results.push({ id, type, description, expected, observed, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${id} [${type}] ${description} -> ${observed}`);
}

function compile() {
  const file = path.join(__dirname, "..", "contracts", "PharmaTrack.sol");
  const input = {
    language: "Solidity",
    sources: { "PharmaTrack.sol": { content: fs.readFileSync(file, "utf8") } },
    settings: { outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } }
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  if (out.errors) {
    const errs = out.errors.filter((e) => e.severity === "error");
    out.errors.forEach((e) => console.log(e.formattedMessage));
    if (errs.length) throw new Error("Compilation failed");
  }
  const c = out.contracts["PharmaTrack.sol"].PharmaTrack;
  console.log("Compilation successful.\n");
  return { abi: c.abi, bytecode: "0x" + c.evm.bytecode.object };
}

async function expectRevert(promiseFn, fragment) {
  try {
    const tx = await promiseFn();
    await tx.wait();
    return { reverted: false, msg: "transaction succeeded" };
  } catch (e) {
    const msg = e.reason || e.shortMessage || e.message || "";
    const full = (msg + " " + (e.message || "")).toString();
    return { reverted: full.includes(fragment), msg: msg };
  }
}

async function main() {
  const { abi, bytecode } = compile();

  const server = ganache.server({ logging: { quiet: true }, wallet: { totalAccounts: 6 } });
  await server.listen(8545);
  const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");

  const regulator = await provider.getSigner(0);
  const mfr = await provider.getSigner(1);
  const distributor = await provider.getSigner(2);
  const pharmacy = await provider.getSigner(3);
  const attacker = await provider.getSigner(4);

  const factory = new ethers.ContractFactory(abi, bytecode, regulator);
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log("Deployed to:", addr, "\n");

  const asMfr = contract.connect(mfr);
  const asDist = contract.connect(distributor);
  const asAttacker = contract.connect(attacker);

  const now = (await provider.getBlock("latest")).timestamp;
  const oneYear = now + 365 * 24 * 3600;

  // ---------- VALID ----------
  record("V1", "Valid", "Constructor sets deployer as regulator",
    "regulator == deployer", await contract.regulator(),
    (await contract.regulator()) === (await regulator.getAddress()));

  await (await contract.authoriseManufacturer(await mfr.getAddress())).wait();
  record("V2", "Valid", "Regulator authorises a manufacturer",
    "isManufacturer == true", String(await contract.isManufacturer(await mfr.getAddress())),
    (await contract.isManufacturer(await mfr.getAddress())) === true);

  await (await asMfr.registerBatch("Paracetamol 500mg", "PCM-001", oneYear, 10000)).wait();
  const b1 = await contract.getBatch(1);
  record("V3", "Valid", "Authorised manufacturer registers a batch",
    "batch #1 stored with correct data", `${b1.medicineName}, qty ${b1.quantity}`,
    b1.medicineName === "Paracetamol 500mg" && b1.quantity === 10000n && b1.currentHolder === (await mfr.getAddress()));

  const [st, id] = await contract.verifyByCode("PCM-001");
  record("V4", "Valid", "Verify genuine batch by code",
    "status Genuine (1), id 1", `status ${st}, id ${id}`, st === 1n && id === 1n);

  await (await asMfr.transferCustody(1, await distributor.getAddress())).wait();
  await (await asDist.transferCustody(1, await pharmacy.getAddress())).wait();
  const trail = await contract.getCustodyTrail(1);
  record("V5", "Valid", "Custody moves manufacturer -> distributor -> pharmacy",
    "trail length 3, holder = pharmacy", `trail length ${trail.length}`,
    trail.length === 3 && (await contract.getBatch(1)).currentHolder === (await pharmacy.getAddress()));

  await (await asMfr.registerBatch("Amoxicillin 250mg", "AMX-001", oneYear, 500)).wait();
  await (await contract.recallBatch(2, "Contamination found")).wait();
  const [st2] = await contract.verifyByCode("AMX-001");
  record("V6", "Valid", "Regulator recalls a batch",
    "status Recalled (3)", `status ${st2}`, st2 === 3n);

  // ---------- INVALID ----------
  let r = await expectRevert(() => asMfr.registerBatch("", "X-1", oneYear, 10), "Medicine name required");
  record("I1", "Invalid", "Register with empty medicine name", "revert: Medicine name required", r.msg, r.reverted);

  r = await expectRevert(() => asMfr.registerBatch("Drug", "X-2", oneYear, 0), "Quantity must be > 0");
  record("I2", "Invalid", "Register with quantity 0", "revert: Quantity must be > 0", r.msg, r.reverted);

  r = await expectRevert(() => asMfr.registerBatch("Drug", "X-3", now - 1000, 10), "Expiry must be in the future");
  record("I3", "Invalid", "Register with past expiry date", "revert: Expiry must be in the future", r.msg, r.reverted);

  r = await expectRevert(() => asMfr.registerBatch("Paracetamol", "PCM-001", oneYear, 10), "Batch code already registered");
  record("I4", "Invalid", "Register duplicate batch code", "revert: Batch code already registered", r.msg, r.reverted);

  r = await expectRevert(() => contract.authoriseManufacturer(ethers.ZeroAddress), "Invalid address");
  record("I5", "Invalid", "Authorise zero address", "revert: Invalid address", r.msg, r.reverted);

  const asPharmacy = contract.connect(pharmacy);
  r = await expectRevert(() => asPharmacy.transferCustody(1, ethers.ZeroAddress), "Invalid recipient");
  record("I6", "Invalid", "Transfer custody to the zero address", "revert: Invalid recipient", r.msg, r.reverted);

  r = await expectRevert(() => contract.getBatch(99), "Batch does not exist");
  // getBatch is a view; ethers throws on call. handle below
  if (!r.reverted) {
    try { await contract.getBatch(99); record("I7", "Invalid", "Query non-existent batch 99", "revert", "no revert", false); }
    catch (e) { record("I7", "Invalid", "Query non-existent batch 99", "revert: Batch does not exist", e.reason || e.shortMessage, (e.reason || e.shortMessage || "").includes("Batch does not exist")); }
  }

  const [stNF, idNF] = await contract.verifyByCode("FAKE-123");
  record("I8", "Invalid", "Verify unknown (counterfeit) code", "status NotFound (0)", `status ${stNF}, id ${idNF}`, stNF === 0n);

  r = await expectRevert(() => asPharmacy.transferCustody(1, await_addr(pharmacy)), "Cannot transfer to yourself");
  record("I9", "Invalid", "Transfer custody to yourself", "revert: Cannot transfer to yourself", r.msg, r.reverted);

  r = await expectRevert(() => asDist.transferCustody(2, ethers.ZeroAddress), "Only current holder can transfer");
  record("I10", "Invalid", "Transfer a batch you do not hold", "revert: Only current holder can transfer", r.msg, r.reverted);

  // transfer of recalled batch (batch 2 held by mfr)
  r = await expectRevert(() => asMfr.transferCustody(2, distributor.address), "Batch is recalled");
  record("I11", "Invalid", "Transfer a recalled batch", "revert: Batch is recalled", r.msg, r.reverted);

  // expiry: register short-lived batch then fast-forward time
  const soon = (await provider.getBlock("latest")).timestamp + 100;
  await (await asMfr.registerBatch("Short-life Syrup", "SYR-001", soon, 50)).wait();
  await provider.send("evm_increaseTime", [500]);
  await provider.send("evm_mine", []);
  const [stExp] = await contract.verifyByCode("SYR-001");
  record("I12", "Invalid", "Batch past expiry date (time travel)", "status Expired (2)", `status ${stExp}`, stExp === 2n);
  r = await expectRevert(() => asMfr.transferCustody(3, distributor.address), "Batch has expired");
  record("I13", "Invalid", "Transfer an expired batch", "revert: Batch has expired", r.msg, r.reverted);

  // ---------- UNAUTHORISED ----------
  r = await expectRevert(() => asAttacker.registerBatch("Fake Drug", "FAKE-1", oneYear, 100), "not an authorised manufacturer");
  record("U1", "Unauthorised", "Non-manufacturer registers batch", "revert: Caller is not an authorised manufacturer", r.msg, r.reverted);

  r = await expectRevert(() => asAttacker.authoriseManufacturer(attacker.address), "Only regulator allowed");
  record("U2", "Unauthorised", "Attacker self-authorises as manufacturer", "revert: Only regulator allowed", r.msg, r.reverted);

  r = await expectRevert(() => asMfr.recallBatch(1, "sabotage"), "Only regulator allowed");
  record("U3", "Unauthorised", "Manufacturer tries to recall a batch", "revert: Only regulator allowed", r.msg, r.reverted);

  r = await expectRevert(() => asAttacker.revokeManufacturer(mfr.address), "Only regulator allowed");
  record("U4", "Unauthorised", "Attacker revokes a manufacturer", "revert: Only regulator allowed", r.msg, r.reverted);

  r = await expectRevert(() => asAttacker.transferCustody(1, attacker.address), "Only current holder can transfer");
  record("U5", "Unauthorised", "Attacker steals custody of batch 1", "revert: Only current holder can transfer", r.msg, r.reverted);

  await (await contract.revokeManufacturer(mfr.address)).wait();
  r = await expectRevert(() => asMfr.registerBatch("Late Drug", "LATE-1", oneYear, 5), "not an authorised manufacturer");
  record("U6", "Unauthorised", "Revoked manufacturer tries to register batch", "revert: Caller is not an authorised manufacturer", r.msg, r.reverted);

  // ---------- Summary ----------
  const passed = results.filter((x) => x.pass).length;
  console.log(`\n${passed}/${results.length} tests passed`);

  // Markdown table for README
  const md = [
    "| ID | Type | Test case | Expected | Observed | Result |",
    "|----|------|-----------|----------|----------|--------|",
    ...results.map((x) => `| ${x.id} | ${x.type} | ${x.description} | ${x.expected} | ${String(x.observed).replace(/\|/g, "/")} | ${x.pass ? "PASS" : "FAIL"} |`)
  ].join("\n");
  fs.writeFileSync(path.join(__dirname, "test-results.md"), `# Automated test results\n\n${passed}/${results.length} passed\n\n${md}\n`);
  fs.writeFileSync(path.join(__dirname, "..", "contracts", "PharmaTrack.abi.json"), JSON.stringify(abi, null, 2));

  await server.close();
  process.exit(passed === results.length ? 0 : 1);
}

function await_addr(signer) { return signer.address; }

main().catch((e) => { console.error(e); process.exit(1); });
