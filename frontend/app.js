// PharmaTrack frontend - ethers.js v6 + MetaMask

const ABI = [
  "function regulator() view returns (address)",
  "function totalBatches() view returns (uint256)",
  "function isManufacturer(address) view returns (bool)",
  "function authoriseManufacturer(address _m)",
  "function revokeManufacturer(address _m)",
  "function registerBatch(string _medicineName, string _batchCode, uint256 _expiryDate, uint256 _quantity) returns (uint256)",
  "function transferCustody(uint256 _id, address _to)",
  "function recallBatch(uint256 _id, string _reason)",
  "function getBatch(uint256 _id) view returns (tuple(uint256 id, string medicineName, string batchCode, uint256 manufactureDate, uint256 expiryDate, uint256 quantity, address manufacturer, address currentHolder, bool recalled))",
  "function getCustodyTrail(uint256 _id) view returns (address[])",
  "function verifyByCode(string _batchCode) view returns (uint8 status, uint256 id)",
  "function statusOf(uint256 _id) view returns (uint8)"
];

const STATUS = ["Not Found (possibly counterfeit)", "Genuine", "Expired", "Recalled"];
const STATUS_CLASS = ["notfound", "genuine", "expired", "recalled"];

let provider, signer, contract, account;

const $ = (id) => document.getElementById(id);

function log(msg, cls = "") {
  const d = document.createElement("div");
  if (cls) d.className = cls;
  d.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  $("log").prepend(d);
}

function readableError(e) {
  return (
    e?.reason ||
    e?.revert?.args?.[0] ||
    e?.info?.error?.message ||
    e?.shortMessage ||
    e?.message ||
    "Unknown error"
  );
}

function requireContract() {
  if (!contract) {
    log("Connect MetaMask and load the contract first.", "err");
    return false;
  }
  return true;
}

// ---------------- Connect wallet ----------------
async function connect() {
  if (!window.ethereum) {
    log("MetaMask not found. Please install it.", "err");
    alert("MetaMask not detected");
    return;
  }
  try {
    provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    signer = await provider.getSigner();
    account = await signer.getAddress();
    const net = await provider.getNetwork();
    $("walletInfo").textContent = `Connected: ${account} (chainId ${net.chainId})`;
    $("connectBtn").textContent = "Connected ✔";
    log(`Wallet connected: ${account}`, "ok");

    window.ethereum.on("accountsChanged", () => location.reload());
    window.ethereum.on("chainChanged", () => location.reload());

    const saved = localStorage.getItem("pharmatrack_addr");
    if (saved) $("contractAddress").value = saved;
  } catch (e) {
    log("Connection rejected: " + readableError(e), "err");
  }
}

async function loadContract() {
  if (!signer) return log("Connect MetaMask first.", "err");
  const addr = $("contractAddress").value.trim();
  if (!ethers.isAddress(addr)) return log("Invalid contract address.", "err");
  try {
    contract = new ethers.Contract(addr, ABI, signer);
    const [reg, total] = await Promise.all([contract.regulator(), contract.totalBatches()]);
    const isMfr = await contract.isManufacturer(account);
    let role = "Public user";
    if (reg.toLowerCase() === account.toLowerCase()) role = "Regulator";
    else if (isMfr) role = "Authorised manufacturer";
    $("contractInfo").innerHTML =
      `Regulator: ${reg}<br>Total batches: ${total}<br>Your role: <b>${role}</b>`;
    localStorage.setItem("pharmatrack_addr", addr);
    log("Contract loaded.", "ok");
  } catch (e) {
    contract = null;
    log("Could not load contract on this network: " + readableError(e), "err");
  }
}

// ---------------- Generic tx sender ----------------
async function sendTx(label, fn) {
  if (!requireContract()) return;
  try {
    log(`${label}: waiting for MetaMask confirmation...`);
    const tx = await fn();
    log(`${label}: tx sent ${tx.hash}`);
    const rc = await tx.wait();
    log(`${label}: confirmed in block ${rc.blockNumber}`, "ok");
    await loadContract();
    return rc;
  } catch (e) {
    log(`${label} FAILED: ${readableError(e)}`, "err");
  }
}

