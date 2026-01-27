// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal interface for Uniswap Permit2 (AllowanceTransfer).
/// We only include what our Router will need.
interface IAllowanceTransfer {
    struct PermitDetails {
        address token;
        uint160 amount;
        uint48 expiration;
        uint48 nonce;
    }

    struct PermitSingle {
        PermitDetails details;
        address spender;
        uint256 sigDeadline;
    }

    /// @notice Returns (amount, expiration, nonce) for an allowance.
    function allowance(address owner, address token, address spender)
        external
        view
        returns (uint160 amount, uint48 expiration, uint48 nonce);

    /// @notice Sets an allowance via signature.
    function permit(address owner, PermitSingle calldata permitSingle, bytes calldata signature) external;

    /// @notice Transfers tokens using Permit2 allowance.
    function transferFrom(address from, address to, uint160 amount, address token) external;
}
