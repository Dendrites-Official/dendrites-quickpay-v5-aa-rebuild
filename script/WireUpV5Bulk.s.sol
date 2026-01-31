// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";

import {QuickPayV5Router} from "../src/QuickPayV5Router.sol";
import {QuickPayV5Paymaster} from "../src/QuickPayV5Paymaster.sol";

contract WireUpV5Bulk is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY_DEPLOYER");
        if (pk == 0) {
            pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        }
        address payable routerBulk = payable(vm.envAddress("ROUTER_BULK"));
        address paymasterBulk = vm.envAddress("PAYMASTER_BULK");
        address usdc = vm.envAddress("USDC");
        address permit2 = vm.envAddress("PERMIT2");
        address stipendSigner = vm.envAddress("STIPEND_SIGNER");
        uint256 stipendMaxWei = vm.envUint("STIPEND_MAX_WEI");
        address feeVault = vm.envAddress("FEEVAULT");
        address entryPoint = vm.envAddress("ENTRYPOINT");
        uint256 chainId = vm.envUint("CHAIN_ID");
        require(chainId == 84532, "WireUpV5Bulk: CHAIN_ID must be 84532");

        uint256 depositEth = vm.envOr("BULK_PAYMASTER_DEPOSIT_ETH", uint256(0));
        if (depositEth == 0) {
            depositEth = 0.001 ether;
        }

        vm.startBroadcast(pk);

        QuickPayV5Router(routerBulk).setFeeVault(feeVault);
        QuickPayV5Paymaster(paymasterBulk).setRouter(address(routerBulk));
        QuickPayV5Router(routerBulk).setTokenAllowed(usdc, true);
        QuickPayV5Paymaster(paymasterBulk).setFeeTokenConfig(usdc, true, 6, 1_000_000);
        QuickPayV5Router(routerBulk).setPermit2(permit2);
        QuickPayV5Router(routerBulk).setStipendConfig(stipendSigner, stipendMaxWei);
        QuickPayV5Paymaster(paymasterBulk).setStipendMaxWei(stipendMaxWei);

        if (depositEth > 0) {
            IEntryPoint(entryPoint).depositTo{value: depositEth}(paymasterBulk);
        }

        vm.stopBroadcast();

        console2.log("WIRED_ROUTER_BULK_TOKEN_USDC:", true);
        console2.log("WIRED_PAYMASTER_BULK_USDC_PRICE:", uint256(1000000));
        console2.log("WIRED_ROUTER_BULK:", routerBulk);
        console2.log("WIRED_PAYMASTER_BULK:", paymasterBulk);
        console2.log("WIRED_ENTRYPOINT:", entryPoint);
        console2.log("WIRED_FEEVAULT:", feeVault);
    }
}
