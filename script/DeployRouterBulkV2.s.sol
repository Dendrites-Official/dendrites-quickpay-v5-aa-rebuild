// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {QuickPayV5Router} from "../src/QuickPayV5Router.sol";

contract DeployRouterBulkV2 is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY_DEPLOYER");
        if (pk == 0) {
            pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        }
        address feeVault = vm.envAddress("FEEVAULT");
        uint256 chainId = vm.envUint("CHAIN_ID");
        require(chainId == 84532, "DeployRouterBulkV2: CHAIN_ID must be 84532");

        vm.startBroadcast(pk);

        QuickPayV5Router router = new QuickPayV5Router(address(feeVault));

        vm.stopBroadcast();

        console2.log("ROUTER_BULK:", address(router));
    }
}
