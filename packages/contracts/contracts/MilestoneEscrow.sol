// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MilestoneEscrow {
    address public buyer;
    address public seller;
    address public arbiter;

    struct Milestone { uint256 amount; bool released; }
    Milestone[] public milestones;

    event EscrowCreated(address buyer, address seller, address arbiter);
    event Released(uint256 indexed id, uint256 amount);
    event Refunded(uint256 indexed id, uint256 amount);

    constructor(address _buyer, address _seller, address _arbiter, uint256[] memory amounts) payable {
        buyer = _buyer; seller = _seller; arbiter = _arbiter;
        for (uint i=0;i<amounts.length;i++){ milestones.push(Milestone(amounts[i], false)); }
        emit EscrowCreated(buyer, seller, arbiter);
    }

    function release(uint256 id) external {
        require(msg.sender == buyer || msg.sender == arbiter, "auth");
        require(!milestones[id].released, "released");
        milestones[id].released = true;
        (bool ok,) = payable(seller).call{value: milestones[id].amount}("");
        require(ok, "xfer");
        emit Released(id, milestones[id].amount);
    }

    function refund(uint256 id) external {
        require(msg.sender == arbiter, "arb only");
        require(!milestones[id].released, "released");
        milestones[id].released = true;
        (bool ok,) = payable(buyer).call{value: milestones[id].amount}("");
        require(ok, "xfer");
        emit Refunded(id, milestones[id].amount);
    }
}
