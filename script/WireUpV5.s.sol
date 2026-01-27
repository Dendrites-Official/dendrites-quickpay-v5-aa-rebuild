// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {QuickPayV5Router} from "../src/QuickPayV5Router.sol";
import {QuickPayV5Paymaster} from "../src/QuickPayV5Paymaster.sol";

contract WireUpV5 is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY_DEPLOYER");
        address payable router = payable(vm.envAddress("ROUTER"));
        address paymaster = vm.envAddress("PAYMASTER");
        address usdc = vm.envAddress("USDC");
        address permit2 = vm.envAddress("PERMIT2");
        address stipendSigner = vm.envAddress("STIPEND_SIGNER");
        uint256 stipendMaxWei = vm.envUint("STIPEND_MAX_WEI");

        vm.startBroadcast(pk);

        QuickPayV5Router(router).setTokenAllowed(usdc, true);
        QuickPayV5Paymaster(paymaster).setFeeTokenConfig(usdc, true, 6, 1_000_000);
        QuickPayV5Router(router).setPermit2(permit2);
        QuickPayV5Router(router).setStipendConfig(stipendSigner, stipendMaxWei);
        QuickPayV5Paymaster(paymaster).setStipendMaxWei(stipendMaxWei);

        vm.stopBroadcast();

        console2.log("WIRED_ROUTER_TOKEN_USDC:", true);
        console2.log("WIRED_PAYMASTER_USDC_PRICE:", uint256(1000000));
    }
}
