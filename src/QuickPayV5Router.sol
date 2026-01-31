// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import {FeeVault} from "./FeeVault.sol";
import {IAllowanceTransfer} from "./permit2/IAllowanceTransfer.sol";

interface ISimpleAccountOwner {
    function owner() external view returns (address);
}

interface IERC3009 {
    function receiveWithAuthorization(
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

interface IERC20Permit {
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external;
}

contract QuickPayV5Router is Ownable {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_BULK_RECIPIENTS = 25;

    FeeVault public feeVault;
    IAllowanceTransfer public permit2;
    address public stipendSigner;
    uint256 public stipendMaxWei;
    mapping(bytes32 => bool) public usedStipend;
    mapping(address => bool) public tokenAllowed;

    event Permit2Updated(address indexed oldPermit2, address indexed newPermit2);
    event StipendConfigUpdated(
        address indexed oldSigner, address indexed newSigner, uint256 oldMaxWei, uint256 newMaxWei
    );
    event ActivationStipendSent(address indexed owner, address indexed token, uint256 stipendWei, bytes32 voucherHash);

    event FinalFeeComputed(
        address indexed from,
        address indexed tokenSent,
        address indexed feeToken,
        uint256 amount,
        uint256 finalFee,
        address to
    );

    event BulkReceipt(
        address indexed from,
        address indexed token,
        uint256 totalNet,
        uint256 feeAmount,
        bytes32 indexed referenceId,
        uint256 recipientCount
    );

    event BulkItem(bytes32 indexed referenceId, address indexed to, uint256 amount);

    constructor(address _feeVault) Ownable(msg.sender) {
        require(_feeVault != address(0), "QuickPayV5Router: feeVault=0");
        feeVault = FeeVault(_feeVault);
    }

    receive() external payable {}

    function setFeeVault(address newVault) external onlyOwner {
        require(newVault != address(0), "QuickPayV5Router: feeVault=0");
        feeVault = FeeVault(newVault);
    }

    function setTokenAllowed(address token, bool allowed) external onlyOwner {
        tokenAllowed[token] = allowed;
    }

    function setPermit2(address newPermit2) external onlyOwner {
        require(newPermit2 != address(0), "QuickPayV5Router: permit2=0");
        address old = address(permit2);
        permit2 = IAllowanceTransfer(newPermit2);
        emit Permit2Updated(old, newPermit2);
    }

    function setStipendConfig(address signer, uint256 maxWei) external onlyOwner {
        require(signer != address(0), "QuickPayV5Router: signer=0");
        require(maxWei > 0, "QuickPayV5Router: maxWei=0");
        address oldSigner = stipendSigner;
        uint256 oldMax = stipendMaxWei;
        stipendSigner = signer;
        stipendMaxWei = maxWei;
        emit StipendConfigUpdated(oldSigner, signer, oldMax, maxWei);
    }

    function sendERC20Sponsored(
        address from,
        address token,
        address to,
        uint256 amount,
        address feeToken,
        uint256 finalFee
    ) external {
        require(from == msg.sender, "QuickPayV5Router: from!=sender");
        require(tokenAllowed[token] == true, "QuickPayV5Router: token not allowed");
        require(to != address(0), "QuickPayV5Router: to=0");
        require(amount > 0, "QuickPayV5Router: amount=0");

        if (feeToken == token) {
            require(finalFee <= amount, "QuickPayV5Router: fee>amount");
            IERC20(token).safeTransferFrom(msg.sender, to, amount - finalFee);
            IERC20(token).safeTransferFrom(msg.sender, address(feeVault), finalFee);
        } else {
            require(feeToken != address(0), "QuickPayV5Router: feeToken=0");
            IERC20(token).safeTransferFrom(msg.sender, to, amount);
            IERC20(feeToken).safeTransferFrom(msg.sender, address(feeVault), finalFee);
        }

        emit FinalFeeComputed(from, token, feeToken, amount, finalFee, to);
    }

    function sendERC20Permit2Sponsored(
        address from,
        address token,
        address to,
        uint256 amount,
        address feeToken,
        uint256 finalFee,
        address owner
    ) external {
        require(address(permit2) != address(0), "QuickPayV5Router: permit2 not set");
        require(tokenAllowed[token] == true, "QuickPayV5Router: token not allowed");
        require(to != address(0), "QuickPayV5Router: to=0");
        require(amount > 0, "QuickPayV5Router: amount=0");

        // for now: default fee from token sent only
        require(feeToken == token, "QuickPayV5Router: feeToken!=token");

        // we want receipts to show the EOA owner as 'from'
        require(from == owner, "QuickPayV5Router: from!=owner");

        // restrict: only the user's AA account (SimpleAccount) can trigger pulls from the user's EOA
        require(ISimpleAccountOwner(msg.sender).owner() == owner, "QuickPayV5Router: caller not owner AA");

        require(finalFee <= amount, "QuickPayV5Router: fee>amount");

        // Permit2 uses uint160 amounts
        require(amount <= type(uint160).max, "QuickPayV5Router: amount>u160");
        require(finalFee <= type(uint160).max, "QuickPayV5Router: fee>u160");

        uint256 net = amount - finalFee;

        if (net > 0) {
            permit2.transferFrom(owner, to, uint160(net), token);
        }
        if (finalFee > 0) {
            permit2.transferFrom(owner, address(feeVault), uint160(finalFee), token);
        }

        emit FinalFeeComputed(from, token, feeToken, amount, finalFee, to);
    }

    function sendERC20Permit2WithPermitSponsored(
        address from,
        address token,
        address to,
        uint256 amount,
        address feeToken,
        uint256 finalFee,
        address owner,
        IAllowanceTransfer.PermitSingle calldata permitSingle,
        bytes calldata permitSig
    ) external {
        require(address(permit2) != address(0), "QuickPayV5Router: permit2 not set");
        require(tokenAllowed[token] == true, "QuickPayV5Router: token not allowed");
        require(to != address(0), "QuickPayV5Router: to=0");
        require(amount > 0, "QuickPayV5Router: amount=0");

        // for now: default fee from token sent only
        require(feeToken == token, "QuickPayV5Router: feeToken!=token");

        // we want receipts to show the EOA owner as 'from'
        require(from == owner, "QuickPayV5Router: from!=owner");

        // restrict: only the user's AA account (SimpleAccount) can trigger pulls from the user's EOA
        require(ISimpleAccountOwner(msg.sender).owner() == owner, "QuickPayV5Router: caller not owner AA");

        require(finalFee <= amount, "QuickPayV5Router: fee>amount");

        // Permit2 uses uint160 amounts
        require(amount <= type(uint160).max, "QuickPayV5Router: amount>u160");
        require(finalFee <= type(uint160).max, "QuickPayV5Router: fee>u160");

        require(permitSingle.details.token == token, "QuickPayV5Router: permit token mismatch");
        require(permitSingle.spender == address(this), "QuickPayV5Router: permit spender mismatch");
        require(permitSingle.details.amount >= amount, "QuickPayV5Router: permit amount low");
        require(permitSingle.details.expiration >= block.timestamp, "QuickPayV5Router: permit expired");
        require(permitSingle.sigDeadline >= block.timestamp, "QuickPayV5Router: sig expired");

        permit2.permit(owner, permitSingle, permitSig);

        uint256 net = amount - finalFee;

        if (net > 0) {
            permit2.transferFrom(owner, to, uint160(net), token);
        }
        if (finalFee > 0) {
            permit2.transferFrom(owner, address(feeVault), uint160(finalFee), token);
        }

        emit FinalFeeComputed(from, token, feeToken, amount, finalFee, to);
    }

    function sendERC20EIP3009Sponsored(
        address from,
        address token,
        address to,
        uint256 amount,
        address feeToken,
        uint256 finalFee,
        address owner,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(tokenAllowed[token] == true, "QuickPayV5Router: token not allowed");
        require(to != address(0), "QuickPayV5Router: to=0");
        require(amount > 0, "QuickPayV5Router: amount=0");
        require(finalFee <= amount, "QuickPayV5Router: fee>amount");
        require(feeToken == token, "QuickPayV5Router: feeToken!=token");
        require(from == owner, "QuickPayV5Router: from!=owner");
        require(ISimpleAccountOwner(msg.sender).owner() == owner, "QuickPayV5Router: caller not owner AA");

        IERC3009(token).receiveWithAuthorization(owner, address(this), amount, validAfter, validBefore, nonce, v, r, s);

        uint256 net = amount - finalFee;
        if (net > 0) {
            IERC20(token).safeTransfer(to, net);
        }
        if (finalFee > 0) {
            IERC20(token).safeTransfer(address(feeVault), finalFee);
        }

        emit FinalFeeComputed(from, token, feeToken, amount, finalFee, to);
    }

    function bulkSendUSDCWithAuthorization(
        address from,
        address token,
        address[] calldata recipients,
        uint256[] calldata amounts,
        uint256 feeAmount,
        bytes32 referenceId,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external {
        require(tokenAllowed[token] == true, "QuickPayV5Router: token not allowed");
        require(recipients.length > 0, "QuickPayV5Router: empty recipients");
        require(recipients.length == amounts.length, "QuickPayV5Router: bad recipients");
        require(recipients.length <= MAX_BULK_RECIPIENTS, "QuickPayV5Router: too many recipients");
        require(from != address(0), "QuickPayV5Router: from=0");
        require(ISimpleAccountOwner(msg.sender).owner() == from, "QuickPayV5Router: caller not owner AA");

        uint256 totalNet = 0;
        for (uint256 i = 0; i < recipients.length; i++) {
            address to = recipients[i];
            uint256 amt = amounts[i];
            require(to != address(0), "QuickPayV5Router: to=0");
            require(amt > 0, "QuickPayV5Router: amount=0");
            totalNet += amt;
        }

        uint256 total = totalNet + feeAmount;
        require(total > 0, "QuickPayV5Router: total=0");

        (uint8 v, bytes32 r, bytes32 s) = _splitSignature(signature);

        IERC3009(token).receiveWithAuthorization(
            from,
            address(this),
            total,
            validAfter,
            validBefore,
            nonce,
            v,
            r,
            s
        );

        for (uint256 i = 0; i < recipients.length; i++) {
            IERC20(token).safeTransfer(recipients[i], amounts[i]);
            emit BulkItem(referenceId, recipients[i], amounts[i]);
        }
        if (feeAmount > 0) {
            IERC20(token).safeTransfer(address(feeVault), feeAmount);
        }

        emit BulkReceipt(from, token, totalNet, feeAmount, referenceId, recipients.length);
    }

    function sendERC20EIP2612Sponsored(
        address from,
        address token,
        address to,
        uint256 amount,
        address feeToken,
        uint256 finalFee,
        address owner,
        uint256 permitDeadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(tokenAllowed[token] == true, "QuickPayV5Router: token not allowed");
        require(to != address(0), "QuickPayV5Router: to=0");
        require(amount > 0, "QuickPayV5Router: amount=0");
        require(finalFee <= amount, "QuickPayV5Router: fee>amount");
        require(feeToken == token, "QuickPayV5Router: feeToken!=token");
        require(from == owner, "QuickPayV5Router: from!=owner");
        require(ISimpleAccountOwner(msg.sender).owner() == owner, "QuickPayV5Router: caller not owner AA");

        IERC20Permit(token).permit(owner, address(this), amount, permitDeadline, v, r, s);
        IERC20(token).safeTransferFrom(owner, address(this), amount);

        uint256 net = amount - finalFee;
        if (net > 0) {
            IERC20(token).safeTransfer(to, net);
        }
        if (finalFee > 0) {
            IERC20(token).safeTransfer(address(feeVault), finalFee);
        }

        emit FinalFeeComputed(from, token, feeToken, amount, finalFee, to);
    }

    function activatePermit2Stipend(
        address owner,
        address token,
        uint256 stipendWei,
        uint256 nonce,
        uint256 deadline,
        bytes calldata sig
    ) external {
        require(tokenAllowed[token] == true, "QuickPayV5Router: token not allowed");
        require(owner != address(0), "QuickPayV5Router: owner=0");
        require(stipendWei > 0 && stipendWei <= stipendMaxWei, "QuickPayV5Router: bad stipend");
        require(block.timestamp <= deadline, "QuickPayV5Router: expired");

        bytes32 voucherHash = keccak256(
            abi.encodePacked(
                "DENDRITES_STIPEND", owner, token, stipendWei, nonce, deadline, block.chainid, address(this)
            )
        );
        require(!usedStipend[voucherHash], "QuickPayV5Router: used");
        usedStipend[voucherHash] = true;

        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(voucherHash);
        address recovered = ECDSA.recover(ethHash, sig);
        require(recovered == stipendSigner, "QuickPayV5Router: bad sig");

        (bool ok,) = owner.call{value: stipendWei}("");
        require(ok, "QuickPayV5Router: stipend send failed");

        emit ActivationStipendSent(owner, token, stipendWei, voucherHash);
    }

    function _splitSignature(bytes calldata signature) internal pure returns (uint8 v, bytes32 r, bytes32 s) {
        require(signature.length == 65, "QuickPayV5Router: bad sig");
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
    }
}
