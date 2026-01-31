// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IERC3009 {
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

contract AckLinkVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Link {
        address sender;
        uint256 amount;
        uint64 createdAt;
        uint64 expiresAt;
        bool claimed;
        bool refunded;
        bytes32 metaHash;
    }

    IERC20 public immutable usdc;
    address public immutable feeVault;
    mapping(bytes32 => Link) public links;
    mapping(address => uint256) public nonces;

    event LinkCreated(
        bytes32 indexed linkId,
        address indexed sender,
        uint256 amount,
        uint64 expiresAt,
        bytes32 metaHash
    );

    event LinkClaimed(
        bytes32 indexed linkId,
        address indexed sender,
        address indexed to,
        uint256 amount
    );

    event LinkRefunded(
        bytes32 indexed linkId,
        address indexed sender,
        uint256 amount
    );

    constructor(address _usdc, address _feeVault) {
        require(_usdc != address(0), "AckLinkVault: usdc=0");
        require(_feeVault != address(0), "AckLinkVault: feeVault=0");
        usdc = IERC20(_usdc);
        feeVault = _feeVault;
    }

    function createLink(uint256 amount, uint64 expiresAt, bytes32 metaHash) external nonReentrant returns (bytes32 linkId) {
        require(amount > 0, "AckLinkVault: amount=0");
        require(expiresAt > block.timestamp, "AckLinkVault: expired");

        uint256 nonce = nonces[msg.sender]++;
        linkId = keccak256(
            abi.encodePacked(msg.sender, amount, expiresAt, metaHash, nonce, block.chainid, address(this))
        );

        links[linkId] = Link({
            sender: msg.sender,
            amount: amount,
            createdAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            claimed: false,
            refunded: false,
            metaHash: metaHash
        });

        usdc.safeTransferFrom(msg.sender, address(this), amount);

        emit LinkCreated(linkId, msg.sender, amount, expiresAt, metaHash);
    }

    function createLinkWithAuthorization(
        address from,
        uint256 totalUsdc6,
        uint256 feeUsdc6,
        uint64 expiresAt,
        bytes32 metaHash,
        bytes32 nonce,
        uint64 validAfter,
        uint64 validBefore,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant returns (bytes32 linkId) {
        require(from != address(0), "AckLinkVault: from=0");
        require(totalUsdc6 > feeUsdc6, "AckLinkVault: total<=fee");
        require(expiresAt > block.timestamp, "AckLinkVault: expired");

        IERC3009(address(usdc)).transferWithAuthorization(
            from,
            address(this),
            totalUsdc6,
            validAfter,
            validBefore,
            nonce,
            v,
            r,
            s
        );

        usdc.safeTransfer(feeVault, feeUsdc6);

        uint256 principal = totalUsdc6 - feeUsdc6;
        uint256 nonceCounter = nonces[from]++;
        linkId = keccak256(
            abi.encodePacked(from, principal, expiresAt, metaHash, nonceCounter, block.chainid, address(this))
        );

        links[linkId] = Link({
            sender: from,
            amount: principal,
            createdAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            claimed: false,
            refunded: false,
            metaHash: metaHash
        });

        emit LinkCreated(linkId, from, principal, expiresAt, metaHash);
    }

    function claim(bytes32 linkId, address to) external nonReentrant {
        Link storage link = links[linkId];
        require(link.sender != address(0), "AckLinkVault: link=0");
        require(!link.claimed, "AckLinkVault: claimed");
        require(!link.refunded, "AckLinkVault: refunded");
        require(block.timestamp < link.expiresAt, "AckLinkVault: expired");
        require(to != address(0), "AckLinkVault: to=0");

        link.claimed = true;

        usdc.safeTransfer(to, link.amount);

        emit LinkClaimed(linkId, link.sender, to, link.amount);
    }

    function refund(bytes32 linkId) external nonReentrant {
        Link storage link = links[linkId];
        require(link.sender != address(0), "AckLinkVault: link=0");
        require(!link.claimed, "AckLinkVault: claimed");
        require(!link.refunded, "AckLinkVault: refunded");
        require(block.timestamp >= link.expiresAt, "AckLinkVault: not_expired");

        link.refunded = true;

        usdc.safeTransfer(link.sender, link.amount);

        emit LinkRefunded(linkId, link.sender, link.amount);
    }
}
