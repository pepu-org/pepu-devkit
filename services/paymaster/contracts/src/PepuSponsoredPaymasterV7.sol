// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { PackedUserOperation } from "@account-abstraction-v7/interfaces/PackedUserOperation.sol";
import { IEntryPoint } from "@account-abstraction-v7/interfaces/IEntryPoint.sol";
import { _packValidationData } from "@account-abstraction-v7/core/Helpers.sol";
import { UserOperationLib } from "@account-abstraction-v7/core/UserOperationLib.sol";

import { MessageHashUtils } from "@openzeppelin-v5.0.2/contracts/utils/cryptography/MessageHashUtils.sol";
import { ReentrancyGuard } from "@openzeppelin-v5.0.2/contracts/utils/ReentrancyGuard.sol";
import { Ownable } from "@openzeppelin-v5.0.2/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin-v5.0.2/contracts/access/Ownable2Step.sol";

import { IPaymasterV7 } from "./interfaces/IPaymasterV7.sol";
import { PostOpMode } from "./interfaces/PostOpMode.sol";

using UserOperationLib for PackedUserOperation;

/// @title PepuSponsoredPaymasterV7
/// @notice Tiered gas-sponsorship paymaster + vault for PEPU (ERC-4337 v0.7). One contract is both the paymaster and
/// the vault: all PEPU sits in this contract's EntryPoint deposit, and a per-sponsor LEDGER records who owns what.
///
/// Sponsors: `sponsorId == 0` is the chain-owned FREE POOL; any other id is a PROJECT, one canonical project per
/// Privy app: `projectId = keccak256(bytes(appId))`. ANYONE can deposit into any projectId at any time, even before
/// the project is claimed. Only the project's OWNER controls its settings, and ownership is established by an on-chain
/// CLAIM backed by an EIP-712 attestation from an authorised signer (the policy service, which verifies the Privy app
/// secret off-chain). The first claim of an EMPTY project is immediate; the first claim of a FUNDED project and every
/// RE-claim of an owned project are timelocked (`adminChangeDelay`), signer-bound and cancellable (review 3, M-1/M-2).
/// A trusted off-chain signer (the policy service) decides which UserOps to sponsor and signs which sponsor pays;
/// the contract then enforces, on-chain and independent of the signer: the sponsor is claimed and not paused,
/// every Kernel call target is on that sponsor's own on-chain allowlist, a per-sponsor daily limit (projects), a
/// per-sender daily limit (REQUIRED for projects; 0 = off only for the free pool, review 3 L-1), and that the sponsor's
/// ledger can cover the MAX cost. Validation deducts the full max
/// cost; `postOp` refunds the unused part to the SAME sponsor ("prepay then refund").
///
/// Core invariant: `totalLiabilities == sum(sponsor balances) <= entryPoint.balanceOf(this)`.
///
/// DEPOSITS ARE ONE-WAY: anyone may deposit into any project (claimed or not) and into the free pool, and NO ONE can
/// withdraw sponsor-ledger funds (not a project owner, not the contract owner, not the manager). The only way PEPU
/// leaves the EntryPoint deposit is the EntryPoint paying a bundler for gas of ops this paymaster sponsored. This
/// contract never calls `entryPoint.withdrawTo`; the only EntryPoint money it can move out is STAKE (a separate
/// balance, never part of any ledger). There is deliberately NO upgradeability, NO owner access to project balances
/// and NO plain `deposit()`/`receive()`. The free pool has NO chain-wide daily ceiling (only the per-op cap and
/// per-sender limit). Because projects cannot exit, their defence against a rogue signer or bundler is PAUSE: the hot
/// manager/owner roles cannot make a signer or bundler addition effective sooner than the immutable `adminChangeDelay`
/// (>= 48 hours), and a project owner can pause the project, and tighten its fee cap and limits, instantly during
/// that window. A funded project nobody owns yet has no owner to pause it, so its first claim is itself timelocked
/// and the contract owner or manager can cancel it. An op's maxFeePerGas is capped on-chain per sponsor. See services/paymaster/SPONSORSHIP-SPEC.md.
///
/// @dev paymasterAndData (mode 1):
///   paymaster(20) | pmVerificationGasLimit(16) | pmPostOpGasLimit(16) | modeByte(1)=0x02 |
///   validUntil(6) | validAfter(6) | sponsorId(32) | signature(65)
/// Signed hash: toEthSignedMessageHash(keccak256(abi.encode(userOpHash', chainid))) with userOpHash' covering
/// `paymasterAndData[0:97]` (everything except the signature, INCLUDING sponsorId).
///
/// @dev Bundler gate (read before running a bundler): validation ALWAYS requires `isBundlerAllowed[tx.origin]`, and
/// the mode byte must be exactly 0x02: there is no mode bit a signer can set to switch the gate off (delta review
/// M1). ERC-7562 [OP-011] bans the ORIGIN opcode during validation, so a conformant
/// (safe-mode) public-mempool bundler rejects every op this paymaster signs. This contract is therefore only
/// supported behind a self-run bundler with the ERC-7562 opcode ban off, whose executor is on the allowlist (the
/// gate then means only that executor can be paid). `address(0)` may be allowlisted so gas estimation (which
/// simulates with tx.origin == 0) works; a mined tx never has tx.origin == 0, so that entry only permits
/// simulation, and a non-allowlisted third-party bundler sees ops that pass simulation but revert (AA33) at
/// inclusion. The gate is what makes the bundler allowlist (and its timelock) the only on-chain restriction on who
/// can be PAID for sponsored gas, even against a compromised signer key.
contract PepuSponsoredPaymasterV7 is Ownable2Step, ReentrancyGuard, IPaymasterV7 {
    /*//////////////////////////////////////////////////////////////
                                TYPES
    //////////////////////////////////////////////////////////////*/

    /// @dev One struct for projects and for the free pool (key bytes32(0)).
    struct Sponsor {
        address owner; // slot0 (160 bits); address(this) for the free pool; address(0) = unclaimed
        bool paused; // slot0 (8)
        uint128 balance; // slot1: spendable ledger balance
        uint128 maxFeePerGas; // slot1: cap on an op's maxFeePerGas (wei); 0 = use `defaultMaxFeePerGas`
        uint112 dailyLimit; // slot2: projects only (> 0). Unused for the free pool (no chain-wide ceiling).
        uint112 spentToday; // slot2: projects only; includes in-flight reservations
        uint32 spentDay; // slot2: day index (validAfter / 1 days), forward-only
        uint112 senderDailyLimit; // slot3: per-sender daily limit (projects: > 0; free pool: 0 = off)
    }

    /// @dev A timelocked re-claim of an already-owned project (see `reclaimProject`).
    struct PendingReclaim {
        address newOwner; // slot0 (160)
        uint48 executableAt; // slot0 (48)
        address signer; // slot1: the signer that attested; must still be a signer at execution
    }

    /// @dev EIP-712 `ProjectClaim` message the signer signs. The domain carries chainId and this contract's address.
    struct Claim {
        string appId;
        address newOwner;
        uint256 nonce;
        uint256 deadline;
        bytes signature; // 65 bytes (r, s, v)
    }

    struct SenderSpend {
        uint32 day;
        uint112 spent; // includes in-flight reservations
    }

    struct Execution {
        address target;
        uint256 value;
        bytes callData;
    }

    /*//////////////////////////////////////////////////////////////
                              CONSTANTS
    //////////////////////////////////////////////////////////////*/

    /// @dev sponsorId of the chain-owned free pool.
    bytes32 internal constant FREE_POOL = bytes32(0);
    /// @dev The only paymaster mode this contract understands.
    uint8 internal constant SPONSORED_MODE = 1;
    /// @dev The only accepted modeByte: mode 1 shifted left one bit, low bit (allowAllBundlers) always 0.
    uint8 internal constant SPONSORED_MODE_BYTE = 0x02;
    /// @dev modeByte (1) + validUntil (6) + validAfter (6) + sponsorId (32)
    uint256 internal constant SIGNED_DATA_LENGTH = 1 + 12 + 32;
    uint256 internal constant PAYMASTER_DATA_OFFSET = UserOperationLib.PAYMASTER_DATA_OFFSET; // 52
    /// @dev Kernel v3 `execute(bytes32,bytes)`
    bytes4 internal constant KERNEL_EXECUTE_SELECTOR = 0xe9ae5c53;
    uint256 internal constant MAX_BATCH = 16;
    /// @notice Minimum paymasterPostOpGasLimit an approval must carry, so a mis-signed approval cannot make postOp OOG.
    uint256 public constant MIN_POSTOP_GAS_LIMIT = 40_000;
    /// @notice Floor for `postOpOverheadGas`: above the worst postOp gas measured on the REAL EntryPoint v0.7 (an op
    /// that restores the sponsor's storage slots, see test/PepuSponsoredPaymasterV7.RealEntryPoint.t.sol), plus margin.
    uint32 public constant MIN_POSTOP_OVERHEAD_GAS = 18_000;
    /// @dev Hard ceiling for the constructor's initial overhead (which in turn is the owner's upper bound).
    uint32 internal constant HARD_MAX_POSTOP_OVERHEAD_GAS = 30_000;
    /// @notice Floor for the immutable `adminChangeDelay` (constructor-enforced).
    uint32 public constant MIN_ADMIN_CHANGE_DELAY = 48 hours;
    /// @notice Ceiling for the immutable `adminChangeDelay` (constructor-enforced), so a deploy typo cannot freeze rotation.
    uint32 public constant MAX_ADMIN_CHANGE_DELAY = 30 days;
    /// @notice A pending claim, re-claim or signer/bundler addition can be executed until this long after it becomes
    /// executable; later it behaves as absent (review 3, B5).
    uint32 public constant PENDING_EXPIRY = 30 days;
    /// @notice A claim attestation's deadline may be at most this far in the future (limits a leaked signer key).
    uint256 internal constant MAX_CLAIM_DEADLINE_AHEAD = 1 hours;
    uint256 internal constant MAX_APP_ID_LENGTH = 128;
    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant CLAIM_TYPEHASH =
        keccak256("ProjectClaim(string appId,address newOwner,uint256 nonce,uint256 deadline)");
    bytes32 internal constant NAME_HASH = keccak256("PepuSponsoredPaymaster");
    bytes32 internal constant VERSION_HASH = keccak256("1");
    uint8 internal constant KIND_SIGNER = 1;
    uint8 internal constant KIND_BUNDLER = 2;
    /// @dev EntryPoint v0.7 charges a 10% penalty on UNUSED execution gas (callGasLimit + postOpGasLimit); it is added
    /// AFTER postOp runs, so postOp cannot see it. We charge its worst case (all of it unused) up front.
    uint256 internal constant EP_UNUSED_GAS_PENALTY_PERCENT = 10;
    /// @notice Unattributable EntryPoint deposit kept as a solvency buffer; only the excess is creditable to the free pool.
    uint256 public constant SURPLUS_RESERVE = 1 ether;

    /*//////////////////////////////////////////////////////////////
                              IMMUTABLES
    //////////////////////////////////////////////////////////////*/

    IEntryPoint public immutable entryPoint;
    /// @notice Upper bound for `postOpOverheadGas`: the value it was deployed with. The owner can only LOWER it
    /// (down to MIN_POSTOP_OVERHEAD_GAS), never raise it above this.
    uint32 public immutable maxPostOpOverheadGas;
    /// @notice Delay between proposing and executing a signer or bundler ADDITION (>= MIN_ADMIN_CHANGE_DELAY, 48h).
    /// Immutable, so projects can verify it. Within this window a project owner can pause the project (the exit) and
    /// tighten its fee cap and limits. Removals are instant.
    uint48 public immutable adminChangeDelay;
    /// @notice Max `maxFeePerGas` (wei) any sponsor without its own cap will fund per op. Immutable.
    uint128 public immutable defaultMaxFeePerGas;

    /*//////////////////////////////////////////////////////////////
                               STORAGE
    //////////////////////////////////////////////////////////////*/

    mapping(bytes32 sponsorId => Sponsor) internal sponsors;
    mapping(bytes32 sponsorId => mapping(address target => bool allowed)) internal targetAllowed;
    mapping(bytes32 sponsorId => mapping(address sender => SenderSpend)) internal senderSpend;
    mapping(bytes32 projectId => address) public pendingProjectOwner;
    /// @notice A pending first claim of a FUNDED project (owner == 0) or a pending re-claim of an owned one. Expires
    /// `PENDING_EXPIRY` after it becomes executable (an expired entry behaves as if absent).
    mapping(bytes32 projectId => PendingReclaim) public pendingReclaim;
    /// @notice The `newOwner` of the last pending re-claim the owner cancelled. Each (project, newOwner) pair can be
    /// vetoed ONCE: a second attested re-claim for the same pair is not cancellable (review 3, M-2).
    mapping(bytes32 projectId => address newOwner) public vetoedReclaimant;
    /// @notice Claim attestations (by EIP-712 digest) already consumed: each can be used once.
    mapping(bytes32 digest => bool used) public claimUsed;
    mapping(address bundler => bool allowed) public isBundlerAllowed;
    mapping(address account => bool isValidSigner) public signers;
    /// @notice When a signer was last removed (0 = never). A pending re-claim proposed at or before this time dies
    /// with the signer and cannot revive if the signer is later re-added (delta review L3).
    mapping(address signer => uint48 removedAt) public signerRemovedAt;
    /// @notice Optional per-sponsor account-code pin (audit L-2). If non-zero, only senders whose runtime codehash
    /// equals it are sponsored by that sponsor. 0 = no restriction.
    mapping(bytes32 sponsorId => bytes32 codehash) public requiredAccountCodehash;
    /// @notice Pending signer/bundler additions: key => earliest execution time (0 = none).
    mapping(bytes32 key => uint48 executableAt) public pendingAdminChange;

    /// @notice Operational hot role (signer rotation, bundler list, free-tier destinations, stake). Set by the owner.
    address public manager;

    /// @notice Sum of every sponsor's ledger balance. Always <= entryPoint.balanceOf(this).
    uint256 public totalLiabilities;
    /// @notice Per-op max cost the free pool will accept.
    uint128 public freeMaxOpCost;
    bool public freeEnabled;
    /// @notice Gas charged on top of `actualGasCost` to cover the postOp call itself (EntryPoint charges for it).
    uint32 public postOpOverheadGas;

    /*//////////////////////////////////////////////////////////////
                                ERRORS
    //////////////////////////////////////////////////////////////*/

    error PaymasterAndDataLengthInvalid();
    error PaymasterModeInvalid();
    error PaymasterConfigLengthInvalid();
    error PaymasterSignatureLengthInvalid();
    error BundlerNotAllowed(address bundler);
    error InvalidValidityWindow();
    error PostOpGasLimitTooLow();
    error UnknownSponsor(bytes32 sponsorId);
    error SponsorPaused(bytes32 sponsorId);
    error FreeTierDisabled();
    error OpCostTooHigh(uint256 maxCost, uint256 limit);
    error UnsupportedCallData();
    error TargetNotAllowed(address target);
    error DailyLimitExceeded(bytes32 sponsorId);
    error SenderDailyLimitExceeded(bytes32 sponsorId, address sender);
    error InsufficientSponsorBalance(bytes32 sponsorId, uint256 balance, uint256 maxCost);
    error NotProjectOwner();
    error NotPendingProjectOwner();
    error ProjectAlreadyClaimed(bytes32 projectId);
    error ProjectNotClaimed(bytes32 projectId);
    error ClaimExpired(uint256 deadline);
    error ClaimAlreadyUsed(bytes32 digest);
    error InvalidClaimSignature();
    error NoPendingReclaim(bytes32 projectId);
    error ReclaimNotReady(uint48 executableAt);
    error ReclaimSignerRemoved(address signer);
    error InvalidAppId();
    error InvalidOwner();
    error ZeroAmount();
    error ZeroDailyLimit();
    error NothingToCredit();
    error DelayTooShort();
    error DelayTooLong();
    error ClaimDeadlineTooFar(uint256 deadline);
    error OverheadOutOfBounds();
    error CostTooLarge();
    error NotOwnerOrManager();
    error NotEntryPoint();
    error MaxFeePerGasTooHigh(uint256 maxFeePerGas, uint256 cap);
    error AccountCodehashMismatch(address sender, bytes32 codehash);
    error ZeroFeeCap();
    error ReclaimNotCancellable(bytes32 projectId);
    error InvalidFreeTierConfig();
    error InvalidAdminChange();
    error AdminChangeAlreadyProposed();
    error AdminChangeNotProposed();
    error AdminChangeNotReady(uint48 executableAt);

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event ProjectClaimed(bytes32 indexed projectId, address indexed owner, string appId);
    event ProjectReclaimProposed(
        bytes32 indexed projectId, address indexed currentOwner, address indexed newOwner, uint48 executableAt
    );
    event ProjectReclaimCancelled(bytes32 indexed projectId);
    /// @dev The FIRST claim of a funded project is pending for `adminChangeDelay` (review 3, M-1). `appId` is logged
    /// here because `ProjectClaimed` is not emitted for a pending claim.
    event ProjectClaimProposed(bytes32 indexed projectId, address indexed newOwner, uint48 executableAt, string appId);
    event Deposited(bytes32 indexed sponsorId, address indexed from, uint256 amount, uint256 newBalance);
    event TargetSet(bytes32 indexed sponsorId, address indexed target, bool allowed);
    event DailyLimitSet(bytes32 indexed sponsorId, uint256 limit);
    event SenderDailyLimitSet(bytes32 indexed sponsorId, uint256 limit);
    event PausedSet(bytes32 indexed projectId, bool paused);
    event ProjectOwnershipTransferStarted(bytes32 indexed projectId, address indexed newOwner);
    event ProjectOwnershipTransferred(bytes32 indexed projectId, address indexed oldOwner, address indexed newOwner);
    event FreeTierConfigured(uint256 maxOpCost, uint256 senderDailyLimit, bool enabled);
    event SurplusCreditedToFreePool(uint256 amount);
    event ManagerSet(address indexed manager);
    event PostOpOverheadGasSet(uint32 gas);
    event BundlerAllowlistUpdated(address bundler, bool allowed);
    event SignerAdded(address signer);
    event SignerRemoved(address signer);
    event AdminChangeProposed(bytes32 indexed key, uint8 kind, address indexed account, uint48 executableAt);
    event AdminChangeCancelled(bytes32 indexed key, uint8 kind, address indexed account);
    event MaxFeePerGasSet(bytes32 indexed sponsorId, uint256 cap);
    event RequiredAccountCodehashSet(bytes32 indexed sponsorId, bytes32 codehash);
    event SponsorReserved(bytes32 indexed sponsorId, bytes32 indexed userOpHash, address indexed sender, uint256 amount);
    event UserOpSettled(
        bytes32 indexed sponsorId, bytes32 indexed userOpHash, address indexed sender, uint256 reserved, uint256 charged
    );

    /*//////////////////////////////////////////////////////////////
                             CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /// @param _adminChangeDelay timelock (seconds, within [48 hours, 30 days]) on every LATER signer/bundler addition. Immutable.
    /// @param _owner initial owner (non-zero).
    /// @param _signers initial signers, effective immediately (every LATER addition is timelocked).
    /// @param _bundlers initial bundler executors, effective immediately (every LATER addition is timelocked).
    /// @param _postOpOverheadGas initial AND maximum postOp overhead; within [MIN_POSTOP_OVERHEAD_GAS, HARD_MAX].
    /// @param _defaultMaxFeePerGas default cap (wei, > 0) on an op's maxFeePerGas for sponsors without their own.
    constructor(
        address _entryPoint,
        address _owner,
        address _manager,
        address[] memory _signers,
        address[] memory _bundlers,
        uint32 _adminChangeDelay,
        uint32 _postOpOverheadGas,
        uint128 _defaultMaxFeePerGas
    )
        Ownable(_owner)
    {
        if (_adminChangeDelay < MIN_ADMIN_CHANGE_DELAY) revert DelayTooShort();
        if (_adminChangeDelay > MAX_ADMIN_CHANGE_DELAY) revert DelayTooLong();
        if (_postOpOverheadGas < MIN_POSTOP_OVERHEAD_GAS || _postOpOverheadGas > HARD_MAX_POSTOP_OVERHEAD_GAS) {
            revert OverheadOutOfBounds();
        }
        if (_defaultMaxFeePerGas == 0) revert ZeroFeeCap();
        entryPoint = IEntryPoint(_entryPoint);
        adminChangeDelay = _adminChangeDelay;
        defaultMaxFeePerGas = _defaultMaxFeePerGas;
        postOpOverheadGas = _postOpOverheadGas;
        maxPostOpOverheadGas = _postOpOverheadGas;
        manager = _manager;
        for (uint256 i = 0; i < _signers.length; i++) {
            signers[_signers[i]] = true;
        }
        for (uint256 i = 0; i < _bundlers.length; i++) {
            isBundlerAllowed[_bundlers[i]] = true;
        }
        // The free pool is a sponsor owned by the contract itself: no EOA can satisfy an owner check for it.
        sponsors[FREE_POOL].owner = address(this);
    }

    // Modifiers delegate to internal functions so their bodies are not inlined at every use (contract size).
    modifier onlyProjectOwner(bytes32 projectId) {
        _checkProjectOwner(projectId);
        _;
    }

    modifier onlyOwnerOrManager() {
        _checkOwnerOrManager();
        _;
    }

    function _checkProjectOwner(bytes32 projectId) internal view {
        if (projectId == FREE_POOL || sponsors[projectId].owner != msg.sender) revert NotProjectOwner();
    }

    function _checkOwnerOrManager() internal view {
        if (msg.sender == address(0) || (msg.sender != owner() && msg.sender != manager)) revert NotOwnerOrManager();
    }

    /*//////////////////////////////////////////////////////////////
                  ERC-4337 v0.7: VALIDATION AND SETTLEMENT
    //////////////////////////////////////////////////////////////*/

    /// @inheritdoc IPaymasterV7
    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    )
        external
        override
        returns (bytes memory context, uint256 validationData)
    {
        if (msg.sender != address(entryPoint)) revert NotEntryPoint();

        (bytes32 sponsorId, uint48 validUntil, uint48 validAfter, bool sigOk) = _parseAndVerify(userOp);
        if (!sigOk) {
            // No state change, empty context: lets dummy-signature gas-estimation stubs run without reverting or charging.
            return ("", _packValidationData(true, validUntil, validAfter));
        }

        if (validUntil == 0) revert InvalidValidityWindow();
        if (uint128(bytes16(userOp.paymasterAndData[36:52])) < MIN_POSTOP_GAS_LIMIT) revert PostOpGasLimitTooLow();
        if (maxCost > type(uint128).max) revert CostTooLarge();

        address sender = userOp.getSender();
        _requireFeeCap(sponsorId, userOp.unpackMaxFeePerGas());
        _requireAccountAllowed(sponsorId, sender);
        (uint32 projectDay, uint32 senderDay1) =
            _reserve(sponsorId, sender, userOp.callData, uint128(maxCost), validAfter);

        emit SponsorReserved(sponsorId, userOpHash, sender, maxCost);
        context = _buildContext(userOp, sponsorId, uint128(maxCost), userOpHash, sender, projectDay, senderDay1);
        validationData = _packValidationData(false, validUntil, validAfter);
    }

    function _buildContext(
        PackedUserOperation calldata userOp,
        bytes32 sponsorId,
        uint128 maxCost,
        bytes32 userOpHash,
        address sender,
        uint32 projectDay,
        uint32 senderDay1
    )
        internal
        view
        returns (bytes memory)
    {
        // Execution gas EntryPoint's unused-gas penalty is computed on: callGasLimit + paymasterPostOpGasLimit.
        uint256 penaltyBasis = userOp.unpackCallGasLimit() + uint256(uint128(bytes16(userOp.paymasterAndData[36:52])));
        // L-6: the postOp gas allowance is SNAPSHOTTED here: postOp makes no cold read of `postOpOverheadGas`, and a
        // `setPostOpOverheadGas` between validation and postOp cannot change what an in-flight op is charged.
        uint256 extraGas = uint256(postOpOverheadGas) + penaltyBasis / 10;
        return abi.encode(sponsorId, maxCost, userOpHash, sender, projectDay, senderDay1, extraGas);
    }

    /// @dev Parses paymasterAndData (mode byte 0x02), applies the (unconditional) bundler gate, and verifies the signer's signature.
    function _parseAndVerify(PackedUserOperation calldata userOp)
        internal
        view
        returns (bytes32 sponsorId, uint48 validUntil, uint48 validAfter, bool sigOk)
    {
        bytes calldata pmd = userOp.paymasterAndData;
        if (pmd.length < PAYMASTER_DATA_OFFSET + 1) revert PaymasterAndDataLengthInvalid();
        // Exactly 0x02 (mode 1, allowAllBundlers = 0). No other byte is accepted, so a signer cannot opt out of the gate.
        if (uint8(pmd[PAYMASTER_DATA_OFFSET]) != SPONSORED_MODE_BYTE) revert PaymasterModeInvalid();
        if (!isBundlerAllowed[tx.origin]) revert BundlerNotAllowed(tx.origin);

        bytes calldata cfg = pmd[PAYMASTER_DATA_OFFSET + 1:];
        if (cfg.length < 12 + 32) revert PaymasterConfigLengthInvalid();
        validUntil = uint48(bytes6(cfg[0:6]));
        validAfter = uint48(bytes6(cfg[6:12]));
        sponsorId = bytes32(cfg[12:44]);
        // Exactly 65 bytes (r, s, v): the 64-byte EIP-2098 form is not supported.
        if (cfg.length - 44 != 65) revert PaymasterSignatureLengthInvalid();

        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(getHash(SPONSORED_MODE, userOp));
        sigOk = _signerOf(digest, bytes32(cfg[44:76]), bytes32(cfg[76:108]), uint8(cfg[108])) != address(0);
    }

    /// @dev Same acceptance rules as OpenZeppelin's ECDSA (low-s only, v in {27, 28}, non-zero signer), but a malformed
    /// or unrecoverable signature is a signature FAILURE (address(0)), never a revert (audit I-7). Returns the
    /// recovered address only if it is a CURRENT signer.
    function _signerOf(bytes32 digest, bytes32 r, bytes32 s, uint8 v) internal view returns (address) {
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return address(0);
        address recovered = ecrecover(digest, v, r, s);
        return signers[recovered] ? recovered : address(0);
    }

    /// @dev The op's maxFeePerGas bounds the gas price the EntryPoint can charge (actual = min(maxFee, prio + basefee)),
    /// so capping it on-chain bounds what any sponsor can be charged per gas, whatever the signer approves.
    function _requireFeeCap(bytes32 sponsorId, uint256 maxFeePerGas) internal view {
        uint256 cap = _effectiveMaxFeePerGas(sponsorId);
        if (maxFeePerGas > cap) revert MaxFeePerGasTooHigh(maxFeePerGas, cap);
    }

    /// @dev Optional account-code restriction (runtime codehash of the sender, available after initCode ran).
    function _requireAccountAllowed(bytes32 sponsorId, address sender) internal view {
        bytes32 required = requiredAccountCodehash[sponsorId];
        if (required == 0) return;
        bytes32 h = sender.codehash;
        if (h != required) revert AccountCodehashMismatch(sender, h);
    }

    /// @dev Checks the sponsor and deducts `maxCost`. Split out of validate to keep the stack shallow.
    function _reserve(bytes32 sponsorId, address sender, bytes calldata callData, uint128 maxCost, uint48 validAfter)
        internal
        returns (uint32 projectDay, uint32 senderDay1)
    {
        Sponsor storage s = sponsors[sponsorId];
        if (s.owner == address(0)) revert UnknownSponsor(sponsorId);
        if (s.paused) revert SponsorPaused(sponsorId);
        bool isFree = sponsorId == FREE_POOL;
        if (isFree) {
            if (!freeEnabled) revert FreeTierDisabled();
            if (maxCost > freeMaxOpCost) revert OpCostTooHigh(maxCost, freeMaxOpCost);
        }

        _requireTargetsAllowed(sponsorId, callData);

        // Day bucket keyed off the SIGNED validAfter (no TIMESTAMP opcode in validation). Forward-only.
        uint32 day = uint32(validAfter / 1 days);

        if (!isFree) {
            // Project-wide daily limit. (The free pool has NO chain-wide ceiling by design.)
            if (day > s.spentDay) {
                s.spentDay = day;
                s.spentToday = 0;
            }
            if (uint256(s.spentToday) + maxCost > s.dailyLimit) {
                revert DailyLimitExceeded(sponsorId);
            }
            unchecked {
                s.spentToday += uint112(maxCost); // <= dailyLimit (uint112) by the check above
            }
            // The bucket the reservation REALLY landed in (newer than `day` for an op signed before midnight).
            projectDay = s.spentDay;
        }

        uint112 senderLimit = s.senderDailyLimit;
        if (senderLimit != 0) {
            SenderSpend storage ss = senderSpend[sponsorId][sender];
            if (day > ss.day) {
                ss.day = day;
                ss.spent = 0;
            }
            if (uint256(ss.spent) + maxCost > senderLimit) {
                revert SenderDailyLimitExceeded(sponsorId, sender);
            }
            unchecked {
                ss.spent += uint112(maxCost); // <= senderLimit (uint112)
            }
            // `+ 1` so that 0 means "this sender is not tracked" (a real day index is 0 when validAfter == 0).
            senderDay1 = ss.day + 1;
        } else if (!isFree) {
            // L-1 (review 3): a PROJECT without a per-sender limit fails closed. 0 only means "off" for the free pool.
            revert ZeroDailyLimit();
        }

        if (s.balance < maxCost) revert InsufficientSponsorBalance(sponsorId, s.balance, maxCost);
        unchecked {
            s.balance -= maxCost;
            totalLiabilities -= maxCost; // totalLiabilities >= balance >= maxCost
        }
    }

    /// @inheritdoc IPaymasterV7
    /// @dev MUST NOT REVERT (see spec 4.5): only guarded arithmetic, no external calls, no loops. The refund goes to
    /// the exact sponsor that was charged at validation (sponsorId travels in the context), for `opSucceeded` and
    /// `opReverted` alike. NOTE: EntryPoint v0.7 never re-invokes postOp in `postOpReverted` mode; see spec 4.5 for
    /// why that case is unreachable in practice and where any residue then goes.
    function postOp(
        PostOpMode, /* mode: charged identically whether the op succeeded or reverted */
        bytes calldata context,
        uint256 actualGasCost,
        uint256 actualUserOpFeePerGas
    )
        external
        override
    {
        if (msg.sender != address(entryPoint)) revert NotEntryPoint();

        (
            bytes32 sponsorId,
            uint128 reserved,
            bytes32 userOpHash,
            address sender,
            uint32 projectDay,
            uint32 senderDay1,
            uint256 extraGas
        ) = abi.decode(context, (bytes32, uint128, bytes32, address, uint32, uint32, uint256));

        uint256 charge = _charge(reserved, actualGasCost, actualUserOpFeePerGas, extraGas);
        uint128 refund = reserved - uint128(charge);

        Sponsor storage s = sponsors[sponsorId];
        s.balance += refund; // cannot overflow: balance + refund <= balance before validation
        totalLiabilities += refund;
        // Release the refund from the bucket that received the reservation, if that bucket is still current.
        if (sponsorId != FREE_POOL && s.spentDay == projectDay) {
            uint112 spent = s.spentToday;
            s.spentToday = spent > refund ? spent - uint112(refund) : 0;
        }
        if (senderDay1 != 0) {
            SenderSpend storage ss = senderSpend[sponsorId][sender];
            if (ss.day + 1 == senderDay1) {
                uint112 spentSender = ss.spent;
                ss.spent = spentSender > refund ? spentSender - uint112(refund) : 0;
            }
        }
        emit UserOpSettled(sponsorId, userOpHash, sender, reserved, charge);
    }

    /// @dev charge = min(reserved, actualGasCost + extraGas * fee), saturating, never reverts. `extraGas` is the
    /// validation-time snapshot of `postOpOverheadGas + (callGasLimit + postOpGasLimit) / 10`.
    /// EntryPoint's final cost = actualGasCost + (gas used by postOp and its call frame) * fee + (10% of unused
    /// execution gas) * fee. The second term is bounded by `postOpOverheadGas`, the third by the penalty basis / 10.
    function _charge(uint256 reserved, uint256 actualGasCost, uint256 fee, uint256 extraGas)
        internal
        pure
        returns (uint256 charge)
    {
        if (fee != 0 && extraGas > (type(uint256).max - actualGasCost) / fee) return reserved;
        charge = actualGasCost + extraGas * fee;
        if (charge > reserved) charge = reserved;
    }

    /// @dev Kernel v3 execute(bytes32 mode, bytes executionCalldata): single (0x00) or batch (0x01) only.
    /// RESIDUAL RISK (L-2): this checks the calldata SHAPE, not what the sender contract does with it. A contract
    /// that implements the Kernel selector with different semantics passes. Bound it per sponsor with
    /// `setRequiredAccountCodehash` (only senders whose runtime codehash equals it are sponsored); without that, treat the
    /// allowlist as a usage policy for Kernel accounts, bounded in cost by the balance, daily limits and fee cap.
    function _requireTargetsAllowed(bytes32 sponsorId, bytes calldata callData) internal view {
        if (callData.length < 4 + 64 || bytes4(callData[0:4]) != KERNEL_EXECUTE_SELECTOR) revert UnsupportedCallData();
        mapping(address => bool) storage allowed = targetAllowed[sponsorId];
        (bytes32 mode, bytes memory exec) = abi.decode(callData[4:], (bytes32, bytes));
        bytes1 callType = bytes1(mode);
        if (callType == 0x00) {
            if (exec.length < 52) revert UnsupportedCallData();
            address target;
            assembly ("memory-safe") {
                target := shr(96, mload(add(exec, 32)))
            }
            if (!allowed[target]) revert TargetNotAllowed(target);
        } else if (callType == 0x01) {
            Execution[] memory batch = abi.decode(exec, (Execution[]));
            if (batch.length == 0 || batch.length > MAX_BATCH) revert UnsupportedCallData();
            for (uint256 i = 0; i < batch.length; i++) {
                if (!allowed[batch[i].target]) revert TargetNotAllowed(batch[i].target);
            }
        } else {
            revert UnsupportedCallData(); // static, delegatecall and unknown call types are never sponsored
        }
    }

    /*//////////////////////////////////////////////////////////////
                           SIGNATURE HASH
    //////////////////////////////////////////////////////////////*/

    /// @notice Hash the signer signs (after EIP-191 wrapping). Covers `paymasterAndData[0:97]`, including sponsorId.
    function getHash(uint8 _mode, PackedUserOperation calldata _userOp) public view returns (bytes32) {
        if (_mode != SPONSORED_MODE) revert PaymasterModeInvalid();
        bytes32 userOpHash = keccak256(
            abi.encode(
                _userOp.getSender(),
                _userOp.nonce,
                _userOp.accountGasLimits,
                _userOp.preVerificationGas,
                _userOp.gasFees,
                keccak256(_userOp.initCode),
                keccak256(_userOp.callData),
                keccak256(_userOp.paymasterAndData[:PAYMASTER_DATA_OFFSET + SIGNED_DATA_LENGTH])
            )
        );
        return keccak256(abi.encode(userOpHash, block.chainid));
    }

    /*//////////////////////////////////////////////////////////////
              PROJECT LIFECYCLE (PERMISSIONLESS DEPOSITS; ATTESTED CLAIMS)
    //////////////////////////////////////////////////////////////*/

    /// @notice FIRST claim of a project: the caller submits an attestation (EIP-712 `ProjectClaim`) from a current
    /// signer that `c.newOwner` controls the Privy app `c.appId`. Anyone may relay it (the attestation fixes the
    /// owner) and it is single-use. A claim of an EMPTY project (ledger balance 0) takes effect immediately. A claim
    /// of a FUNDED project (review 3, M-1) is PENDING for `adminChangeDelay` (>= 48h): bound to the attesting signer
    /// (it dies if that signer is removed), announced by `ProjectClaimProposed`, finished by anyone with
    /// `executeReclaim`, and cancellable by the contract owner or manager with `cancelReclaim`. This gives a
    /// funded, unowned project (which nobody can pause yet) the same defence window as every other signer-gated
    /// change. A project that is already owned reverts: use `reclaimProject` (timelocked) instead.
    /// The claim sets NO configuration (delta review L2: the attestation cannot bind caller-chosen settings, so there
    /// are none to choose): the project starts with an empty allowlist and `dailyLimit == 0`, so nothing is spendable
    /// until the owner calls `setTargets`, `setDailyLimit` and `setSenderDailyLimit`. Deposits made before the
    /// claim are already in the ledger and become spendable only once the owner has configured the project.
    function claimProject(Claim calldata c) external returns (bytes32 projectId) {
        address signer;
        (projectId, signer) = _verifyClaim(c);
        Sponsor storage s = sponsors[projectId];
        if (s.owner != address(0)) revert ProjectAlreadyClaimed(projectId);
        if (s.balance == 0) {
            s.owner = c.newOwner;
            emit ProjectClaimed(projectId, c.newOwner, c.appId);
        } else {
            emit ProjectClaimProposed(projectId, c.newOwner, _setPending(projectId, c.newOwner, signer), c.appId);
        }
    }

    /// @notice RE-claim of an ALREADY-OWNED project (the owner lost their wallet, or hands over by re-verifying).
    /// Same attestation as `claimProject`, but the new owner only takes over `adminChangeDelay` (>= 48h) later via
    /// `executeReclaim`, and `ProjectReclaimProposed` is emitted so the change is visible. The current owner can
    /// `cancelReclaim` it ONCE per (project, newOwner): after a veto, a second attested re-claim by the same
    /// `newOwner` cannot be cancelled (review 3, M-2: a hostile or compromised owner cannot block recovery forever).
    /// A newer attested re-claim replaces a pending one and restarts the delay.
    function reclaimProject(Claim calldata c) external {
        (bytes32 projectId, address signer) = _verifyClaim(c);
        address current = sponsors[projectId].owner;
        if (current == address(0)) revert ProjectNotClaimed(projectId);
        emit ProjectReclaimProposed(projectId, current, c.newOwner, _setPending(projectId, c.newOwner, signer));
    }

    function _setPending(bytes32 projectId, address newOwner, address signer) internal returns (uint48 executableAt) {
        executableAt = uint48(block.timestamp) + adminChangeDelay;
        pendingReclaim[projectId] = PendingReclaim(newOwner, executableAt, signer);
    }

    /// @notice Permissionless once the delay has passed (and before it expires), provided the attesting signer is still
    /// a signer (removing a signer therefore also kills every claim and re-claim it started).
    function executeReclaim(bytes32 projectId) external {
        PendingReclaim memory p = pendingReclaim[projectId];
        if (p.newOwner == address(0) || block.timestamp > p.executableAt + PENDING_EXPIRY) {
            revert NoPendingReclaim(projectId);
        }
        if (block.timestamp < p.executableAt) revert ReclaimNotReady(p.executableAt);
        if (!signers[p.signer] || p.executableAt - adminChangeDelay <= signerRemovedAt[p.signer]) {
            revert ReclaimSignerRemoved(p.signer);
        }
        address old = sponsors[projectId].owner;
        delete pendingReclaim[projectId];
        delete pendingProjectOwner[projectId];
        delete vetoedReclaimant[projectId];
        sponsors[projectId].owner = p.newOwner;
        emit ProjectOwnershipTransferred(projectId, old, p.newOwner);
    }

    /// @notice Cancel a pending claim or re-claim. For an OWNED project: the current owner, once per (project,
    /// newOwner) pair. For a project with NO owner (a pending first claim): the contract owner or manager.
    function cancelReclaim(bytes32 projectId) external {
        address newOwner = pendingReclaim[projectId].newOwner;
        if (sponsors[projectId].owner == address(0)) {
            _checkOwnerOrManager();
        } else {
            _checkProjectOwner(projectId);
            if (newOwner != address(0)) {
                if (vetoedReclaimant[projectId] == newOwner) revert ReclaimNotCancellable(projectId);
                vetoedReclaimant[projectId] = newOwner;
            }
        }
        if (newOwner == address(0)) revert NoPendingReclaim(projectId);
        delete pendingReclaim[projectId];
        emit ProjectReclaimCancelled(projectId);
    }

    /// @dev Validates and CONSUMES a claim attestation. Returns the projectId and the attesting signer.
    function _verifyClaim(Claim calldata c) internal returns (bytes32 projectId, address signer) {
        uint256 len = bytes(c.appId).length;
        if (len == 0 || len > MAX_APP_ID_LENGTH) revert InvalidAppId();
        if (c.newOwner == address(0) || c.newOwner == address(this)) revert InvalidOwner();
        if (block.timestamp > c.deadline) revert ClaimExpired(c.deadline);
        if (c.deadline > block.timestamp + MAX_CLAIM_DEADLINE_AHEAD) revert ClaimDeadlineTooFar(c.deadline);
        if (c.signature.length != 65) revert InvalidClaimSignature();
        bytes32 digest = claimDigest(c.appId, c.newOwner, c.nonce, c.deadline);
        if (claimUsed[digest]) revert ClaimAlreadyUsed(digest);
        bytes calldata sig = c.signature;
        signer = _signerOf(digest, bytes32(sig[0:32]), bytes32(sig[32:64]), uint8(sig[64]));
        if (signer == address(0)) revert InvalidClaimSignature();
        claimUsed[digest] = true;
        projectId = keccak256(bytes(c.appId));
    }

    /// @notice ANYONE may deposit into any project, claimed or not (but not the free pool: see `fundFreePool`).
    /// ONE-WAY: nothing can ever withdraw it. The project's settings (targets, limits, fee cap, codehash pin, pause)
    /// are controlled by `getProject(projectId).projectOwner` (address(0) = not yet claimed, so the funds cannot be
    /// spent yet); a depositor can check that owner first. Depositing to an id nobody ever claims strands the funds.
    function depositFor(bytes32 projectId) external payable nonReentrant {
        if (msg.value == 0) revert ZeroAmount();
        if (projectId == FREE_POOL) revert UnknownSponsor(projectId);
        _credit(projectId, msg.value);
    }

    function setTargets(bytes32 projectId, address[] calldata targets, bool allowed)
        external
        onlyProjectOwner(projectId)
    {
        _setTargets(projectId, targets, allowed);
    }

    function setDailyLimit(bytes32 projectId, uint112 limit) external onlyProjectOwner(projectId) {
        if (limit == 0) revert ZeroDailyLimit();
        sponsors[projectId].dailyLimit = limit;
        emit DailyLimitSet(projectId, limit);
    }

    function setSenderDailyLimit(bytes32 projectId, uint112 limit) external onlyProjectOwner(projectId) {
        if (limit == 0) revert ZeroDailyLimit();
        sponsors[projectId].senderDailyLimit = limit;
        emit SenderDailyLimitSet(projectId, limit);
    }

    /// @notice Project owner: cap on an op's maxFeePerGas this project will fund (wei, > 0). Overrides the default.
    function setMaxFeePerGas(bytes32 projectId, uint128 cap) external onlyProjectOwner(projectId) {
        _setMaxFeePerGas(projectId, cap);
    }

    /// @notice Project owner: only sponsor senders whose runtime codehash equals `codehash` (0 turns the restriction
    /// off). Pin the codehash of your account proxy (e.g. the Kernel proxy your factory deploys).
    function setRequiredAccountCodehash(bytes32 projectId, bytes32 codehash) external onlyProjectOwner(projectId) {
        requiredAccountCodehash[projectId] = codehash;
        emit RequiredAccountCodehashSet(projectId, codehash);
    }

    /// @notice Pause/unpause spending for this project (immediate; only affects the project's own users). With deposits
    /// one-way, PAUSE IS A PROJECT'S EXIT: a paused project's ledger cannot be spent by anyone, whatever the signer signs.
    function setPaused(bytes32 projectId, bool paused) external onlyProjectOwner(projectId) {
        sponsors[projectId].paused = paused;
        emit PausedSet(projectId, paused);
    }

    function proposeProjectOwner(bytes32 projectId, address newOwner) external onlyProjectOwner(projectId) {
        // address(0) UNSETS a nomination (review 3, B5). A nominee can only accept by calling, so address(this) is inert.
        pendingProjectOwner[projectId] = newOwner;
        emit ProjectOwnershipTransferStarted(projectId, newOwner);
    }

    function acceptProjectOwnership(bytes32 projectId) external {
        if (msg.sender == address(0) || pendingProjectOwner[projectId] != msg.sender) revert NotPendingProjectOwner();
        address old = sponsors[projectId].owner;
        delete pendingProjectOwner[projectId];
        // a voluntary transfer supersedes a pending re-claim, EXCEPT one already vetoed once (it cannot be vetoed again)
        if (pendingReclaim[projectId].newOwner != vetoedReclaimant[projectId]) delete pendingReclaim[projectId];
        sponsors[projectId].owner = msg.sender;
        emit ProjectOwnershipTransferred(projectId, old, msg.sender);
    }

    /*//////////////////////////////////////////////////////////////
                         FREE POOL (CHAIN)
    //////////////////////////////////////////////////////////////*/

    /// @notice Anyone may add PEPU to the chain-owned free pool. One-way: nothing can withdraw it.
    function fundFreePool() external payable nonReentrant {
        if (msg.value == 0) revert ZeroAmount();
        _credit(FREE_POOL, msg.value);
    }

    /// @notice OWNER only. There is deliberately no chain-wide daily ceiling.
    /// @param maxOpCost max `maxCost` of a single op the free pool will fund
    /// @param senderDailyLimit per-sender (smart account) spend per UTC day on the free pool (0 = no on-chain limit)
    /// @param enabled false switches the free tier off
    function setFreeTier(uint128 maxOpCost, uint112 senderDailyLimit, bool enabled) external onlyOwner {
        // A non-zero per-sender limit below the per-op cap would make every free op fail (review 3, A7).
        if (senderDailyLimit != 0 && senderDailyLimit < maxOpCost) revert InvalidFreeTierConfig();
        freeMaxOpCost = maxOpCost;
        sponsors[FREE_POOL].senderDailyLimit = senderDailyLimit;
        freeEnabled = enabled;
        emit FreeTierConfigured(maxOpCost, senderDailyLimit, enabled);
    }

    /// @notice OWNER or MANAGER: emergency stop for the free tier (only the owner can configure/re-enable it fully).
    function pauseFreePool() external onlyOwnerOrManager {
        freeEnabled = false;
        emit FreeTierConfigured(freeMaxOpCost, sponsors[FREE_POOL].senderDailyLimit, false);
    }

    /// @notice OWNER only: cap on an op's maxFeePerGas the free pool will fund (wei, > 0). Overrides the default.
    function setFreeMaxFeePerGas(uint128 cap) external onlyOwner {
        _setMaxFeePerGas(FREE_POOL, cap);
    }

    function setFreeTargets(address[] calldata targets, bool allowed) external onlyOwnerOrManager {
        _setTargets(FREE_POOL, targets, allowed);
    }

    /// @notice Permissionless. Moves unattributable EntryPoint deposit (postOp overhead residue, direct deposits)
    /// above `SURPLUS_RESERVE` into the FREE POOL ledger. This is the ONLY way surplus ever leaves the unallocated
    /// state, and it can only go to the free pool: no function sends it to the owner or any chosen address.
    function creditSurplusToFreePool() external returns (uint256 credited) {
        uint256 available = surplus();
        if (available <= SURPLUS_RESERVE) revert NothingToCredit();
        credited = available - SURPLUS_RESERVE;
        Sponsor storage s = sponsors[FREE_POOL];
        uint256 newBalance = uint256(s.balance) + credited;
        if (newBalance > type(uint128).max) revert CostTooLarge();
        s.balance = uint128(newBalance);
        totalLiabilities += credited;
        emit SurplusCreditedToFreePool(credited);
        emit Deposited(FREE_POOL, address(this), credited, newBalance);
    }

    /*//////////////////////////////////////////////////////////////
                                 ADMIN
    //////////////////////////////////////////////////////////////*/

    /// @notice OWNER only. After `renounceOwnership` the manager can no longer be changed.
    function setManager(address newManager) external onlyOwner {
        manager = newManager;
        emit ManagerSet(newManager);
    }

    /// @notice OWNER only. Can only LOWER the overhead (or restore it up to the deployed value): the bounds are
    /// [MIN_POSTOP_OVERHEAD_GAS, maxPostOpOverheadGas], and `maxPostOpOverheadGas` is immutable.
    function setPostOpOverheadGas(uint32 gas) external onlyOwner {
        if (gas < MIN_POSTOP_OVERHEAD_GAS || gas > maxPostOpOverheadGas) revert OverheadOutOfBounds();
        postOpOverheadGas = gas;
        emit PostOpOverheadGasSet(gas);
    }

    /// @notice Propose adding a signer (kind 1) or a bundler executor (kind 2). It takes effect only through
    /// `executeAdminChange`, `adminChangeDelay` (>= 48h) later, so every project can see the pending change (event
    /// `AdminChangeProposed`) and pause before it can matter. Removals are instant.
    function proposeAdminChange(uint8 kind, address account) external onlyOwnerOrManager {
        // address(0) may be (re-)allowlisted as a BUNDLER (gas estimation simulates with tx.origin == 0), never as a signer.
        if ((account == address(0) && kind == KIND_SIGNER) || (kind != KIND_SIGNER && kind != KIND_BUNDLER)) {
            revert InvalidAdminChange();
        }
        bytes32 key = _changeKey(kind, account);
        uint48 pending = pendingAdminChange[key];
        if (pending != 0 && block.timestamp <= pending + PENDING_EXPIRY) revert AdminChangeAlreadyProposed();
        pending = uint48(block.timestamp) + adminChangeDelay;
        pendingAdminChange[key] = pending;
        emit AdminChangeProposed(key, kind, account, pending);
    }

    function executeAdminChange(uint8 kind, address account) external onlyOwnerOrManager {
        bytes32 key = _changeKey(kind, account);
        uint48 at = pendingAdminChange[key];
        if (at == 0 || block.timestamp > at + PENDING_EXPIRY) revert AdminChangeNotProposed();
        if (block.timestamp < at) revert AdminChangeNotReady(at);
        delete pendingAdminChange[key];
        if (kind == KIND_SIGNER) {
            signers[account] = true;
            emit SignerAdded(account);
        } else {
            isBundlerAllowed[account] = true;
            emit BundlerAllowlistUpdated(account, true);
        }
    }

    /// @notice Veto a pending addition (owner or manager).
    function cancelAdminChange(uint8 kind, address account) external onlyOwnerOrManager {
        bytes32 key = _changeKey(kind, account);
        if (pendingAdminChange[key] == 0) revert AdminChangeNotProposed();
        delete pendingAdminChange[key];
        emit AdminChangeCancelled(key, kind, account);
    }

    /// @notice INSTANT (a removal can only make the paymaster safer). Also cancels a pending addition.
    function removeSigner(address _signer) external onlyOwnerOrManager {
        signers[_signer] = false;
        signerRemovedAt[_signer] = uint48(block.timestamp);
        delete pendingAdminChange[_changeKey(KIND_SIGNER, _signer)];
        emit SignerRemoved(_signer);
    }

    /// @notice INSTANT removal of bundler executors. Also cancels pending additions of the same addresses.
    function removeBundlers(address[] calldata bundlers) external onlyOwnerOrManager {
        for (uint256 i = 0; i < bundlers.length; i++) {
            isBundlerAllowed[bundlers[i]] = false;
            delete pendingAdminChange[_changeKey(KIND_BUNDLER, bundlers[i])];
            emit BundlerAllowlistUpdated(bundlers[i], false);
        }
    }

    function _changeKey(uint8 kind, address account) internal pure returns (bytes32) {
        return keccak256(abi.encode(kind, account));
    }

    /// @notice Stake is separate from the deposit and is not part of any ledger. The stake/unlock/withdrawStake calls
    /// below are the ONLY EntryPoint money-moving calls this contract can make besides `depositTo`; they act on the
    /// stake slot, never on the deposit slot that backs the ledgers.
    function addStake(uint32 unstakeDelaySec) external payable onlyOwner {
        if (unstakeDelaySec > MAX_ADMIN_CHANGE_DELAY) revert DelayTooLong();
        entryPoint.addStake{ value: msg.value }(unstakeDelaySec);
    }

    /// @notice OWNER only: unlocking stake knocks the paymaster out of "staked" status (ERC-7562), halting sponsorship.
    function unlockStake() external onlyOwner {
        entryPoint.unlockStake();
    }

    /// @notice OWNER only. Stake is the chain's own (never a sponsor's) money.
    function withdrawStake(address payable to) external onlyOwner {
        entryPoint.withdrawStake(to);
    }

    /*//////////////////////////////////////////////////////////////
                                 VIEWS
    //////////////////////////////////////////////////////////////*/

    function getProject(bytes32 sponsorId)
        external
        view
        returns (
            address projectOwner,
            bool paused,
            uint112 senderDailyLimit,
            uint128 balance,
            uint112 dailyLimit,
            uint112 spentToday,
            uint32 spentDay
        )
    {
        Sponsor storage s = sponsors[sponsorId];
        return (
            s.owner,
            s.paused,
            s.senderDailyLimit,
            s.balance,
            s.dailyLimit,
            s.spentToday,
            s.spentDay
        );
    }

    /// @notice The maxFeePerGas cap validation enforces for `sponsorId` (its own, else the immutable default).
    function effectiveMaxFeePerGas(bytes32 sponsorId) external view returns (uint256) {
        return _effectiveMaxFeePerGas(sponsorId);
    }

    function _effectiveMaxFeePerGas(bytes32 sponsorId) internal view returns (uint256 cap) {
        cap = sponsors[sponsorId].maxFeePerGas;
        if (cap == 0) cap = defaultMaxFeePerGas;
    }

    function isTargetAllowed(bytes32 sponsorId, address target) external view returns (bool) {
        return targetAllowed[sponsorId][target];
    }

    /// @notice What `sender` has reserved/spent from `sponsorId` on `day` (validAfter / 1 days).
    function getSenderSpend(bytes32 sponsorId, address sender) external view returns (uint32 day, uint112 spent) {
        SenderSpend storage ss = senderSpend[sponsorId][sender];
        return (ss.day, ss.spent);
    }

    /// @notice projectId = keccak256(bytes(appId)): one canonical project per Privy app id.
    function projectIdOf(string calldata appId) public pure returns (bytes32) {
        return keccak256(bytes(appId));
    }

    /// @notice EIP-712 domain separator of the claim attestation (binds chainId and this paymaster's address).
    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    /// @notice The EIP-712 digest a signer signs to attest that `newOwner` controls Privy app `appId`.
    function claimDigest(string calldata appId, address newOwner, uint256 nonce, uint256 deadline)
        public
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(abi.encode(CLAIM_TYPEHASH, keccak256(bytes(appId)), newOwner, nonce, deadline));
        return MessageHashUtils.toTypedDataHash(domainSeparator(), structHash);
    }

    /// @notice EntryPoint deposit not owed to any sponsor (unattributable; creditable only to the free pool).
    function surplus() public view returns (uint256) {
        uint256 deposit = entryPoint.balanceOf(address(this));
        return deposit > totalLiabilities ? deposit - totalLiabilities : 0;
    }

    /*//////////////////////////////////////////////////////////////
                               INTERNALS
    //////////////////////////////////////////////////////////////*/

    function _credit(bytes32 sponsorId, uint256 amount) internal {
        Sponsor storage s = sponsors[sponsorId];
        uint256 newBalance = uint256(s.balance) + amount; // amount <= msg.value, so no uint256 overflow
        if (newBalance > type(uint128).max) revert CostTooLarge();
        s.balance = uint128(newBalance);
        totalLiabilities += amount;
        emit Deposited(sponsorId, msg.sender, amount, newBalance);
        entryPoint.depositTo{ value: amount }(address(this));
    }

    function _setMaxFeePerGas(bytes32 sponsorId, uint128 cap) internal {
        if (cap == 0) revert ZeroFeeCap();
        // A sponsor can only TIGHTEN the immutable default (review 3, M-1): no owner can raise its cap above it.
        if (cap > defaultMaxFeePerGas) revert MaxFeePerGasTooHigh(cap, defaultMaxFeePerGas);
        sponsors[sponsorId].maxFeePerGas = cap;
        emit MaxFeePerGasSet(sponsorId, cap);
    }

    function _setTargets(bytes32 sponsorId, address[] calldata targets, bool allowed) internal {
        mapping(address => bool) storage list = targetAllowed[sponsorId];
        for (uint256 i = 0; i < targets.length; i++) {
            list[targets[i]] = allowed;
            emit TargetSet(sponsorId, targets[i], allowed);
        }
    }
}
