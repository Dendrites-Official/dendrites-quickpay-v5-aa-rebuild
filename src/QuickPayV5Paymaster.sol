// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {BasePaymaster} from "account-abstraction/core/BasePaymaster.sol";
import {PackedUserOperation as UserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {SimpleAccount} from "account-abstraction/samples/SimpleAccount.sol";
import {_packValidationData} from "account-abstraction/core/Helpers.sol";

interface IQuickPayV5Router {
    function permit2() external view returns (address);
}

contract QuickPayV5Paymaster is BasePaymaster {
    using SafeERC20 for IERC20;

    address public router;
    address public feeVault;
    address public feeCollector;
    address public acklinkVault;
    uint32 public capBps;
    uint256 public stipendMaxWei;
    uint256 public ecoBaselineUsd6;
    uint256 public instantBaselineUsd6;
    uint256 public firstTxSurchargeUsd6;

    mapping(address => bool) public feeTokenAllowed;
    mapping(address => uint8) public feeTokenDecimals;
    mapping(address => uint256) public usd6PerWholeToken;
    mapping(address => bool) public firstTxSurchargePaid;

    event RouterUpdated(address indexed oldRouter, address indexed newRouter);
    event FeeTokenConfigUpdated(address indexed token, bool allowed, uint8 decimals, uint256 usd6PerWholeToken);
    event CapBpsUpdated(uint32 oldCapBps, uint32 newCapBps);
    event StipendMaxWeiUpdated(uint256 oldVal, uint256 newVal);
    event BaselinesUpdated(uint256 ecoUsd6, uint256 instantUsd6);
    event SurchargeUpdated(uint256 oldUsd6, uint256 newUsd6);
    event DepositWithdrawn(address indexed to, uint256 amount);
    event PaymasterFeeQuoted(
        address indexed payer,
        address indexed feeToken,
        uint8 mode,
        uint256 baselineUsd6,
        uint256 surchargeUsd6,
        uint256 requiredMinMaxFeeUsd6,
        uint256 finalFeeTokenAmount
    );

    constructor(
        IEntryPoint _entryPoint,
        address _router,
        address _feeVault,
        address _feeCollector,
        address _acklinkVault
    )
        BasePaymaster(_entryPoint)
    {
        require(address(_entryPoint) != address(0), "QuickPayV5Paymaster: entryPoint=0");
        require(_router != address(0), "QuickPayV5Paymaster: router=0");
        require(_feeVault != address(0), "QuickPayV5Paymaster: feeVault=0");
        require(_feeCollector != address(0), "QuickPayV5Paymaster: feeCollector=0");
        require(_acklinkVault != address(0), "QuickPayV5Paymaster: acklinkVault=0");

        router = _router;
        feeVault = _feeVault;
        feeCollector = _feeCollector;
        acklinkVault = _acklinkVault;

        capBps = 14500;
        ecoBaselineUsd6 = 200000;
        instantBaselineUsd6 = 300000;
        firstTxSurchargeUsd6 = 100000;
    }

    function setRouter(address newRouter) external onlyOwner {
        require(newRouter != address(0), "QuickPayV5Paymaster: router=0");
        address old = router;
        router = newRouter;
        emit RouterUpdated(old, newRouter);
    }

    function setCapBps(uint32 newCapBps) external onlyOwner {
        require(newCapBps >= 10000, "QuickPayV5Paymaster: capBps<10000");
        uint32 old = capBps;
        capBps = newCapBps;
        emit CapBpsUpdated(old, newCapBps);
    }

    function setStipendMaxWei(uint256 newMax) external onlyOwner {
        require(newMax > 0, "Paymaster: max=0");
        uint256 old = stipendMaxWei;
        stipendMaxWei = newMax;
        emit StipendMaxWeiUpdated(old, newMax);
    }

    function setBaselines(uint256 ecoUsd6, uint256 instantUsd6) external onlyOwner {
        ecoBaselineUsd6 = ecoUsd6;
        instantBaselineUsd6 = instantUsd6;
        emit BaselinesUpdated(ecoUsd6, instantUsd6);
    }

    function setFirstTxSurcharge(uint256 newUsd6) external onlyOwner {
        uint256 old = firstTxSurchargeUsd6;
        firstTxSurchargeUsd6 = newUsd6;
        emit SurchargeUpdated(old, newUsd6);
    }

    function setFeeTokenConfig(address token, bool allowed, uint8 decimals, uint256 priceUsd6PerWholeToken)
        external
        onlyOwner
    {
        require(token != address(0), "QuickPayV5Paymaster: token=0");
        if (allowed) {
            require(priceUsd6PerWholeToken > 0, "QuickPayV5Paymaster: price=0");
        }

        feeTokenAllowed[token] = allowed;
        feeTokenDecimals[token] = decimals;
        usd6PerWholeToken[token] = priceUsd6PerWholeToken;

        emit FeeTokenConfigUpdated(token, allowed, decimals, priceUsd6PerWholeToken);
    }

    function withdrawDepositTo(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "QuickPayV5Paymaster: to=0");
        entryPoint.withdrawTo(payable(to), amount);
        emit DepositWithdrawn(to, amount);
    }

    function _ceilDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        if (a == 0) return 0;
        return (a + b - 1) / b;
    }

    function quoteFeeUsd6(
        address payer,
        uint8 mode, // 0=SEND, 1=ACTIVATE_APPROVE
        uint8 speed, // 0=ECO, 1=INSTANT
        uint256 nowTs // passed from offchain for consistent quoting
    )
        external
        view
        returns (
            uint256 baselineUsd6,
            uint256 surchargeUsd6,
            uint256 finalFeeUsd6,
            uint256 capBpsValue,
            uint256 maxFeeRequiredUsd6,
            bool firstTxSurchargeApplies
        )
    {
        nowTs;

        capBpsValue = uint256(capBps);

        require(mode == 0 || mode == 1, "QuickPayV5Paymaster: bad mode");
        require(speed == 0 || speed == 1, "QuickPayV5Paymaster: bad speed");

        if (mode == 1) {
            // ACTIVATE_APPROVE: no fee (mirrors current validation behavior).
            baselineUsd6 = 0;
            surchargeUsd6 = 0;
            finalFeeUsd6 = 0;
            maxFeeRequiredUsd6 = 0;
            firstTxSurchargeApplies = false;
            return (baselineUsd6, surchargeUsd6, finalFeeUsd6, capBpsValue, maxFeeRequiredUsd6, firstTxSurchargeApplies);
        }

        baselineUsd6 = (speed == 0) ? ecoBaselineUsd6 : instantBaselineUsd6;

        bool paid = firstTxSurchargePaid[payer];
        firstTxSurchargeApplies = !paid;
        surchargeUsd6 = paid ? 0 : firstTxSurchargeUsd6;

        finalFeeUsd6 = baselineUsd6 + surchargeUsd6;
        // ceil(finalFeeUsd6 * capBps / 10000)
        maxFeeRequiredUsd6 = (finalFeeUsd6 * capBpsValue + 9999) / 10000;
    }

    function _parseAndValidateRouterCall(UserOperation calldata userOp, address expectedFeeToken)
        internal
        view
        returns (address token, uint256 amount, uint256 finalFee)
    {
        bytes calldata cd = userOp.callData;
        require(cd.length >= 4, "QuickPayV5Paymaster: callData too short");

        bytes4 sel;
        assembly {
            sel := calldataload(cd.offset)
        }
        bytes memory func;
        if (sel == 0xb61d27f6) {
            // execute(address dest,uint256 value,bytes func)
            (address dest, uint256 value, bytes memory innerFunc) = abi.decode(cd[4:], (address, uint256, bytes));
            require(dest == router, "QuickPayV5Paymaster: wrong dest");
            require(value == 0, "QuickPayV5Paymaster: nonzero value");
            func = innerFunc;
        } else if (sel == 0x47e1da2a) {
            // executeBatch(address[] dest,uint256[] value,bytes[] func)
            (address[] memory dests, uint256[] memory values, bytes[] memory funcs) = abi.decode(
                cd[4:],
                (address[], uint256[], bytes[])
            );
            require(dests.length == funcs.length && values.length == funcs.length, "QuickPayV5Paymaster: bad batch");
            require(dests.length == 2, "QuickPayV5Paymaster: bad batch length");
            require(values[0] == 0 && values[1] == 0, "QuickPayV5Paymaster: nonzero value");

            address permit2Addr = IQuickPayV5Router(router).permit2();
            require(dests[0] == permit2Addr, "QuickPayV5Paymaster: bad permit2 dest");
            require(dests[1] == router, "QuickPayV5Paymaster: wrong dest");

            func = funcs[1];
        } else {
            revert("QuickPayV5Paymaster: not execute()/executeBatch()");
        }

        require(func.length >= 4 + 32 * 6, "QuickPayV5Paymaster: bad inner call");

        bytes4 innerSelector;
        assembly {
            innerSelector := mload(add(func, 0x20))
        }

        bytes4 SEL_SEND_ERC20 = bytes4(keccak256("sendERC20Sponsored(address,address,address,uint256,address,uint256)"));
        bytes4 SEL_SEND_ERC20_PERMIT2 =
            bytes4(keccak256("sendERC20Permit2Sponsored(address,address,address,uint256,address,uint256,address)"));
        bytes4 SEL_SEND_ERC20_EIP2612 = bytes4(
            keccak256(
                "sendERC20EIP2612Sponsored(address,address,address,uint256,address,uint256,address,uint256,uint8,bytes32,bytes32)"
            )
        );
        bytes4 SEL_SEND_ERC20_EIP3009 = bytes4(
            keccak256(
                "sendERC20EIP3009Sponsored(address,address,address,uint256,address,uint256,address,uint256,uint256,bytes32,uint8,bytes32,bytes32)"
            )
        );
        bytes4 SEL_BULK_EIP3009 = bytes4(
            keccak256(
                "bulkSendUSDCWithAuthorization(address,address,address[],uint256[],uint256,bytes32,uint256,uint256,bytes32,bytes)"
            )
        );

        require(
            innerSelector == SEL_SEND_ERC20 || innerSelector == SEL_SEND_ERC20_PERMIT2
                || innerSelector == SEL_SEND_ERC20_EIP2612 || innerSelector == SEL_SEND_ERC20_EIP3009
                || innerSelector == SEL_BULK_EIP3009,
            "Paymaster: invalid router method"
        );

        address from;
        address to;
        address feeTokenInCall;
        address owner;
        bool isBulk = false;
        address[] memory bulkRecipients;
        uint256[] memory bulkAmounts;

        if (innerSelector == SEL_SEND_ERC20_EIP3009) {
            uint256 validAfter;
            uint256 validBefore;
            bytes32 nonce;
            uint8 v;
            bytes32 r;
            bytes32 s;
            require(func.length >= 4 + 32 * 13, "QuickPayV5Paymaster: bad inner call");
            assembly {
                let dataPtr := add(func, 0x20)
                // For address args, skip the 12-byte left padding inside each 32-byte slot.
                // Slots start at offsets 4 + 32*n. Address bytes begin at offset + 12.
                from := shr(96, mload(add(dataPtr, 16)))
                token := shr(96, mload(add(dataPtr, 48)))
                to := shr(96, mload(add(dataPtr, 80)))
                amount := mload(add(dataPtr, 100))
                feeTokenInCall := shr(96, mload(add(dataPtr, 144)))
                finalFee := mload(add(dataPtr, 164))
                owner := shr(96, mload(add(dataPtr, 208)))
                validAfter := mload(add(dataPtr, 228))
                validBefore := mload(add(dataPtr, 260))
                nonce := mload(add(dataPtr, 292))
                v := byte(31, mload(add(dataPtr, 324)))
                r := mload(add(dataPtr, 356))
                s := mload(add(dataPtr, 388))
            }
            require(from == owner, "QuickPayV5Paymaster: from!=owner");
        } else if (innerSelector == SEL_BULK_EIP3009) {
            uint256 feeAmount;
            bytes32 referenceId;
            uint256 validAfter;
            uint256 validBefore;
            bytes32 nonce;
            bytes memory sig;
            bytes memory funcParams = new bytes(func.length - 4);
            assembly {
                let len := sub(mload(func), 4)
                let src := add(func, 0x24)
                let dst := add(funcParams, 0x20)
                for { let i := 0 } lt(i, len) { i := add(i, 0x20) } { mstore(add(dst, i), mload(add(src, i))) }
            }
            (from, token, bulkRecipients, bulkAmounts, feeAmount, referenceId, validAfter, validBefore, nonce, sig) =
                abi.decode(
                    funcParams,
                    (address, address, address[], uint256[], uint256, bytes32, uint256, uint256, bytes32, bytes)
                );
            referenceId;
            validAfter;
            validBefore;
            nonce;
            sig;
            feeTokenInCall = token;
            finalFee = feeAmount;
            isBulk = true;

            require(bulkRecipients.length > 0, "QuickPayV5Paymaster: empty recipients");
            require(bulkRecipients.length == bulkAmounts.length, "QuickPayV5Paymaster: bad recipients");

            uint256 totalNet = 0;
            for (uint256 i = 0; i < bulkAmounts.length; i++) {
                require(bulkRecipients[i] != address(0), "QuickPayV5Paymaster: to=0");
                require(bulkAmounts[i] > 0, "QuickPayV5Paymaster: amount=0");
                totalNet += bulkAmounts[i];
            }
            amount = totalNet + feeAmount;
            to = bulkRecipients[0];
        } else if (innerSelector == SEL_SEND_ERC20_EIP2612) {
            uint256 permitDeadline;
            uint8 v;
            bytes32 r;
            bytes32 s;
            require(func.length >= 4 + 32 * 11, "QuickPayV5Paymaster: bad inner call");
            bytes memory funcParams = new bytes(func.length - 4);
            assembly {
                let len := sub(mload(func), 4)
                let src := add(func, 0x24)
                let dst := add(funcParams, 0x20)
                for { let i := 0 } lt(i, len) { i := add(i, 0x20) } { mstore(add(dst, i), mload(add(src, i))) }
            }
            (from, token, to, amount, feeTokenInCall, finalFee, owner, permitDeadline, v, r, s) = abi.decode(
                funcParams,
                (address, address, address, uint256, address, uint256, address, uint256, uint8, bytes32, bytes32)
            );
            permitDeadline;
            v;
            r;
            s;
            require(from == owner, "QuickPayV5Paymaster: from!=owner");
        } else {
            // sendERC20Sponsored(address from,address token,address to,uint256 amount,address feeToken,uint256 finalFee)
            assembly {
                let dataPtr := add(func, 0x20)
                // For address args, skip the 12-byte left padding inside each 32-byte slot.
                // Slots start at offsets 4 + 32*n. Address bytes begin at offset + 12.
                from := shr(96, mload(add(dataPtr, 16)))
                token := shr(96, mload(add(dataPtr, 48)))
                to := shr(96, mload(add(dataPtr, 80)))
                amount := mload(add(dataPtr, 100))
                feeTokenInCall := shr(96, mload(add(dataPtr, 144)))
                finalFee := mload(add(dataPtr, 164))
                owner := shr(96, mload(add(dataPtr, 208)))
            }

            if (innerSelector == SEL_SEND_ERC20) {
                require(from == userOp.sender, "QuickPayV5Paymaster: from!=sender");
            } else {
                require(func.length >= 4 + 32 * 7, "QuickPayV5Paymaster: bad inner call");
                require(from == owner, "QuickPayV5Paymaster: from!=owner");
            }
        }
        require(token != address(0), "QuickPayV5Paymaster: token=0");
        if (!isBulk) {
            require(to != address(0), "QuickPayV5Paymaster: to=0");
        }
        require(amount > 0, "QuickPayV5Paymaster: amount=0");
        require(feeTokenInCall == expectedFeeToken, "QuickPayV5Paymaster: feeToken mismatch");
    }

    function _computeAndValidateFee(
        address payer,
        uint8 mode,
        uint8 speed,
        address feeToken,
        uint256 maxFeeUsd6,
        address token,
        uint256 amount,
        uint256 finalFee
    ) internal {
        uint256 baselineUsd6 = (speed == 0) ? ecoBaselineUsd6 : instantBaselineUsd6;
        uint256 surchargeUsd6 = firstTxSurchargePaid[payer] ? 0 : firstTxSurchargeUsd6;
        uint256 totalUsd6 = baselineUsd6 + surchargeUsd6;

        uint256 requiredMinMaxFeeUsd6 = _ceilDiv(totalUsd6 * uint256(capBps), 10000);
        require(maxFeeUsd6 >= requiredMinMaxFeeUsd6, "QuickPayV5Paymaster: maxFeeUsd6 too low");

        uint8 decimals = feeTokenDecimals[feeToken];
        require(decimals > 0, "QuickPayV5Paymaster: decimals not set");
        uint256 price = usd6PerWholeToken[feeToken];
        require(price > 0, "QuickPayV5Paymaster: price not set");

        uint256 finalFeeTokenAmount = _ceilDiv(totalUsd6 * (10 ** uint256(decimals)), price);
        require(finalFee == finalFeeTokenAmount, "QuickPayV5Paymaster: finalFee mismatch");

        if (feeToken == token) {
            require(finalFeeTokenAmount <= amount, "QuickPayV5Paymaster: fee>amount");
        }

        emit PaymasterFeeQuoted(
            payer, feeToken, mode, baselineUsd6, surchargeUsd6, requiredMinMaxFeeUsd6, finalFeeTokenAmount
        );
    }

    function _validatePaymasterUserOp(UserOperation calldata userOp, bytes32, uint256)
        internal
        override
        returns (bytes memory context, uint256 validationData)
    {
        uint8 mode;
        uint8 speed;
        address feeToken;
        uint256 maxFeeUsd6;
        uint48 validUntil;
        uint48 validAfter;

        {
            require(
                userOp.paymasterAndData.length >= PAYMASTER_DATA_OFFSET, "QuickPayV5Paymaster: bad paymasterAndData"
            );
            bytes calldata paymasterData = userOp.paymasterAndData[PAYMASTER_DATA_OFFSET:];

            // Backward compatible paymasterData:
            // - old: (uint8 mode, address feeToken, uint256 maxFeeUsd6, uint48 validUntil, uint48 validAfter)
            // - new: (uint8 mode, uint8 speed, address feeToken, uint256 maxFeeUsd6, uint48 validUntil, uint48 validAfter)
            if (paymasterData.length == 32 * 5) {
                (mode, feeToken, maxFeeUsd6, validUntil, validAfter) =
                    abi.decode(paymasterData, (uint8, address, uint256, uint48, uint48));
                speed = 0;
            } else {
                // Preserve existing revert string for malformed paymasterData.
                require(paymasterData.length == 32 * 6, "QuickPayV5Paymaster: bad paymasterAndData");
                (mode, speed, feeToken, maxFeeUsd6, validUntil, validAfter) =
                    abi.decode(paymasterData, (uint8, uint8, address, uint256, uint48, uint48));
            }
        }

        require(mode == 0 || mode == 1 || mode == 2 || mode == 3, "QuickPayV5Paymaster: bad mode");
        require(speed == 0 || speed == 1, "QuickPayV5Paymaster: bad speed");
        if (mode != 2) {
            require(feeTokenAllowed[feeToken] == true, "QuickPayV5Paymaster: feeToken not allowed");
        }
        require(block.timestamp >= validAfter, "QuickPayV5Paymaster: too early");
        if (validUntil != 0) {
            require(block.timestamp <= validUntil, "QuickPayV5Paymaster: expired");
        }

        // Parse SimpleAccount.execute(...) for activate lanes.
        bytes calldata cd = userOp.callData;
        require(cd.length >= 4, "QuickPayV5Paymaster: callData too short");

        bytes4 sel;
        assembly {
            sel := calldataload(cd.offset)
        }

        address dest;
        uint256 value;
        bytes memory func;
        if (mode != 0) {
            require(sel == 0xb61d27f6, "QuickPayV5Paymaster: not execute()");
            (dest, value, func) = abi.decode(cd[4:], (address, uint256, bytes));
        }

        if (mode == 2) {
            // ACTIVATE_STIPEND: execute(router, 0, activatePermit2Stipend(...))
            require(value == 0, "QuickPayV5Paymaster: nonzero value");
            require(dest == router, "QuickPayV5Paymaster: wrong dest");
            require(func.length >= 4 + 32 * 5, "QuickPayV5Paymaster: bad inner call");

            bytes4 innerSelector;
            assembly {
                innerSelector := mload(add(func, 0x20))
            }

            bytes4 SEL_ACTIVATE_STIPEND =
                bytes4(keccak256("activatePermit2Stipend(address,address,uint256,uint256,uint256,bytes)"));
            require(innerSelector == SEL_ACTIVATE_STIPEND, "QuickPayV5Paymaster: wrong method");

            uint256 stipendWei;
            assembly {
                let dataPtr := add(func, 0x20)
                stipendWei := mload(add(dataPtr, 68))
            }
            require(stipendWei <= stipendMaxWei, "QuickPayV5Paymaster: stipend too high");

            require(maxFeeUsd6 == 0, "QuickPayV5Paymaster: fee must be zero");

            context = abi.encode(userOp.sender, mode);
            validationData = _packValidationData(false, validUntil, validAfter);
            return (context, validationData);
        }

        if (mode == 1) {
            // ACTIVATE_APPROVE: execute(feeToken, 0, approve(router, type(uint256).max))
            require(value == 0, "QuickPayV5Paymaster: nonzero value");
            require(dest == feeToken, "QuickPayV5Paymaster: wrong dest");

            require(func.length >= 4 + 32 * 2, "QuickPayV5Paymaster: bad inner call");

            bytes4 innerSelector;
            assembly {
                innerSelector := mload(add(func, 0x20))
            }
            require(innerSelector == IERC20.approve.selector, "QuickPayV5Paymaster: wrong method");

            address spender;
            uint256 approveAmount;
            assembly {
                let dataPtr := add(func, 0x20)
                spender := shr(96, mload(add(dataPtr, 16)))
                approveAmount := mload(add(dataPtr, 36))
            }
            require(spender == router, "QuickPayV5Paymaster: wrong spender");
            require(approveAmount == type(uint256).max, "QuickPayV5Paymaster: wrong amount");

            context = abi.encode(userOp.sender, mode);
            validationData = _packValidationData(false, validUntil, validAfter);
            return (context, validationData);
        }

        if (mode == 3) {
            // ACKLINK: execute(acklinkVault, 0, createLinkWithAuthorization(...))
            require(sel == 0xb61d27f6, "QuickPayV5Paymaster: not execute()");
            require(value == 0, "QuickPayV5Paymaster: nonzero value");
            require(dest == acklinkVault, "QuickPayV5Paymaster: wrong dest");
            require(func.length >= 4, "QuickPayV5Paymaster: bad inner call");

            bytes4 innerSelector;
            assembly {
                innerSelector := mload(add(func, 0x20))
            }

            bytes4 SEL_ACKLINK_CREATE = bytes4(
                keccak256(
                    "createLinkWithAuthorization(address,uint256,uint256,uint64,bytes32,bytes32,bytes32,uint64,uint64,uint8,bytes32,bytes32)"
                )
            );
            bytes4 SEL_ACKLINK_CLAIM = bytes4(keccak256("claim(bytes32,address,bytes)"));
            bytes4 SEL_ACKLINK_REFUND = bytes4(keccak256("refund(bytes32)"));
            require(
                innerSelector == SEL_ACKLINK_CREATE || innerSelector == SEL_ACKLINK_CLAIM
                    || innerSelector == SEL_ACKLINK_REFUND,
                "QuickPayV5Paymaster: wrong method"
            );

            if (innerSelector == SEL_ACKLINK_CREATE) {
                require(func.length >= 4 + 32 * 12, "QuickPayV5Paymaster: bad inner call");
                address from;
                uint256 totalUsdc6;
                uint256 feeUsdc6;
                uint64 expiresAt;
                bytes32 metaHash;
                bytes32 codeHash;
                bytes32 authNonce;
                uint64 validAfterAuth;
                uint64 validBeforeAuth;
                uint8 v;
                bytes32 r;
                bytes32 s;
                bytes memory funcParams = new bytes(func.length - 4);
                assembly {
                    let len := sub(mload(func), 4)
                    let src := add(func, 0x24)
                    let dst := add(funcParams, 0x20)
                    for { let i := 0 } lt(i, len) { i := add(i, 0x20) } { mstore(add(dst, i), mload(add(src, i))) }
                }
                (
                    from,
                    totalUsdc6,
                    feeUsdc6,
                    expiresAt,
                    metaHash,
                    codeHash,
                    authNonce,
                    validAfterAuth,
                    validBeforeAuth,
                    v,
                    r,
                    s
                ) = abi.decode(
                    funcParams,
                    (address, uint256, uint256, uint64, bytes32, bytes32, bytes32, uint64, uint64, uint8, bytes32, bytes32)
                );
                expiresAt;
                metaHash;
                codeHash;
                authNonce;
                validAfterAuth;
                validBeforeAuth;
                v;
                r;
                s;

                require(from != address(0), "QuickPayV5Paymaster: from=0");
                require(totalUsdc6 > feeUsdc6, "QuickPayV5Paymaster: fee>=total");

                _computeAndValidateFee(userOp.sender, mode, speed, feeToken, maxFeeUsd6, feeToken, totalUsdc6, feeUsdc6);
            } else if (innerSelector == SEL_ACKLINK_CLAIM) {
                require(func.length >= 4 + 32 * 3, "QuickPayV5Paymaster: bad inner call");
                require(maxFeeUsd6 == 0, "QuickPayV5Paymaster: fee must be zero");
            } else {
                require(func.length >= 4 + 32 * 1, "QuickPayV5Paymaster: bad inner call");
                require(maxFeeUsd6 == 0, "QuickPayV5Paymaster: fee must be zero");
            }

            context = abi.encode(userOp.sender, mode);
            validationData = _packValidationData(false, validUntil, validAfter);
            return (context, validationData);
        }

        // mode == 0: SEND (allow execute or executeBatch)
        (address token, uint256 amount, uint256 finalFee) = _parseAndValidateRouterCall(userOp, feeToken);
        _computeAndValidateFee(userOp.sender, mode, speed, feeToken, maxFeeUsd6, token, amount, finalFee);

        context = abi.encode(userOp.sender, mode);
        validationData = _packValidationData(false, validUntil, validAfter);
    }

    function _postOp(PostOpMode, bytes calldata context, uint256, uint256) internal override {
        (address payer, uint8 mode) = abi.decode(context, (address, uint8));
        if ((mode == 0 || mode == 3) && !firstTxSurchargePaid[payer]) {
            firstTxSurchargePaid[payer] = true;
        }
    }
}
