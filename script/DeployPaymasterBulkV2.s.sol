// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";

import {QuickPayV5Paymaster} from "../src/QuickPayV5Paymaster.sol";

contract DeployPaymasterBulkV2 is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY_DEPLOYER");
        if (pk == 0) {
            pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        }
        address entryPoint = vm.envAddress("ENTRYPOINT");
        address routerBulk = vm.envAddress("ROUTER_BULK");
        address feeVault = vm.envAddress("FEEVAULT");
        address feeCollector = vm.envAddress("FEE_COLLECTOR");
        uint256 chainId = vm.envUint("CHAIN_ID");
        require(chainId == 84532, "DeployPaymasterBulkV2: CHAIN_ID must be 84532");

        vm.startBroadcast(pk);
        QuickPayV5Paymaster paymaster = new QuickPayV5Paymaster(IEntryPoint(entryPoint), routerBulk, feeVault, feeCollector);
        vm.stopBroadcast();

        console2.log("PAYMASTER_BULK:", address(paymaster));
    }
}
