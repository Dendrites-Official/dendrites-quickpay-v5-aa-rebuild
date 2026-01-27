// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";

import {QuickPayV5Paymaster} from "../src/QuickPayV5Paymaster.sol";

contract DeployPaymaster is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY_DEPLOYER");
        address entryPoint = vm.envAddress("ENTRYPOINT");
        address router = vm.envAddress("ROUTER");
        address feeVault = vm.envAddress("FEEVAULT");
        address feeCollector = vm.envAddress("FEE_COLLECTOR");

        vm.startBroadcast(pk);
        QuickPayV5Paymaster paymaster = new QuickPayV5Paymaster(IEntryPoint(entryPoint), router, feeVault, feeCollector);
        vm.stopBroadcast();

        console2.log("PAYMASTER:", address(paymaster));
    }
}
