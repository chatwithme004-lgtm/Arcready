// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Example of a contract that compiles and runs on Arc but misbehaves there.
interface IERC20 { function balanceOf(address) external view returns (uint256); }

contract Raffle {
    IERC20 public usdc = IERC20(0x3600000000000000000000000000000000000000);
    address[] public players;

    function enter() external payable {
        require(msg.value == 1e18, "1 USDC to enter");
        players.push(msg.sender);
    }

    function pot() public view returns (uint256) {
        return address(this).balance + usdc.balanceOf(address(this));
    }

    function draw() external {
        address winner = players[block.prevrandao % players.length];
        payable(winner).transfer(pot());
    }
}
