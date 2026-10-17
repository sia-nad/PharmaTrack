// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title PharmaTrack
 * @notice Blockchain-based medicine batch registry to fight counterfeit drugs.
 *
 * Problem: counterfeit / expired medicines enter the supply chain and patients
 * cannot verify where a medicine came from.
 *
 * Solution: a regulator authorises manufacturers; manufacturers register
 * medicine batches on-chain; custody is passed on (manufacturer -> distributor
 * -> pharmacy) and every hop is recorded. Anyone (e.g. a patient) can verify a
 * batch and see its status (genuine / expired / recalled) and custody trail.
 */
contract PharmaTrack {
    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------
    address public regulator;      // deployer, e.g. a drug-control authority
    uint256 public totalBatches;   // also used as the next batch id counter

    struct Batch {
        uint256 id;
        string  medicineName;
        string  batchCode;         // printed on the pack, must be unique
        uint256 manufactureDate;   // unix timestamp
        uint256 expiryDate;        // unix timestamp
        uint256 quantity;          // number of units in the batch
        address manufacturer;
        address currentHolder;
        bool    recalled;
    }

    mapping(address => bool)      public isManufacturer;
    mapping(uint256 => Batch)     private batches;
    mapping(bytes32 => bool)      private batchCodeUsed;
    mapping(uint256 => address[]) private custodyTrail;

    enum Status { NotFound, Genuine, Expired, Recalled }

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------
    event ManufacturerAuthorised(address indexed manufacturer);
    event ManufacturerRevoked(address indexed manufacturer);
    event BatchRegistered(uint256 indexed id, string batchCode, address indexed manufacturer);
    event CustodyTransferred(uint256 indexed id, address indexed from, address indexed to);
    event BatchRecalled(uint256 indexed id, string reason);

    // ---------------------------------------------------------------------
    // Modifiers (access control / validation)
    // ---------------------------------------------------------------------
    modifier onlyRegulator() {
        require(msg.sender == regulator, "Only regulator allowed");
        _;
    }

    modifier onlyManufacturer() {
        require(isManufacturer[msg.sender], "Caller is not an authorised manufacturer");
        _;
    }

    modifier batchExists(uint256 _id) {
        require(_id >= 1 && _id <= totalBatches, "Batch does not exist");
        _;
    }

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------
    constructor() {
        regulator = msg.sender;
    }

    // ---------------------------------------------------------------------
    // Regulator functions
    // ---------------------------------------------------------------------
    function authoriseManufacturer(address _m) external onlyRegulator {
        require(_m != address(0), "Invalid address");
        require(!isManufacturer[_m], "Already authorised");
        isManufacturer[_m] = true;
        emit ManufacturerAuthorised(_m);
    }

    function revokeManufacturer(address _m) external onlyRegulator {
        require(isManufacturer[_m], "Not an authorised manufacturer");
        isManufacturer[_m] = false;
        emit ManufacturerRevoked(_m);
    }

    function recallBatch(uint256 _id, string calldata _reason)
        external
        onlyRegulator
        batchExists(_id)
    {
        Batch storage b = batches[_id];
        require(!b.recalled, "Batch already recalled");
        b.recalled = true;
        emit BatchRecalled(_id, _reason);
    }

    // ---------------------------------------------------------------------
    // Manufacturer functions
    // ---------------------------------------------------------------------
    function registerBatch(
        string calldata _medicineName,
        string calldata _batchCode,
        uint256 _expiryDate,
        uint256 _quantity
    ) external onlyManufacturer returns (uint256) {
        require(bytes(_medicineName).length > 0, "Medicine name required");
        require(bytes(_batchCode).length > 0, "Batch code required");
        require(_quantity > 0, "Quantity must be > 0");
        require(_expiryDate > block.timestamp, "Expiry must be in the future");

        bytes32 codeHash = keccak256(bytes(_batchCode));
        require(!batchCodeUsed[codeHash], "Batch code already registered");
        batchCodeUsed[codeHash] = true;

        totalBatches += 1;
        uint256 id = totalBatches;

        batches[id] = Batch({
            id: id,
            medicineName: _medicineName,
            batchCode: _batchCode,
            manufactureDate: block.timestamp,
            expiryDate: _expiryDate,
            quantity: _quantity,
            manufacturer: msg.sender,
            currentHolder: msg.sender,
            recalled: false
        });
        custodyTrail[id].push(msg.sender);

        emit BatchRegistered(id, _batchCode, msg.sender);
        return id;
    }

    // ---------------------------------------------------------------------
    // Supply-chain function (current holder only)
    // ---------------------------------------------------------------------
    function transferCustody(uint256 _id, address _to) external batchExists(_id) {
        Batch storage b = batches[_id];
        require(msg.sender == b.currentHolder, "Only current holder can transfer");
        require(_to != address(0), "Invalid recipient");
        require(_to != msg.sender, "Cannot transfer to yourself");
        require(!b.recalled, "Batch is recalled");
        require(block.timestamp < b.expiryDate, "Batch has expired");

        b.currentHolder = _to;
        custodyTrail[_id].push(_to);
        emit CustodyTransferred(_id, msg.sender, _to);
    }

    // ---------------------------------------------------------------------
    // Public read functions (free, no gas)
    // ---------------------------------------------------------------------
    function getBatch(uint256 _id) external view batchExists(_id) returns (Batch memory) {
        return batches[_id];
    }

    function getCustodyTrail(uint256 _id)
        external
        view
        batchExists(_id)
        returns (address[] memory)
    {
        return custodyTrail[_id];
    }

    /// @notice Verify a medicine by the batch code printed on the pack.
    function verifyByCode(string calldata _batchCode)
        external
        view
        returns (Status status, uint256 id)
    {
        if (!batchCodeUsed[keccak256(bytes(_batchCode))]) {
            return (Status.NotFound, 0);
        }
        for (uint256 i = 1; i <= totalBatches; i++) {
            if (keccak256(bytes(batches[i].batchCode)) == keccak256(bytes(_batchCode))) {
                return (_statusOf(i), i);
            }
        }
        return (Status.NotFound, 0);
    }

    function statusOf(uint256 _id) external view batchExists(_id) returns (Status) {
        return _statusOf(_id);
    }

    function _statusOf(uint256 _id) internal view returns (Status) {
        Batch storage b = batches[_id];
        if (b.recalled) return Status.Recalled;
        if (block.timestamp >= b.expiryDate) return Status.Expired;
        return Status.Genuine;
    }
}
