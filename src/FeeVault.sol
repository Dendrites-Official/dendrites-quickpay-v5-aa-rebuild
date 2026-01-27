// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract FeeVault is Ownable {
    using SafeERC20 for IERC20;

    address public feeCollector;
    mapping(address => bool) public isOperator;

    event FeeCollectorUpdated(address indexed oldCollector, address indexed newCollector);
    event OperatorUpdated(address indexed operator, bool allowed);
    event Swept(address indexed token, uint256 amount, address indexed to, address indexed by);

    constructor(address _feeCollector) Ownable(msg.sender) {
        require(_feeCollector != address(0), "FeeVault: feeCollector=0");
        feeCollector = _feeCollector;
    }

    function setFeeCollector(address newCollector) external onlyOwner {
        require(newCollector != address(0), "FeeVault: feeCollector=0");
        address old = feeCollector;
        feeCollector = newCollector;
        emit FeeCollectorUpdated(old, newCollector);
    }

    function setOperator(address op, bool allowed) external onlyOwner {
        isOperator[op] = allowed;
        emit OperatorUpdated(op, allowed);
    }

    function sweepERC20(address token, uint256 amount) external {
        require(isOperator[msg.sender] || msg.sender == owner(), "FeeVault: not authorized");
        IERC20(token).safeTransfer(feeCollector, amount);
        emit Swept(token, amount, feeCollector, msg.sender);
    }
}
