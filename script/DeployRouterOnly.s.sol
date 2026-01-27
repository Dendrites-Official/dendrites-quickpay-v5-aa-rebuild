// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {QuickPayV5Router} from "../src/QuickPayV5Router.sol";

contract DeployRouterOnly is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY_DEPLOYER");
        address feeVault = vm.envAddress("FEEVAULT");

        vm.startBroadcast(pk);

        QuickPayV5Router router = new QuickPayV5Router(address(feeVault));

        vm.stopBroadcast();

        console2.log("ROUTER:", address(router));
    }
}