// ---------------- Actions ----------------
async function registerBatch() {
  const name = $("medName").value.trim();
  const code = $("batchCode").value.trim();
  const exp = $("expiry").value;
  const qty = $("qty").value;
  if (!name || !code || !exp || !qty) return log("Fill all register fields.", "err");
  const expiry = Math.floor(new Date(exp + "T00:00:00").getTime() / 1000);
  await sendTx("Register batch", () => contract.registerBatch(name, code, expiry, BigInt(qty)));
}

async function transferCustody() {
  const id = $("trId").value;
  const to = $("trTo").value.trim();
  if (!id) return log("Enter a batch ID.", "err");
  if (!ethers.isAddress(to)) return log("Invalid recipient address.", "err");
  await sendTx("Transfer custody", () => contract.transferCustody(BigInt(id), to));
}

async function authorise() {
  const a = $("mfrAddr").value.trim();
  if (!ethers.isAddress(a)) return log("Invalid manufacturer address.", "err");
  await sendTx("Authorise manufacturer", () => contract.authoriseManufacturer(a));
}

async function revoke() {
  const a = $("mfrAddr").value.trim();
  if (!ethers.isAddress(a)) return log("Invalid manufacturer address.", "err");
  await sendTx("Revoke manufacturer", () => contract.revokeManufacturer(a));
}

async function recall() {
  const id = $("recallId").value;
  const reason = $("recallReason").value.trim() || "No reason given";
  if (!id) return log("Enter a batch ID.", "err");
  await sendTx("Recall batch", () => contract.recallBatch(BigInt(id), reason));
}

// ---------------- Read-only (blockchain data retrieval) ----------------
async function verify() {
  if (!requireContract()) return;
  const code = $("verifyCode").value.trim();
  if (!code) return log("Enter a batch code.", "err");
  try {
    const [status, id] = await contract.verifyByCode(code);
    const s = Number(status);
    $("verifyResult").innerHTML =
      `<span class="badge ${STATUS_CLASS[s]}">${STATUS[s]}</span>` +
      (s !== 0 ? `<div class="muted">Batch ID: ${id}</div>` : "");
    log(`Verified "${code}": ${STATUS[s]}`, "ok");
  } catch (e) {
    log("Verify failed: " + readableError(e), "err");
  }
}

async function lookup() {
  if (!requireContract()) return;
  const id = $("lookupId").value;
  if (!id) return log("Enter a batch ID.", "err");
  try {
    const [b, trail, st] = await Promise.all([
      contract.getBatch(BigInt(id)),
      contract.getCustodyTrail(BigInt(id)),
      contract.statusOf(BigInt(id))
    ]);
    const fmt = (t) => new Date(Number(t) * 1000).toLocaleDateString();
    const s = Number(st);
    $("batchDetails").innerHTML = `
      <span class="badge ${STATUS_CLASS[s]}">${STATUS[s]}</span>
      <table>
        <tr><td>Batch ID</td><td>${b.id}</td></tr>
        <tr><td>Medicine</td><td>${escapeHtml(b.medicineName)}</td></tr>
        <tr><td>Batch code</td><td>${escapeHtml(b.batchCode)}</td></tr>
        <tr><td>Manufactured</td><td>${fmt(b.manufactureDate)}</td></tr>
        <tr><td>Expiry</td><td>${fmt(b.expiryDate)}</td></tr>
        <tr><td>Quantity</td><td>${b.quantity}</td></tr>
        <tr><td>Manufacturer</td><td>${b.manufacturer}</td></tr>
        <tr><td>Current holder</td><td>${b.currentHolder}</td></tr>
        <tr><td>Recalled</td><td>${b.recalled ? "Yes" : "No"}</td></tr>
      </table>
      <b>Custody trail</b>
      <ol>${trail.map((a) => `<li>${a}</li>`).join("")}</ol>`;
    log(`Loaded batch #${id}`, "ok");
  } catch (e) {
    $("batchDetails").innerHTML = "";
    log("Lookup failed: " + readableError(e), "err");
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------------- Wire up ----------------
$("connectBtn").onclick = connect;
$("loadContractBtn").onclick = loadContract;
$("verifyBtn").onclick = verify;
$("lookupBtn").onclick = lookup;
$("registerBtn").onclick = registerBatch;
$("transferBtn").onclick = transferCustody;
$("authBtn").onclick = authorise;
$("revokeBtn").onclick = revoke;
$("recallBtn").onclick = recall;
