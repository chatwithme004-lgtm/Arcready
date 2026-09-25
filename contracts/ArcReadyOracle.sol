// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ArcReadyOracle — on-chain Arc compatibility check for any deployed contract
/// @notice Reads a contract's runtime bytecode with EXTCODECOPY and flags opcodes that behave
///         differently on Arc (docs.arc.io "EVM differences"). `scan` is a free view call any
///         contract or UI can use; `attest` records the result on-chain, tied to the code hash,
///         so wallets and apps can look it up later and see if the code has changed since.
contract ArcReadyOracle {
    // Flag bits, kept in sync with src/bytecode.js
    uint256 public constant PREVRANDAO = 1 << 0; // always 0 on Arc: randomness is predictable
    uint256 public constant SELFDESTRUCT = 1 << 1; // moves the contract's USDC; can revert
    uint256 public constant BLOBHASH = 1 << 2; // always 0 on Arc
    uint256 public constant BLOBBASEFEE = 1 << 3; // always 1 on Arc
    uint256 public constant BEACON_ROOTS = 1 << 4; // EIP-4788 contract not deployed on Arc
    uint256 public constant DELEGATED_EOA = 1 << 5; // EIP-7702 delegation, not a contract
    uint256 public constant NO_CODE = 1 << 6; // nothing deployed at the address

    uint256 private constant PROBLEMS = PREVRANDAO | SELFDESTRUCT | BLOBHASH | BLOBBASEFEE | BEACON_ROOTS;
    bytes20 private constant BEACON_ROOTS_ADDR = bytes20(0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02);
    bytes19 private constant BEACON_ROOTS_19 = bytes19(0x0F3df6D732807Ef1319fB7B8bB8522d0Beac02);

    struct Attestation {
        uint64 flags;
        uint32 size;
        uint64 timestamp;
        bytes32 codehash;
        address attester;
    }

    mapping(address => Attestation) public attestations;
    uint256 public attestationCount;

    event Attested(address indexed target, uint256 flags, bytes32 codehash, address indexed attester);

    /// @notice Free check. `ready` is true when none of the Arc problem opcodes are present.
    function scan(address target) public view returns (bool ready, uint256 flags, uint256 size) {
        bytes memory code = target.code;
        size = code.length;
        if (size == 0) return (false, NO_CODE, 0);
        if (size == 23 && code[0] == 0xef && code[1] == 0x01 && code[2] == 0x00) return (false, DELEGATED_EOA, size);
        flags = _walk(code, _codeEnd(code));
        ready = flags & PROBLEMS == 0;
    }

    /// @notice Record the current check result on-chain for `target`.
    function attest(address target) external returns (uint256 flags) {
        (, flags,) = scan(target);
        attestations[target] = Attestation({
            flags: uint64(flags),
            size: uint32(target.code.length),
            timestamp: uint64(block.timestamp),
            codehash: target.codehash,
            attester: msg.sender
        });
        attestationCount++;
        emit Attested(target, flags, target.codehash, msg.sender);
    }

    /// @notice Stored result, and whether the code is unchanged since it was recorded.
    function status(address target) external view returns (bool attested, bool ready, bool current, uint256 flags) {
        Attestation memory a = attestations[target];
        if (a.timestamp == 0) return (false, false, false, 0);
        return (true, a.flags & PROBLEMS == 0, a.codehash == target.codehash, a.flags);
    }

    // Solidity appends CBOR metadata whose length sits in the last two bytes. Those bytes are
    // data and may contain 0x44 or 0xff, so stop walking where the metadata starts.
    function _codeEnd(bytes memory code) private pure returns (uint256) {
        uint256 n = code.length;
        if (n < 4) return n;
        uint256 len = (uint256(uint8(code[n - 2])) << 8) | uint8(code[n - 1]);
        if (len == 0 || len >= 200 || len + 2 >= n) return n;
        uint256 cut = n - len - 2;
        bytes1 head = code[cut];
        return head == 0xa1 || head == 0xa2 ? cut : n;
    }

    function _walk(bytes memory code, uint256 end) private pure returns (uint256 flags) {
        for (uint256 i = 0; i < end; ) {
            uint8 op = uint8(code[i]);
            if (op >= 0x60 && op <= 0x7f) {
                uint256 n = op - 0x5f;
                // Compilers push this address as PUSH19 because its first byte is zero.
                if (n == 20 && i + 20 < end && _read20(code, i + 1) == BEACON_ROOTS_ADDR) flags |= BEACON_ROOTS;
                if (n == 19 && i + 19 < end && bytes19(_read20(code, i + 1)) == BEACON_ROOTS_19) flags |= BEACON_ROOTS;
                i += n + 1;
                continue;
            }
            if (op == 0x44) flags |= PREVRANDAO;
            else if (op == 0xff) flags |= SELFDESTRUCT;
            else if (op == 0x49) flags |= BLOBHASH;
            else if (op == 0x4a) flags |= BLOBBASEFEE;
            unchecked { ++i; }
        }
    }

    function _read20(bytes memory code, uint256 offset) private pure returns (bytes20 out) {
        assembly {
            out := mload(add(add(code, 32), offset))
        }
    }
}
