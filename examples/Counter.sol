// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Example of a contract with nothing Arc-specific to fix.
contract Counter {
    uint256 public count;
    function increment() external { count++; }
}
